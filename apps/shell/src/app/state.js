import { createSidebarLayout } from "./sidebarLayout.js";
import { normalizeTheme } from "./browser.js";

export function createInitialState(storage = globalThis.localStorage, media = globalThis.matchMedia?.bind(globalThis)) {
  const readStorage = (key) => { try { return storage?.getItem(key) ?? null; } catch { return null; } };
  const desktopLayout = (() => { try { return media("(min-width: 768px)").matches; } catch { return true; } })();
  return {
    tenantId: "tenant_demo",
    authToken: readStorage("sysml.authToken") ?? "",
    refreshToken: readStorage("sysml.refreshToken") ?? "",
    user: null,
    view: "dashboard",
    sidebarLayout: createSidebarLayout(storage, desktopLayout),
    rightPanel: "advisor",
    selectedHistoryVersion: "current",
    settingsOpen: false,
    validationExpanded: readStorage("sysml.validationExpanded") !== "false",
    versionHistory: [],
    baselines: [],
    auditHistory: [],
    reviews: [],
    versionCompare: { from: "", to: "", diff: null },
    collaboration: { role: "Owner", permissions: [], presence: [], comments: [], notifications: [], online: false },
    settings: { theme: normalizeTheme(readStorage("sysml.theme")) },
    project: null,
    diagram: null,
    diagrams: [],
    tabStates: {},
    dirtyTabIds: new Set(),
    modelRepository: { schema_version: 2, elements: [], relationships: [] },
    selectedElementIds: [],
    selectedRelationshipId: null,
    canvasViewport: { zoom: 1, scrollLeft: 0, scrollTop: 0 },
    selectedTool: { type: "select", kind: null, label: "" },
    saveStatus: "",
    shareDraft: { email: "", role: "Viewer" },
    history: [],
    future: []
  };
}

export function rememberActiveTabState(state) {
  if (!state.diagram?.id) return;
  state.tabStates[state.diagram.id] = {
    viewport: structuredClone(state.canvasViewport),
    history: structuredClone(state.history),
    future: structuredClone(state.future),
    selectedElementIds: [...state.selectedElementIds],
    selectedRelationshipId: state.selectedRelationshipId
  };
}

export function activateDiagramTab(state, diagram) {
  rememberActiveTabState(state);
  state.diagram = diagram;
  const saved = state.tabStates[diagram.id];
  state.canvasViewport = structuredClone(saved?.viewport ?? { zoom: 1, scrollLeft: 0, scrollTop: 0 });
  state.history = structuredClone(saved?.history ?? []);
  state.future = structuredClone(saved?.future ?? []);
  state.selectedElementIds = [...(saved?.selectedElementIds ?? [])];
  state.selectedRelationshipId = saved?.selectedRelationshipId ?? null;
  state.selectedTool = { type: "select", kind: null, label: "" };
}

export function resetEditorInteractionState(state) {
  state.selectedElementIds = [];
  state.selectedRelationshipId = null;
  state.selectedTool = { type: "select", kind: null, label: "" };
  state.canvasViewport = { zoom: 1, scrollLeft: 0, scrollTop: 0 };
  state.history = [];
  state.future = [];
  state.tabStates = {};
  state.dirtyTabIds = new Set();
}
