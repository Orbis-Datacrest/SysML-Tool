import { registerMfe } from "/packages/ui/src/moduleRegistry.js";
import { elementKinds } from "/packages/model-core/src/index.js";
import {
  MIN_NODE_HEIGHT, MIN_NODE_WIDTH, applyElementStyle, clamp, expandGroupedSelection,
  groupElements, moveSelection, nodesInRect, removeElements, reorderElements,
  selectionBounds, snap, ungroupElements
} from "./canvas-model.js";

const CANVAS = { width: 5000, height: 4000 };
const ZOOM = { minimum: 0.25, maximum: 2.5 };
const relationshipTypes = [
  ["association", "Association"], ["directional-association", "Directed Association"],
  ["bidirectional-association", "Bidirectional Association"], ["dependency", "Dependency"],
  ["generalization", "Generalization"], ["realization", "Realization"],
  ["composition", "Composition"], ["aggregation", "Aggregation"], ["containment", "Containment"]
];
const defaultNodeStyle = { borderColor: "#26351f", fillColor: "#d7eadb", borderWidth: 1, textStyle: "normal" };
const defaultRelationshipStyle = { color: "#9aa8bb", width: 2 };

function id(prefix) { return `${prefix}_${Math.random().toString(36).slice(2, 10)}`; }
function escapeHtml(value = "") {
  return String(value).replace(/[&<>'"]/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", "\"": "&quot;" })[character]);
}

registerMfe("diagram-canvas", (element, { state, bus, setDiagram, undoDiagram, redoDiagram }) => {
  let zoom = 1;
  let gesture = null;
  let connectDrag = null;
  let contextMenu = null;
  let relationshipToolbar = null;
  let selectionFrame = null;
  let paletteHover = null;
  let editingNodeId = null;
  let pointerDrag = null;
  let clipboard = [];
  let pasteOffset = 0;
  let spaceHeld = false;

  const selectedIds = () => state.selectedElementIds ?? [];
  const nodeStyle = (node) => ({ ...defaultNodeStyle, ...(node.style ?? {}) });
  const relationshipStyle = (relationship) => ({ ...defaultRelationshipStyle, ...(relationship.style ?? {}) });
  const pointOnCanvas = (event) => {
    const rect = element.getBoundingClientRect();
    return { x: (event.clientX - rect.left + element.scrollLeft) / zoom, y: (event.clientY - rect.top + element.scrollTop) / zoom };
  };
  const mutate = (mutator) => {
    const next = structuredClone(state.diagram);
    mutator(next);
    setDiagram(next);
  };
  const setSelection = (ids, relationshipId = null, expandGroups = true) => {
    state.selectedElementIds = [...new Set(expandGroups ? expandGroupedSelection(state.diagram.elements, ids) : ids)];
    state.selectedRelationshipId = relationshipId;
    selectionFrame = state.selectedElementIds.length > 1 ? selectionBounds(state.diagram.elements, state.selectedElementIds) : null;
    if (!relationshipId) relationshipToolbar = null;
    bus.emit("selection:changed", state.selectedElementIds);
  };

  const nodeKindClass = (kind) => `node-shape-${kind.replace(/[^a-z0-9-]/g, "")}`;
  const nodeLabel = (kind) => kind.split("-").map((word) => `${word[0]?.toUpperCase() ?? ""}${word.slice(1)}`).join(" ");
  const ellipseKinds = new Set(["use-case"]);
  const roundedKinds = new Set(["activity", "action", "state", "composite-state", "interaction", "interaction-use"]);
  const diamondKinds = new Set(["decision", "merge-node", "choice"]);
  const circleKinds = new Set(["initial-node", "initial-state", "final-node", "final-state", "activity-final", "flow-final", "entry-point", "exit-point", "terminate"]);
  const packageKinds = new Set(["package", "model", "profile", "view", "viewpoint"]);
  const noteKinds = new Set(["note", "comment", "rationale", "problem"]);

  function renderNodeContent(node) {
    if (editingNodeId === node.id) return `<textarea class="node-inline-editor" data-node-editor="${node.id}" aria-label="Edit ${escapeHtml(nodeLabel(node.kind))} text">${escapeHtml(node.name)}</textarea>`;
    const attributes = node.properties?.attributes ?? [];
    const operations = node.properties?.operations ?? [];
    if (node.kind === "actor") return `<svg class="actor-figure" viewBox="0 0 100 126" aria-hidden="true"><circle cx="50" cy="20" r="17"></circle><path d="M50 37v50M18 51h64M50 87 19 123M50 87l31 36"></path></svg><div class="actor-name">${escapeHtml(node.name)}</div>`;
    if (diamondKinds.has(node.kind)) return `<div class="diamond-shape"></div><div class="shape-caption centered">${escapeHtml(node.name)}</div>`;
    if (circleKinds.has(node.kind)) return `<div class="circle-shape ${node.kind.startsWith("final") ? "final" : ""}"></div>${node.name ? `<div class="shape-caption below">${escapeHtml(node.name)}</div>` : ""}`;
    if (["fork-join", "fork-node", "join-node"].includes(node.kind)) return `<div class="fork-join-shape"></div><div class="shape-caption below">${escapeHtml(node.name)}</div>`;
    if (node.kind === "accept-event-action") return `<div class="event-action-shape accept"></div><div class="shape-caption centered">${escapeHtml(node.name)}</div>`;
    if (node.kind === "send-signal-action") return `<div class="event-action-shape send"></div><div class="shape-caption centered">${escapeHtml(node.name)}</div>`;
    if (node.kind === "destruction-occurrence") return `<div class="destruction-shape"></div><div class="shape-caption below">${escapeHtml(node.name)}</div>`;
    if (node.kind === "lifeline") return `<div class="lifeline-head">${escapeHtml(node.name)}</div><div class="lifeline-line"></div>`;
    if (packageKinds.has(node.kind)) return `<div class="package-tab"></div><div class="package-body"><strong>${escapeHtml(node.name)}</strong><small>«${escapeHtml(nodeLabel(node.kind))}»</small></div>`;
    if (noteKinds.has(node.kind)) return `<div class="note-fold"></div><div class="note-content">${escapeHtml(node.name)}</div>`;
    if (ellipseKinds.has(node.kind)) return `<div class="ellipse-content">${escapeHtml(node.name)}</div>`;
    if (roundedKinds.has(node.kind)) return `<div class="rounded-content"><strong>${escapeHtml(node.name)}</strong><small>${escapeHtml(nodeLabel(node.kind))}</small></div>`;
    return `<div class="node-title">${escapeHtml(node.name)}${node.locked ? `<span class="lock-indicator" title="Locked">●</span>` : ""}</div>
      <div class="node-body"><div class="node-stereotype">${escapeHtml(nodeLabel(node.kind))}</div>${attributes.map((attribute) => `<div>+ ${escapeHtml(attribute)}</div>`).join("")}${operations.map((operation) => `<div>${escapeHtml(operation)}</div>`).join("")}</div>`;
  }

  function defaultSizeFor(kind) {
    if (kind === "actor") return { width: 110, height: 170 };
    if (ellipseKinds.has(kind)) return { width: 160, height: 86 };
    if (diamondKinds.has(kind)) return { width: 110, height: 90 };
    if (circleKinds.has(kind)) return { width: 56, height: 56 };
    if (["fork-join", "fork-node", "join-node"].includes(kind)) return { width: 150, height: 34 };
    if (["accept-event-action", "send-signal-action"].includes(kind)) return { width: 180, height: 80 };
    if (["input-pin", "output-pin"].includes(kind)) return { width: 54, height: 54 };
    if (kind === "destruction-occurrence") return { width: 70, height: 70 };
    if (kind === "lifeline") return { width: 120, height: 240 };
    if (roundedKinds.has(kind)) return { width: 160, height: 90 };
    if (noteKinds.has(kind)) return { width: 150, height: 110 };
    return { width: 180, height: 110 };
  }

  function relationshipPath(source, target) {
    const start = { x: source.x + source.width, y: source.y + source.height / 2 };
    const end = { x: target.x, y: target.y + target.height / 2 };
    const midX = (start.x + end.x) / 2;
    return { start, end, midX, d: `M ${start.x} ${start.y} C ${midX} ${start.y}, ${midX} ${end.y}, ${end.x} ${end.y}` };
  }

  function relationshipDecoration(type) {
    const decorations = {
      association: {},
      "directional-association": { end: "open-arrow" },
      "bidirectional-association": { start: "open-arrow", end: "open-arrow" },
      dependency: { end: "open-arrow", dashed: true },
      generalization: { end: "hollow-triangle" },
      realization: { end: "hollow-triangle", dashed: true },
      composition: { start: "filled-diamond" },
      aggregation: { start: "hollow-diamond" },
      containment: { start: "containment" }
    };
    return decorations[type] ?? decorations.association;
  }

  function renderMarkerDefinitions() {
    return `<defs>
      <marker id="open-arrow" viewBox="0 0 12 12" markerWidth="12" markerHeight="12" refX="10" refY="6" orient="auto-start-reverse" markerUnits="userSpaceOnUse"><path d="M2,1 L10,6 L2,11" fill="none" stroke="context-stroke" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"></path></marker>
      <marker id="hollow-triangle" viewBox="0 0 14 14" markerWidth="14" markerHeight="14" refX="12" refY="7" orient="auto-start-reverse" markerUnits="userSpaceOnUse"><path d="M1.5,1.5 L12,7 L1.5,12.5 Z" fill="var(--canvas)" stroke="context-stroke" stroke-width="1.5" stroke-linejoin="round"></path></marker>
      <marker id="filled-diamond" viewBox="0 0 16 12" markerWidth="16" markerHeight="12" refX="1" refY="6" orient="auto-start-reverse" markerUnits="userSpaceOnUse"><path d="M1,6 L8,1 L15,6 L8,11 Z" fill="context-stroke" stroke="context-stroke" stroke-linejoin="round"></path></marker>
      <marker id="hollow-diamond" viewBox="0 0 16 12" markerWidth="16" markerHeight="12" refX="1" refY="6" orient="auto-start-reverse" markerUnits="userSpaceOnUse"><path d="M1,6 L8,1 L15,6 L8,11 Z" fill="var(--canvas)" stroke="context-stroke" stroke-width="1.5" stroke-linejoin="round"></path></marker>
      <marker id="containment" viewBox="0 0 17 17" markerWidth="17" markerHeight="17" refX="2" refY="8.5" orient="auto-start-reverse" markerUnits="userSpaceOnUse"><circle cx="8.5" cy="8.5" r="6.5" fill="var(--canvas)" stroke="context-stroke"></circle><path d="M5,8.5 H12 M8.5,5 V12" stroke="context-stroke" stroke-width="1.3"></path></marker>
    </defs>`;
  }

  function renderRelationships(diagram) {
    return `<svg class="relationship-layer" width="${CANVAS.width}" height="${CANVAS.height}" aria-label="Diagram relationships">${renderMarkerDefinitions()}
      ${(diagram.relationships ?? []).map((relationship) => {
        const source = diagram.elements.find((node) => node.id === relationship.source_id);
        const target = diagram.elements.find((node) => node.id === relationship.target_id);
        if (!source || !target) return "";
        const path = relationshipPath(source, target);
        const decoration = relationshipDecoration(relationship.kind);
        const style = relationshipStyle(relationship);
        const selected = state.selectedRelationshipId === relationship.id;
        return `<path class="relationship-hit" data-rel="${relationship.id}" d="${path.d}"></path>
          <path class="relationship-line ${selected ? "selected" : ""}" d="${path.d}" style="--relationship-color:${style.color};--relationship-width:${style.width}px" stroke-dasharray="${decoration.dashed ? "7 6" : "0"}" ${decoration.start ? `marker-start="url(#${decoration.start})"` : ""} ${decoration.end ? `marker-end="url(#${decoration.end})"` : ""}></path>
          <text class="relationship-label ${selected ? "selected" : ""}" data-rel="${relationship.id}" x="${path.midX}" y="${(path.start.y + path.end.y) / 2 - 10}">${escapeHtml(relationship.label || relationshipTypes.find(([type]) => type === relationship.kind)?.[1] || relationship.kind)}</text>`;
      }).join("")}
      ${connectDrag ? `<path class="relationship-preview" d="M ${connectDrag.x1} ${connectDrag.y1} C ${(connectDrag.x1 + connectDrag.x2) / 2} ${connectDrag.y1}, ${(connectDrag.x1 + connectDrag.x2) / 2} ${connectDrag.y2}, ${connectDrag.x2} ${connectDrag.y2}" marker-end="url(#open-arrow)"></path>` : ""}
    </svg>`;
  }

  function toolbarPosition(diagram) {
    const bounds = selectionBounds(diagram.elements, selectedIds());
    if (!bounds) return null;
    const rect = element.getBoundingClientRect();
    const width = selectedIds().length > 1 ? 344 : 380;
    return {
      x: clamp(rect.left + bounds.left * zoom - element.scrollLeft, rect.left + 8, rect.right - width - 8),
      y: clamp(rect.top + bounds.top * zoom - element.scrollTop - 48, rect.top + 8, rect.bottom - 48)
    };
  }

  function positionFormattingToolbar() {
    const toolbar = element.querySelector(".format-toolbar");
    if (!toolbar || !state.diagram) return;
    const position = toolbarPosition(state.diagram);
    if (!position) return;
    toolbar.style.left = `${position.x}px`;
    toolbar.style.top = `${position.y}px`;
  }

  function renderFormattingToolbar(diagram) {
    if (!selectedIds().length) return "";
    const selected = diagram.elements.filter((node) => selectedIds().includes(node.id));
    if (!selected.length) return "";
    const style = nodeStyle(selected[0]);
    const position = toolbarPosition(diagram);
    return `<div class="format-toolbar" style="left:${position.x}px;top:${position.y}px" aria-label="${selected.length > 1 ? "Selection" : "Element"} formatting toolbar">
      ${selected.length > 1 ? `<span class="selection-count">${selected.length} selected</span>` : ""}
      <label title="Border color">Border <input data-style="borderColor" type="color" value="${style.borderColor}"></label>
      <label title="Fill color">Fill <input data-style="fillColor" type="color" value="${style.fillColor}"></label>
      <label title="Border thickness">Line <select data-style="borderWidth">${[1, 2, 3, 4].map((width) => `<option value="${width}" ${style.borderWidth === width ? "selected" : ""}>${width}px</option>`).join("")}</select></label>
      <button data-style-button="textStyle" class="format-button ${style.textStyle === "bold" ? "active" : ""}" title="Toggle bold text"><strong>B</strong></button>
    </div>`;
  }

  function renderRelationshipToolbar() {
    if (!relationshipToolbar || !state.selectedRelationshipId) return "";
    const relationship = state.diagram.relationships.find((item) => item.id === state.selectedRelationshipId);
    if (!relationship) return "";
    const style = relationshipStyle(relationship);
    return `<div class="relationship-toolbar" style="left:${relationshipToolbar.x}px;top:${relationshipToolbar.y}px" aria-label="Connection formatting toolbar">
      <select data-relationship-style="kind" title="Relation type">${relationshipTypes.map(([type, label]) => `<option value="${type}" ${relationship.kind === type ? "selected" : ""}>${label}</option>`).join("")}</select>
      <label title="Line thickness">Line <select data-relationship-style="width">${[1, 2, 3, 4, 5].map((width) => `<option value="${width}" ${style.width === width ? "selected" : ""}>${width}px</option>`).join("")}</select></label>
      <label title="Line color">Color <input data-relationship-style="color" type="color" value="${style.color}"></label>
      <button data-relationship-command="delete" class="danger" title="Delete connection">Delete</button>
    </div>`;
  }

  function renderContextMenu() {
    if (!contextMenu || !selectedIds().length) return "";
    const selected = state.diagram.elements.filter((node) => selectedIds().includes(node.id));
    const allLocked = selected.every((node) => node.locked);
    const selectedGroups = new Set(selected.filter((node) => node.groupId).map((node) => node.groupId));
    const completeSingleGroup = selectedGroups.size === 1 && selected.every((node) => node.groupId === [...selectedGroups][0]);
    return `<div class="canvas-context-menu" style="left:${contextMenu.x}px;top:${contextMenu.y}px" role="menu">
      <button data-command="delete" class="context-danger" role="menuitem">Delete <kbd>Del</kbd></button>
      <button data-command="cut" role="menuitem">Cut <kbd>Ctrl+X</kbd></button><button data-command="copy" role="menuitem">Copy <kbd>Ctrl+C</kbd></button><button data-command="duplicate" role="menuitem">Duplicate <kbd>Ctrl+D</kbd></button>
      <span class="context-separator"></span>
      ${selected.length > 1 && !completeSingleGroup ? `<button data-command="group" role="menuitem">Group <kbd>Ctrl+G</kbd></button>` : ""}
      ${selectedGroups.size ? `<button data-command="ungroup" role="menuitem">Ungroup <kbd>⇧Ctrl+G</kbd></button>` : ""}
      <button data-command="lock" role="menuitem">${allLocked ? "Unlock" : "Lock"}</button>
      <button data-command="forward" role="menuitem">Bring Forward</button><button data-command="backward" role="menuitem">Bring Backward</button>
    </div>`;
  }

  function render() {
    const diagram = state.diagram;
    if (!diagram) return;
    const scroll = { left: element.scrollLeft, top: element.scrollTop };
    const hostRect = element.getBoundingClientRect();
    const previewTop = paletteHover ? clamp(paletteHover.clientY - 100, hostRect.top + 68, hostRect.bottom - 224) : 0;
    element.innerHTML = `<div class="canvas-chrome"><div class="canvas-toolbar">
      <button id="history-undo" title="Undo last change" aria-label="Undo last change" ${state.history.length ? "" : "disabled"}>↶</button><button id="history-redo" title="Redo last change" aria-label="Redo last change" ${state.future.length ? "" : "disabled"}>↷</button>
      <span class="toolbar-separator"></span><button id="zoom-out" title="Zoom out" aria-label="Zoom out" ${zoom <= ZOOM.minimum ? "disabled" : ""}>−</button><button id="zoom-reset" title="Reset zoom" class="zoom-level">${Math.round(zoom * 100)}%</button><button id="zoom-in" title="Zoom in" aria-label="Zoom in" ${zoom >= ZOOM.maximum ? "disabled" : ""}>+</button>
      <button id="select-all" title="Select all elements" ${diagram.elements.length ? "" : "disabled"}>Select all</button><span class="toolbar-hint">Shift-click selects precisely · Drag a side handle to connect · Space-drag to pan</span>
    </div>${paletteHover ? `<div class="palette-canvas-preview" style="left:${hostRect.left + 14}px;top:${previewTop}px" aria-live="polite"><div class="palette-preview-name">${escapeHtml(paletteHover.label)}</div><div class="palette-preview-symbol">${paletteHover.preview}</div></div>` : ""}
      ${pointerDrag ? `<div class="canvas-drag-ghost" style="left:${pointerDrag.clientX + 16}px;top:${pointerDrag.clientY + 16}px"><span>${pointerDrag.preview}</span><strong>${escapeHtml(pointerDrag.label)}</strong></div>` : ""}</div>
    <div class="canvas-content" style="width:${CANVAS.width * zoom}px;height:${CANVAS.height * zoom}px">
      <div id="canvas-plane" style="width:${CANVAS.width}px;height:${CANVAS.height}px;transform:scale(${zoom})">
        ${renderRelationships(diagram)}
        ${selectedIds().length > 1 && (selectionFrame ?? selectionBounds(diagram.elements, selectedIds())) ? (() => { const bounds = selectionFrame ?? selectionBounds(diagram.elements, selectedIds()); return `<div class="group-selection-box" data-selection-area style="left:${bounds.left}px;top:${bounds.top}px;width:${bounds.right - bounds.left}px;height:${bounds.bottom - bounds.top}px" title="Drag anywhere to move selection"><span class="selection-frame-label">${selectedIds().length} selected</span></div>`; })() : ""}
        ${diagram.elements.map((node) => {
          const selected = selectedIds().includes(node.id); const style = nodeStyle(node);
          return `<div class="diagram-node ${nodeKindClass(node.kind)} ${selected ? "selected" : ""} ${node.locked ? "locked" : ""} ${node.groupId ? "grouped" : ""}" data-node="${node.id}" title="Double-click to edit text" style="left:${node.x}px;top:${node.y}px;width:${node.width}px;height:${node.height}px;--node-fill:${style.fillColor};--node-border:${style.borderColor};--node-border-width:${style.borderWidth}px;--node-font-weight:${style.textStyle === "bold" ? 700 : 400}">
            ${renderNodeContent(node)}
            ${selected ? `<span class="connector-handle connector-out" data-handle="${node.id}" title="Drag to create relationship"></span><span class="connector-handle connector-in"></span>` : ""}
            ${selected && selectedIds().length === 1 && !node.locked ? `<span class="resize-handle" data-resize="${node.id}" title="Resize element"></span>` : ""}
          </div>`;
        }).join("")}
        ${gesture?.type === "marquee" ? `<div class="selection-marquee" style="left:${gesture.rect.left}px;top:${gesture.rect.top}px;width:${gesture.rect.right - gesture.rect.left}px;height:${gesture.rect.bottom - gesture.rect.top}px"></div>` : ""}
      </div>
    </div>${renderFormattingToolbar(diagram)}${renderRelationshipToolbar()}${renderContextMenu()}`;
    element.scrollLeft = scroll.left; element.scrollTop = scroll.top;
    bindRenderedEvents();
  }

  function setZoom(nextZoom, clientX, clientY) {
    const rect = element.getBoundingClientRect();
    const focusX = clientX ?? rect.left + element.clientWidth / 2;
    const focusY = clientY ?? rect.top + element.clientHeight / 2;
    const canvasX = (focusX - rect.left + element.scrollLeft) / zoom;
    const canvasY = (focusY - rect.top + element.scrollTop) / zoom;
    zoom = clamp(nextZoom, ZOOM.minimum, ZOOM.maximum);
    render();
    element.scrollLeft = canvasX * zoom - (focusX - rect.left);
    element.scrollTop = canvasY * zoom - (focusY - rect.top);
  }

  function bindRenderedEvents() {
    element.querySelector("#history-undo").addEventListener("click", (event) => { event.stopPropagation(); undoDiagram(); });
    element.querySelector("#history-redo").addEventListener("click", (event) => { event.stopPropagation(); redoDiagram(); });
    element.querySelector("#zoom-in").addEventListener("click", () => setZoom(zoom + 0.1));
    element.querySelector("#zoom-out").addEventListener("click", () => setZoom(zoom - 0.1));
    element.querySelector("#zoom-reset").addEventListener("click", () => setZoom(1));
    element.querySelector("#select-all").addEventListener("click", () => setSelection(state.diagram.elements.map((node) => node.id)));
    element.querySelectorAll("[data-rel]").forEach((target) => {
      target.addEventListener("pointerdown", (event) => { event.stopPropagation(); contextMenu = null; setSelection([], target.dataset.rel); });
      target.addEventListener("contextmenu", (event) => openRelationshipToolbar(event, target.dataset.rel));
    });
    element.querySelectorAll("[data-handle]").forEach((handle) => handle.addEventListener("pointerdown", (event) => {
      event.preventDefault(); event.stopPropagation();
      const source = state.diagram.elements.find((node) => node.id === handle.dataset.handle);
      connectDrag = { sourceId: source.id, x1: source.x + source.width, y1: source.y + source.height / 2, x2: source.x + source.width + 80, y2: source.y + source.height / 2 };
      gesture = null; contextMenu = null; relationshipToolbar = null; setSelection([source.id]);
    }));
    element.querySelectorAll("[data-resize]").forEach((handle) => handle.addEventListener("pointerdown", (event) => {
      event.preventDefault(); event.stopPropagation();
      const node = state.diagram.elements.find((item) => item.id === handle.dataset.resize);
      gesture = { type: "resize", id: node.id, start: pointOnCanvas(event), original: structuredClone(node), diagramBefore: structuredClone(state.diagram), changed: false };
    }));
    element.querySelectorAll("[data-node]").forEach((nodeElement) => {
      nodeElement.addEventListener("pointerdown", (event) => { if (!event.target.closest(".node-inline-editor")) startNodeGesture(event, nodeElement.dataset.node); });
      nodeElement.addEventListener("dblclick", (event) => beginNodeEditing(event, nodeElement.dataset.node));
      nodeElement.addEventListener("contextmenu", (event) => openContextMenu(event, nodeElement.dataset.node));
    });
    element.querySelectorAll("[data-node-editor]").forEach((input) => {
      input.addEventListener("pointerdown", (event) => event.stopPropagation());
      input.addEventListener("keydown", (event) => {
        if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); input.blur(); }
        if (event.key === "Escape") { event.preventDefault(); editingNodeId = null; render(); }
      });
      input.addEventListener("blur", () => commitNodeEditing(input.dataset.nodeEditor, input.value), { once: true });
      requestAnimationFrame(() => { input.focus(); input.select(); });
    });
    element.querySelector("[data-selection-area]")?.addEventListener("pointerdown", startSelectionGesture);
    element.querySelectorAll("[data-style-button]").forEach((button) => button.addEventListener("click", () => {
      const first = state.diagram.elements.find((node) => node.id === selectedIds()[0]);
      applyStyle("textStyle", nodeStyle(first).textStyle === "bold" ? "normal" : "bold");
    }));
    element.querySelector("[data-relationship-command='delete']")?.addEventListener("click", deleteSelectedRelationship);
    element.querySelectorAll("[data-command]").forEach((button) => button.addEventListener("click", () => executeCommand(button.dataset.command)));
  }

  function beginNodeEditing(event, nodeId) {
    event.preventDefault(); event.stopPropagation();
    editingNodeId = nodeId;
    gesture = null;
    render();
  }

  function commitNodeEditing(nodeId, value) {
    if (editingNodeId !== nodeId) return;
    editingNodeId = null;
    const text = value.trim();
    mutate((next) => { next.elements.find((node) => node.id === nodeId).name = text || nodeLabel(next.elements.find((node) => node.id === nodeId).kind); });
  }

  function startSelectionGesture(event) {
    if (event.button !== 0) return;
    event.preventDefault(); event.stopPropagation(); contextMenu = null; relationshipToolbar = null;
    const movableIds = selectedIds().filter((itemId) => !state.diagram.elements.find((node) => node.id === itemId)?.locked);
    if (!movableIds.length) return;
    gesture = { type: "move", start: pointOnCanvas(event), ids: movableIds, originals: Object.fromEntries(state.diagram.elements.filter((node) => movableIds.includes(node.id)).map((node) => [node.id, structuredClone(node)])), frameOriginal: structuredClone(selectionFrame ?? selectionBounds(state.diagram.elements, selectedIds())), diagramBefore: structuredClone(state.diagram), changed: false };
  }

  function startNodeGesture(event, nodeId) {
    if (event.button !== 0) return;
    event.preventDefault(); event.stopPropagation(); contextMenu = null; relationshipToolbar = null;
    const clickedIds = expandGroupedSelection(state.diagram.elements, [nodeId]);
    let nextSelection;
    if (event.shiftKey) {
      const removing = clickedIds.every((itemId) => selectedIds().includes(itemId));
      nextSelection = removing ? selectedIds().filter((itemId) => !clickedIds.includes(itemId)) : [...selectedIds(), ...clickedIds];
    } else nextSelection = selectedIds().includes(nodeId) ? selectedIds() : clickedIds;
    setSelection(nextSelection, null, false);
    const movableIds = nextSelection.filter((itemId) => !state.diagram.elements.find((node) => node.id === itemId)?.locked);
    if (!movableIds.includes(nodeId)) return;
    gesture = { type: "move", start: pointOnCanvas(event), ids: movableIds, originals: Object.fromEntries(state.diagram.elements.filter((node) => movableIds.includes(node.id)).map((node) => [node.id, structuredClone(node)])), frameOriginal: selectedIds().length > 1 ? structuredClone(selectionFrame ?? selectionBounds(state.diagram.elements, selectedIds())) : null, diagramBefore: structuredClone(state.diagram), changed: false };
  }

  function openContextMenu(event, nodeId) {
    event.preventDefault(); event.stopPropagation(); relationshipToolbar = null;
    if (!selectedIds().includes(nodeId)) setSelection(expandGroupedSelection(state.diagram.elements, [nodeId]), null, false);
    const rect = element.getBoundingClientRect();
    contextMenu = { x: clamp(event.clientX, rect.left + 4, rect.right - 210), y: clamp(event.clientY, rect.top + 4, rect.bottom - 300) };
    render();
  }

  function openRelationshipToolbar(event, relationshipId) {
    event.preventDefault(); event.stopPropagation(); contextMenu = null;
    const rect = element.getBoundingClientRect();
    relationshipToolbar = { x: clamp(event.clientX, rect.left + 8, rect.right - 470), y: clamp(event.clientY, rect.top + 8, rect.bottom - 52) };
    setSelection([], relationshipId);
  }

  function applyStyle(property, value) {
    if (!selectedIds().length) return;
    mutate((next) => applyElementStyle(next.elements, selectedIds(), property, value, defaultNodeStyle));
  }

  function applyRelationshipStyle(property, value) {
    if (!state.selectedRelationshipId) return;
    mutate((next) => {
      const relationship = next.relationships.find((item) => item.id === state.selectedRelationshipId);
      if (property === "kind") relationship.kind = value;
      else relationship.style = { ...defaultRelationshipStyle, ...(relationship.style ?? {}), [property]: property === "width" ? Number(value) : value };
    });
  }

  function copySelection() { clipboard = state.diagram.elements.filter((node) => selectedIds().includes(node.id)).map((node) => structuredClone(node)); pasteOffset = 0; }
  function duplicateSelection() {
    if (!clipboard.length) copySelection();
    if (!clipboard.length) return;
    pasteOffset += 20; const newIds = []; const groupMap = new Map();
    mutate((next) => {
      for (const copied of clipboard) {
        const duplicate = structuredClone(copied); duplicate.id = id(duplicate.kind); duplicate.name = `${duplicate.name} Copy`; duplicate.locked = false;
        duplicate.x = clamp(copied.x + pasteOffset, 0, CANVAS.width - copied.width); duplicate.y = clamp(copied.y + pasteOffset, 0, CANVAS.height - copied.height);
        if (duplicate.groupId) { if (!groupMap.has(duplicate.groupId)) groupMap.set(duplicate.groupId, id("group")); duplicate.groupId = groupMap.get(duplicate.groupId); }
        next.elements.push(duplicate); newIds.push(duplicate.id);
      }
    });
    setSelection(newIds, null, false);
  }

  function executeCommand(command) {
    contextMenu = null;
    if (command === "copy") { copySelection(); render(); return; }
    if (command === "duplicate") { copySelection(); duplicateSelection(); return; }
    if (command === "cut") copySelection();
    if (command === "delete" || command === "cut") { mutate((next) => removeElements(next, selectedIds())); setSelection([]); return; }
    mutate((next) => {
      if (command === "group" && selectedIds().length > 1) groupElements(next.elements, selectedIds(), id("group"));
      if (command === "ungroup") ungroupElements(next.elements, selectedIds());
      if (command === "lock") { const chosen = next.elements.filter((node) => selectedIds().includes(node.id)); const lock = !chosen.every((node) => node.locked); chosen.forEach((node) => { node.locked = lock; }); }
      if (command === "forward" || command === "backward") reorderElements(next.elements, selectedIds(), command);
    });
  }

  function deleteSelectedRelationship() {
    if (!state.selectedRelationshipId) return;
    mutate((next) => { next.relationships = next.relationships.filter((relationship) => relationship.id !== state.selectedRelationshipId); state.selectedRelationshipId = null; relationshipToolbar = null; });
  }
  function deleteSelection() { if (selectedIds().length) executeCommand("delete"); else deleteSelectedRelationship(); }

  element.addEventListener("pointerdown", (event) => {
    if ((event.button === 1 || (event.button === 0 && spaceHeld)) && !event.target.closest(".diagram-node")) {
      event.preventDefault(); gesture = { type: "pan", startX: event.clientX, startY: event.clientY, scrollLeft: element.scrollLeft, scrollTop: element.scrollTop }; return;
    }
    if (event.button !== 0 || event.target.closest(".canvas-toolbar,.format-toolbar,.relationship-toolbar,.canvas-context-menu")) return;
    contextMenu = null; relationshipToolbar = null;
    const start = pointOnCanvas(event);
    gesture = { type: "marquee", start, rect: { left: start.x, top: start.y, right: start.x, bottom: start.y }, additive: event.shiftKey, baseSelection: event.shiftKey ? [...selectedIds()] : [] };
    if (!event.shiftKey) setSelection([]); else render();
  });
  element.addEventListener("wheel", (event) => {
    if (!event.ctrlKey && !event.metaKey) return;
    event.preventDefault();
    setZoom(zoom * Math.exp(-event.deltaY * 0.008), event.clientX, event.clientY);
  }, { passive: false });
  element.addEventListener("input", (event) => {
    const input = event.target.closest("input[type='color']");
    if (!input) return;
    event.stopPropagation();
    if (input.dataset.style) {
      const property = input.dataset.style === "fillColor" ? "--node-fill" : "--node-border";
      element.querySelectorAll(".diagram-node.selected").forEach((node) => node.style.setProperty(property, input.value));
    }
    if (input.dataset.relationshipStyle === "color") element.querySelector(".relationship-line.selected")?.style.setProperty("--relationship-color", input.value);
  });
  element.addEventListener("change", (event) => {
    const input = event.target.closest("[data-style],[data-relationship-style]");
    if (!input) return;
    event.stopPropagation();
    if (input.dataset.style) applyStyle(input.dataset.style, input.type === "color" ? input.value : Number(input.value));
    if (input.dataset.relationshipStyle) applyRelationshipStyle(input.dataset.relationshipStyle, input.value);
  });
  element.addEventListener("scroll", positionFormattingToolbar, { passive: true });
  element.addEventListener("contextmenu", (event) => {
    if (!event.target.closest("[data-node],[data-rel],.relationship-toolbar")) { event.preventDefault(); contextMenu = null; relationshipToolbar = null; render(); }
  });
  // Native browser drags (text, links, images, files, and UI fragments) never create model elements.
  element.addEventListener("dragenter", (event) => event.preventDefault());
  element.addEventListener("dragover", (event) => {
    event.preventDefault();
    if (event.dataTransfer) event.dataTransfer.dropEffect = "none";
  });
  element.addEventListener("dragleave", (event) => { if (!element.contains(event.relatedTarget)) element.classList.remove("drag-target-active"); });
  function placePaletteElement(kind, clientX, clientY) {
    if (!elementKinds.includes(kind) || !state.diagram) return false;
    const rect = element.getBoundingClientRect();
    if (clientX < rect.left || clientX > rect.right || clientY < rect.top || clientY > rect.bottom) return false;
    const point = pointOnCanvas({ clientX, clientY });
    const size = defaultSizeFor(kind);
    const nodeId = id(kind);
    mutate((next) => next.elements.push({ id: nodeId, kind, name: nodeLabel(kind), x: clamp(snap(point.x - size.width / 2), 0, CANVAS.width - size.width), y: clamp(snap(point.y - size.height / 2), 0, CANVAS.height - size.height), ...size, properties: {} }));
    paletteHover = null;
    setSelection([nodeId]);
    return true;
  }
  element.addEventListener("drop", (event) => {
    event.preventDefault();
    event.stopPropagation();
    element.classList.remove("drag-target-active");
  });

  window.addEventListener("pointermove", (event) => {
    if (connectDrag) { const point = pointOnCanvas(event); connectDrag.x2 = point.x; connectDrag.y2 = point.y; render(); return; }
    if (!gesture) return;
    if (gesture.type === "pan") { element.scrollLeft = gesture.scrollLeft - (event.clientX - gesture.startX); element.scrollTop = gesture.scrollTop - (event.clientY - gesture.startY); return; }
    const point = pointOnCanvas(event);
    if (gesture.type === "marquee") {
      gesture.rect = { left: Math.min(gesture.start.x, point.x), top: Math.min(gesture.start.y, point.y), right: Math.max(gesture.start.x, point.x), bottom: Math.max(gesture.start.y, point.y) };
      const hits = expandGroupedSelection(state.diagram.elements, nodesInRect(state.diagram.elements, gesture.rect));
      state.selectedElementIds = gesture.additive ? [...new Set([...gesture.baseSelection, ...hits])] : hits; render(); return;
    }
    const next = structuredClone(state.diagram); const dx = point.x - gesture.start.x; const dy = point.y - gesture.start.y;
    if (gesture.type === "move") moveSelection(next.elements, gesture.ids, gesture.originals, dx, dy, CANVAS, 1);
    if (gesture.type === "move" && gesture.frameOriginal) {
      const original = gesture.originals[gesture.ids[0]];
      const moved = next.elements.find((node) => node.id === gesture.ids[0]);
      const actualDx = moved.x - original.x; const actualDy = moved.y - original.y;
      selectionFrame = { left: gesture.frameOriginal.left + actualDx, top: gesture.frameOriginal.top + actualDy, right: gesture.frameOriginal.right + actualDx, bottom: gesture.frameOriginal.bottom + actualDy };
    }
    if (gesture.type === "resize") { const node = next.elements.find((item) => item.id === gesture.id); node.width = clamp(snap(gesture.original.width + dx), MIN_NODE_WIDTH, CANVAS.width - node.x); node.height = clamp(snap(gesture.original.height + dy), MIN_NODE_HEIGHT, CANVAS.height - node.y); }
    gesture.changed = true;
    state.diagram = next;
    // Keep pointer movement local to the canvas; publishing on every pixel forces every panel to rerender.
    render();
  });

  window.addEventListener("pointerup", (event) => {
    if (connectDrag) {
      const targetId = event.target.closest?.("[data-node]")?.dataset.node;
      if (targetId && targetId !== connectDrag.sourceId) {
        const sourceId = connectDrag.sourceId;
        mutate((next) => { const relationship = { id: id("rel"), kind: "directional-association", source_id: sourceId, target_id: targetId, label: "", properties: {}, style: { ...defaultRelationshipStyle } }; next.relationships.push(relationship); state.selectedRelationshipId = relationship.id; state.selectedElementIds = []; });
      }
      connectDrag = null; render(); return;
    }
    if (gesture?.type === "marquee") selectionFrame = selectedIds().length > 1 ? { ...gesture.rect } : null;
    if (gesture?.changed && gesture.diagramBefore) { const completed = structuredClone(state.diagram); state.diagram = gesture.diagramBefore; setDiagram(completed); }
    gesture = null;
    render();
  });

  window.addEventListener("keydown", (event) => {
    const editing = ["INPUT", "TEXTAREA", "SELECT"].includes(document.activeElement?.tagName); if (editing) return;
    const modifier = event.ctrlKey || event.metaKey; const key = event.key.toLowerCase();
    if (event.code === "Space") { spaceHeld = true; if (!editing) event.preventDefault(); }
    if (modifier && key === "a") { event.preventDefault(); setSelection(state.diagram.elements.map((node) => node.id)); }
    if (modifier && key === "z" && !event.shiftKey) { event.preventDefault(); undoDiagram(); }
    if (modifier && (key === "y" || (key === "z" && event.shiftKey))) { event.preventDefault(); redoDiagram(); }
    if (modifier && key === "c") copySelection();
    if (modifier && key === "x") executeCommand("cut");
    if (modifier && key === "d") { event.preventDefault(); executeCommand("duplicate"); }
    if (modifier && key === "v") duplicateSelection();
    if (modifier && key === "g") { event.preventDefault(); executeCommand(event.shiftKey ? "ungroup" : "group"); }
    if (event.key === "Delete" || event.key === "Backspace") deleteSelection();
    if (event.key === "Escape") { gesture = null; connectDrag = null; contextMenu = null; relationshipToolbar = null; render(); }
  });
  window.addEventListener("keyup", (event) => { if (event.code === "Space") spaceHeld = false; });

  bus.on("diagram:changed", render);
  bus.on("selection:changed", render);
  bus.on("palette:hover", (detail) => { paletteHover = detail; render(); });
  bus.on("palette:dragstart", () => { paletteHover = null; pointerDrag = null; render(); });
  bus.on("palette:pointermove", (detail) => {
    const rect = element.getBoundingClientRect();
    const inside = detail.clientX >= rect.left && detail.clientX <= rect.right && detail.clientY >= rect.top && detail.clientY <= rect.bottom;
    element.classList.toggle("drag-target-active", inside);
    paletteHover = null;
    pointerDrag = detail;
    render();
  });
  bus.on("palette:pointerdrop", ({ kind, clientX, clientY }) => { placePaletteElement(kind, clientX, clientY); pointerDrag = null; render(); });
  bus.on("palette:dragend", () => { pointerDrag = null; element.classList.remove("drag-target-active"); render(); });
  render();
});
