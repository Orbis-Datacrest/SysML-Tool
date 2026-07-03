import { registerMfe } from "/packages/ui/src/moduleRegistry.js";

registerMfe("import-export", (element, { state }) => {
  function downloadJson() {
    const blob = new Blob([JSON.stringify({ project: state.project, diagram: state.diagram }, null, 2)], { type: "application/json" });
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = `${state.project.name}.json`;
    link.click();
  }
  function render() {
    element.innerHTML = `
      <div class="panel">
        <h2>Import / Export</h2>
        <div class="stack">
          <button id="json">Export JSON</button>
          <button id="plantuml">Export PlantUML</button>
          <button id="pdf">Export PDF</button>
          <span class="muted">XMI, PNG, and SVG contracts are scaffolded for service implementation.</span>
        </div>
      </div>
    `;
    element.querySelector("#json").addEventListener("click", downloadJson);
    element.querySelector("#plantuml").addEventListener("click", () => {
      const lines = ["@startuml", ...state.diagram.elements.map((item) => `class ${item.name}`), ...state.diagram.relationships.map((rel) => {
        const source = state.diagram.elements.find((item) => item.id === rel.source_id)?.name;
        const target = state.diagram.elements.find((item) => item.id === rel.target_id)?.name;
        return `${source} --> ${target} : ${rel.kind}`;
      }), "@enduml"];
      const blob = new Blob([lines.join("\n")], { type: "text/plain" });
      const link = document.createElement("a");
      link.href = URL.createObjectURL(blob);
      link.download = `${state.diagram.name}.puml`;
      link.click();
    });
    element.querySelector("#pdf").addEventListener("click", () => {
      window.open(`/api/diagrams/${state.diagram.id}/export/pdf`, "_blank");
    });
  }
  render();
});
