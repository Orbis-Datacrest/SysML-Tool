import { registerMfe } from "/packages/ui/src/moduleRegistry.js";

registerMfe("properties-panel", (element, { state, setDiagram, bus }) => {
  function render() {
    const selected = state.diagram?.elements.find((item) => item.id === state.selectedElementIds[0]);
    element.innerHTML = `
      <div class="panel">
        <h2>Properties</h2>
        ${selected ? `<div class="stack"><label>Name<input id="name" value="${selected.name}"></label><span class="muted">${selected.kind} / ${selected.id}</span></div>` : `<span class="muted">Select an element to edit properties.</span>`}
      </div>
    `;
    element.querySelector("#name")?.addEventListener("change", (event) => {
      const next = structuredClone(state.diagram);
      next.elements.find((item) => item.id === selected.id).name = event.target.value;
      setDiagram(next);
    });
  }
  bus.on("diagram:changed", render);
  bus.on("selection:changed", render);
  render();
});
