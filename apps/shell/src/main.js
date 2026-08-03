import { createEventBus, mountMfe } from "/packages/ui/src/moduleRegistry.js";
import { activateDiagramTab, createInitialState, rememberActiveTabState } from "./app/state.js";
import { applyTheme, escapeHtml, nextTheme, rememberPage } from "./app/browser.js";
import { loadLocalWorkspace, persistLocalWorkspace } from "./app/localWorkspace.js";
import { createShellRenderer } from "./views/createShellRenderer.js";
import "/apps/project-explorer/src/index.js";
import "/apps/element-palette/src/index.js";
import "/apps/diagram-canvas/src/index.js";
import "/apps/import-export/src/index.js";
import "/apps/ai-advisor/src/index.js";

const state = createInitialState();
const restored = loadLocalWorkspace();
Object.assign(state, {
  view: "editor",
  project: restored.project,
  diagrams: restored.diagrams,
  diagram: restored.diagrams.find((item) => item.id === restored.activeDiagramId) ?? restored.diagrams[0],
  canvasViewport: restored.canvasViewport,
  tabStates: restored.tabStates,
  history: restored.history,
  future: restored.future,
  rightPanel: "advisor",
  saveStatus: "Stored temporarily in this browser"
});
state.modelRepository = repositoryFromDiagrams(state.diagrams);
applyTheme(state.settings.theme);

const bus = createEventBus();
let persistTimer = null;

function repositoryFromDiagrams(diagrams) {
  const elements = new Map();
  const relationships = new Map();
  for (const diagram of diagrams ?? []) {
    for (const item of diagram.elements ?? []) elements.set(item.model_element_id ?? item.id, {
      id: item.model_element_id ?? item.id, kind: item.kind, name: item.name,
      semantic: item.properties ?? {}, stereotypes: item.stereotypes ?? []
    });
    for (const item of diagram.relationships ?? []) relationships.set(item.model_relationship_id ?? item.id, {
      id: item.model_relationship_id ?? item.id, kind: item.kind, source_id: item.source_id,
      target_id: item.target_id, label: item.label, semantic: item.properties ?? {}
    });
  }
  return { schema_version: 2, elements: [...elements.values()], relationships: [...relationships.values()] };
}

function updateSaveStatus(message) {
  state.saveStatus = message;
  const target = document.querySelector("#save-status");
  if (target) target.textContent = message;
}

function persistNow() {
  clearTimeout(persistTimer);
  persistTimer = null;
  rememberActiveTabState(state);
  state.modelRepository = repositoryFromDiagrams(state.diagrams);
  const saved = persistLocalWorkspace(state);
  updateSaveStatus(saved ? "Stored temporarily in this browser" : "Browser storage unavailable — export JSON");
  return saved;
}

function schedulePersist() {
  updateSaveStatus("Storing temporary copy…");
  clearTimeout(persistTimer);
  persistTimer = setTimeout(persistNow, 120);
}

function setDiagram(diagram, recordHistory = true, historySnapshot = null) {
  if (state.diagram && recordHistory) state.history.push(structuredClone(historySnapshot ?? state.diagram));
  if (state.history.length > 100) state.history.shift();
  state.diagram = diagram;
  state.diagrams = state.diagrams.map((item) => item.id === diagram.id ? diagram : item);
  state.future = [];
  state.dirtyTabIds.delete(diagram.id);
  bus.emit("diagram:changed", diagram);
  schedulePersist();
}

function updateDiagramDraft(diagram) {
  state.diagram = diagram;
  state.diagrams = state.diagrams.map((item) => item.id === diagram.id ? diagram : item);
  state.future = [];
  schedulePersist();
}

function undoDiagram() {
  const previous = state.history.pop();
  if (!previous) return;
  state.future.push(structuredClone(state.diagram));
  state.diagram = previous;
  state.diagrams = state.diagrams.map((item) => item.id === previous.id ? previous : item);
  bus.emit("diagram:changed", previous);
  persistNow();
}

function redoDiagram() {
  const next = state.future.pop();
  if (!next) return;
  state.history.push(structuredClone(state.diagram));
  state.diagram = next;
  state.diagrams = state.diagrams.map((item) => item.id === next.id ? next : item);
  bus.emit("diagram:changed", next);
  persistNow();
}

