import { registerMfe } from "/packages/ui/src/moduleRegistry.js";
import { diagramCatalog } from "/packages/model-core/src/diagram-catalog.js";

function diagramOptions() {
  return [
    ["UML", "Structural"], ["UML", "Behavioral"],
    ["SysML", "Structural"], ["SysML", "Behavioral"], ["SysML", "Requirement"]
  ].map(([family, category]) => `<optgroup label="${family} · ${category}">${diagramCatalog
    .filter((diagram) => diagram.family === family && diagram.category === category)
    .map((diagram) => `<option value="${diagram.value}">${diagram.label}</option>`).join("")}</optgroup>`).join("");
}

registerMfe("project-explorer", (element, { state, bus, setDiagram }) => {
  function render() {
    element.innerHTML = `<div class="panel diagram-type-panel">
      <h2>Diagram Type</h2>
      <select id="diagram-type" aria-label="Diagram type">${diagramOptions()}</select>
    </div>`;
    const select = element.querySelector("#diagram-type");
    select.value = state.diagram?.type ?? "uml-class";
    select.addEventListener("change", () => {
      if (!state.diagram || state.diagram.type === select.value) return;
      state.selectedElementIds = [];
      state.selectedRelationshipId = null;
      setDiagram({ ...structuredClone(state.diagram), type: select.value });
    });
  }

  bus.on("diagram:changed", render);
  render();
});
