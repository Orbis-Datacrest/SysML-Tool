import { createEventBus, mountMfe } from "/packages/ui/src/moduleRegistry.js";
import { activateDiagramTab, createInitialState, resetEditorInteractionState } from "./app/state.js";
import { applyTheme, dashboardUrl, escapeHtml, nextTheme, projectUrl, rememberPage as persistPage } from "./app/browser.js";
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
const storageGet = (key) => { try { return localStorage.getItem(key); } catch { return null; } };
const storageSet = (key, value) => { try { localStorage.setItem(key, value); } catch { /* Storage can be unavailable in private/embedded contexts. */ } };
const storageRemove = (key) => { try { localStorage.removeItem(key); } catch { /* Nothing else to clear locally. */ } };

const bus = createEventBus();
const autoSaveTimers = new Map();
const saveQueues = new Map();
const diagramChangeVersions = new Map();
const lastSavedDiagramVersions = new Map();
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

function rememberPage(view, projectId = state.project?.id, diagramId = state.diagram?.id) {
  persistPage(view, projectId, diagramId);
}

const api = createApiClient({ state, bus });
const synchronization = createSynchronizationService({ api, state, bus });

function setDiagram(diagram, recordHistory = true, historySnapshot = null, scheduleSave = true) {
  if (state.diagram && recordHistory) state.history.push(structuredClone(historySnapshot ?? state.diagram));
  state.diagram = diagram;
  state.diagrams = state.diagrams.map((item) => item.id === diagram.id ? diagram : item);
  state.dirtyTabIds.add(diagram.id);
  state.selectedHistoryVersion = "current";
  state.future = [];
  bus.emit("diagram:changed", diagram);
  if (scheduleSave) scheduleAutoSave();
}

// Text editors update their draft without forcing the canvas subtree to rerender.
// The final blur commit supplies the pre-edit snapshot and creates one undo entry.
function updateDiagramDraft(diagram) {
  state.diagram = diagram;
  state.diagrams = state.diagrams.map((item) => item.id === diagram.id ? diagram : item);
  state.dirtyTabIds.add(diagram.id);
  state.selectedHistoryVersion = "current";
  state.future = [];
  scheduleAutoSave();
}

function updateSaveStatus(status) {
  state.saveStatus = status;
  const target = document.querySelector("#save-status");
  if (target) target.textContent = status;
}

function syncSavedDiagram(saved) {
  if (state.diagram?.id === saved.id) state.diagram = saved;
  state.dirtyTabIds.delete(saved.id);
  state.diagrams = (state.diagrams ?? []).map((diagram) => diagram.id === saved.id ? saved : diagram);
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
  const diagramId = state.diagram.id;
  const changeVersion = (diagramChangeVersions.get(diagramId) ?? 0) + 1;
  diagramChangeVersions.set(diagramId, changeVersion);
  state.dirtyTabIds.add(state.diagram.id);
  state.diagrams = state.diagrams.map((item) => item.id === state.diagram.id ? state.diagram : item);
  clearTimeout(autoSaveTimers.get(state.diagram.id));
  updateSaveStatus("Unsaved");
  const pendingDiagram = structuredClone(state.diagram);
  autoSaveTimers.set(state.diagram.id, setTimeout(() => saveCurrentDiagram({ snapshot: false, diagram: pendingDiagram, changeVersion }), 300));
}

async function saveCurrentDiagram({ snapshot = false, diagram = state.diagram, changeVersion = diagramChangeVersions.get(diagram?.id) ?? 0 } = {}) {
  if (!diagram?.id) return;
  clearTimeout(autoSaveTimers.get(diagram.id));
  autoSaveTimers.delete(diagram.id);
  const previousSave = saveQueues.get(diagram.id) ?? Promise.resolve();
  const queuedSave = previousSave.catch(() => null).then(async () => {
    try {
      const isLatestChange = () => (diagramChangeVersions.get(diagram.id) ?? 0) === changeVersion;
      if (state.diagram?.id === diagram.id && isLatestChange()) updateSaveStatus(snapshot ? "Saving…" : "Auto-saving…");
      const outgoing = { ...diagram, version: lastSavedDiagramVersions.get(diagram.id) ?? diagram.version };
      const saved = await api.saveDiagram(outgoing, { snapshot });
      lastSavedDiagramVersions.set(diagram.id, saved.version);
      // A response for an older canvas snapshot must not replace newer imported
      // or edited state. Saves are also serialized so the server ends with the
      // newest snapshot even when an earlier request was already in flight.
      if (isLatestChange()) {
        syncSavedDiagram(saved);
        await loadModelRepository(state.project?.id);
        bus.emit("repository:changed", state.modelRepository);
        if (state.diagram?.id === diagram.id) updateSaveStatus(snapshot ? "Saved milestone" : "Saved");
        if (snapshot) await loadVersionHistory();
        setTimeout(() => {
          if (state.saveStatus === "Saved" || state.saveStatus === "Saved milestone") updateSaveStatus("");
        }, 1800);
      }
      return saved;
    } catch (error) {
      if ((diagramChangeVersions.get(diagram.id) ?? 0) === changeVersion) {
        updateSaveStatus("Save failed");
        bus.emit("toast", error.message);
      }
      return null;
    }
  });
  saveQueues.set(diagram.id, queuedSave);
  try {
    return await queuedSave;
  } finally {
    if (saveQueues.get(diagram.id) === queuedSave) saveQueues.delete(diagram.id);
  }
}

