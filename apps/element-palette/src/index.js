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

function previewText(kind, y = 27, className = "preview-text") {
  const label = labelFor(kind);
  const text = label.length > 16 ? `${label.slice(0, 15)}…` : label;
  return `<text class="${className}" x="36" y="${y}" text-anchor="middle">${text}</text>`;
}

function elementPreview(kind) {
  if (["association", "link", "connector", "communication-path", "control-flow", "object-flow", "transition", "item-flow", "binding-connector"].includes(kind)) return `<svg viewBox="0 0 72 48" aria-hidden="true"><path d="M5 24h62"/>${["control-flow", "object-flow", "transition", "item-flow"].includes(kind) ? `<path d="m58 18 9 6-9 6"/>` : ""}</svg>`;
  if (["dependency", "note-connector", "include", "extend", "package-merge", "satisfy", "verify", "refine", "trace", "derive-reqt"].includes(kind)) return `<svg viewBox="0 0 72 48" aria-hidden="true"><path stroke-dasharray="6 4" d="M5 24h62"/><path d="m58 18 9 6-9 6"/></svg>`;
  if (["generalization", "extension"].includes(kind)) return `<svg viewBox="0 0 72 48" aria-hidden="true"><path d="M5 24h50"/><path class="shape-fill" d="m55 15 12 9-12 9Z"/></svg>`;
  if (["aggregation", "composition"].includes(kind)) return `<svg viewBox="0 0 72 48" aria-hidden="true"><path d="M17 24h50"/><path class="${kind === "composition" ? "solid" : "shape-fill"}" d="M5 24l12-8 12 8-12 8Z"/></svg>`;
  if (["synchronous-message", "asynchronous-message", "numbered-message"].includes(kind)) return `<svg viewBox="0 0 72 48" aria-hidden="true"><path d="M5 24h62m-9-6 9 6-9 6"/>${kind === "numbered-message" ? `<text class="preview-text" x="8" y="20">1.1</text>` : ""}</svg>`;
  if (kind === "return-message") return `<svg viewBox="0 0 72 48" aria-hidden="true"><path stroke-dasharray="6 4" d="M67 24H5m9-6-9 6 9 6"/></svg>`;
  if (humanKinds.has(kind)) return `<svg viewBox="0 0 72 58" aria-hidden="true"><circle cx="36" cy="10" r="8"/><path d="M36 18v21M19 25h34M36 39 20 56M36 39l16 17"/></svg>`;
  if (circleKinds.has(kind)) return `<svg viewBox="0 0 72 48" aria-hidden="true"><circle cx="36" cy="24" r="12"/>${kind.startsWith("final") || kind === "activity-final" ? `<circle class="solid" cx="36" cy="24" r="7"/>` : `<circle class="solid" cx="36" cy="24" r="10"/>`}</svg>`;
  if (diamondKinds.has(kind)) return `<svg viewBox="0 0 72 48" aria-hidden="true"><path class="shape-fill" d="M36 5 61 24 36 43 11 24Z"/></svg>`;
  if (["fork-node", "join-node", "fork-join"].includes(kind)) return `<svg viewBox="0 0 72 48" aria-hidden="true"><rect class="solid" x="8" y="21" width="56" height="7" rx="2"/></svg>`;
  if (kind === "accept-event-action") return `<svg viewBox="0 0 72 48" aria-hidden="true"><path class="shape-fill" d="M8 9h56v30H8l9-15Z"/><path d="M24 24h27"/></svg>`;
  if (kind === "send-signal-action") return `<svg viewBox="0 0 72 48" aria-hidden="true"><path class="shape-fill" d="M8 9h47l10 15-10 15H8Z"/><path d="M20 24h28"/></svg>`;
  if (["input-pin", "output-pin"].includes(kind)) return `<svg viewBox="0 0 72 48" aria-hidden="true"><rect class="shape-fill" x="25" y="13" width="22" height="22"/><path d="M9 24h16M47 24h16"/></svg>`;
  if (kind === "destruction-occurrence") return `<svg viewBox="0 0 72 48" aria-hidden="true"><path d="M22 10l28 28M50 10 22 38" stroke-width="4"/></svg>`;
  if (roundedKinds.has(kind)) return `<svg viewBox="0 0 72 48" aria-hidden="true"><rect class="shape-fill" x="4" y="8" width="64" height="32" rx="11"/>${previewText(kind)}</svg>`;
  if (ellipseKinds.has(kind)) {
    return `<svg viewBox="0 0 72 48" aria-hidden="true"><ellipse class="shape-fill" cx="36" cy="24" rx="32" ry="17"/>${previewText(kind)}</svg>`;
  }
  if (timelineKinds.has(kind)) return `<svg viewBox="0 0 72 48" aria-hidden="true"><rect class="shape-fill" x="20" y="4" width="32" height="10" rx="2"/><path stroke-dasharray="3 3" d="M36 14v30"/><rect class="accent-fill" x="32" y="21" width="8" height="17" rx="1"/></svg>`;
  if (packageKinds.has(kind)) return `<svg viewBox="0 0 72 48" aria-hidden="true"><path class="shape-fill" d="M7 12h22l5 6h31v25H7Z"/><path d="M7 18h58"/>${previewText(kind, 32)}</svg>`;
  if (noteKinds.has(kind)) return `<svg viewBox="0 0 72 48" aria-hidden="true"><path class="shape-fill" d="M17 5h29l10 10v28H17Z"/><path d="M46 5v10h10M24 24h24M24 31h19"/></svg>`;
  if (kind === "decision" || kind === "fork-join") return `<svg viewBox="0 0 72 48" aria-hidden="true">${kind === "decision" ? `<path class="shape-fill" d="M36 6 58 24 36 42 14 24Z"/>` : `<rect class="solid" x="10" y="21" width="52" height="6" rx="2"/>`}</svg>`;
  if (kind === "interface") return `<svg viewBox="0 0 72 48" aria-hidden="true"><path d="M5 24h18"/><circle class="shape-fill" cx="32" cy="24" r="9"/><path d="M41 24h26"/>${previewText(kind, 46, "preview-small-text")}</svg>`;
  if (kind === "component") return `<svg viewBox="0 0 72 48" aria-hidden="true"><rect class="shape-fill" x="13" y="7" width="53" height="35"/><rect class="shape-fill" x="6" y="14" width="14" height="8"/><rect class="shape-fill" x="6" y="28" width="14" height="8"/>${previewText(kind)}</svg>`;
  if (["object", "slot"].includes(kind)) return `<svg viewBox="0 0 72 48" aria-hidden="true"><rect class="shape-fill" x="7" y="9" width="58" height="30"/>${previewText(kind, 27, "preview-underlined-text")}</svg>`;
  if (["port", "connector", "binding-connector"].includes(kind)) return `<svg viewBox="0 0 72 48" aria-hidden="true"><path d="M6 24h60"/><rect class="shape-fill" x="29" y="17" width="14" height="14"/>${previewText(kind, 46, "preview-small-text")}</svg>`;
  if (kind === "system-boundary") return `<svg viewBox="0 0 72 48" aria-hidden="true"><rect class="shape-fill" x="4" y="3" width="64" height="42" rx="8"/>${previewText(kind)}</svg>`;
  if (kind === "activity-partition") return `<svg viewBox="0 0 72 48" aria-hidden="true"><rect class="shape-fill" x="14" y="3" width="44" height="42"/><path d="M14 14h44"/>${previewText(kind, 11, "preview-tiny-text")}</svg>`;
  if (["artifact", "deployment-specification"].includes(kind)) return `<svg viewBox="0 0 72 48" aria-hidden="true"><path class="shape-fill" d="M16 4h31l10 10v30H16Z"/><path d="M47 4v10h10"/>${previewText(kind, 29)}</svg>`;
  return `<svg viewBox="0 0 72 48" aria-hidden="true"><rect class="shape-fill" x="4" y="2" width="64" height="44" rx="2"/><path d="M4 16h64M4 31h64"/><text class="preview-stereotype" x="36" y="9" text-anchor="middle">«${labelFor(kind)}»</text><text class="preview-text" x="36" y="14" text-anchor="middle">${labelFor(kind)}</text><text class="preview-small-text" x="8" y="25">attributes</text><text class="preview-small-text" x="8" y="40">operations</text></svg>`;
}

