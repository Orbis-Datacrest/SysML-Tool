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
  mobilePanel: null,
  sidebarOpen: window.matchMedia("(min-width: 768px)").matches,
  historyOpen: false,
  settingsOpen: false,
  versionHistory: [],
  baselines: [],
  auditHistory: [],
  reviews: [],
  versionCompare: { from: "", to: "", diff: null },
  collaboration: { role: "Owner", permissions: [], presence: [], comments: [], notifications: [], online: false },
  settings: { theme: localStorage.getItem("sysml.theme") ?? "dark" },
  project: null,
  diagram: null,
  diagrams: [],
  modelRepository: { schema_version: 2, elements: [], relationships: [] },
  selectedElementIds: [],
  selectedRelationshipId: null,
  relationshipKind: "association",
  saveStatus: "",
  shareDraft: { email: "", role: "Viewer" },
  history: [],
  future: []
};

const bus = createEventBus();
let autoSaveTimer = null;
applyTheme(state.settings.theme);

// Dismiss sharing without re-rendering it, so an unsent email/role draft remains intact.
document.addEventListener("pointerdown", (event) => {
  const popover = document.querySelector("#share-popover");
  if (popover && !popover.hidden && !event.target.closest(".share-control")) popover.hidden = true;
}, true);
document.addEventListener("keydown", (event) => {
  if (event.key === "Escape") {
    const popover = document.querySelector("#share-popover");
    if (popover && !popover.hidden) popover.hidden = true;
  }
});

