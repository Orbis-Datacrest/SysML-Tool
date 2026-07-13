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
  function render() {
    element.innerHTML = `<div class="panel diagram-type-panel"><h2>Diagram</h2><select id="diagram-type" aria-label="Diagram type">${diagramOptions()}</select></div>`;
    const diagramType = element.querySelector("#diagram-type");
    diagramType.value = state.diagram?.type ?? "uml-class";
    diagramType.addEventListener("change", () => {
      if (!state.diagram || state.diagram.type === diagramType.value) return;
      state.selectedElementIds = [];
      state.selectedRelationshipId = null;
      setDiagram({ ...structuredClone(state.diagram), type: diagramType.value });
    });
  }

  const unsubscribe = bus.on("diagram:changed", render);
  render();
  return unsubscribe;
});

registerMfe("project-validation", (element, { state, bus }) => {
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
    const expanded = state.validationExpanded !== false;
    element.innerHTML = `<div class="panel validation-panel ${expanded ? "expanded" : "collapsed"}">
      <button class="validation-heading" id="validation-toggle" type="button" aria-expanded="${expanded}" aria-controls="validation-content">
        <span class="validation-disclosure" aria-hidden="true">${expanded ? "▾" : "▸"}</span><span class="validation-title">Validation</span><span class="validation-count ${issues.length ? "has-errors" : ""}">${issues.length}</span>
      </button>
      <div id="validation-content" class="validation-content" aria-hidden="${!expanded}">
        <div class="validation-content-inner">
          <select id="severity-filter" aria-label="Filter validation severity"><option value="all">All severities</option>${["error", "warning", "info"].map((severity) => `<option value="${severity}" ${severityFilter === severity ? "selected" : ""}>${severity}</option>`).join("")}</select>
          <div class="validation-list">${issues.map((diagnostic) => `<button class="validation-item ${diagnostic.severity}" data-diagnostic-id="${escapeHtml(diagnostic.affectedElement.id)}" data-diagnostic-type="${diagnostic.affectedElement.type}"><span class="severity-dot"></span><span><strong>${escapeHtml(diagnostic.message)}</strong><small>${escapeHtml(diagnostic.suggestedFix)}</small></span></button>`).join("") || `<p class="validation-clean">✓ No model issues found</p>`}</div>
        </div>
      </div>
    </div>`;
    element.querySelector("#validation-toggle").addEventListener("click", () => {
      state.validationExpanded = !expanded;
      try { localStorage.setItem("sysml.validationExpanded", String(state.validationExpanded)); } catch {}
      render();
    });
    element.querySelector("#severity-filter")?.addEventListener("change", (event) => { severityFilter = event.target.value; render(); });
    element.querySelectorAll("[data-diagnostic-id]").forEach((button) => button.addEventListener("click", () => focusDiagnostic(button.dataset.diagnosticId, button.dataset.diagnosticType)));
  }

  const unsubscribeDiagram = bus.on("diagram:changed", render);
  const unsubscribeRepository = bus.on("repository:changed", render);
  render();
  return () => { unsubscribeDiagram(); unsubscribeRepository(); };
});
