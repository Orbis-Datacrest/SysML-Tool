import { registerMfe } from "/packages/ui/src/moduleRegistry.js";

const diagramTypes = [
  ["uml-class", "UML Class Diagram"],
  ["uml-state-machine", "UML State Machine"],
  ["uml-activity", "UML Activity"],
  ["uml-sequence", "UML Sequence"],
  ["sysml-bdd", "SysML Block Definition"],
  ["sysml-ibd", "SysML Internal Block"],
  ["sysml-requirement", "SysML Requirement"],
  ["sysml-parametric", "SysML Parametric"],
  ["sysml-use-case", "SysML Use Case"]
];

registerMfe("project-explorer", (element, { state, bus, api }) => {
  let data = { projects: [], diagrams: [] };
  function render() {
    element.innerHTML = `
      <div class="panel">
        <h2>Project Navigation</h2>
        <div class="stack">
          <strong class="nav-title"><span class="tool-icon">PR</span>${state.project?.name ?? "No project"}</strong>
          <span class="muted">${state.project?.description ?? ""}</span>
          <button id="new-project">New Project</button>
        </div>
      </div>
      <div class="panel">
        <h2>Design / Model Navigation</h2>
        <div class="stack">
          ${data.diagrams.map((diagram) => `<button class="nav-row" data-diagram="${diagram.id}"><span class="tool-icon">DG</span><span>${diagram.name}<br><span class="muted">${diagram.type}</span></span></button>`).join("")}
        </div>
      </div>
      <div class="panel">
        <h2>Diagram Type</h2>
        <select id="diagram-type">${diagramTypes.map(([value, label]) => `<option value="${value}">${label}</option>`).join("")}</select>
        <button id="new-diagram" class="primary" style="margin-top:8px;width:100%">Create Diagram</button>
      </div>
    `;
    element.querySelector("#diagram-type").value = state.diagram?.type ?? "uml-class";
    element.querySelector("#new-project").addEventListener("click", async () => {
      const project = await api.request("/api/projects", { method: "POST", body: JSON.stringify({ name: "Untitled Project" }) });
      state.project = project;
      bus.emit("toast", "Project created");
      render();
    });
    element.querySelector("#new-diagram").addEventListener("click", async () => {
      const type = element.querySelector("#diagram-type").value;
      const diagram = await api.request("/api/diagrams", { method: "POST", body: JSON.stringify({ project_id: state.project.id, type, name: diagramTypes.find(([value]) => value === type)[1] }) });
      state.diagram = diagram;
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
