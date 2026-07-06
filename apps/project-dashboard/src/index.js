import { registerMfe } from "/packages/ui/src/moduleRegistry.js";

function formatDate(value) {
  if (!value) return "Never";
  const date = new Date(value);
  const today = new Date();
  const yesterday = new Date();
  yesterday.setDate(today.getDate() - 1);
  if (date.toDateString() === today.toDateString()) return "Today";
  if (date.toDateString() === yesterday.toDateString()) return "Yesterday";
  return date.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}

function escapeHtml(value = "") {
  return String(value).replace(/[&<>'"]/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", "\"": "&quot;" })[character]);
}

registerMfe("project-dashboard", (element, { state, api, bus }) => {
  let projects = [];
  let recent = [];
  let loading = true;
  let error = "";

  async function load() {
    if (!state.user) {
      loading = false;
      projects = [];
      recent = [];
      render();
      return;
    }
    try {
      loading = true;
      render();
      const data = await api.request("/api/projects");
      projects = data.projects ?? [];
      recent = data.recent ?? [];
      error = "";
    } catch (caught) {
      error = caught.message;
    } finally {
      loading = false;
      render();
    }
  }

  function projectCard(project) {
    return `
      <article class="project-card" data-project="${project.id}">
        <div>
          <h3>${escapeHtml(project.name)}</h3>
          <p class="muted">Modified: ${formatDate(project.updated_at)} · ${project.diagram_count ?? 0} diagram${project.diagram_count === 1 ? "" : "s"}</p>
        </div>
        <div class="project-card-actions">
          <button data-open="${project.id}" class="primary">Open</button>
          <button data-rename="${project.id}">Rename</button>
          <button data-delete="${project.id}" class="danger">Delete</button>
        </div>
      </article>
    `;
  }

  function render() {
    element.innerHTML = `
      <section class="dashboard-shell">
        <div class="dashboard-hero">
          <div>
            <p class="eyebrow">Project Dashboard</p>
            <h1>Welcome${state.user ? `, ${escapeHtml(state.user.email)}` : ""}</h1>
            <p class="muted">Create, reopen, and manage SysML/UML modeling projects before entering the editor.</p>
          </div>
          <button id="new-project" class="primary dashboard-new" ${state.user ? "" : "disabled"}>+ New Project</button>
        </div>
        ${!state.user ? `<div class="dashboard-empty">Login to create and manage your saved projects.</div>` : ""}
        ${error ? `<div class="dashboard-error">${escapeHtml(error)}</div>` : ""}
        ${loading ? `<div class="dashboard-empty">Loading projects…</div>` : ""}
        ${state.user && !loading ? `
          <section class="dashboard-section">
            <h2>My Projects</h2>
            <div class="project-grid">${projects.map(projectCard).join("") || `<div class="dashboard-empty">No projects yet. Start with + New Project.</div>`}</div>
          </section>
          <section class="dashboard-section">
            <h2>Recent Projects</h2>
            <div class="recent-list">
              ${recent.map((project) => `<button data-open="${project.id}" class="recent-item"><span>${escapeHtml(project.name)}</span><span class="muted">${formatDate(project.last_opened_at)}</span></button>`).join("") || `<span class="muted">No recent projects yet.</span>`}
            </div>
          </section>
        ` : ""}
      </section>
    `;

    element.querySelector("#new-project")?.addEventListener("click", async () => {
      const name = prompt("Project name", "Untitled Project");
      if (!name) return;
      const project = await api.request("/api/projects", { method: "POST", body: JSON.stringify({ name }) });
      bus.emit("project:open", project.id);
    });
    element.querySelectorAll("[data-open]").forEach((button) => {
      button.addEventListener("click", () => bus.emit("project:open", button.dataset.open));
    });
    element.querySelectorAll("[data-rename]").forEach((button) => {
      button.addEventListener("click", async () => {
        const project = projects.find((item) => item.id === button.dataset.rename);
        const name = prompt("Rename project", project?.name ?? "");
        if (!name || name === project?.name) return;
        await api.request(`/api/projects/${button.dataset.rename}`, { method: "PATCH", body: JSON.stringify({ name }) });
        bus.emit("toast", "Project renamed");
        await load();
      });
    });
    element.querySelectorAll("[data-delete]").forEach((button) => {
      button.addEventListener("click", async () => {
        const project = projects.find((item) => item.id === button.dataset.delete);
        if (!confirm(`Delete "${project?.name ?? "this project"}"? This also deletes its diagrams.`)) return;
        await api.request(`/api/projects/${button.dataset.delete}`, { method: "DELETE" });
        bus.emit("toast", "Project deleted");
        await load();
      });
    });
  }

  bus.on("auth:changed", load);
  load();
});