function escapeHtml(value = "") {
  return String(value).replace(/[&<>'"]/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", "\"": "&quot;" })[character]);
}

const icons = {
  moon: `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" fill="currentColor" class="bi bi-moon-fill" viewBox="0 0 16 16" aria-hidden="true"><path d="M6 .278a.77.77 0 0 1 .08.858 7.2 7.2 0 0 0-.878 3.46c0 4.021 3.278 7.277 7.318 7.277q.792-.001 1.533-.16a.79.79 0 0 1 .81.316.73.73 0 0 1-.031.893A8.35 8.35 0 0 1 8.344 16C3.734 16 0 12.286 0 7.71 0 4.266 2.114 1.312 5.124.06A.75.75 0 0 1 6 .278"/></svg>`,
  sun: `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" fill="currentColor" class="bi bi-brightness-high" viewBox="0 0 16 16" aria-hidden="true"><path d="M8 11a3 3 0 1 1 0-6 3 3 0 0 1 0 6m0 1a4 4 0 1 0 0-8 4 4 0 0 0 0 8M8 0a.5.5 0 0 1 .5.5v2a.5.5 0 0 1-1 0v-2A.5.5 0 0 1 8 0m0 13a.5.5 0 0 1 .5.5v2a.5.5 0 0 1-1 0v-2A.5.5 0 0 1 8 13m8-5a.5.5 0 0 1-.5.5h-2a.5.5 0 0 1 0-1h2a.5.5 0 0 1 .5.5M3 8a.5.5 0 0 1-.5.5h-2a.5.5 0 0 1 0-1h2A.5.5 0 0 1 3 8m10.657-5.657a.5.5 0 0 1 0 .707l-1.414 1.415a.5.5 0 1 1-.707-.708l1.414-1.414a.5.5 0 0 1 .707 0m-9.193 9.193a.5.5 0 0 1 0 .707L3.05 13.657a.5.5 0 0 1-.707-.707l1.414-1.414a.5.5 0 0 1 .707 0m9.193 2.121a.5.5 0 0 1-.707 0l-1.414-1.414a.5.5 0 0 1 .707-.707l1.414 1.414a.5.5 0 0 1 0 .707M4.464 4.465a.5.5 0 0 1-.707 0L2.343 3.05a.5.5 0 1 1 .707-.707l1.414 1.414a.5.5 0 0 1 0 .708"/></svg>`,
  save: `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" fill="currentColor" class="bi bi-floppy" viewBox="0 0 16 16" aria-hidden="true"><path d="M11 2H9v3h2z"/><path d="M1.5 0h11.586a1.5 1.5 0 0 1 1.06.44l1.415 1.414A1.5 1.5 0 0 1 16 2.914V14.5a1.5 1.5 0 0 1-1.5 1.5h-13A1.5 1.5 0 0 1 0 14.5v-13A1.5 1.5 0 0 1 1.5 0M1 1.5v13a.5.5 0 0 0 .5.5H2v-4.5A1.5 1.5 0 0 1 3.5 9h9a1.5 1.5 0 0 1 1.5 1.5V15h.5a.5.5 0 0 0 .5-.5V2.914a.5.5 0 0 0-.146-.353l-1.415-1.415A.5.5 0 0 0 13.086 1H13v4.5A1.5 1.5 0 0 1 11.5 7h-7A1.5 1.5 0 0 1 3 5.5V1H1.5a.5.5 0 0 0-.5.5m3 4a.5.5 0 0 0 .5.5h7a.5.5 0 0 0 .5-.5V1H4zM3 15h10v-4.5a.5.5 0 0 0-.5-.5h-9a.5.5 0 0 0-.5.5z"/></svg>`,
  history: `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" fill="currentColor" class="bi bi-clock-history" viewBox="0 0 16 16" aria-hidden="true"><path d="M8.515 1.019A7 7 0 0 0 8 1V0a8 8 0 0 1 .589.022zm2.004.45a7 7 0 0 0-.985-.299l.219-.976q.576.129 1.126.342zm1.37.71a7 7 0 0 0-.439-.27l.493-.87a8 8 0 0 1 .979.654l-.615.789a7 7 0 0 0-.418-.302zm1.834 1.79a7 7 0 0 0-.653-.796l.724-.69q.406.429.747.91zm.744 1.352a7 7 0 0 0-.214-.468l.893-.45a8 8 0 0 1 .45 1.088l-.95.313a7 7 0 0 0-.179-.483m.53 2.507a7 7 0 0 0-.1-1.025l.985-.17q.1.58.116 1.17zm-.131 1.538q.05-.254.081-.51l.993.123a8 8 0 0 1-.23 1.155l-.964-.267q.069-.247.12-.501m-.952 2.379q.276-.436.486-.908l.914.405q-.24.54-.555 1.038zm-.964 1.205q.183-.183.35-.378l.758.653a8 8 0 0 1-.401.432z"/><path d="M8 1a7 7 0 1 0 4.95 11.95l.707.707A8.001 8.001 0 1 1 8 0z"/><path d="M7.5 3a.5.5 0 0 1 .5.5v5.21l3.248 1.856a.5.5 0 0 1-.496.868l-3.5-2A.5.5 0 0 1 7 9V3.5a.5.5 0 0 1 .5-.5"/></svg>`,
  share: `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" fill="currentColor" class="bi bi-unlock2-fill" viewBox="0 0 16 16" aria-hidden="true"><path fill-rule="evenodd" d="M8 0c1.07 0 2.041.42 2.759 1.104l.14.14.062.08a.5.5 0 0 1-.71.675l-.076-.066-.216-.205A3 3 0 0 0 5 4v2h6.5A2.5 2.5 0 0 1 14 8.5v5a2.5 2.5 0 0 1-2.5 2.5h-7A2.5 2.5 0 0 1 2 13.5v-5a2.5 2.5 0 0 1 2-2.45V4a4 4 0 0 1 4-4"/></svg>`,
  ai: `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" fill="currentColor" class="bi bi-stars" viewBox="0 0 16 16" aria-hidden="true"><path d="M7.657 6.247c.11-.33.576-.33.686 0l.645 1.937a2.89 2.89 0 0 0 1.829 1.828l1.936.645c.33.11.33.576 0 .686l-1.937.645a2.89 2.89 0 0 0-1.828 1.829l-.645 1.936a.361.361 0 0 1-.686 0l-.645-1.937a2.89 2.89 0 0 0-1.828-1.828l-1.937-.645a.361.361 0 0 1 0-.686l1.937-.645a2.89 2.89 0 0 0 1.828-1.828zM3.794 1.148a.217.217 0 0 1 .412 0l.387 1.162c.173.518.579.924 1.097 1.097l1.162.387a.217.217 0 0 1 0 .412l-1.162.387A1.73 1.73 0 0 0 4.593 5.69l-.387 1.162a.217.217 0 0 1-.412 0L3.407 5.69A1.73 1.73 0 0 0 2.31 4.593l-1.162-.387a.217.217 0 0 1 0-.412l1.162-.387A1.73 1.73 0 0 0 3.407 2.31zM10.863.099a.145.145 0 0 1 .274 0l.258.774c.115.346.386.617.732.732l.774.258a.145.145 0 0 1 0 .274l-.774.258a1.16 1.16 0 0 0-.732.732l-.258.774a.145.145 0 0 1-.274 0l-.258-.774a1.16 1.16 0 0 0-.732-.732L9.1 2.137a.145.145 0 0 1 0-.274l.774-.258c.346-.115.617-.386.732-.732z"/></svg>`
};

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
  },
  createBaseline(projectId, input) {
    return this.request(`/api/projects/${projectId}/versions`, { method: "POST", body: JSON.stringify(input) });
  },
  compareVersions(projectId, from, to) {
    return this.request(`/api/projects/${projectId}/versions/compare?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`);
  },
  restoreElement(projectId, version, input) {
    return this.request(`/api/projects/${projectId}/versions/${version}/restore-element`, { method: "POST", body: JSON.stringify(input) });
  },
  restoreDiagram(projectId, version, input) {
    return this.request(`/api/projects/${projectId}/versions/${version}/restore-diagram`, { method: "POST", body: JSON.stringify(input) });
  },
  releaseBaseline(projectId, baselineId) {
    return this.request(`/api/projects/${projectId}/baselines/${baselineId}/release`, { method: "POST" });
  },
  listReviews(projectId) {
    return this.request(`/api/projects/${projectId}/reviews`);
  },
  createReview(projectId, input) {
    return this.request(`/api/projects/${projectId}/reviews`, { method: "POST", body: JSON.stringify(input) });
  },
  approveReview(projectId, reviewId, input) {
    return this.request(`/api/projects/${projectId}/reviews/${reviewId}/approval`, { method: "POST", body: JSON.stringify(input) });
  },
  collaborationState(projectId, diagramId) {
    return this.request(`/api/projects/${projectId}/collaboration?diagram_id=${encodeURIComponent(diagramId)}`);
  },
  publishPresence(projectId, input) {
    return this.request(`/api/projects/${projectId}/collaboration`, { method: "POST", body: JSON.stringify(input) });
  },
  createComment(projectId, input) {
    return this.request(`/api/projects/${projectId}/comments`, { method: "POST", body: JSON.stringify(input) });
  }
};

