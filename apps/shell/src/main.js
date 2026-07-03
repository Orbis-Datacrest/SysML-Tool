import { createEventBus, mountMfe } from "/packages/ui/src/moduleRegistry.js";
import "/apps/project-explorer/src/index.js";
import "/apps/element-palette/src/index.js";
import "/apps/diagram-canvas/src/index.js";
import "/apps/ai-advisor/src/index.js";
import "/apps/import-export/src/index.js";
import "/apps/properties-panel/src/index.js";
import "/apps/auth-tenant-settings/src/index.js";

const state = {
  tenantId: "tenant_demo",
  project: null,
  diagram: null,
  selectedElementIds: [],
  selectedRelationshipId: null,
  relationshipKind: "association",
  history: [],
  future: []
};

const bus = createEventBus();
const api = {
  async request(path, options = {}) {
    const result = await fetch(path, {
      ...options,
      headers: { "content-type": "application/json", "x-tenant-id": state.tenantId, ...(options.headers ?? {}) }
    });
    if (!result.ok) throw new Error((await result.json()).error ?? result.statusText);
    return result.headers.get("content-type")?.includes("application/json") ? result.json() : result.blob();
  },
  saveDiagram(diagram) {
    return this.request(`/api/diagrams/${diagram.id}`, { method: "PUT", body: JSON.stringify(diagram) });
  }
};

function setDiagram(diagram, recordHistory = true) {
  if (state.diagram && recordHistory) state.history.push(structuredClone(state.diagram));
  state.diagram = diagram;
  state.future = [];
  bus.emit("diagram:changed", diagram);
}

function renderShell() {
  document.querySelector("#app").innerHTML = `
    <header class="topbar">
      <div>
        <strong class="brand-mark"><span class="brand-icon">S</span>SysML Studio</strong>
        <span id="project-title">Loading project</span>
      </div>
      <div class="topbar-actions">
        <button id="undo" title="Undo" class="icon-button">↶</button>
        <button id="redo" title="Redo" class="icon-button">↷</button>
        <button id="save" title="Save" class="primary">Save</button>
      </div>
    </header>
    <main class="workspace">
      <aside class="left-rail">
        <section id="project-explorer"></section>
        <section id="element-palette"></section>
        <section id="properties-panel"></section>
        <section id="import-export"></section>
        <section id="auth-tenant-settings"></section>
      </aside>
      <section id="diagram-canvas" class="canvas-host"></section>
      <aside class="right-rail">
        <section id="ai-advisor"></section>
      </aside>
    </main>
  `;
  const context = { state, bus, api, setDiagram };
  mountMfe("project-explorer", document.querySelector("#project-explorer"), context);
  mountMfe("element-palette", document.querySelector("#element-palette"), context);
  mountMfe("diagram-canvas", document.querySelector("#diagram-canvas"), context);
  mountMfe("ai-advisor", document.querySelector("#ai-advisor"), context);
  mountMfe("properties-panel", document.querySelector("#properties-panel"), context);
  mountMfe("import-export", document.querySelector("#import-export"), context);
  mountMfe("auth-tenant-settings", document.querySelector("#auth-tenant-settings"), context);

  document.querySelector("#save").addEventListener("click", async () => {
    state.diagram = await api.saveDiagram(state.diagram);
    bus.emit("toast", "Diagram saved");
  });
  document.querySelector("#undo").addEventListener("click", () => {
    const previous = state.history.pop();
    if (!previous) return;
    state.future.push(structuredClone(state.diagram));
    state.diagram = previous;
    bus.emit("diagram:changed", state.diagram);
  });
  document.querySelector("#redo").addEventListener("click", () => {
    const next = state.future.pop();
    if (!next) return;
    state.history.push(structuredClone(state.diagram));
    state.diagram = next;
    bus.emit("diagram:changed", state.diagram);
  });
}

async function boot() {
  renderShell();
  const data = await api.request("/api/bootstrap");
  state.project = data.projects[0];
  state.diagram = data.diagrams[0];
  document.querySelector("#project-title").textContent = `${state.project.name} / ${state.diagram.name}`;
  bus.emit("bootstrap", data);
  bus.emit("diagram:changed", state.diagram);
}

boot();
