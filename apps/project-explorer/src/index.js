import { registerMfe } from "/packages/ui/src/moduleRegistry.js";
import { diagramCatalog } from "/packages/model-core/src/diagram-catalog.js";
import { validateModel } from "/packages/model-core/src/index.js";

function escapeHtml(value = "") {
  return String(value).replace(/[&<>'"]/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" })[character]);
}

function diagramOptions() {
  return [["UML", "Structural"], ["UML", "Behavioral"], ["SysML", "Structural"], ["SysML", "Behavioral"], ["SysML", "Requirement"]]
    .map(([family, category]) => `<optgroup label="${family} · ${category}">${diagramCatalog
      .filter((diagram) => diagram.family === family && diagram.category === category)
      .map((diagram) => `<option value="${diagram.value}">${diagram.label}</option>`).join("")}</optgroup>`).join("");
}

registerMfe("project-explorer", (element, { state, bus, setDiagram }) => {
  let severityFilter = "all";
  const diagramElementIds = () => new Set((state.diagrams ?? []).flatMap((diagram) => (diagram.elements ?? []).map((item) => item.model_element_id ?? item.id)));
  const diagnostics = () => validateModel(state.modelRepository ?? { elements: [], relationships: [] }, { diagramElementIds: diagramElementIds() })
    .filter((diagnostic) => severityFilter === "all" || diagnostic.severity === severityFilter);

  function focusDiagnostic(diagnosticId, type) {
    if (type === "relationship") {
      const diagram = (state.diagrams ?? []).find((item) => item.relationships.some((relationship) => (relationship.model_relationship_id ?? relationship.id) === diagnosticId));
      if (diagram && diagram.id !== state.diagram?.id) { state.diagram = diagram; bus.emit("diagram:changed", diagram); }
      bus.emit("relationship:focus", diagnosticId);
      return;
    }
    const diagram = (state.diagrams ?? []).find((item) => item.elements.some((modelElement) => (modelElement.model_element_id ?? modelElement.id) === diagnosticId));
    if (diagram && diagram.id !== state.diagram?.id) { state.diagram = diagram; bus.emit("diagram:changed", diagram); }
    bus.emit("model:focus", diagnosticId);
  }

  function render() {
    const issues = diagnostics();
    element.innerHTML = `<div class="panel diagram-type-panel"><h2>Diagram Type</h2><select id="diagram-type" aria-label="Diagram type">${diagramOptions()}</select></div>
      <div class="panel validation-panel"><div class="validation-heading"><h2>Validation</h2><span class="validation-count ${issues.length ? "has-errors" : ""}">${issues.length}</span></div>
        <select id="severity-filter" aria-label="Filter validation severity"><option value="all">All severities</option>${["error", "warning", "info"].map((severity) => `<option value="${severity}" ${severityFilter === severity ? "selected" : ""}>${severity}</option>`).join("")}</select>
        <div class="validation-list">${issues.map((diagnostic) => `<button class="validation-item ${diagnostic.severity}" data-diagnostic-id="${escapeHtml(diagnostic.affectedElement.id)}" data-diagnostic-type="${diagnostic.affectedElement.type}"><span class="severity-dot"></span><span><strong>${escapeHtml(diagnostic.message)}</strong><small>${escapeHtml(diagnostic.suggestedFix)}</small></span></button>`).join("") || `<p class="validation-clean">✓ No model issues found</p>`}</div>
      </div>`;
    const diagramType = element.querySelector("#diagram-type");
    diagramType.value = state.diagram?.type ?? "uml-class";
    diagramType.addEventListener("change", () => {
      if (!state.diagram || state.diagram.type === diagramType.value) return;
      state.selectedElementIds = [];
      state.selectedRelationshipId = null;
      setDiagram({ ...structuredClone(state.diagram), type: diagramType.value });
    });
    element.querySelector("#severity-filter").addEventListener("change", (event) => { severityFilter = event.target.value; render(); });
    element.querySelectorAll("[data-diagnostic-id]").forEach((button) => button.addEventListener("click", () => focusDiagnostic(button.dataset.diagnosticId, button.dataset.diagnosticType)));
  }

  bus.on("diagram:changed", render);
  bus.on("repository:changed", render);
  render();
});