function createSynchronizationService({ api, state, bus }) {
  let timer = null;
  let pendingPresence = null;
  let inFlight = false;
  const apply = (payload) => {
    state.collaboration = { ...state.collaboration, ...payload, online: true };
    bus.emit("collaboration:changed", state.collaboration);
  };
  const poll = async () => {
    if (!state.project?.id || !state.diagram?.id || inFlight) return;
    inFlight = true;
    try {
      if (pendingPresence) {
        await api.publishPresence(state.project.id, pendingPresence);
        pendingPresence = null;
      }
      apply(await api.collaborationState(state.project.id, state.diagram.id));
    } catch (error) {
      state.collaboration.online = false;
      if (!String(error.message).includes("Failed to fetch")) bus.emit("toast", error.message);
    } finally {
      inFlight = false;
    }
  };
  return {
    start() {
      clearInterval(timer);
      timer = setInterval(poll, 3000);
      poll();
    },
    stop() {
      clearInterval(timer);
      timer = null;
    },
    publishPresence(cursor = null, selection = state.selectedElementIds ?? []) {
      if (!state.project?.id || !state.diagram?.id) return;
      pendingPresence = { diagram_id: state.diagram.id, cursor, selection };
    },
    async addComment(input) {
      const result = await api.createComment(state.project.id, input);
      state.collaboration.comments = result.comments ?? [];
      bus.emit("collaboration:changed", state.collaboration);
    },
    refresh: poll
  };
}

