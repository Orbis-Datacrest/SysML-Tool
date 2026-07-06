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
    const projectName = state.project?.name?.trim() || "Untitled Project";
    const selectedType = diagramCatalog.find((diagram) => diagram.value === state.diagram?.type) ?? diagramCatalog[0];
    element.innerHTML = `<div class="panel project-heading-panel">
      ${state.project ? `<button class="project-title" id="edit-project-name" title="Rename project" aria-label="Rename ${escapeHtml(projectName)}"><span>${escapeHtml(projectName)}</span><span class="edit-glyph" aria-hidden="true">✎</span></button>` : `<div class="project-title unavailable">Untitled Project</div>`}
      ${state.project?.description ? `<p class="project-description">${escapeHtml(state.project.description)}</p>` : ""}
    </div>
    <div class="panel diagram-type-panel">
      <h2>Diagram Type</h2>
      <div class="diagram-select-wrap" data-family="${selectedType.family}">
        <span class="diagram-family-badge" aria-hidden="true">${selectedType.family === "UML" ? "U" : "S"}</span>
        <select id="diagram-type" aria-label="Diagram type">${diagramOptions()}</select>
        <span class="select-chevron" aria-hidden="true">⌄</span>
      </div>
      <button id="new-diagram" class="primary full-width">Create Diagram</button>
    </div>`;

    const typeSelect = element.querySelector("#diagram-type");
    typeSelect.value = state.diagram?.type ?? "uml-class";
    typeSelect.addEventListener("change", () => {
      if (!state.diagram) return;
      const next = structuredClone(state.diagram);
      next.type = typeSelect.value;
      setDiagram(next);
    });
    element.querySelector("#edit-project-name")?.addEventListener("click", beginProjectRename);
    element.querySelector("#new-diagram").addEventListener("click", async () => {
      if (!state.project) return;
      const definition = diagramCatalog.find((item) => item.value === typeSelect.value);
      const diagram = await api.request("/api/diagrams", { method: "POST", body: JSON.stringify({ project_id: state.project.id, type: definition.value, name: definition.label }) });
      setDiagram(diagram, false);
    });
  }

  function beginProjectRename() {
    const button = element.querySelector("#edit-project-name");
    if (!button) return;
    const originalName = state.project.name?.trim() || "Untitled Project";
    button.outerHTML = `<input id="project-name-editor" class="project-title-editor" value="${escapeHtml(originalName)}" aria-label="Project name" maxlength="120">`;
    const input = element.querySelector("#project-name-editor");
    let cancelled = false;
    input.focus();
    input.select();
    input.addEventListener("keydown", (event) => {
      if (event.key === "Enter") { event.preventDefault(); input.blur(); }
      if (event.key === "Escape") { event.preventDefault(); cancelled = true; render(); }
    });
    input.addEventListener("blur", async () => {
      if (cancelled) return;
      const name = input.value.trim() || "Untitled Project";
      if (name !== state.project.name) {
        state.project = await api.request(`/api/projects/${state.project.id}`, { method: "PUT", body: JSON.stringify({ ...state.project, name }) });
        bus.emit("project:changed", state.project);
      }
      render();
    }, { once: true });
  }

  bus.on("bootstrap", render);
  bus.on("diagram:changed", render);
  render();
});
