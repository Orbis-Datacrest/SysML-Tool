import { registerMfe } from "/packages/ui/src/moduleRegistry.js";
import { commonElements, diagramCatalog } from "/packages/model-core/src/diagram-catalog.js";

const elementLabels = {
  "use-case": "Use Case", "system-boundary": "System Boundary", "data-type": "Data Type",
  "execution-environment": "Execution Environment", "structured-classifier": "Structured Classifier",
  "initial-node": "Initial Node", "final-node": "Final Node", "fork-join": "Fork / Join",
  "initial-state": "Initial State", "final-state": "Final State", "history-state": "History State",
  "combined-fragment": "Combined Fragment", "interaction-use": "Interaction Use",
  "state-invariant": "State Invariant", "time-constraint": "Time Constraint",
  "duration-constraint": "Duration Constraint", "value-type": "Value Type",
  "interface-block": "Interface Block", "constraint-block": "Constraint Block",
  "flow-property": "Flow Property", "constraint-property": "Constraint Property",
  "value-property": "Value Property", "binding-connector": "Binding Connector",
  "object-node": "Object Node", "test-case": "Test Case", "primitive-type": "Primitive Type",
  "accept-event-action": "Accept Event", "send-signal-action": "Send Signal", "merge-node": "Merge",
  "activity-final": "Activity Final", "flow-final": "Flow Final", "fork-node": "Fork",
  "join-node": "Join", "input-pin": "Input Pin", "output-pin": "Output Pin",
  "activity-partition": "Activity Partition", "composite-state": "Composite State",
  "entry-point": "Entry Point", "exit-point": "Exit Point", "destruction-occurrence": "Destruction",
  "history-state": "History", "interaction-use": "Interaction Use"
};

const ellipseKinds = new Set(["use-case"]);
const roundedKinds = new Set(["activity", "action", "state", "composite-state", "interaction", "interaction-use"]);
const circleKinds = new Set(["initial-node", "final-node", "initial-state", "final-state", "activity-final", "flow-final", "entry-point", "exit-point", "terminate"]);
const diamondKinds = new Set(["decision", "merge-node", "choice"]);
const humanKinds = new Set(["actor"]);
const timelineKinds = new Set(["lifeline", "activation", "message", "time-constraint", "duration-constraint", "state-invariant"]);
const packageKinds = new Set(["package", "model", "profile", "view", "viewpoint"]);
const noteKinds = new Set(["note", "comment", "rationale", "problem"]);

function labelFor(kind) {
  return elementLabels[kind] ?? kind.split("-").map((word) => `${word[0].toUpperCase()}${word.slice(1)}`).join(" ");
}

function elementPreview(kind) {
  if (humanKinds.has(kind)) return `<svg viewBox="0 0 72 58" aria-hidden="true"><circle cx="36" cy="10" r="8"/><path d="M36 18v21M19 25h34M36 39 20 56M36 39l16 17"/></svg>`;
  if (circleKinds.has(kind)) return `<svg viewBox="0 0 72 48" aria-hidden="true"><circle cx="36" cy="24" r="12"/>${kind.startsWith("final") ? `<circle class="solid" cx="36" cy="24" r="7"/>` : `<circle class="solid" cx="36" cy="24" r="10"/>`}</svg>`;
  if (diamondKinds.has(kind)) return `<svg viewBox="0 0 72 48" aria-hidden="true"><path class="shape-fill" d="M36 5 61 24 36 43 11 24Z"/></svg>`;
  if (["fork-node", "join-node", "fork-join"].includes(kind)) return `<svg viewBox="0 0 72 48" aria-hidden="true"><rect class="solid" x="8" y="21" width="56" height="7" rx="2"/></svg>`;
  if (kind === "accept-event-action") return `<svg viewBox="0 0 72 48" aria-hidden="true"><path class="shape-fill" d="M8 9h56v30H8l9-15Z"/><path d="M24 24h27"/></svg>`;
  if (kind === "send-signal-action") return `<svg viewBox="0 0 72 48" aria-hidden="true"><path class="shape-fill" d="M8 9h47l10 15-10 15H8Z"/><path d="M20 24h28"/></svg>`;
  if (["input-pin", "output-pin"].includes(kind)) return `<svg viewBox="0 0 72 48" aria-hidden="true"><rect class="shape-fill" x="25" y="13" width="22" height="22"/><path d="M9 24h16M47 24h16"/></svg>`;
  if (kind === "destruction-occurrence") return `<svg viewBox="0 0 72 48" aria-hidden="true"><path d="M22 10l28 28M50 10 22 38" stroke-width="4"/></svg>`;
  if (roundedKinds.has(kind)) return `<svg viewBox="0 0 72 48" aria-hidden="true"><rect class="shape-fill" x="8" y="8" width="56" height="32" rx="11"/><path d="M23 24h26"/></svg>`;
  if (ellipseKinds.has(kind)) {
    return `<svg viewBox="0 0 72 48" aria-hidden="true"><ellipse class="shape-fill" cx="36" cy="24" rx="27" ry="15"/><path d="M25 24h22"/></svg>`;
  }
  if (timelineKinds.has(kind)) return `<svg viewBox="0 0 72 48" aria-hidden="true"><rect class="shape-fill" x="20" y="4" width="32" height="10" rx="2"/><path stroke-dasharray="3 3" d="M36 14v30"/><rect class="accent-fill" x="32" y="21" width="8" height="17" rx="1"/></svg>`;
  if (packageKinds.has(kind)) return `<svg viewBox="0 0 72 48" aria-hidden="true"><path class="shape-fill" d="M9 13h21l5 6h28v24H9Z"/><path d="M9 19h54"/></svg>`;
  if (noteKinds.has(kind)) return `<svg viewBox="0 0 72 48" aria-hidden="true"><path class="shape-fill" d="M17 5h29l10 10v28H17Z"/><path d="M46 5v10h10M24 24h24M24 31h19"/></svg>`;
  if (kind === "decision" || kind === "fork-join") return `<svg viewBox="0 0 72 48" aria-hidden="true">${kind === "decision" ? `<path class="shape-fill" d="M36 6 58 24 36 42 14 24Z"/>` : `<rect class="solid" x="10" y="21" width="52" height="6" rx="2"/>`}</svg>`;
  return `<svg viewBox="0 0 72 48" aria-hidden="true"><rect class="shape-fill" x="8" y="4" width="56" height="40" rx="3"/><path d="M8 16h56M8 31h56M16 10h25M15 22h31M15 27h24M15 37h34"/></svg>`;
}