const synchronization = createSynchronizationService({ api, state, bus });

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
  const changedElements = new Map((saved.elements ?? []).map((item) => [item.model_element_id ?? item.id, item]));
  const changedRelationships = new Map((saved.relationships ?? []).map((item) => [item.model_relationship_id ?? item.id, item]));
  state.diagrams = (state.diagrams ?? []).map((diagram) => {
    if (diagram.id === saved.id) return saved;
    return {
      ...diagram,
      elements: (diagram.elements ?? []).map((item) => {
        const model = changedElements.get(item.model_element_id ?? item.id);
        return model ? { ...item, kind: model.kind, name: model.name, properties: structuredClone(model.properties), stereotypes: structuredClone(model.stereotypes ?? []) } : item;
      }),
      relationships: (diagram.relationships ?? []).map((item) => {
        const model = changedRelationships.get(item.model_relationship_id ?? item.id);
        return model ? { ...item, kind: model.kind, source_id: model.source_id, target_id: model.target_id, label: model.label, properties: structuredClone(model.properties), stereotypes: structuredClone(model.stereotypes ?? []), validation: model.validation } : item;
      })
    };
  });
  state.modelRepository.elements = [...new Map([...state.modelRepository.elements, ...(saved.elements ?? []).map((item) => ({ id: item.model_element_id ?? item.id, kind: item.kind, name: item.name, semantic: item.properties, stereotypes: item.stereotypes ?? [] }))].map((item) => [item.id, item])).values()];
}

async function loadModelRepository(projectId) {
  state.modelRepository = projectId ? await api.request(`/api/projects/${projectId}/model`) : { schema_version: 2, elements: [], relationships: [] };
}

