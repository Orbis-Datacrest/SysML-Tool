import { createEventBus, mountMfe } from "/packages/ui/src/moduleRegistry.js";
import { createInitialState } from "./app/state.js";
import { applyTheme, dashboardUrl, escapeHtml, projectUrl, rememberPage as persistPage } from "./app/browser.js";
import { createApiClient } from "./api/apiClient.js";
import { createSynchronizationService } from "./services/synchronizationService.js";
import { createShellRenderer } from "./views/createShellRenderer.js";
import "/apps/project-explorer/src/index.js";
import "/apps/project-dashboard/src/index.js";
import "/apps/element-palette/src/index.js";
import "/apps/diagram-canvas/src/index.js";
import "/apps/ai-advisor/src/index.js";
import "/apps/import-export/src/index.js";
import "/apps/auth-tenant-settings/src/index.js";

const state = createInitialState();

const bus = createEventBus();
let autoSaveTimer = null;
applyTheme(state.settings.theme);

// Dismiss sharing without re-rendering it, so an unsent email/role draft remains intact.
document.addEventListener("pointerdown", (event) => {
  const popover = document.querySelector("#share-popover");
  if (popover && !popover.hidden && !event.target.closest(".share-control")) {
    popover.hidden = true;
    document.querySelector("#share-project")?.setAttribute("aria-expanded", "false");
  }
}, true);
document.addEventListener("keydown", (event) => {
  if (event.key === "Escape") {
    const popover = document.querySelector("#share-popover");
    if (popover && !popover.hidden) {
      popover.hidden = true;
      const shareButton = document.querySelector("#share-project");
      shareButton?.setAttribute("aria-expanded", "false");
      shareButton?.focus();
    }
  }
});

