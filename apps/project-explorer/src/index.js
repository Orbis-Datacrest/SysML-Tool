import { registerMfe } from "/packages/ui/src/moduleRegistry.js";
import { diagramCatalog } from "/packages/model-core/src/diagram-catalog.js";

function escapeHtml(value = "") {
  return String(value).replace(/[&<>'"]/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", "\"": "&quot;" })[character]);
}

function diagramOptions() {
  return [
    ["UML", "Structural"], ["UML", "Behavioral"],
    ["SysML", "Structural"], ["SysML", "Behavioral"], ["SysML", "Requirement"]
  ].map(([family, category]) => `<optgroup label="${family} · ${category}">${diagramCatalog
    .filter((diagram) => diagram.family === family && diagram.category === category)
    .map((diagram) => `<option value="${diagram.value}">${diagram.label}</option>`).join("")}</optgroup>`).join("");
}

registerMfe("project-explorer", (element, { state, bus, api, setDiagram }) => {
  function render() {
    const diagrams = (data.diagrams ?? []).filter((diagram) => !state.project || diagram.project_id === state.project.id);
    element.innerHTML = `
      <div class="panel">
        <h2>Project Navigation</h2>
        <div class="stack">
          <strong class="nav-title"><span class="tool-icon">PR</span>${state.project?.name ?? "No project"}</strong>
          <span class="muted">${state.project?.description ?? ""}</span>
          <button id="back-dashboard">Project Dashboard</button>
        </div>
      </div>
      
      <div class="panel">
        <h2>Diagram Type</h2>
        <select id="diagram-type">${diagramTypes.map(([value, label]) => `<option value="${value}">${label}</option>`).join("")}</select>
        <button id="new-diagram" class="primary" style="margin-top:8px;width:100%">Create Diagram</button>
      </div>
    `;
    element.querySelector("#diagram-type").value = state.diagram?.type ?? "uml-class";
    element.querySelector("#back-dashboard").addEventListener("click", () => {
      bus.emit("dashboard:open");
    });
    element.querySelectorAll("[data-diagram]").forEach((button) => {
      button.addEventListener("click", () => {
        const diagram = diagrams.find((item) => item.id === button.dataset.diagram);
        if (!diagram) return;
        state.diagram = diagram;
        state.selectedElementIds = [];
        state.selectedRelationshipId = null;
        bus.emit("diagram:changed", diagram);
        render();
      });
    });
    element.querySelectorAll("[data-rename-diagram]").forEach((button) => {
      button.addEventListener("click", async () => {
        const diagram = diagrams.find((item) => item.id === button.dataset.renameDiagram);
        const name = prompt("Rename diagram", diagram?.name ?? "");
        if (!name || name === diagram?.name) return;
        const updated = await api.request(`/api/diagrams/${diagram.id}`, { method: "PATCH", body: JSON.stringify({ name }) });
        data.diagrams = data.diagrams.map((item) => item.id === updated.id ? updated : item);
        state.diagrams = (state.diagrams ?? []).map((item) => item.id === updated.id ? updated : item);
        if (state.diagram?.id === updated.id) {
          state.diagram = updated;
          bus.emit("diagram:changed", updated);
        }
        bus.emit("toast", "Diagram renamed");
        render();
      });
    });
    element.querySelectorAll("[data-delete-diagram]").forEach((button) => {
      button.addEventListener("click", async () => {
        const diagram = diagrams.find((item) => item.id === button.dataset.deleteDiagram);
        if (!confirm(`Delete "${diagram?.name ?? "this diagram"}"?`)) return;
        await api.request(`/api/diagrams/${diagram.id}`, { method: "DELETE" });
        data.diagrams = data.diagrams.filter((item) => item.id !== diagram.id);
        state.diagrams = (state.diagrams ?? []).filter((item) => item.id !== diagram.id);
        if (state.diagram?.id === diagram.id) {
          state.diagram = state.diagrams.find((item) => item.project_id === state.project.id) ?? null;
          bus.emit("diagram:changed", state.diagram);
        }
        bus.emit("toast", "Diagram deleted");
        render();
      });
    });
    element.querySelectorAll("[data-duplicate-diagram]").forEach((button) => {
      button.addEventListener("click", async () => {
        const diagram = await api.request(`/api/diagrams/${button.dataset.duplicateDiagram}/duplicate`, { method: "POST" });
        data.diagrams.push(diagram);
        state.diagrams = [...(state.diagrams ?? []), diagram];
        state.diagram = diagram;
        bus.emit("diagram:changed", diagram);
        bus.emit("toast", "Diagram duplicated");
        render();
      });
    });
    element.querySelector("#new-diagram").addEventListener("click", async () => {
      const type = element.querySelector("#diagram-type").value;
      const diagram = await api.request("/api/diagrams", { method: "POST", body: JSON.stringify({ project_id: state.project.id, type, name: diagramTypes.find(([value]) => value === type)[1] }) });
      state.diagram = diagram;
      state.diagrams = [...(state.diagrams ?? []), diagram];
      data.diagrams.push(diagram);
      bus.emit("diagram:changed", diagram);
      render();
    });
  }
  bus.on("bootstrap", (next) => {
    data = next;
    render();
  });
  render();
});