function paletteItems(items) {
  return `<div class="palette-grid">${items.map((item) => `<button class="palette-item" draggable="false" data-kind="${item.kind}" data-palette-type="${item.type}" title="${item.label}" aria-label="Drag ${item.label} to the canvas"><span class="palette-symbol">${elementPreview(item.shape ?? item.kind)}</span><span class="palette-item-label">${item.label}</span></button>`).join("")}</div>`;
}

registerMfe("element-palette", (element, { state, bus }) => {
  let pointerDragging = false;
  function render() {
    const diagramType = diagramCatalog.find((item) => item.value === state.diagram?.type) ?? diagramCatalog[0];
    const commonNodes = commonElements.filter((item) => item.type === "node");
    const diagramNodes = diagramType.palette.filter((item) => item.type === "node");
    element.innerHTML = `<div class="panel palette-panel">
      <h2>Element Palette</h2>
      <details open><summary><span>Common Elements</span><span class="palette-count">${commonNodes.length}</span></summary>${paletteItems(commonNodes)}</details>
      <details open><summary><span>Diagram Elements</span><span class="palette-count">${diagramNodes.length}</span></summary>${paletteItems(diagramNodes)}</details>
    </div>`;
    element.querySelectorAll("[data-kind]").forEach((button) => {
      const item = [...commonNodes, ...diagramNodes].find(({ kind, type }) => kind === button.dataset.kind && type === button.dataset.paletteType);
      const detail = (clientY = button.getBoundingClientRect().top + button.offsetHeight / 2) => ({ ...item, preview: elementPreview(item.shape ?? item.kind), clientY });
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
          bus.emit("palette:pointermove", { ...item, clientX: pointerEvent.clientX, clientY: pointerEvent.clientY, preview: elementPreview(item.shape ?? item.kind) });
        };
        const up = (pointerEvent) => {
          window.removeEventListener("pointermove", move);
          window.removeEventListener("pointerup", up);
          if (dragging) bus.emit("palette:pointerdrop", { ...item, clientX: pointerEvent.clientX, clientY: pointerEvent.clientY });
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