async function saveMilestone(diagramIds) {
  const selected = state.diagrams.filter((diagram) => diagramIds.includes(diagram.id));
  if (!selected.length) throw new Error("Select at least one tab for the milestone.");
  updateSaveStatus("Saving milestone…");
  for (const diagram of selected) {
    clearTimeout(autoSaveTimers.get(diagram.id));
    autoSaveTimers.delete(diagram.id);
    syncSavedDiagram(await api.saveDiagram(diagram));
  }
  const result = await api.request(`/api/projects/${state.project.id}/versions/milestone`, { method: "POST", body: JSON.stringify({ diagram_ids: selected.map(({ id }) => id), description: selected.map(({ name }) => name).join(", ") }) });
  state.versionHistory = result.versions ?? [];
  updateSaveStatus("Saved milestone");
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
  api, applyTheme, bus, escapeHtml, icons, loadVersionHistory, mountMfe, nextTheme, projectUrl, rememberPage,
  activateDiagramTab, cancelAutoSave: (diagramId) => { clearTimeout(autoSaveTimers.get(diagramId)); autoSaveTimers.delete(diagramId); }, redoDiagram, saveCurrentDiagram, saveMilestone, setDiagram, showDashboard, state, undoDiagram, updateDiagramDraft
});

async function loadWorkspace() {
  const data = await api.request("/api/bootstrap");
  state.project = data.projects[0] ?? null;
  state.diagram = data.diagrams[0] ?? null;
  state.diagrams = data.diagrams ?? [];
  state.diagrams.forEach((diagram) => lastSavedDiagramVersions.set(diagram.id, diagram.version));
  await loadModelRepository(state.project?.id);
  updateWorkspaceTitle();
  bus.emit("bootstrap", data);
  if (state.diagram) bus.emit("diagram:changed", state.diagram);
  if (state.view === "editor") synchronization.start();
}

