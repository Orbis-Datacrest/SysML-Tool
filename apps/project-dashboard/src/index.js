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
  let dashboardView = "workspace";
  const starredStorageKey = () => `sysml-starred-projects:${state.user?.id ?? state.user?.email ?? "anonymous"}`;
  const readStarred = () => {
    try { return new Set(JSON.parse(localStorage.getItem(starredStorageKey()) ?? "[]")); }
    catch { return new Set(); }
  };
  let starredIds = readStarred();

  function persistStarred() {
    localStorage.setItem(starredStorageKey(), JSON.stringify([...starredIds]));
  }

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
    const isStarred = starredIds.has(String(project.id));
    return `
      <article class="project-card" data-open-card="${project.id}" role="button" tabindex="0" aria-label="Open ${escapeHtml(project.name)}">
        <span class="project-card-icon" aria-hidden="true">◇</span><div>
          <h3>${escapeHtml(project.name)}</h3>
          <p class="muted">Modified: ${formatDate(project.updated_at)} · ${project.diagram_count ?? 0} diagram${project.diagram_count === 1 ? "" : "s"}</p>
          <span class="project-kind">SysML</span>
        </div>
        <div class="project-card-actions">
          <button data-star="${project.id}" class="star-button ${isStarred ? "starred" : ""}" title="${isStarred ? "Remove from starred" : "Add to starred"}" aria-label="${isStarred ? "Remove" : "Add"} ${escapeHtml(project.name)} ${isStarred ? "from" : "to"} starred" aria-pressed="${isStarred}">☆</button>
          <button data-delete="${project.id}" class="danger icon-button" title="Delete project" aria-label="Delete ${escapeHtml(project.name)}">
            <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" fill="currentColor" class="bi bi-trash-fill" viewBox="0 0 16 16" aria-hidden="true">
              <path d="M2.5 1a1 1 0 0 0-1 1v1a1 1 0 0 0 1 1H3v9a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2V4h.5a1 1 0 0 0 1-1V2a1 1 0 0 0-1-1H10a1 1 0 0 0-1-1H7a1 1 0 0 0-1 1zm3 4a.5.5 0 0 1 .5.5v7a.5.5 0 0 1-1 0v-7a.5.5 0 0 1 .5-.5M8 5a.5.5 0 0 1 .5.5v7a.5.5 0 0 1-1 0v-7A.5.5 0 0 1 8 5m3 .5v7a.5.5 0 0 1-1 0v-7a.5.5 0 0 1 1 0"/>
            </svg>
          </button>
        </div>
      </article>
    `;
  }

  function render() {
    const displayName = state.user?.email?.split("@")[0]?.replace(/[._-]+/g, " ") || "Engineer";
    const diagrams = projects.reduce((total, project) => total + Number(project.diagram_count ?? 0), 0);
    element.innerHTML = `
      <section class="dashboard-shell">
        <div class="dashboard-hero">
          <div class="dashboard-hero-copy">
            <p class="eyebrow"><span></span> Browser-based systems engineering</p>
            <h1>Welcome back, <em>${escapeHtml(displayName)}</em></h1>
            <p class="muted">Model architecture, connect requirements, and validate your design — all from one focused SysML workspace.</p>
          </div>
          <button id="new-project" class="primary dashboard-new" ${state.user ? "" : "disabled"}>+ New Project</button>
          <div class="dashboard-stats">
            <span><small>Projects</small><strong>${projects.length}</strong></span>
            <span><small>Diagrams</small><strong>${diagrams}</strong></span>
            <span><small>Last edit</small><strong>${recent[0] ? formatDate(recent[0].last_opened_at) : "—"}</strong></span>
          </div>
        </div>
        ${!state.user ? `<div class="dashboard-empty">Login to create and manage your saved projects.</div>` : ""}
        ${error ? `<div class="dashboard-error">${escapeHtml(error)}</div>` : ""}
        ${loading ? `<div class="dashboard-empty">Loading projects…</div>` : ""}
        ${state.user && !loading && dashboardView === "workspace" ? `
          <section class="dashboard-section">
            <div class="dashboard-section-heading"><div><h2>My Projects</h2><p>${projects.length} project${projects.length === 1 ? "" : "s"} in your workspace</p></div><label class="project-search"><span aria-hidden="true">⌕</span><input type="search" placeholder="Search projects" aria-label="Search projects"></label></div>
            <div class="project-grid">${projects.map(projectCard).join("") || `<div class="dashboard-empty">No projects yet. Start with + New Project.</div>`}<button class="new-project-card" type="button" data-create-project>＋ <span>New project</span></button></div>
          </section>
          <section class="dashboard-section">
            <h2>Recent Projects</h2>
            <div class="recent-list">
              ${recent.map((project) => `<button data-open="${project.id}" class="recent-item"><span class="recent-project"><i>◇</i><span><strong>${escapeHtml(project.name)}</strong><small>SysML · ${project.diagram_count ?? 0} diagrams</small></span></span><span class="muted">◷ ${formatDate(project.last_opened_at)}</span></button>`).join("") || `<span class="muted">No recent projects yet.</span>`}
            </div>
          </section>
        ` : ""}
        ${state.user && !loading && dashboardView === "starred" ? `
          <section class="dashboard-section dashboard-view-section"><div class="dashboard-section-heading"><div><p class="eyebrow">Saved projects</p><h2>Starred</h2><p>Projects you want to keep close at hand.</p></div></div><div class="project-grid">${projects.filter((project) => starredIds.has(String(project.id))).map(projectCard).join("") || `<div class="dashboard-empty">No starred projects yet. Use the star button on a project card to add one.</div>`}</div></section>
        ` : ""}
        ${state.user && !loading && dashboardView === "activity" ? `
          <section class="dashboard-section dashboard-view-section"><div class="dashboard-section-heading"><div><p class="eyebrow">Workspace timeline</p><h2>Activity</h2><p>Your latest project opens and model updates.</p></div></div><div class="activity-list">${recent.map((project) => `<button data-open="${project.id}" class="activity-item"><span class="activity-marker">◇</span><span><strong>${escapeHtml(project.name)}</strong><small>Opened ${formatDate(project.last_opened_at)} · ${project.diagram_count ?? 0} diagram${project.diagram_count === 1 ? "" : "s"}</small></span><time>${formatDate(project.last_opened_at)}</time></button>`).join("") || `<div class="dashboard-empty">Activity will appear here after you open or edit a project.</div>`}</div></section>
        ` : ""}
      </section>
    `;

    element.querySelectorAll("#new-project, [data-create-project]").forEach((button) => button.addEventListener("click", async () => {
      const project = await api.request("/api/projects", { method: "POST", body: JSON.stringify({ name: "Untitled Project" }) });
      bus.emit("project:open", project.id);
    }));
    element.querySelector(".project-search input")?.addEventListener("input", (event) => {
      const query = event.currentTarget.value.trim().toLowerCase();
      element.querySelectorAll("[data-open-card]").forEach((card) => { card.hidden = !card.textContent.toLowerCase().includes(query); });
    });
    element.querySelectorAll("[data-open]").forEach((button) => {
      button.addEventListener("click", () => bus.emit("project:open", button.dataset.open));
    });
    element.querySelectorAll("[data-open-card]").forEach((card) => {
      const open = () => bus.emit("project:open", card.dataset.openCard);
      card.addEventListener("click", (event) => { if (!event.target.closest("[data-delete], [data-star]")) open(); });
      card.addEventListener("keydown", (event) => {
        if (event.target.closest("[data-delete], [data-star]")) return;
        if (event.key !== "Enter" && event.key !== " ") return;
        event.preventDefault();
        open();
      });
    });
    element.querySelectorAll("[data-star]").forEach((button) => {
      button.addEventListener("click", (event) => {
        event.stopPropagation();
        const id = String(button.dataset.star);
        if (starredIds.has(id)) starredIds.delete(id); else starredIds.add(id);
        persistStarred();
        render();
      });
    });
    element.querySelectorAll("[data-delete]").forEach((button) => {
      button.addEventListener("click", async (event) => {
        event.stopPropagation();
        const project = projects.find((item) => item.id === button.dataset.delete);
        if (!confirm(`Delete "${project?.name ?? "this project"}"? This also deletes its diagrams.`)) return;
        await api.request(`/api/projects/${button.dataset.delete}`, { method: "DELETE" });
        bus.emit("toast", "Project deleted");
        await load();
      });
    });
  }

  const unsubscribe = bus.on("auth:changed", load);
  const unsubscribeView = bus.on("dashboard:view", (view) => { dashboardView = view; render(); });
  load();
  return () => { unsubscribe(); unsubscribeView(); };
});
