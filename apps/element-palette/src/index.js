import { registerMfe } from "/packages/ui/src/moduleRegistry.js";
import { commonElements, diagramCatalog } from "/packages/model-core/src/diagram-catalog.js";

const elementLabels = {
  "compact-class": "Compact Class", "interface-class": "Interface Class", "template-class": "Template Class",
  "object-compact": "Compact Object", "nary-association": "N-ary Association", "divider-vertical": "Divider",
  "self-association": "Self Association", "frame-fragment": "Frame / Fragment", "text-label": "Text Label",
  "symbol-braces": "Symbol { }", "symbol-guillemets": "Symbol << >>",
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

function elementPreview(kind, variant = "full") {
  if (["association", "link", "connector", "communication-path", "control-flow", "object-flow", "transition", "item-flow", "binding-connector"].includes(kind)) return `<svg viewBox="0 0 72 48" aria-hidden="true"><path d="M5 24h62"/>${["control-flow", "object-flow", "transition", "item-flow"].includes(kind) ? `<path d="m58 18 9 6-9 6"/>` : ""}</svg>`;
  if (["include", "extend"].includes(kind)) return `<svg viewBox="0 0 72 48" aria-hidden="true"><path stroke-dasharray="6 6" d="M5 24h62m-9-6 9 6-9 6"/><text class="preview-small-text" x="36" y="17" text-anchor="middle">«${kind}»</text></svg>`;
  if (["dependency", "note-connector", "package-merge", "satisfy", "verify", "refine", "trace", "derive-reqt"].includes(kind)) return `<svg viewBox="0 0 72 48" aria-hidden="true"><path stroke-dasharray="6 4" d="M5 24h62"/><path d="m58 18 9 6-9 6"/></svg>`;
  if (["generalization", "extension"].includes(kind)) return `<svg viewBox="0 0 72 48" aria-hidden="true"><path d="M5 24h50"/><path class="shape-fill" d="m55 15 12 9-12 9Z"/></svg>`;
  if (["aggregation", "composition"].includes(kind)) return `<svg viewBox="0 0 72 48" aria-hidden="true"><path class="${kind === "composition" ? "solid" : "shape-fill"}" d="M5 24 17 17.5 29 24 17 30.5Z"/><path d="M29 24h38"/></svg>`;
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
  if (kind === "compact-class") return `<svg viewBox="0 0 72 48" aria-hidden="true"><rect class="shape-fill" x="12" y="14" width="48" height="20"/><text class="preview-text" x="36" y="27" text-anchor="middle">Class</text></svg>`;
  if (kind === "interface-class") return `<svg viewBox="0 0 72 58" aria-hidden="true"><rect class="shape-fill" x="8" y="4" width="56" height="50"/><path d="M8 20h56M8 32h56M8 44h56"/><text class="preview-tiny-text" x="36" y="12" text-anchor="middle">&lt;&lt;interface&gt;&gt;</text><text class="preview-text" x="36" y="18" text-anchor="middle">Class</text></svg>`;
  if (kind === "template-class") return `<svg viewBox="0 0 72 58" aria-hidden="true"><rect class="shape-fill" x="10" y="11" width="51" height="39"/><path d="M10 28h51M10 39h51"/><rect class="shape-fill" stroke-dasharray="4 3" x="45" y="3" width="20" height="13"/><text class="preview-tiny-text" x="55" y="12" text-anchor="middle">T</text><text class="preview-text" x="35" y="23" text-anchor="middle">Template</text></svg>`;
  if (kind === "nary-association") return `<svg viewBox="0 0 72 48" aria-hidden="true"><path class="shape-fill" d="M36 7 58 24 36 41 14 24Z"/></svg>`;
  if (kind === "divider-vertical") return `<svg viewBox="0 0 72 48" aria-hidden="true"><path stroke-dasharray="7 6" d="M36 4v40"/><text class="preview-small-text" x="41" y="25">{Text}</text></svg>`;
  if (kind === "self-association") return `<svg viewBox="0 0 72 48" aria-hidden="true"><rect class="shape-fill" x="7" y="12" width="43" height="22"/><path d="M50 19h8v22H33v-7"/><text class="preview-small-text" x="55" y="17">0..1</text><text class="preview-small-text" x="30" y="44">0..*</text><text class="preview-text" x="28" y="27" text-anchor="middle">Class</text></svg>`;
  if (kind === "frame-fragment") return `<svg viewBox="0 0 72 48" aria-hidden="true"><path class="shape-fill" d="M9 8h54v32H9Z"/><path d="M9 8h27v12l-7 7H9"/></svg>`;
  if (kind === "callout") return `<svg viewBox="0 0 72 48" aria-hidden="true"><circle class="solid" cx="18" cy="38" r="3"/><path d="M18 38C34 31 45 17 56 4"/></svg>`;
  if (kind === "text-label") return `<svg viewBox="0 0 72 48" aria-hidden="true"><text class="preview-text" x="36" y="27" text-anchor="middle">Text</text></svg>`;
  if (kind === "symbol-braces") return `<svg viewBox="0 0 72 48" aria-hidden="true"><text class="preview-text" x="36" y="27" text-anchor="middle">{ }</text></svg>`;
  if (kind === "symbol-guillemets") return `<svg viewBox="0 0 72 48" aria-hidden="true"><text class="preview-text" x="36" y="27" text-anchor="middle">&lt;&lt; &gt;&gt;</text></svg>`;
  if (kind === "decision" || kind === "fork-join") return `<svg viewBox="0 0 72 48" aria-hidden="true">${kind === "decision" ? `<path class="shape-fill" d="M36 6 58 24 36 42 14 24Z"/>` : `<rect class="solid" x="10" y="21" width="52" height="6" rx="2"/>`}</svg>`;
  if (kind === "interface") return `<svg viewBox="0 0 72 48" aria-hidden="true"><path d="M5 24h18"/><circle class="shape-fill" cx="32" cy="24" r="9"/><path d="M41 24h26"/>${previewText(kind, 46, "preview-small-text")}</svg>`;
  if (kind === "component") return `<svg viewBox="0 0 72 48" aria-hidden="true"><rect class="shape-fill" x="13" y="7" width="53" height="35"/><rect class="shape-fill" x="6" y="14" width="14" height="8"/><rect class="shape-fill" x="6" y="28" width="14" height="8"/>${previewText(kind)}</svg>`;
  if (["object", "slot"].includes(kind)) return `<svg viewBox="0 0 72 48" aria-hidden="true"><rect class="shape-fill" x="7" y="9" width="58" height="30"/>${previewText(kind, 27, "preview-underlined-text")}</svg>`;
  if (["port", "connector", "binding-connector"].includes(kind)) return `<svg viewBox="0 0 72 48" aria-hidden="true"><path d="M6 24h60"/><rect class="shape-fill" x="29" y="17" width="14" height="14"/>${previewText(kind, 46, "preview-small-text")}</svg>`;
  if (kind === "system-boundary") return `<svg viewBox="0 0 72 48" aria-hidden="true"><rect class="shape-fill" x="4" y="3" width="64" height="42" rx="8"/>${previewText(kind)}</svg>`;
  if (kind === "activity-partition") return `<svg viewBox="0 0 72 48" aria-hidden="true"><rect class="shape-fill" x="14" y="3" width="44" height="42"/><path d="M14 14h44"/>${previewText(kind, 11, "preview-tiny-text")}</svg>`;
  if (["artifact", "deployment-specification"].includes(kind)) return `<svg viewBox="0 0 72 48" aria-hidden="true"><path class="shape-fill" d="M16 4h31l10 10v30H16Z"/><path d="M47 4v10h10"/>${previewText(kind, 29)}</svg>`;
  const simple = ["class", "block"].includes(kind) && variant === "simple";
  return `<svg viewBox="0 0 72 48" aria-hidden="true"><rect class="shape-fill" x="4" y="2" width="64" height="44" rx="2"/><path d="M4 16h64${simple ? "" : "M4 31h64"}"/><text class="preview-stereotype" x="36" y="9" text-anchor="middle">«${labelFor(kind)}»</text><text class="preview-text" x="36" y="14" text-anchor="middle">${labelFor(kind)}</text><text class="preview-small-text" x="8" y="${simple ? 33 : 25}">attributes</text>${simple ? "" : `<text class="preview-small-text" x="8" y="40">operations</text>`}</svg>`;
}

function paletteItems(items) {
  return `<div class="palette-grid">${items.map((item) => `<button class="palette-item" draggable="false" data-kind="${item.kind}" data-variant="${item.variant ?? ""}" data-palette-type="${item.type}" data-label="${item.label}" data-cross-diagram="${Boolean(item.crossDiagram)}" title="${item.label}${item.origin ? ` · ${item.origin}` : ""}" aria-label="Drag ${item.label} to the canvas"><span class="palette-symbol">${elementPreview(item.shape ?? item.kind, item.variant)}</span><span class="palette-item-label">${item.label}${item.origin ? `<small>${item.origin}</small>` : ""}</span></button>`).join("")}</div>`;
}

registerMfe("element-palette", (element, { state, bus }) => {
  const lifecycle = new AbortController();
  let pointerDragging = false;
  let searchQuery = "";
  function render() {
    const diagramType = diagramCatalog.find((item) => item.value === state.diagram?.type) ?? diagramCatalog[0];
    const commonNodes = commonElements.filter((item) => item.type === "node");
    const diagramNodes = diagramType.palette.filter((item) => item.type === "node");
    const currentKeys = new Set([...commonNodes, ...diagramNodes].map((item) => `${item.kind}|${item.variant ?? ""}|${item.label}`));
    const discovered = new Map();
    for (const source of diagramCatalog) {
      for (const item of source.palette.filter((candidate) => candidate.type === "node")) {
        const key = `${item.kind}|${item.variant ?? ""}|${item.label}`;
        if (!discovered.has(key)) discovered.set(key, { ...item, origin: source.label, crossDiagram: !currentKeys.has(key) });
      }
    }
    const normalizedQuery = searchQuery.trim().toLocaleLowerCase();
    const searchResults = normalizedQuery ? [...discovered.values()].filter((item) => `${item.label} ${item.kind} ${item.origin}`.toLocaleLowerCase().includes(normalizedQuery)) : [];
    element.innerHTML = `<div class="panel palette-panel">
      <h2>Elements</h2>
      <label class="palette-search"><span>Find any element</span><input id="element-search" type="search" value="${searchQuery.replace(/[&<>'"]/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" })[character])}" placeholder="Search all diagram types…" autocomplete="off"></label>
      ${normalizedQuery ? `<section class="palette-search-results" aria-live="polite"><div class="palette-results-heading"><strong>Search results</strong><span>${searchResults.length}</span></div>${searchResults.length ? paletteItems(searchResults) : `<p class="palette-empty">No elements match “${searchQuery.replace(/[&<>'"]/g, "")}”. Try a name such as Actor, Block, or Requirement.</p>`}</section>` : `
        <details open><summary><span>Common</span><span class="palette-count">${commonNodes.length}</span></summary>${paletteItems(commonNodes)}</details>
        <details open><summary><span>Diagram-specific</span><span class="palette-count">${diagramNodes.length}</span></summary>${paletteItems(diagramNodes)}</details>`}
    </div>`;
    const searchInput = element.querySelector("#element-search");
    searchInput.addEventListener("input", () => {
      searchQuery = searchInput.value;
      render();
      const nextInput = element.querySelector("#element-search");
      nextInput.focus();
      nextInput.setSelectionRange(searchQuery.length, searchQuery.length);
    });
    element.querySelectorAll("[data-kind]").forEach((button) => {
      const candidates = [...commonNodes, ...diagramNodes, ...searchResults];
      const item = candidates.find(({ kind, type, variant, label }) => kind === button.dataset.kind && type === button.dataset.paletteType && (variant ?? "") === button.dataset.variant && label === button.dataset.label);
      const detail = (clientY = button.getBoundingClientRect().top + button.offsetHeight / 2) => ({ ...item, crossDiagram: button.dataset.crossDiagram === "true", preview: elementPreview(item.shape ?? item.kind, item.variant), clientY });
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
          if (pointerEvent.pointerId !== pointerId) return;
          if (!dragging && Math.hypot(pointerEvent.clientX - origin.x, pointerEvent.clientY - origin.y) < 4) return;
          if (!dragging) { dragging = true; pointerDragging = true; bus.emit("palette:dragstart", button.dataset.kind); }
          bus.emit("palette:pointermove", { ...item, clientX: pointerEvent.clientX, clientY: pointerEvent.clientY, preview: elementPreview(item.shape ?? item.kind, item.variant) });
        };
        const pointerId = event.pointerId;
        const up = (pointerEvent) => {
          if (pointerEvent.pointerId !== pointerId) return;
          window.removeEventListener("pointermove", move);
          window.removeEventListener("pointerup", up);
          window.removeEventListener("pointercancel", up);
          if (dragging && pointerEvent.type === "pointerup") bus.emit("palette:pointerdrop", { ...item, crossDiagram: button.dataset.crossDiagram === "true", clientX: pointerEvent.clientX, clientY: pointerEvent.clientY });
          pointerDragging = false;
          bus.emit("palette:dragend");
          bus.emit("palette:hover", null);
        };
        window.addEventListener("pointermove", move, { signal: lifecycle.signal });
        window.addEventListener("pointerup", up, { signal: lifecycle.signal });
        window.addEventListener("pointercancel", up, { signal: lifecycle.signal });
      });
    });
  }
  const unsubscribe = bus.on("diagram:changed", render);
  render();
  return () => {
    lifecycle.abort();
    unsubscribe();
    pointerDragging = false;
    bus.emit("palette:dragend");
    bus.emit("palette:hover", null);
  };
});
