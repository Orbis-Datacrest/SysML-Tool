import { createEventBus, mountMfe } from "/packages/ui/src/moduleRegistry.js";
import "/apps/project-explorer/src/index.js";
import "/apps/project-dashboard/src/index.js";
import "/apps/element-palette/src/index.js";
import "/apps/diagram-canvas/src/index.js";
import "/apps/ai-advisor/src/index.js";
import "/apps/import-export/src/index.js";
import "/apps/auth-tenant-settings/src/index.js";

const state = {
  tenantId: "tenant_demo",
  authToken: localStorage.getItem("sysml.authToken") ?? "",
  refreshToken: localStorage.getItem("sysml.refreshToken") ?? "",
  user: null,
  view: "dashboard",
  historyOpen: false,
  versionHistory: [],
  settings: { theme: localStorage.getItem("sysml.theme") ?? "dark" },
  project: null,
  diagram: null,
  diagrams: [],
  selectedElementIds: [],
  selectedRelationshipId: null,
  relationshipKind: "association",
  saveStatus: "",
  history: [],
  future: []
};

const bus = createEventBus();
let autoSaveTimer = null;
applyTheme(state.settings.theme);

function escapeHtml(value = "") {
  return String(value).replace(/[&<>'"]/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", "\"": "&quot;" })[character]);
}

function rememberPage(view, projectId = state.project?.id) {
  localStorage.setItem("sysml.activeView", view);
  if (projectId) localStorage.setItem("sysml.activeProjectId", projectId);
}

function projectUrl(projectId) {
  const url = new URL(window.location.href);
  url.searchParams.set("project", projectId);
  return url;
}

function dashboardUrl() {
  const url = new URL(window.location.href);
  url.searchParams.delete("project");
  return url;
}

function applyTheme(theme) {
  const next = theme === "light" ? "light" : "dark";
  document.documentElement.dataset.theme = next;
  localStorage.setItem("sysml.theme", next);
}

const api = {
  async request(path, options = {}) {
    return this.rawRequest(path, options, true);
  },
  async rawRequest(path, options = {}, allowRefresh = true) {
    const authHeaders = state.authToken ? { authorization: `Bearer ${state.authToken}` } : {};
    const result = await fetch(path, {
      ...options,
      headers: { "content-type": "application/json", "x-tenant-id": state.tenantId, ...authHeaders, ...(options.headers ?? {}) }
    });
    if (result.status === 401 && allowRefresh && state.refreshToken && path !== "/api/auth/refresh") {
      const refreshed = await this.rawRequest("/api/auth/refresh", { method: "POST", body: JSON.stringify({ refreshToken: state.refreshToken }) }, false);
      state.authToken = refreshed.token;
      state.refreshToken = refreshed.refreshToken;
      state.user = refreshed.user;
      localStorage.setItem("sysml.authToken", refreshed.token);
      localStorage.setItem("sysml.refreshToken", refreshed.refreshToken);
      bus.emit("auth:changed", state.user);
      return this.rawRequest(path, options, false);
    }
    if (!result.ok) throw new Error((await result.json()).error ?? result.statusText);
    return result.headers.get("content-type")?.includes("application/json") ? result.json() : result.blob();
  },
  saveDiagram(diagram, { snapshot = false } = {}) {
    return this.request(`/api/diagrams/${diagram.id}${snapshot ? "?snapshot=1" : ""}`, { method: "PUT", body: JSON.stringify(diagram) });
  }
};

function setDiagram(diagram, recordHistory = true) {
  if (state.diagram && recordHistory) state.history.push(structuredClone(state.diagram));
  state.diagram = diagram;
  state.future = [];
  bus.emit("diagram:changed", diagram);
  scheduleAutoSave();
}

function updateSaveStatus(status) {
  state.saveStatus = status;
  const target = document.querySelector("#save-status");
  if (target) target.textContent = status;
}

function syncSavedDiagram(saved) {
  state.diagram = saved;
  state.diagrams = (state.diagrams ?? []).map((diagram) => diagram.id === saved.id ? saved : diagram);
}

function scheduleAutoSave() {
  if (state.view !== "editor" || !state.diagram?.id) return;
  clearTimeout(autoSaveTimer);
  updateSaveStatus("Unsaved");
  autoSaveTimer = setTimeout(() => saveCurrentDiagram({ snapshot: false }), 800);
}

async function saveCurrentDiagram({ snapshot = false } = {}) {
  if (!state.diagram?.id) return;
  clearTimeout(autoSaveTimer);
  try {
    updateSaveStatus(snapshot ? "Saving…" : "Auto-saving…");
    const saved = await api.saveDiagram(state.diagram, { snapshot });
    syncSavedDiagram(saved);
    updateSaveStatus(snapshot ? "Saved milestone" : "Saved");
    if (snapshot) await loadVersionHistory();
    setTimeout(() => {
      if (state.saveStatus === "Saved" || state.saveStatus === "Saved milestone") updateSaveStatus("");
    }, 1800);
  } catch (error) {
    updateSaveStatus("Save failed");
    bus.emit("toast", error.message);
  }
}

async function loadVersionHistory() {
  if (!state.project?.id) return;
  const result = await api.request(`/api/projects/${state.project.id}/versions`);
  state.versionHistory = result.versions ?? [];
}

bus.on("history:undo", () => {
  const previous = state.history.pop();
  if (!previous) return;
  state.future.push(structuredClone(state.diagram));
  state.diagram = previous;
  bus.emit("diagram:changed", state.diagram);
  scheduleAutoSave();
});

bus.on("history:redo", () => {
  const next = state.future.pop();
  if (!next) return;
  state.history.push(structuredClone(state.diagram));
  state.diagram = next;
  bus.emit("diagram:changed", state.diagram);
  scheduleAutoSave();
});

function updateWorkspaceTitle() {
  const title = document.querySelector("#project-title");
  const name = title?.querySelector(".project-name-text");
  if (name) name.textContent = state.project?.name ?? "Untitled Project";
}

function showDashboard({ updateHistory = true, replaceHistory = false } = {}) {
  state.view = "dashboard";
  state.historyOpen = false;
  rememberPage("dashboard");
  if (updateHistory) {
    const method = replaceHistory ? "replaceState" : "pushState";
    window.history[method]({ view: "dashboard" }, "", dashboardUrl());
  }
  renderShell();
}

function undoDiagram() {
  const previous = state.history.pop();
  if (!previous) return;
  state.future.push(structuredClone(state.diagram));
  state.diagram = previous;
  bus.emit("diagram:changed", state.diagram);
}

function redoDiagram() {
  const next = state.future.pop();
  if (!next) return;
  state.history.push(structuredClone(state.diagram));
  state.diagram = next;
  bus.emit("diagram:changed", state.diagram);
}

function renderShell() {
  applyTheme(state.settings.theme);
  document.querySelector("#app").innerHTML = `
    <header class="topbar">
      <div class="topbar-left">
        <button id="brand-home" class="brand-button" title="Open Project Dashboard" aria-label="Open Project Dashboard"><strong class="brand-mark"><span class="brand-icon">S</span>SysML Studio</strong></button>
        ${state.view === "editor" ? `<button id="manual-save" class="icon-button" title="Save Diagram" aria-label="Save Diagram">💾</button><span id="save-status" class="save-status">${state.saveStatus}</span>` : ""}
        ${state.view === "editor" ? `<button id="project-title" class="top-project-name" title="Rename project" aria-label="Rename project: ${escapeHtml(state.project?.name ?? "Untitled Project")}"><span class="project-name-text">${escapeHtml(state.project?.name ?? "Untitled Project")}</span><span class="project-name-edit" aria-hidden="true">✎</span></button>` : `<span id="project-title">Project Dashboard</span>`}
      </div>
      <div class="topbar-actions">
        ${state.view === "editor" ? `<button id="history-toggle" class="icon-button" title="Version History" aria-label="Version History">🕘</button>` : ""}
        <button id="theme-toggle" class="icon-button" title="Toggle ${state.settings.theme === "dark" ? "Light" : "Dark"} Mode" aria-label="Toggle ${state.settings.theme === "dark" ? "Light" : "Dark"} Mode">${state.settings.theme === "dark" ? "🌙" : "☀️"}</button>
        ${state.view === "editor" ? `<div class="share-control">
          <button id="share-project" class="share-button" title="Share project" aria-label="Open project sharing"><span class="share-lock" aria-hidden="true">🔒</span><span>Share</span><span class="share-chevron" aria-hidden="true">▾</span></button>
          <div id="share-popover" class="share-popover" hidden>
            <div class="share-popover-header"><div><strong>Share project</strong><small>${escapeHtml(state.project?.name ?? "Untitled Project")}</small></div><button id="close-share" class="share-close" aria-label="Close sharing">×</button></div>
            <form id="share-form">
              <label for="share-email">Invite by email</label>
              <div class="share-invite-row"><input id="share-email" type="email" autocomplete="email" placeholder="name@example.com" required><select id="share-role" aria-label="Access level"><option value="Viewer">Viewer</option><option value="Commenter">Commenter</option><option value="Editor">Editor</option></select></div>
              <p id="share-role-help" class="share-role-help">Can view the project but cannot make changes.</p>
              <button class="primary share-send" type="submit">Send invite</button>
            </form>
            <button id="copy-project-link" class="copy-project-link" type="button">Copy project link</button>
          </div>
        </div>` : ""}
        <section id="import-export" class="topbar-export"></section>
        ${state.view === "dashboard" ? `<section id="auth-session" class="topbar-auth"></section>` : ""}
      </div>
    </header>
    ${state.view === "editor" ? `
      <main class="workspace">
        <aside class="left-rail">
          <section id="project-explorer"></section>
          <section id="element-palette"></section>
          <section id="properties-panel"></section>
          <section id="import-export"></section>
          <section id="auth-tenant-settings"></section>
          <section id="left-account" class="left-account"></section>
        </aside>
        <section id="diagram-canvas" class="canvas-host"></section>
        <aside class="right-rail">
          <section id="ai-advisor"></section>
        </aside>
      </main>
    ` : `
      <main class="dashboard-host">
        <section id="project-dashboard"></section>
      </main>
    `}
    ${state.historyOpen ? `
      <div class="history-backdrop" role="presentation">
        <aside class="history-drawer" role="dialog" aria-modal="true" aria-labelledby="history-title">
          <div class="history-header">
            <div>
              <p class="eyebrow">Version History</p>
              <h2 id="history-title">${state.project?.name ?? "Project"}</h2>
            </div>
            <button id="close-history" title="Close history" aria-label="Close history">×</button>
          </div>
          <div class="history-body">
            ${state.versionHistory.map((item) => `
              <div class="version-card">
                <strong>Version ${item.version}</strong>
                <span class="muted">${new Date(item.created_at).toLocaleString()}</span>
                <span>${item.description}</span>
                <button data-restore-version="${item.version}">Restore</button>
              </div>
            `).join("") || `<p class="muted">No manual save milestones yet. Click the save icon to create one.</p>`}
          </div>
        </aside>
      </div>
    ` : ""}
  `;
  const context = { state, bus, api, setDiagram, undoDiagram, redoDiagram };
  if (state.view === "dashboard") mountMfe("auth-session", document.querySelector("#auth-session"), context);
  if (state.view === "dashboard") {
    mountMfe("project-dashboard", document.querySelector("#project-dashboard"), context);
  } else {
    mountMfe("project-explorer", document.querySelector("#project-explorer"), context);
    mountMfe("element-palette", document.querySelector("#element-palette"), context);
    mountMfe("diagram-canvas", document.querySelector("#diagram-canvas"), context);
    mountMfe("ai-advisor", document.querySelector("#ai-advisor"), context);
      mountMfe("import-export", document.querySelector("#import-export"), context);
    mountMfe("auth-tenant-settings", document.querySelector("#auth-tenant-settings"), context);
    mountMfe("auth-session", document.querySelector("#left-account"), context);
  }

  document.querySelectorAll(".topbar, .left-rail, .right-rail").forEach((region) => {
    region.addEventListener("dragstart", (event) => {
      if (!event.target.closest(".palette-item")) event.preventDefault();
    });
    region.addEventListener("drop", (event) => event.preventDefault());
  });

  document.querySelector("#brand-home")?.addEventListener("click", () => {
    if (state.view === "editor") showDashboard();
  });
  document.querySelector("#history-toggle")?.addEventListener("click", async () => {
    await loadVersionHistory();
    state.historyOpen = true;
    renderShell();
  });
  document.querySelector("#close-history")?.addEventListener("click", () => {
    state.historyOpen = false;
    renderShell();
  });
  document.querySelector(".history-backdrop")?.addEventListener("click", (event) => {
    if (event.target === event.currentTarget) {
      state.historyOpen = false;
      renderShell();
    }
  });
  document.querySelector("#theme-toggle")?.addEventListener("click", async () => {
    state.settings.theme = state.settings.theme === "dark" ? "light" : "dark";
    applyTheme(state.settings.theme);
    if (state.user) {
      const result = await api.request("/api/settings", { method: "PATCH", body: JSON.stringify({ theme: state.settings.theme }) });
      state.settings = result.settings;
      applyTheme(state.settings.theme);
    }
    renderShell();
  });
  const sharePopover = document.querySelector("#share-popover");
  document.querySelector("#share-project")?.addEventListener("click", () => {
    sharePopover.hidden = !sharePopover.hidden;
    if (!sharePopover.hidden) document.querySelector("#share-email")?.focus();
  });
  document.querySelector("#close-share")?.addEventListener("click", () => { sharePopover.hidden = true; });
  const shareRoleHelp = {
    Viewer: "Can view the project but cannot make changes.",
    Commenter: "Can view the project and leave comments.",
    Editor: "Can edit diagrams and project content."
  };
  document.querySelector("#share-role")?.addEventListener("change", (event) => {
    document.querySelector("#share-role-help").textContent = shareRoleHelp[event.target.value];
  });
  document.querySelector("#share-form")?.addEventListener("submit", async (event) => {
    event.preventDefault();
    const submit = event.currentTarget.querySelector("button[type='submit']");
    submit.disabled = true;
    try {
      await api.request(`/api/projects/${state.project.id}/shares`, {
        method: "POST",
        body: JSON.stringify({ email: document.querySelector("#share-email").value, role: document.querySelector("#share-role").value })
      });
      document.querySelector("#share-email").value = "";
      sharePopover.hidden = true;
      bus.emit("toast", "Project invitation sent");
    } catch (error) {
      bus.emit("toast", error.message);
    } finally {
      submit.disabled = false;
    }
  });
  document.querySelector("#copy-project-link")?.addEventListener("click", async () => {
    const url = projectUrl(state.project.id).toString();
    try { await navigator.clipboard.writeText(url); bus.emit("toast", "Project link copied"); }
    catch { prompt("Copy project link", url); }
  });
  document.querySelector("#manual-save")?.addEventListener("click", async () => {
    await saveCurrentDiagram({ snapshot: true });
    bus.emit("toast", "Diagram milestone saved");
  });
  document.querySelector("#project-title.top-project-name")?.addEventListener("click", () => {
    const button = document.querySelector("#project-title.top-project-name");
    if (!button || !state.project) return;
    const input = document.createElement("input");
    input.className = "top-project-name-editor";
    input.value = state.project.name;
    input.setAttribute("aria-label", "Project name");
    button.replaceWith(input);
    let finished = false;
    const finish = async (save) => {
      if (finished) return;
      finished = true;
      const name = input.value.trim();
      if (save && name && name !== state.project.name) {
        try {
          state.project = await api.request(`/api/projects/${state.project.id}`, { method: "PATCH", body: JSON.stringify({ name }) });
          bus.emit("toast", "Project renamed");
        } catch (error) {
          bus.emit("toast", error.message);
        }
      }
      renderShell();
    };
    input.addEventListener("keydown", (event) => {
      if (event.key === "Enter") { event.preventDefault(); finish(true); }
      if (event.key === "Escape") { event.preventDefault(); finish(false); }
    });
    input.addEventListener("blur", () => finish(true));
    input.focus();
    input.select();
  });
  document.querySelectorAll("[data-restore-version]").forEach((button) => {
    button.addEventListener("click", async () => {
      if (!confirm(`Restore project version ${button.dataset.restoreVersion}? Current unsaved canvas changes will be replaced.`)) return;
      const result = await api.request(`/api/projects/${state.project.id}/versions/${button.dataset.restoreVersion}/restore`, { method: "POST" });
      state.project = result.project;
      state.diagrams = result.diagrams ?? [];
      state.diagram = state.diagrams[0] ?? null;
      state.historyOpen = false;
      await loadVersionHistory();
      renderShell();
      bus.emit("bootstrap", { projects: [state.project], diagrams: state.diagrams });
      if (state.diagram) bus.emit("diagram:changed", state.diagram);
      bus.emit("toast", "Version restored");
    });
  });
}

async function loadWorkspace() {
  const data = await api.request("/api/bootstrap");
  state.project = data.projects[0] ?? null;
  state.diagram = data.diagrams[0] ?? null;
  state.diagrams = data.diagrams ?? [];
  updateWorkspaceTitle();
  bus.emit("bootstrap", data);
  if (state.diagram) bus.emit("diagram:changed", state.diagram);
}

async function openProject(projectId, { updateHistory = true } = {}) {
  const data = await api.request(`/api/projects/${projectId}/open`, { method: "POST" });
  state.project = data.project;
  state.diagrams = data.diagrams ?? [];
  state.diagram = state.diagrams[0] ?? null;
  state.selectedElementIds = [];
  state.selectedRelationshipId = null;
  state.history = [];
  state.future = [];
  state.view = "editor";
  rememberPage("editor", projectId);
  if (updateHistory) window.history.pushState({ view: "editor", projectId }, "", projectUrl(projectId));
  renderShell();
  updateWorkspaceTitle();
  bus.emit("bootstrap", { projects: [state.project], diagrams: state.diagrams });
  if (state.diagram) bus.emit("diagram:changed", state.diagram);
}

async function boot() {
  document.querySelector("#app").innerHTML = `<main class="app-boot" aria-label="Restoring workspace"><span class="boot-mark">S</span><span>Restoring workspace…</span></main>`;
  if (state.authToken) {
    const session = await api.request("/api/auth/me");
    state.user = session.user;
    if (!state.user && state.refreshToken) {
      const refreshed = await api.request("/api/auth/refresh", { method: "POST", body: JSON.stringify({ refreshToken: state.refreshToken }) });
      state.authToken = refreshed.token;
      state.refreshToken = refreshed.refreshToken;
      state.user = refreshed.user;
      localStorage.setItem("sysml.authToken", refreshed.token);
      localStorage.setItem("sysml.refreshToken", refreshed.refreshToken);
    }
    if (state.user) state.tenantId = state.user.tenant_id;
    if (state.user) {
      const result = await api.request("/api/settings");
      state.settings = result.settings;
      applyTheme(state.settings.theme);
    }
    if (!state.user) {
      state.authToken = "";
      state.refreshToken = "";
      localStorage.removeItem("sysml.authToken");
      localStorage.removeItem("sysml.refreshToken");
    }
    bus.emit("auth:changed", state.user);
  }
  const routeProjectId = new URL(window.location.href).searchParams.get("project");
  const rememberedView = routeProjectId ? "editor" : localStorage.getItem("sysml.activeView");
  const rememberedProjectId = routeProjectId ?? localStorage.getItem("sysml.activeProjectId");
  if (rememberedView === "editor" && rememberedProjectId) {
    try {
      await openProject(rememberedProjectId, { updateHistory: false });
      window.history.replaceState({ view: "editor", projectId: rememberedProjectId }, "", projectUrl(rememberedProjectId));
      return;
    } catch {
      localStorage.removeItem("sysml.activeProjectId");
    }
  }
  state.view = "dashboard";
  rememberPage("dashboard");
  renderShell();
  window.history.replaceState({ view: "dashboard" }, "", dashboardUrl());
}

bus.on("auth:login", async ({ token, refreshToken, user }) => {
  state.authToken = token;
  state.refreshToken = refreshToken ?? "";
  state.user = user;
  state.tenantId = user.tenant_id;
  localStorage.setItem("sysml.authToken", token);
  if (refreshToken) localStorage.setItem("sysml.refreshToken", refreshToken);
  const result = await api.request("/api/settings");
  state.settings = result.settings;
  applyTheme(state.settings.theme);
  state.view = "dashboard";
  rememberPage("dashboard");
  bus.emit("auth:changed", user);
  renderShell();
});

bus.on("auth:logout", async () => {
  if (state.authToken) await api.request("/api/auth/logout", { method: "POST" });
  state.authToken = "";
  state.refreshToken = "";
  state.user = null;
  state.tenantId = "tenant_demo";
  localStorage.removeItem("sysml.authToken");
  localStorage.removeItem("sysml.refreshToken");
  state.view = "dashboard";
  rememberPage("dashboard");
  state.project = null;
  state.diagram = null;
  state.diagrams = [];
  bus.emit("auth:changed", null);
  renderShell();
});

bus.on("project:open", openProject);
bus.on("dashboard:open", () => {
  if (state.view === "editor") showDashboard();
});

window.addEventListener("popstate", async (event) => {
  if (event.state?.view === "editor" && event.state.projectId) {
    await openProject(event.state.projectId, { updateHistory: false });
    return;
  }
  showDashboard({ updateHistory: false });
});

boot();
