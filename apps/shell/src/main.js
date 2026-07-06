import { createEventBus, mountMfe } from "/packages/ui/src/moduleRegistry.js";
import "/apps/project-explorer/src/index.js";
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

function updateWorkspaceTitle() {
  const title = document.querySelector("#project-title");
  if (title) title.textContent = state.project && state.diagram ? `${state.project.name} / ${state.diagram.name}` : "No workspace";
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
  document.querySelector("#app").innerHTML = `
    <header class="topbar">
      <div>
        <strong class="brand-mark"><span class="brand-icon">S</span>SysML Studio</strong>
        <span id="project-title">Loading project</span>
      </div>
      <div class="topbar-actions">
        <button id="save" title="Save" class="primary">Save</button>
        <section id="import-export" class="topbar-export"></section>
        <section id="auth-session" class="topbar-auth"></section>
      </div>
    </header>
    <main class="workspace">
      <aside class="left-rail">
        <section id="project-explorer"></section>
        <section id="element-palette"></section>
        <section id="auth-tenant-settings"></section>
      </aside>
      <section id="diagram-canvas" class="canvas-host"></section>
      <aside class="right-rail">
        <section id="ai-advisor"></section>
      </aside>
    </main>
  `;
  const context = { state, bus, api, setDiagram, undoDiagram, redoDiagram };
  mountMfe("project-explorer", document.querySelector("#project-explorer"), context);
  mountMfe("element-palette", document.querySelector("#element-palette"), context);
  mountMfe("diagram-canvas", document.querySelector("#diagram-canvas"), context);
  mountMfe("ai-advisor", document.querySelector("#ai-advisor"), context);
  mountMfe("import-export", document.querySelector("#import-export"), context);
  mountMfe("auth-tenant-settings", document.querySelector("#auth-tenant-settings"), context);
  mountMfe("auth-session", document.querySelector("#auth-session"), context);

  document.querySelectorAll(".topbar, .left-rail, .right-rail").forEach((region) => {
    region.addEventListener("dragstart", (event) => {
      if (!event.target.closest(".palette-item")) event.preventDefault();
    });
    region.addEventListener("drop", (event) => event.preventDefault());
  });

  document.querySelector("#save").addEventListener("click", async () => {
    state.diagram = await api.saveDiagram(state.diagram);
    bus.emit("toast", "Diagram saved");
  });
  bus.on("history:undo", undoDiagram);
  bus.on("history:redo", redoDiagram);
  bus.on("project:changed", updateWorkspaceTitle);
  bus.on("diagram:changed", updateWorkspaceTitle);
}

async function loadWorkspace() {
  const data = await api.request("/api/bootstrap");
  state.project = data.projects[0] ?? null;
  state.diagram = data.diagrams[0] ?? null;
  updateWorkspaceTitle();
  bus.emit("bootstrap", data);
  if (state.diagram) bus.emit("diagram:changed", state.diagram);
}

async function boot() {
  renderShell();
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
    if (!state.user) {
      state.authToken = "";
      state.refreshToken = "";
      localStorage.removeItem("sysml.authToken");
      localStorage.removeItem("sysml.refreshToken");
    }
    bus.emit("auth:changed", state.user);
  }
  await loadWorkspace();
}

bus.on("auth:login", async ({ token, refreshToken, user }) => {
  state.authToken = token;
  state.refreshToken = refreshToken ?? "";
  state.user = user;
  state.tenantId = user.tenant_id;
  localStorage.setItem("sysml.authToken", token);
  if (refreshToken) localStorage.setItem("sysml.refreshToken", refreshToken);
  bus.emit("auth:changed", user);
  await loadWorkspace();
});

bus.on("auth:logout", async () => {
  if (state.authToken) await api.request("/api/auth/logout", { method: "POST" });
  state.authToken = "";
  state.refreshToken = "";
  state.user = null;
  state.tenantId = "tenant_demo";
  localStorage.removeItem("sysml.authToken");
  localStorage.removeItem("sysml.refreshToken");
  bus.emit("auth:changed", null);
  await loadWorkspace();
});

boot();