function repositoryFromDiagrams(diagrams) {
  const elements = new Map();
  const relationships = new Map();
  for (const diagram of diagrams ?? []) {
    for (const item of diagram.elements ?? []) elements.set(item.model_element_id ?? item.id, { id: item.model_element_id ?? item.id, kind: item.kind, name: item.name, semantic: item.properties ?? {}, stereotypes: item.stereotypes ?? [] });
    for (const item of diagram.relationships ?? []) relationships.set(item.model_relationship_id ?? item.id, { id: item.model_relationship_id ?? item.id, kind: item.kind, source_id: item.source_id, target_id: item.target_id, label: item.label, semantic: item.properties ?? {}, stereotypes: item.stereotypes ?? [], validation: item.validation });
  }
  return { schema_version: 2, elements: [...elements.values()], relationships: [...relationships.values()] };
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
    await loadModelRepository(state.project?.id);
    bus.emit("repository:changed", state.modelRepository);
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
  state.baselines = result.baselines ?? [];
  const history = await api.request(`/api/projects/${state.project.id}/history`);
  state.auditHistory = history.audit ?? [];
  const reviews = await api.listReviews(state.project.id);
  state.reviews = reviews.reviews ?? [];
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
  synchronization.stop();
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
        ${state.view === "editor" ? `<button id="sidebar-toggle" class="icon-button" title="${state.sidebarOpen ? "Collapse" : "Expand"} project tools" aria-label="${state.sidebarOpen ? "Collapse" : "Expand"} project tools" aria-controls="project-tools-sidebar" aria-expanded="${state.sidebarOpen}">☰</button>` : ""}
        <button id="brand-home" class="brand-button" title="Open Project Dashboard" aria-label="Open Project Dashboard"><strong class="brand-mark"><span class="brand-icon">S</span>SysML Studio</strong></button>
        ${state.view === "editor" ? `<button id="manual-save" class="icon-button" title="Save Diagram" aria-label="Save Diagram">${icons.save}</button><span id="save-status" class="save-status">${state.saveStatus}</span>` : ""}
        ${state.view === "editor" ? `<button id="project-title" class="top-project-name" title="Rename project" aria-label="Rename project: ${escapeHtml(state.project?.name ?? "Untitled Project")}"><span class="project-name-text">${escapeHtml(state.project?.name ?? "Untitled Project")}</span><span class="project-name-edit" aria-hidden="true">✎</span></button>` : `<span id="project-title">Project Dashboard</span>`}
      </div>
      <div class="topbar-actions">
        ${state.view === "editor" ? `<button id="ai-sidebar-toggle" class="icon-button" title="${state.mobilePanel === "advisor" ? "Close" : "Open"} AI advisor" aria-label="${state.mobilePanel === "advisor" ? "Close" : "Open"} AI advisor" aria-controls="ai-advisor-sidebar" aria-expanded="${state.mobilePanel === "advisor"}">${icons.ai}</button>` : ""}
        ${state.view === "editor" ? `<button id="history-toggle" class="icon-button" title="Version History" aria-label="Version History">${icons.history}</button>` : ""}
        <button id="theme-toggle" class="icon-button" title="Toggle ${state.settings.theme === "dark" ? "Light" : "Dark"} Mode" aria-label="Toggle ${state.settings.theme === "dark" ? "Light" : "Dark"} Mode">${state.settings.theme === "dark" ? icons.moon : icons.sun}</button>
        ${state.view === "editor" ? `<div class="share-control">
          <button id="share-project" class="share-button" title="Share project" aria-label="Open project sharing"><span class="share-lock" aria-hidden="true">${icons.share}</span><span>Share</span><span class="share-chevron" aria-hidden="true">▾</span></button>
          <div id="share-popover" class="share-popover" hidden>
            <div class="share-popover-header"><div><strong>Share project</strong><small>${escapeHtml(state.project?.name ?? "Untitled Project")}</small></div><button id="close-share" class="share-close" aria-label="Close sharing">×</button></div>
            <form id="share-form">
              <label for="share-email">Invite by email</label>
              <div class="share-invite-row"><input id="share-email" type="email" autocomplete="email" value="${escapeHtml(state.shareDraft.email)}" placeholder="name@example.com" required><select id="share-role" aria-label="Access level"><option value="Viewer" ${state.shareDraft.role === "Viewer" ? "selected" : ""}>Viewer</option><option value="Commenter" ${state.shareDraft.role === "Commenter" ? "selected" : ""}>Commenter</option><option value="Editor" ${state.shareDraft.role === "Editor" ? "selected" : ""}>Editor</option></select></div>
              <p id="share-role-help" class="share-role-help">Can view the project but cannot make changes.</p>
              <button class="primary share-send" type="submit">Send invite</button>
            </form>
            <button id="copy-project-link" class="copy-project-link" type="button">Copy project link</button>
          </div>
        </div>` : ""}
        <section id="topbar-import-export" class="topbar-export"></section>
        ${state.view === "dashboard" ? `<section id="auth-session" class="topbar-auth"></section>` : ""}
      </div>
    </header>
    ${state.view === "editor" ? `
      <main class="workspace ${state.sidebarOpen ? "sidebar-open" : ""} ${state.mobilePanel === "advisor" ? "advisor-open" : ""}">
        <aside id="project-tools-sidebar" class="left-rail ${state.sidebarOpen ? "drawer-open" : ""}" aria-label="Project tools">
          <div class="mobile-drawer-header mobile-only"><strong>Project tools</strong><button class="close-mobile-panel" aria-label="Close project tools">×</button></div>
          <section id="project-explorer"></section>
          <section id="element-palette"></section>
          <section id="properties-panel"></section>
          <section id="drawer-import-export" class="drawer-import-export"></section>
          <section id="left-account" class="left-account"></section>
        </aside>
        <section id="diagram-canvas" class="canvas-host"></section>
        <aside id="ai-advisor-sidebar" class="right-rail ${state.mobilePanel === "advisor" ? "drawer-open" : ""}" aria-label="AI advisor">
          <div class="mobile-drawer-header mobile-only"><strong>AI advisor</strong><button class="close-mobile-panel" aria-label="Close AI advisor">×</button></div>
          <section id="ai-advisor"></section>
          <div class="ai-settings-actions">
            <button id="settings-toggle" class="settings-toggle" type="button" aria-expanded="${state.settingsOpen}" aria-controls="auth-tenant-settings">${state.settingsOpen ? "Close Settings" : "Settings"}</button>
          </div>
          ${state.settingsOpen ? `<section id="auth-tenant-settings" class="ai-settings-slot"></section>` : ""}
        </aside>
        <button class="workspace-drawer-backdrop ${state.mobilePanel === "advisor" ? "advisor-backdrop" : ""} ${state.sidebarOpen ? "sidebar-backdrop" : ""}" aria-label="Close open panel"></button>
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
            <form id="baseline-form" class="history-form">
              <input id="baseline-name" placeholder="Baseline name" aria-label="Baseline name" required>
              <input id="baseline-description" placeholder="Change description" aria-label="Change description">
              <label class="checkbox-row"><input id="baseline-release" type="checkbox"> Release immutable baseline</label>
              <button class="primary" type="submit">Create Baseline</button>
            </form>
            <div class="history-section">
              <strong>Named Baselines</strong>
              ${state.baselines.map((item) => `
                <div class="version-card baseline-card">
                  <strong>${escapeHtml(item.name)} ${item.released ? `<span class="baseline-state">Released</span>` : `<span class="baseline-state draft">Draft</span>`}</strong>
                  <span class="muted">Version ${item.version} · ${new Date(item.created_at).toLocaleString()}</span>
                  <span>${escapeHtml(item.description)}</span>
                  ${item.released ? "" : `<button data-release-baseline="${item.id}">Release</button>`}
                </div>
              `).join("") || `<p class="muted">No named baselines yet.</p>`}
            </div>
            <form id="compare-form" class="history-form compact">
              <select id="compare-from" aria-label="Compare from">${state.versionHistory.map((item) => `<option value="${item.version}" ${String(state.versionCompare.from) === String(item.version) ? "selected" : ""}>v${item.version}</option>`).join("")}</select>
              <select id="compare-to" aria-label="Compare to">${state.versionHistory.map((item) => `<option value="${item.version}" ${String(state.versionCompare.to || state.versionHistory[0]?.version) === String(item.version) ? "selected" : ""}>v${item.version}</option>`).join("")}</select>
              <button type="submit">Compare</button>
            </form>
            ${state.versionCompare.diff ? `<div class="diff-panel">
              ${["modelChanges", "diagramChanges", "relationshipChanges", "requirementChanges"].map((key) => `
                <section><strong>${key.replace(/([A-Z])/g, " $1")}</strong>
                  ${(state.versionCompare.diff[key] ?? []).slice(0, 8).map((item) => `<div class="diff-row ${item.kind}"><span>${escapeHtml(item.label ?? item.id)}</span><small>${escapeHtml(item.path || item.kind)}: ${escapeHtml(String(item.before ?? "∅"))} → ${escapeHtml(String(item.after ?? "∅"))}</small></div>`).join("") || `<p class="muted">No changes.</p>`}
                </section>
              `).join("")}
            </div>` : ""}
            <div class="history-section">
              <strong>Reviews & Approvals</strong>
              <form id="review-form" class="history-form compact"><input id="review-title" placeholder="Review title" aria-label="Review title"><button type="submit">Open Review</button></form>
              ${state.reviews.map((item) => `<div class="version-card">
                <strong>${escapeHtml(item.title)}</strong><span class="muted">${escapeHtml(item.status)} · ${new Date(item.created_at).toLocaleString()}</span>
                <button data-approve-review="${item.id}" ${item.status === "approved" ? "disabled" : ""}>Approve</button>
                <button data-request-changes="${item.id}" ${item.status === "approved" ? "disabled" : ""}>Request changes</button>
              </div>`).join("") || `<p class="muted">No active reviews.</p>`}
            </div>
            <div class="history-section">
              <strong>Collaboration</strong>
              <div class="collab-summary"><span>${escapeHtml(state.collaboration.role)}</span><span>${state.collaboration.presence.length} online</span><span>${state.collaboration.comments.length} comments</span></div>
              ${state.collaboration.comments.slice(-5).reverse().map((item) => `<div class="comment-card"><strong>${escapeHtml(item.author)}</strong><span>${escapeHtml(item.body)}</span><small>${escapeHtml(item.anchor_type)} ${escapeHtml(item.anchor_id)}</small></div>`).join("") || `<p class="muted">No anchored discussions yet.</p>`}
            </div>
            <div class="history-section">
              <strong>Model History</strong>
            ${state.versionHistory.map((item) => `
              <div class="version-card">
                <strong>Version ${item.version}</strong>
                <span class="muted">${new Date(item.created_at).toLocaleString()}</span>
                <span>${item.description}</span>
                ${state.diagram ? `<button data-restore-diagram-version="${item.version}">Restore diagram</button>` : ""}
                ${state.selectedElementIds?.[0] && state.diagram ? `<button data-restore-element-version="${item.version}">Restore selected element</button>` : ""}
                <button data-restore-version="${item.version}">Restore</button>
              </div>
            `).join("") || `<p class="muted">No manual save milestones yet. Click the save icon to create one.</p>`}
            </div>
            <div class="history-section">
              <strong>Audit History</strong>
              ${state.auditHistory.slice(0, 12).map((item) => `<div class="audit-row"><span>${escapeHtml(item.description)}</span><small>${new Date(item.created_at).toLocaleString()}</small></div>`).join("") || `<p class="muted">No audited actions yet.</p>`}
            </div>
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
    mountMfe("import-export", document.querySelector("#topbar-import-export"), context);
    mountMfe("import-export", document.querySelector("#drawer-import-export"), context);
    if (state.settingsOpen) mountMfe("auth-tenant-settings", document.querySelector("#auth-tenant-settings"), context);
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
  const setMobilePanel = (panel) => {
    state.mobilePanel = state.mobilePanel === panel ? null : panel;
    renderShell();
  };
  document.querySelector("#sidebar-toggle")?.addEventListener("click", () => {
    state.sidebarOpen = !state.sidebarOpen;
    renderShell();
  });
  document.querySelector("#ai-sidebar-toggle")?.addEventListener("click", () => setMobilePanel("advisor"));
  document.querySelector("#settings-toggle")?.addEventListener("click", () => {
    state.settingsOpen = !state.settingsOpen;
    renderShell();
  });
  document.querySelectorAll(".close-mobile-panel,.workspace-drawer-backdrop").forEach((button) => button.addEventListener("click", () => {
    state.mobilePanel = null;
    state.sidebarOpen = false;
    renderShell();
  }));
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
  document.querySelector("#share-email")?.addEventListener("input", (event) => {
    state.shareDraft.email = event.target.value;
  });
  document.querySelector("#share-role")?.addEventListener("change", (event) => {
    state.shareDraft.role = event.target.value;
    document.querySelector("#share-role-help").textContent = shareRoleHelp[event.target.value];
  });
  const shareRoleHelpTarget = document.querySelector("#share-role-help");
  if (shareRoleHelpTarget) shareRoleHelpTarget.textContent = shareRoleHelp[state.shareDraft.role];
  document.querySelector("#share-form")?.addEventListener("submit", async (event) => {
    event.preventDefault();
    const submit = event.currentTarget.querySelector("button[type='submit']");
    submit.disabled = true;
    try {
      await api.request(`/api/projects/${state.project.id}/shares`, {
        method: "POST",
        body: JSON.stringify({ email: state.shareDraft.email, role: state.shareDraft.role })
      });
      state.shareDraft.email = "";
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
  document.querySelector("#baseline-form")?.addEventListener("submit", async (event) => {
    event.preventDefault();
    const name = document.querySelector("#baseline-name").value.trim();
    const description = document.querySelector("#baseline-description").value.trim();
    const release = document.querySelector("#baseline-release").checked;
    try {
      const result = await api.createBaseline(state.project.id, { name, description, release });
      state.versionHistory = result.versions ?? [];
      state.baselines = result.baselines ?? [];
      renderShell();
      bus.emit("toast", release ? "Released baseline created" : "Baseline created");
    } catch (error) {
      bus.emit("toast", error.message);
    }
  });
  document.querySelector("#compare-form")?.addEventListener("submit", async (event) => {
    event.preventDefault();
    const from = document.querySelector("#compare-from").value;
    const to = document.querySelector("#compare-to").value;
    try {
      const result = await api.compareVersions(state.project.id, from, to);
      state.versionCompare = { from, to, diff: result.diff };
      renderShell();
    } catch (error) {
      bus.emit("toast", error.message);
    }
  });
  document.querySelector("#review-form")?.addEventListener("submit", async (event) => {
    event.preventDefault();
    const title = document.querySelector("#review-title").value.trim() || "Engineering Review";
    try {
      await api.createReview(state.project.id, { title, baseline_id: state.baselines[0]?.id });
      await loadVersionHistory();
      renderShell();
      bus.emit("toast", "Review opened");
    } catch (error) {
      bus.emit("toast", error.message);
    }
  });
  document.querySelectorAll("[data-release-baseline]").forEach((button) => button.addEventListener("click", async () => {
    try {
      await api.releaseBaseline(state.project.id, button.dataset.releaseBaseline);
      await loadVersionHistory();
      renderShell();
      bus.emit("toast", "Baseline released");
    } catch (error) {
      bus.emit("toast", error.message);
    }
  }));
  document.querySelectorAll("[data-approve-review],[data-request-changes]").forEach((button) => button.addEventListener("click", async () => {
    const reviewId = button.dataset.approveReview ?? button.dataset.requestChanges;
    const decision = button.dataset.approveReview ? "approved" : "changes-requested";
    try {
      await api.approveReview(state.project.id, reviewId, { decision });
      await loadVersionHistory();
      renderShell();
      bus.emit("toast", decision === "approved" ? "Review approved" : "Changes requested");
    } catch (error) {
      bus.emit("toast", error.message);
    }
  }));
  document.querySelectorAll("[data-restore-element-version]").forEach((button) => {
    button.addEventListener("click", async () => {
      const elementId = state.selectedElementIds?.[0];
      if (!elementId) return;
      if (!confirm(`Restore selected element from project version ${button.dataset.restoreElementVersion}?`)) return;
      state.diagram = await api.restoreElement(state.project.id, button.dataset.restoreElementVersion, { diagram_id: state.diagram.id, element_id: elementId });
      state.historyOpen = false;
      renderShell();
      bus.emit("diagram:changed", state.diagram);
      bus.emit("toast", "Element restored");
    });
  });
  document.querySelectorAll("[data-restore-diagram-version]").forEach((button) => {
    button.addEventListener("click", async () => {
      if (!confirm(`Restore current diagram from project version ${button.dataset.restoreDiagramVersion}?`)) return;
      state.diagram = await api.restoreDiagram(state.project.id, button.dataset.restoreDiagramVersion, { diagram_id: state.diagram.id });
      state.diagrams = state.diagrams.map((diagram) => diagram.id === state.diagram.id ? state.diagram : diagram);
      state.historyOpen = false;
      renderShell();
      bus.emit("diagram:changed", state.diagram);
      bus.emit("toast", "Diagram restored");
    });
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
  await loadModelRepository(state.project?.id);
  updateWorkspaceTitle();
  bus.emit("bootstrap", data);
  if (state.diagram) bus.emit("diagram:changed", state.diagram);
  if (state.view === "editor") synchronization.start();
}

async function openProject(projectId, { updateHistory = true } = {}) {
  const data = await api.request(`/api/projects/${projectId}/open`, { method: "POST" });
  state.project = data.project;
  state.diagrams = data.diagrams ?? [];
  state.diagram = state.diagrams[0] ?? null;
  state.modelRepository = repositoryFromDiagrams(state.diagrams);
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
  synchronization.start();
  try {
    await loadModelRepository(projectId);
    bus.emit("repository:changed", state.modelRepository);
  } catch (error) {
    console.warn("Using the diagram-derived model repository because model loading failed", error);
  }
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

bus.on("project:open", (projectId) => openProject(projectId).catch((error) => bus.emit("toast", `Could not open project: ${error.message}`)));
bus.on("dashboard:open", () => {
  if (state.view === "editor") showDashboard();
});
bus.on("selection:changed", (selection) => synchronization.publishPresence(null, selection));
bus.on("canvas:pointer", (cursor) => synchronization.publishPresence(cursor, state.selectedElementIds ?? []));
bus.on("comment:create", (comment) => synchronization.addComment(comment).catch((error) => bus.emit("toast", error.message)));
bus.on("collaboration:changed", () => {
  if (state.historyOpen) renderShell();
});

window.addEventListener("popstate", async (event) => {
  if (event.state?.view === "editor" && event.state.projectId) {
    await openProject(event.state.projectId, { updateHistory: false });
    return;
  }
  showDashboard({ updateHistory: false });
});

boot();