function paletteItems(kinds) {
  return `<div class="palette-grid">${kinds.map((kind) => `<button class="palette-item" draggable="false" data-kind="${kind}" title="${labelFor(kind)}" aria-label="Drag ${labelFor(kind)} to the canvas"><span class="palette-symbol">${elementPreview(kind)}</span><span class="palette-item-label">${labelFor(kind)}</span></button>`).join("")}</div>`;
}

registerMfe("element-palette", (element, { state, bus }) => {
  let pointerDragging = false;
  function render() {
    const diagramType = diagramCatalog.find((item) => item.value === state.diagram?.type) ?? diagramCatalog[0];
    element.innerHTML = `<div class="panel palette-panel">
      <h2>Element Palette</h2>
      <details open><summary><span>Common</span><span class="palette-count">${commonElements.length}</span></summary>${paletteItems(commonElements)}</details>
      <details open><summary><span>Diagram Elements</span><span class="palette-count">${diagramType.elements.length}</span></summary>${paletteItems(diagramType.elements)}</details>
    </div>`;
    element.querySelectorAll("[data-kind]").forEach((button) => {
      const detail = (clientY = button.getBoundingClientRect().top + button.offsetHeight / 2) => ({ kind: button.dataset.kind, label: labelFor(button.dataset.kind), preview: elementPreview(button.dataset.kind), clientY });
      button.addEventListener("mouseenter", (event) => { if (!pointerDragging) bus.emit("palette:hover", detail(event.clientY)); });
      button.addEventListener("mousemove", (event) => { if (!pointerDragging) bus.emit("palette:hover", detail(event.clientY)); });
      button.addEventListener("focus", () => bus.emit("palette:hover", detail()));
      button.addEventListener("mouseleave", () => bus.emit("palette:hover", null));
      button.addEventListener("blur", () => bus.emit("palette:hover", null));
      button.addEventListener("pointerdown", (event) => {
        if (event.button !== 0) return;
        event.preventDefault();
        const origin = { x: event.clientX, y: event.clientY };
        let dragging = false;
        const move = (pointerEvent) => {
          if (!dragging && Math.hypot(pointerEvent.clientX - origin.x, pointerEvent.clientY - origin.y) < 4) return;
          if (!dragging) { dragging = true; pointerDragging = true; bus.emit("palette:dragstart", button.dataset.kind); }
          bus.emit("palette:pointermove", { kind: button.dataset.kind, clientX: pointerEvent.clientX, clientY: pointerEvent.clientY, label: labelFor(button.dataset.kind), preview: elementPreview(button.dataset.kind) });
        };
        const up = (pointerEvent) => {
          window.removeEventListener("pointermove", move);
          window.removeEventListener("pointerup", up);
          if (dragging) bus.emit("palette:pointerdrop", { kind: button.dataset.kind, clientX: pointerEvent.clientX, clientY: pointerEvent.clientY });
          pointerDragging = false;
          bus.emit("palette:dragend");
          bus.emit("palette:hover", null);
        };
        window.addEventListener("pointermove", move);
        window.addEventListener("pointerup", up, { once: true });
      });
    });
  }
  bus.on("diagram:changed", render);
  render();
});
