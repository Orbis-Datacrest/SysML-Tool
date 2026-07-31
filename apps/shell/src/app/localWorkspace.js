export const LOCAL_WORKSPACE_KEY = "model-studio.workspace.v1";
export const LOCAL_HISTORY_LIMIT = 100;

function read(storage, key) {
  try { return storage?.getItem(key) ?? null; } catch { return null; }
}

export function createBlankWorkspace() {
  const now = new Date().toISOString();
  const projectId = "local_project";
  const diagram = {
    id: "diagram_main",
    project_id: projectId,
    type: "uml-class",
    name: "Untitled Diagram",
    version: 1,
    metadata: { grid: 20 },
    elements: [],
    relationships: []
  };
  return {
    project: { id: projectId, name: "Untitled Project", description: "Local Model Studio workspace", created_at: now, updated_at: now },
    diagrams: [diagram],
    activeDiagramId: diagram.id,
    canvasViewport: { zoom: 1, scrollLeft: 0, scrollTop: 0 },
    tabStates: {},
    history: [],
    future: []
  };
}

export function loadLocalWorkspace(storage = globalThis.localStorage) {
  const fallback = createBlankWorkspace();
  try {
    const value = JSON.parse(read(storage, LOCAL_WORKSPACE_KEY));
    if (!value?.project || !Array.isArray(value.diagrams) || !value.diagrams.length) return fallback;
    const activeDiagramId = value.diagrams.some((item) => item.id === value.activeDiagramId)
      ? value.activeDiagramId
      : value.diagrams[0].id;
    return {
      ...fallback,
      ...value,
      activeDiagramId,
      canvasViewport: value.canvasViewport ?? fallback.canvasViewport,
      tabStates: value.tabStates ?? {},
      history: (value.history ?? []).slice(-LOCAL_HISTORY_LIMIT),
      future: (value.future ?? []).slice(-LOCAL_HISTORY_LIMIT)
    };
  } catch {
    return fallback;
  }
}

export function workspaceSnapshot(state) {
  return {
    schemaVersion: 1,
    savedAt: new Date().toISOString(),
    project: structuredClone(state.project),
    diagrams: structuredClone(state.diagrams),
    activeDiagramId: state.diagram?.id ?? state.diagrams[0]?.id ?? null,
    canvasViewport: structuredClone(state.canvasViewport),
    tabStates: structuredClone(state.tabStates),
    history: structuredClone(state.history.slice(-LOCAL_HISTORY_LIMIT)),
    future: structuredClone(state.future.slice(-LOCAL_HISTORY_LIMIT))
  };
}

export function persistLocalWorkspace(state, storage = globalThis.localStorage) {
  try {
    storage?.setItem(LOCAL_WORKSPACE_KEY, JSON.stringify(workspaceSnapshot(state)));
    return true;
  } catch {
    return false;
  }
}