const icons = {
  moon: `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" fill="currentColor" class="bi bi-moon-fill" viewBox="0 0 16 16" aria-hidden="true"><path d="M6 .278a.77.77 0 0 1 .08.858 7.2 7.2 0 0 0-.878 3.46c0 4.021 3.278 7.277 7.318 7.277q.792-.001 1.533-.16a.79.79 0 0 1 .81.316.73.73 0 0 1-.031.893A8.35 8.35 0 0 1 8.344 16C3.734 16 0 12.286 0 7.71 0 4.266 2.114 1.312 5.124.06A.75.75 0 0 1 6 .278"/></svg>`,
  sun: `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" fill="currentColor" class="bi bi-brightness-high" viewBox="0 0 16 16" aria-hidden="true"><path d="M8 11a3 3 0 1 1 0-6 3 3 0 0 1 0 6m0 1a4 4 0 1 0 0-8 4 4 0 0 0 0 8M8 0a.5.5 0 0 1 .5.5v2a.5.5 0 0 1-1 0v-2A.5.5 0 0 1 8 0m0 13a.5.5 0 0 1 .5.5v2a.5.5 0 0 1-1 0v-2A.5.5 0 0 1 8 13m8-5a.5.5 0 0 1-.5.5h-2a.5.5 0 0 1 0-1h2a.5.5 0 0 1 .5.5M3 8a.5.5 0 0 1-.5.5h-2a.5.5 0 0 1 0-1h2A.5.5 0 0 1 3 8m10.657-5.657a.5.5 0 0 1 0 .707l-1.414 1.415a.5.5 0 1 1-.707-.708l1.414-1.414a.5.5 0 0 1 .707 0m-9.193 9.193a.5.5 0 0 1 0 .707L3.05 13.657a.5.5 0 0 1-.707-.707l1.414-1.414a.5.5 0 0 1 .707 0m9.193 2.121a.5.5 0 0 1-.707 0l-1.414-1.414a.5.5 0 0 1 .707-.707l1.414 1.414a.5.5 0 0 1 0 .707M4.464 4.465a.5.5 0 0 1-.707 0L2.343 3.05a.5.5 0 1 1 .707-.707l1.414 1.414a.5.5 0 0 1 0 .708"/></svg>`,
  save: `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" fill="currentColor" class="bi bi-floppy" viewBox="0 0 16 16" aria-hidden="true"><path d="M11 2H9v3h2z"/><path d="M1.5 0h11.586a1.5 1.5 0 0 1 1.06.44l1.415 1.414A1.5 1.5 0 0 1 16 2.914V14.5a1.5 1.5 0 0 1-1.5 1.5h-13A1.5 1.5 0 0 1 0 14.5v-13A1.5 1.5 0 0 1 1.5 0M1 1.5v13a.5.5 0 0 0 .5.5H2v-4.5A1.5 1.5 0 0 1 3.5 9h9a1.5 1.5 0 0 1 1.5 1.5V15h.5a.5.5 0 0 0 .5-.5V2.914a.5.5 0 0 0-.146-.353l-1.415-1.415A.5.5 0 0 0 13.086 1H13v4.5A1.5 1.5 0 0 1 11.5 7h-7A1.5 1.5 0 0 1 3 5.5V1H1.5a.5.5 0 0 0-.5.5m3 4a.5.5 0 0 0 .5.5h7a.5.5 0 0 0 .5-.5V1H4zM3 15h10v-4.5a.5.5 0 0 0-.5-.5h-9a.5.5 0 0 0-.5.5z"/></svg>`,
  history: `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" fill="currentColor" class="bi bi-clock-history" viewBox="0 0 16 16" aria-hidden="true"><path d="M8.515 1.019A7 7 0 0 0 8 1V0a8 8 0 0 1 .589.022zm2.004.45a7 7 0 0 0-.985-.299l.219-.976q.576.129 1.126.342zm1.37.71a7 7 0 0 0-.439-.27l.493-.87a8 8 0 0 1 .979.654l-.615.789a7 7 0 0 0-.418-.302zm1.834 1.79a7 7 0 0 0-.653-.796l.724-.69q.406.429.747.91zm.744 1.352a7 7 0 0 0-.214-.468l.893-.45a8 8 0 0 1 .45 1.088l-.95.313a7 7 0 0 0-.179-.483m.53 2.507a7 7 0 0 0-.1-1.025l.985-.17q.1.58.116 1.17zm-.131 1.538q.05-.254.081-.51l.993.123a8 8 0 0 1-.23 1.155l-.964-.267q.069-.247.12-.501m-.952 2.379q.276-.436.486-.908l.914.405q-.24.54-.555 1.038zm-.964 1.205q.183-.183.35-.378l.758.653a8 8 0 0 1-.401.432z"/><path d="M8 1a7 7 0 1 0 4.95 11.95l.707.707A8.001 8.001 0 1 1 8 0z"/><path d="M7.5 3a.5.5 0 0 1 .5.5v5.21l3.248 1.856a.5.5 0 0 1-.496.868l-3.5-2A.5.5 0 0 1 7 9V3.5a.5.5 0 0 1 .5-.5"/></svg>`,
  share: `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" fill="currentColor" class="bi bi-unlock2-fill" viewBox="0 0 16 16" aria-hidden="true"><path fill-rule="evenodd" d="M8 0c1.07 0 2.041.42 2.759 1.104l.14.14.062.08a.5.5 0 0 1-.71.675l-.076-.066-.216-.205A3 3 0 0 0 5 4v2h6.5A2.5 2.5 0 0 1 14 8.5v5a2.5 2.5 0 0 1-2.5 2.5h-7A2.5 2.5 0 0 1 2 13.5v-5a2.5 2.5 0 0 1 2-2.45V4a4 4 0 0 1 4-4"/></svg>`,
  ai: `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" fill="currentColor" class="bi bi-stars" viewBox="0 0 16 16" aria-hidden="true"><path d="M7.657 6.247c.11-.33.576-.33.686 0l.645 1.937a2.89 2.89 0 0 0 1.829 1.828l1.936.645c.33.11.33.576 0 .686l-1.937.645a2.89 2.89 0 0 0-1.828 1.829l-.645 1.936a.361.361 0 0 1-.686 0l-.645-1.937a2.89 2.89 0 0 0-1.828-1.828l-1.937-.645a.361.361 0 0 1 0-.686l1.937-.645a2.89 2.89 0 0 0 1.828-1.828zM3.794 1.148a.217.217 0 0 1 .412 0l.387 1.162c.173.518.579.924 1.097 1.097l1.162.387a.217.217 0 0 1 0 .412l-1.162.387A1.73 1.73 0 0 0 4.593 5.69l-.387 1.162a.217.217 0 0 1-.412 0L3.407 5.69A1.73 1.73 0 0 0 2.31 4.593l-1.162-.387a.217.217 0 0 1 0-.412l1.162-.387A1.73 1.73 0 0 0 3.407 2.31zM10.863.099a.145.145 0 0 1 .274 0l.258.774c.115.346.386.617.732.732l.774.258a.145.145 0 0 1 0 .274l-.774.258a1.16 1.16 0 0 0-.732.732l-.258.774a.145.145 0 0 1-.274 0l-.258-.774a1.16 1.16 0 0 0-.732-.732L9.1 2.137a.145.145 0 0 1 0-.274l.774-.258c.346-.115.617-.386.732-.732z"/></svg>`
};

function rememberPage(view, projectId = state.project?.id) {
  persistPage(view, projectId);
}

const api = createApiClient({ state, bus });
const synchronization = createSynchronizationService({ api, state, bus });

function setDiagram(diagram, recordHistory = true) {
  if (state.diagram && recordHistory) state.history.push(structuredClone(state.diagram));
  state.diagram = diagram;
  state.selectedHistoryVersion = "current";
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
  scheduleAutoSave();
}

function redoDiagram() {
  const next = state.future.pop();
  if (!next) return;
  state.history.push(structuredClone(state.diagram));
  state.diagram = next;
  bus.emit("diagram:changed", state.diagram);
  scheduleAutoSave();
}

const renderShell = createShellRenderer({
  api, applyTheme, bus, escapeHtml, icons, loadVersionHistory, mountMfe, projectUrl,
  redoDiagram, saveCurrentDiagram, setDiagram, showDashboard, state, undoDiagram
});

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
  state.canvasViewport = { zoom: 1, scrollLeft: 0, scrollTop: 0 };
  state.history = [];
  state.future = [];
  state.selectedHistoryVersion = "current";
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
window.addEventListener("popstate", async (event) => {
  if (event.state?.view === "editor" && event.state.projectId) {
    await openProject(event.state.projectId, { updateHistory: false });
    return;
  }
  showDashboard({ updateHistory: false });
});

boot();
