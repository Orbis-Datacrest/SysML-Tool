import { registerMfe } from "/packages/ui/src/moduleRegistry.js";

function download(blob, filename) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

registerMfe("import-export", (element, { state, api }) => {
  let open = false;

  function downloadJson() {
    download(new Blob([JSON.stringify({ project: state.project, diagram: state.diagram }, null, 2)], { type: "application/json" }), `${state.project?.name ?? "project"}.json`);
  }

  function downloadPlantUml() {
    const lines = ["@startuml", ...state.diagram.elements.map((item) => `class ${item.name}`), ...state.diagram.relationships.map((relationship) => {
      const source = state.diagram.elements.find((item) => item.id === relationship.source_id)?.name;
      const target = state.diagram.elements.find((item) => item.id === relationship.target_id)?.name;
      return `${source} --> ${target} : ${relationship.kind}`;
    }), "@enduml"];
    download(new Blob([lines.join("\n")], { type: "text/plain" }), `${state.diagram.name}.puml`);
  }

  async function downloadPdf() {
    const blob = await api.request(`/api/diagrams/${state.diagram.id}/export/pdf`);
    download(blob, `${state.diagram.name}.pdf`);
  }

  function render() {
    element.innerHTML = `<button id="export-toggle" class="export-button" aria-haspopup="menu" aria-expanded="${open}">Export <span aria-hidden="true">⌄</span></button>
      ${open ? `<div class="export-menu" role="menu">
        <button data-export="json" role="menuitem"><span class="export-format">JSON</span><span>Project data</span></button>
        <button data-export="plantuml" role="menuitem"><span class="export-format">PUML</span><span>PlantUML source</span></button>
        <button data-export="pdf" role="menuitem"><span class="export-format">PDF</span><span>Document</span></button>
      </div>` : ""}`;
    element.querySelector("#export-toggle").addEventListener("click", (event) => { event.stopPropagation(); open = !open; render(); });
    element.querySelectorAll("[data-export]").forEach((button) => button.addEventListener("click", async () => {
      open = false;
      if (button.dataset.export === "json") downloadJson();
      if (button.dataset.export === "plantuml") downloadPlantUml();
      if (button.dataset.export === "pdf") await downloadPdf();
      render();
    }));
  }

  document.addEventListener("click", (event) => {
    if (open && !element.contains(event.target)) { open = false; render(); }
  });
  render();
});