async function openProject(projectId, { updateHistory = true } = {}) {
  if (!state.user || !state.authToken) throw new Error("Log in before opening a project.");
  const data = await api.request(`/api/projects/${projectId}/open`, { method: "POST" });
  state.project = data.project;
  state.diagrams = data.diagrams ?? [];
  state.diagrams.forEach((diagram) => lastSavedDiagramVersions.set(diagram.id, diagram.version));
  const rememberedDiagramId = storageGet(`sysml.activeDiagramId.${projectId}`);
  state.diagram = state.diagrams.find((diagram) => diagram.id === rememberedDiagramId) ?? state.diagrams[0] ?? null;
  state.modelRepository = repositoryFromDiagrams(state.diagrams);
  resetEditorInteractionState(state);
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

async function enterAuthenticatedWorkspace(preferredProjectId = storageGet("sysml.activeProjectId")) {
  if (preferredProjectId) {
    try {
      await openProject(preferredProjectId, { updateHistory: false });
      window.history.replaceState({ view: "editor", projectId: preferredProjectId }, "", projectUrl(preferredProjectId));
      return true;
    } catch (error) {
      if (!state.user) throw error;
      storageRemove("sysml.activeProjectId");
    }
  }
  const data = await api.request("/api/bootstrap");
  const firstProjectId = data.projects?.[0]?.id;
  if (firstProjectId) {
    await openProject(firstProjectId, { updateHistory: false });
    window.history.replaceState({ view: "editor", projectId: firstProjectId }, "", projectUrl(firstProjectId));
    return true;
  }
  state.view = "dashboard";
  rememberPage("dashboard");
  renderShell();
  window.history.replaceState({ view: "dashboard" }, "", dashboardUrl());
  return false;
}

async function boot() {
  document.querySelector("#app").innerHTML = `<main class="app-boot" aria-label="Restoring workspace"><span class="boot-mark">S</span><span>Restoring workspace…</span></main>`;
  if (state.authToken) {
    try {
      const session = await api.request("/api/auth/me");
      state.user = session.user;
      if (!state.user && state.refreshToken) {
        const refreshed = await api.request("/api/auth/refresh", { method: "POST", body: JSON.stringify({ refreshToken: state.refreshToken }) });
        state.authToken = refreshed.token;
        state.refreshToken = refreshed.refreshToken;
        state.user = refreshed.user;
        storageSet("sysml.authToken", refreshed.token);
        storageSet("sysml.refreshToken", refreshed.refreshToken);
      }
      if (state.user) state.tenantId = state.user.tenant_id;
      if (state.user) {
        const result = await api.request("/api/settings");
        state.settings = result.settings;
        applyTheme(state.settings.theme);
      }
    } catch {
      state.user = null;
    }
    if (!state.user) {
      state.authToken = "";
      state.refreshToken = "";
      storageRemove("sysml.authToken");
      storageRemove("sysml.refreshToken");
    }
    bus.emit("auth:changed", state.user);
  }
  const routeProjectId = new URL(window.location.href).searchParams.get("project");
  const rememberedView = routeProjectId ? "editor" : storageGet("sysml.activeView");
  const rememberedProjectId = routeProjectId ?? storageGet("sysml.activeProjectId");
  if (state.user && rememberedView === "editor") {
    try {
      await enterAuthenticatedWorkspace(rememberedProjectId);
      return;
    } catch {
      storageRemove("sysml.activeProjectId");
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
  storageSet("sysml.authToken", token);
  if (refreshToken) storageSet("sysml.refreshToken", refreshToken);
  const result = await api.request("/api/settings");
  state.settings = result.settings;
  applyTheme(state.settings.theme);
  state.view = "dashboard";
  rememberPage("dashboard");
  bus.emit("auth:changed", user);
  renderShell();
  window.history.replaceState({ view: "dashboard" }, "", dashboardUrl());
});

bus.on("auth:expired", () => {
  if (!state.user && !state.authToken && !state.refreshToken) return;
  synchronization.stop();
  state.authToken = "";
  state.refreshToken = "";
  state.user = null;
  state.tenantId = "tenant_demo";
  storageRemove("sysml.authToken");
  storageRemove("sysml.refreshToken");
  storageRemove("sysml.activeProjectId");
  state.view = "dashboard";
  state.project = null;
  state.diagram = null;
  state.diagrams = [];
  state.modelRepository = { schema_version: 2, elements: [], relationships: [] };
  resetEditorInteractionState(state);
  rememberPage("dashboard");
  bus.emit("auth:changed", null);
  renderShell();
  window.history.replaceState({ view: "dashboard" }, "", dashboardUrl());
  bus.emit("toast", "Your session expired. Please log in again.");
});

bus.on("auth:logout", async () => {
  try { if (state.authToken) await api.request("/api/auth/logout", { method: "POST" }); } catch { /* Local protected state must still be cleared. */ }
  synchronization.stop();
  state.authToken = "";
  state.refreshToken = "";
  state.user = null;
  state.tenantId = "tenant_demo";
  storageRemove("sysml.authToken");
  storageRemove("sysml.refreshToken");
  storageRemove("sysml.activeProjectId");
  state.view = "dashboard";
  rememberPage("dashboard");
  state.project = null;
  state.diagram = null;
  state.diagrams = [];
  state.modelRepository = { schema_version: 2, elements: [], relationships: [] };
  resetEditorInteractionState(state);
  bus.emit("auth:changed", null);
  renderShell();
  window.history.replaceState({ view: "dashboard" }, "", dashboardUrl());
});

bus.on("project:open", (projectId) => openProject(projectId).catch((error) => bus.emit("toast", `Could not open project: ${error.message}`)));
bus.on("dashboard:open", () => {
  if (state.view === "editor") showDashboard();
});
bus.on("selection:changed", (selection) => synchronization.publishPresence(null, selection));
bus.on("canvas:pointer", (cursor) => synchronization.publishPresence(cursor, state.selectedElementIds ?? []));
bus.on("diagram:remote", (diagram) => {
  lastSavedDiagramVersions.set(diagram.id, diagram.version);
  state.history = [];
  state.future = [];
});
bus.on("collaboration:conflict", ({ remoteVersion }) => {
  updateSaveStatus("Collaboration conflict");
  bus.emit("toast", `A teammate saved version ${remoteVersion}. Your unsaved canvas was kept; refresh after exporting a backup to load their version.`);
});
bus.on("comment:create", ({ input, onSuccess, onError } = {}) => synchronization.addComment(input).then((result) => onSuccess?.(result)).catch((error) => { onError?.(error); bus.emit("toast", error.message); }));
bus.on("comment:update", ({ commentId, input, onSuccess, onError } = {}) => synchronization.updateComment(commentId, input).then((result) => onSuccess?.(result)).catch((error) => { onError?.(error); bus.emit("toast", error.message); }));
bus.on("collaboration:retry", () => synchronization.refresh());
window.addEventListener("popstate", async (event) => {
  if (event.state?.view === "editor" && event.state.projectId) {
    if (state.user) await openProject(event.state.projectId, { updateHistory: false });
    else showDashboard({ updateHistory: false });
    return;
  }
  showDashboard({ updateHistory: false });
});

boot();
