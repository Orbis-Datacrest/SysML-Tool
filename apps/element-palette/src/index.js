import { registerMfe } from "/packages/ui/src/moduleRegistry.js";

const elements = [
  ["class", "C", "Class"],
  ["interface", "I", "Interface"],
  ["block", "B", "Block"],
  ["package", "P", "Package"],
  ["requirement", "R", "Requirement"],
  ["actor", "A", "Actor"],
  ["use-case", "UC", "Use case"],
  ["state", "S", "State"],
  ["activity", "AC", "Activity"],
  ["action", "FN", "Action"],
  ["decision", "D", "Decision"],
  ["lifeline", "L", "Lifeline"],
  ["port", "PT", "Port"],
  ["note", "N", "Note"]
];

registerMfe("element-palette", (element) => {
  element.innerHTML = `
    <div class="panel">
      <h2>Element Palette</h2>
      <div class="palette-grid">
        ${elements.map(([kind, glyph, label]) => `<button class="palette-item" draggable="true" data-kind="${kind}" title="Drag ${label} to the canvas"><span class="tool-icon">${glyph}</span><span>${label}</span></button>`).join("")}
      </div>
    </div>
  `;
  element.querySelectorAll("[data-kind]").forEach((button) => {
    button.addEventListener("dragstart", (event) => {
      event.dataTransfer.setData("application/sysml-element", button.dataset.kind);
    });
  });
});