const api = {
  async request(path, options = {}) {
    const body = options.body ? JSON.parse(options.body) : {};
    if (path === "/api/ai" && options.method === "POST") {
      const response = await fetch("/api/ai", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body)
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.error ?? `AI request failed (${response.status}).`);
      return payload;
    }
    if (path === "local:diagrams" && options.method === "POST") {
      setTimeout(schedulePersist, 0);
      return { id: `diagram_${crypto.randomUUID()}`, project_id: state.project.id, type: body.type, name: body.name, version: 1, metadata: { grid: 20 }, elements: [], relationships: [] };
    }
    const diagramMatch = path.match(/^local:diagram\/([^/?]+)$/);
    if (diagramMatch && options.method === "PATCH") {
      const diagram = state.diagrams.find((item) => item.id === diagramMatch[1]);
      setTimeout(schedulePersist, 0);
      return { ...diagram, ...body, updated_at: new Date().toISOString() };
    }
    if (diagramMatch && options.method === "DELETE") {
      setTimeout(schedulePersist, 0);
      return {};
    }
    const projectMatch = path.match(/^local:project\/([^/?]+)$/);
    if (projectMatch && options.method === "PATCH") {
      setTimeout(schedulePersist, 0);
      return { ...state.project, ...body, updated_at: new Date().toISOString() };
    }
    throw new Error("This feature needs a backend and is not available in the local-only edition.");
  },
  async saveDiagram(diagram) { setDiagram(diagram, false); persistNow(); return diagram; }
};

async function saveCurrentDiagram({ diagram = state.diagram } = {}) {
  if (diagram) setDiagram(diagram, false);
  persistNow();
  return diagram;
}

async function saveMilestone() {
  persistNow();
  bus.emit("toast", "Temporary browser copy updated. Export JSON for a durable file.");
}

const renderShell = createShellRenderer({
  activateDiagramTab, api, applyTheme, bus, cancelAutoSave: () => {}, escapeHtml, icons: {
    moon: "☾", sun: "☀", save: "↓", history: "↶",
    ai: `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" fill="currentColor" class="bi bi-stars" viewBox="0 0 16 16" aria-hidden="true" focusable="false">
      <path d="M7.657 6.247c.11-.33.576-.33.686 0l.645 1.937a2.89 2.89 0 0 0 1.829 1.828l1.936.645c.33.11.33.576 0 .686l-1.937.645a2.89 2.89 0 0 0-1.828 1.829l-.645 1.936a.361.361 0 0 1-.686 0l-.645-1.937a2.89 2.89 0 0 0-1.828-1.828l-1.937-.645a.361.361 0 0 1 0-.686l1.937-.645a2.89 2.89 0 0 0 1.828-1.828zM3.794 1.148a.217.217 0 0 1 .412 0l.387 1.162c.173.518.579.924 1.097 1.097l1.162.387a.217.217 0 0 1 0 .412l-1.162.387A1.73 1.73 0 0 0 4.593 5.69l-.387 1.162a.217.217 0 0 1-.412 0L3.407 5.69A1.73 1.73 0 0 0 2.31 4.593l-1.162-.387a.217.217 0 0 1 0-.412l1.162-.387A1.73 1.73 0 0 0 3.407 2.31zM10.863.099a.145.145 0 0 1 .274 0l.258.774c.115.346.386.617.732.732l.774.258a.145.145 0 0 1 0 .274l-.774.258a1.16 1.16 0 0 0-.732.732l-.258.774a.145.145 0 0 1-.274 0l-.258-.774a1.16 1.16 0 0 0-.732-.732L9.1 2.137a.145.145 0 0 1 0-.274l.774-.258c.346-.115.617-.386.732-.732z"/>
    </svg>`
  },
  loadVersionHistory: async () => {}, mountMfe, nextTheme,
  redoDiagram, rememberPage,
  saveCurrentDiagram, saveMilestone, setDiagram, showDashboard: () => {}, state,
  undoDiagram, updateDiagramDraft
});

bus.on("history:undo", undoDiagram);
bus.on("history:redo", redoDiagram);
bus.on("diagram:changed", schedulePersist);
window.addEventListener("beforeunload", persistNow);
document.addEventListener("visibilitychange", () => { if (document.visibilityState === "hidden") persistNow(); });

renderShell();
bus.emit("bootstrap", { projects: [state.project], diagrams: state.diagrams });
bus.emit("diagram:changed", state.diagram);
