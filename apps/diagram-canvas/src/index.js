import { registerMfe } from "/packages/ui/src/moduleRegistry.js";
import {
  MIN_NODE_HEIGHT, MIN_NODE_WIDTH, clamp, moveSelection, nodesInRect,
  removeElements, reorderElements, snap
} from "./canvas-model.js";

const relationshipOptions = ["association", "aggregation", "composition", "generalization", "realization", "dependency", "trace", "satisfy", "verify", "refine", "allocate", "flow", "connector"];
const dashedRelationships = new Set(["dependency", "trace", "satisfy", "verify", "refine", "allocate"]);
const defaultStyle = { borderColor: "#26351f", fillColor: "#d7eadb", borderWidth: 1, textStyle: "normal" };

function id(prefix) { return `${prefix}_${Math.random().toString(36).slice(2, 10)}`; }
function escapeHtml(value = "") {
  return String(value).replace(/[&<>'"]/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", "\"": "&quot;" })[character]);
}

registerMfe("diagram-canvas", (element, { state, bus, setDiagram }) => {
  let zoom = 1;
  let gesture = null;
  let connectDrag = null;
  let contextMenu = null;
  let clipboard = [];
  let pasteOffset = 0;

  const selectedIds = () => state.selectedElementIds ?? [];
  const canvasSize = () => ({ width: element.clientWidth / zoom, height: element.clientHeight / zoom });
  const pointOnCanvas = (event) => {
    const rect = element.getBoundingClientRect();
    return { x: (event.clientX - rect.left) / zoom, y: (event.clientY - rect.top) / zoom };
  };
  const nodeStyle = (node) => ({ ...defaultStyle, ...(node.style ?? {}) });
  const setSelection = (ids, relationshipId = null) => {
    state.selectedElementIds = [...new Set(ids)];
    state.selectedRelationshipId = relationshipId;
    bus.emit("selection:changed", state.selectedElementIds);
  };
  const mutate = (mutator) => {
    const next = structuredClone(state.diagram);
    mutator(next);
    setDiagram(next);
  };

  function relationshipPath(source, target) {
    const start = { x: source.x + source.width, y: source.y + source.height / 2 };
    const end = { x: target.x, y: target.y + target.height / 2 };
    const midX = (start.x + end.x) / 2;
    return { start, end, midX, d: `M ${start.x} ${start.y} C ${midX} ${start.y}, ${midX} ${end.y}, ${end.x} ${end.y}` };
  }

  function renderRelationships(diagram) {
    return `<svg class="relationship-layer" aria-label="Diagram relationships">
      <defs><marker id="arrow" markerWidth="10" markerHeight="10" refX="9" refY="3" orient="auto" markerUnits="strokeWidth"><path d="M0,0 L0,6 L9,3 z" fill="context-stroke"></path></marker></defs>
      ${(diagram.relationships ?? []).map((relationship) => {
        const source = diagram.elements.find((node) => node.id === relationship.source_id);
        const target = diagram.elements.find((node) => node.id === relationship.target_id);
        if (!source || !target) return "";
        const path = relationshipPath(source, target);
        const selected = state.selectedRelationshipId === relationship.id;
        return `<path class="relationship-hit" data-rel="${relationship.id}" d="${path.d}"></path>
          <path class="relationship-line ${selected ? "selected" : ""}" d="${path.d}" stroke-dasharray="${dashedRelationships.has(relationship.kind) ? "6 5" : "0"}" marker-end="url(#arrow)"></path>
          <text class="relationship-label ${selected ? "selected" : ""}" data-rel="${relationship.id}" x="${path.midX}" y="${(path.start.y + path.end.y) / 2 - 10}">${escapeHtml(relationship.label || relationship.kind)}</text>`;
      }).join("")}
      ${connectDrag ? `<path class="relationship-preview" d="M ${connectDrag.x1} ${connectDrag.y1} C ${(connectDrag.x1 + connectDrag.x2) / 2} ${connectDrag.y1}, ${(connectDrag.x1 + connectDrag.x2) / 2} ${connectDrag.y2}, ${connectDrag.x2} ${connectDrag.y2}" marker-end="url(#arrow)"></path>` : ""}
    </svg>`;
  }

  function renderFormattingToolbar(diagram) {
    if (selectedIds().length !== 1) return "";
    const node = diagram.elements.find((item) => item.id === selectedIds()[0]);
    if (!node) return "";
    const style = nodeStyle(node);
    return `<div class="format-toolbar" aria-label="Element formatting toolbar">
      <label title="Border color">Border <input data-style="borderColor" type="color" value="${style.borderColor}"></label>
      <label title="Fill color">Fill <input data-style="fillColor" type="color" value="${style.fillColor}"></label>
      <label title="Border thickness">Line <select data-style="borderWidth"><option value="1" ${style.borderWidth === 1 ? "selected" : ""}>1 px</option><option value="2" ${style.borderWidth === 2 ? "selected" : ""}>2 px</option><option value="3" ${style.borderWidth === 3 ? "selected" : ""}>3 px</option></select></label>
      <button data-style-button="textStyle" class="format-button ${style.textStyle === "bold" ? "active" : ""}" title="Toggle bold text"><strong>B</strong></button>
    </div>`;
  }

  function renderContextMenu() {
    if (!contextMenu || !selectedIds().length) return "";
    const selected = state.diagram.elements.filter((node) => selectedIds().includes(node.id));
    const allLocked = selected.every((node) => node.locked);
    return `<div class="canvas-context-menu" style="left:${contextMenu.x}px;top:${contextMenu.y}px" role="menu">
      <button data-command="delete" class="context-danger" role="menuitem">Delete <kbd>Del</kbd></button>
      <button data-command="cut" role="menuitem">Cut <kbd>Ctrl+X</kbd></button>
      <button data-command="copy" role="menuitem">Copy <kbd>Ctrl+C</kbd></button>
      <button data-command="duplicate" role="menuitem">Duplicate <kbd>Ctrl+D</kbd></button>
      <span class="context-separator"></span>
      <button data-command="lock" role="menuitem">${allLocked ? "Unlock" : "Lock"}</button>
      <button data-command="forward" role="menuitem">Bring Forward</button>
      <button data-command="backward" role="menuitem">Bring Backward</button>
    </div>`;
  }

  function render() {
    const diagram = state.diagram;
    if (!diagram) return;
    element.innerHTML = `<div class="canvas-toolbar">
      <button id="zoom-out" title="Zoom out">−</button><button id="zoom-in" title="Zoom in">+</button>
      <button id="select-all" title="Select all elements">Select all</button>
      <select id="relationship-kind" title="Relationship type">${relationshipOptions.map((kind) => `<option value="${kind}" ${state.relationshipKind === kind ? "selected" : ""}>${kind}</option>`).join("")}</select>
      <span class="toolbar-hint">Shift-click or drag to multi-select · Drag a side handle to connect</span>
    </div>
    ${renderFormattingToolbar(diagram)}
    <div id="canvas-plane" style="transform:scale(${zoom});">
      ${renderRelationships(diagram)}
      ${diagram.elements.map((node) => {
        const selected = selectedIds().includes(node.id);
        const style = nodeStyle(node);
        return `<div class="diagram-node ${selected ? "selected" : ""} ${node.locked ? "locked" : ""}" data-node="${node.id}" style="left:${node.x}px;top:${node.y}px;width:${node.width}px;height:${node.height}px;--node-fill:${style.fillColor};--node-border:${style.borderColor};--node-border-width:${style.borderWidth}px;--node-font-weight:${style.textStyle === "bold" ? 700 : 400}">
          <div class="node-title">${escapeHtml(node.name)}${node.locked ? `<span class="lock-indicator" title="Locked">●</span>` : ""}</div>
          <div class="node-body"><div>${escapeHtml(node.kind)}</div>${(node.properties?.attributes ?? []).map((attribute) => `<div>+ ${escapeHtml(attribute)}</div>`).join("")}${(node.properties?.operations ?? []).map((operation) => `<div>${escapeHtml(operation)}</div>`).join("")}</div>
          ${selected ? `<span class="connector-handle connector-out" data-handle="${node.id}" title="Drag to create relationship"></span><span class="connector-handle connector-in"></span>` : ""}
          ${selected && selectedIds().length === 1 && !node.locked ? `<span class="resize-handle" data-resize="${node.id}" title="Resize element"></span>` : ""}
        </div>`;
      }).join("")}
      ${gesture?.type === "marquee" ? `<div class="selection-marquee" style="left:${gesture.rect.left}px;top:${gesture.rect.top}px;width:${gesture.rect.right - gesture.rect.left}px;height:${gesture.rect.bottom - gesture.rect.top}px"></div>` : ""}
    </div>${renderContextMenu()}`;

    bindRenderedEvents();
  }

  function bindRenderedEvents() {
    element.querySelector("#zoom-in").addEventListener("click", () => { zoom = Math.min(2, zoom + 0.1); render(); });
    element.querySelector("#zoom-out").addEventListener("click", () => { zoom = Math.max(0.5, zoom - 0.1); render(); });
    element.querySelector("#select-all").addEventListener("click", () => setSelection(state.diagram.elements.map((node) => node.id)));
    element.querySelector("#relationship-kind").addEventListener("change", (event) => { state.relationshipKind = event.target.value; });
    element.querySelectorAll("[data-rel]").forEach((target) => target.addEventListener("pointerdown", (event) => {
      event.stopPropagation(); contextMenu = null; setSelection([], target.dataset.rel);
    }));
    element.querySelectorAll("[data-handle]").forEach((handle) => handle.addEventListener("pointerdown", (event) => {
      event.preventDefault(); event.stopPropagation();
      const source = state.diagram.elements.find((node) => node.id === handle.dataset.handle);
      connectDrag = { sourceId: source.id, x1: source.x + source.width, y1: source.y + source.height / 2, x2: source.x + source.width + 80, y2: source.y + source.height / 2 };
      gesture = null; contextMenu = null; setSelection([source.id]);
    }));
    element.querySelectorAll("[data-resize]").forEach((handle) => handle.addEventListener("pointerdown", (event) => {
      event.preventDefault(); event.stopPropagation();
      const node = state.diagram.elements.find((item) => item.id === handle.dataset.resize);
      gesture = { type: "resize", id: node.id, start: pointOnCanvas(event), original: structuredClone(node), diagramBefore: structuredClone(state.diagram), changed: false };
    }));
    element.querySelectorAll("[data-node]").forEach((nodeElement) => {
      nodeElement.addEventListener("pointerdown", (event) => startNodeGesture(event, nodeElement.dataset.node));
      nodeElement.addEventListener("contextmenu", (event) => openContextMenu(event, nodeElement.dataset.node));
    });
    element.querySelectorAll("[data-style]").forEach((input) => input.addEventListener("change", () => applyStyle(input.dataset.style, input.type === "color" ? input.value : Number(input.value))));
    element.querySelectorAll("[data-style-button]").forEach((button) => button.addEventListener("click", () => {
      const node = state.diagram.elements.find((item) => item.id === selectedIds()[0]);
      applyStyle("textStyle", nodeStyle(node).textStyle === "bold" ? "normal" : "bold");
    }));
    element.querySelectorAll("[data-command]").forEach((button) => button.addEventListener("click", () => executeCommand(button.dataset.command)));
  }

  function startNodeGesture(event, nodeId) {
    if (event.button !== 0) return;
    event.preventDefault(); event.stopPropagation(); contextMenu = null;
    let nextSelection;
    if (event.shiftKey) nextSelection = selectedIds().includes(nodeId) ? selectedIds().filter((idValue) => idValue !== nodeId) : [...selectedIds(), nodeId];
    else nextSelection = selectedIds().includes(nodeId) ? selectedIds() : [nodeId];
    setSelection(nextSelection);
    const movableIds = nextSelection.filter((idValue) => !state.diagram.elements.find((node) => node.id === idValue)?.locked);
    if (!movableIds.includes(nodeId)) return;
    gesture = {
      type: "move", start: pointOnCanvas(event), ids: movableIds,
      originals: Object.fromEntries(state.diagram.elements.filter((node) => movableIds.includes(node.id)).map((node) => [node.id, structuredClone(node)])),
      diagramBefore: structuredClone(state.diagram), changed: false
    };
  }

  function openContextMenu(event, nodeId) {
    event.preventDefault(); event.stopPropagation();
    if (!selectedIds().includes(nodeId)) setSelection([nodeId]);
    const rect = element.getBoundingClientRect();
    contextMenu = { x: clamp(event.clientX - rect.left, 4, element.clientWidth - 210), y: clamp(event.clientY - rect.top, 4, element.clientHeight - 280) };
    render();
  }

  function applyStyle(property, value) {
    if (selectedIds().length !== 1) return;
    mutate((next) => {
      const node = next.elements.find((item) => item.id === selectedIds()[0]);
      node.style = { ...defaultStyle, ...(node.style ?? {}), [property]: value };
    });
  }

  function copySelection() {
    clipboard = state.diagram.elements.filter((node) => selectedIds().includes(node.id)).map((node) => structuredClone(node));
    pasteOffset = 0;
  }

  function duplicateSelection() {
    if (!clipboard.length) copySelection();
    if (!clipboard.length) return;
    pasteOffset += 20;
    const newIds = [];
    mutate((next) => {
      for (const copied of clipboard) {
        const duplicate = structuredClone(copied);
        duplicate.id = id(duplicate.kind); duplicate.name = `${duplicate.name} Copy`; duplicate.locked = false;
        duplicate.x = clamp(copied.x + pasteOffset, 0, canvasSize().width - copied.width);
        duplicate.y = clamp(copied.y + pasteOffset, 0, canvasSize().height - copied.height);
        next.elements.push(duplicate); newIds.push(duplicate.id);
      }
      state.selectedElementIds = newIds;
    });
    setSelection(newIds);
  }

  function executeCommand(command) {
    contextMenu = null;
    if (command === "copy") { copySelection(); render(); return; }
    if (command === "duplicate") { copySelection(); duplicateSelection(); return; }
    if (command === "cut") copySelection();
    if (command === "delete" || command === "cut") {
      mutate((next) => removeElements(next, selectedIds())); setSelection([]); return;
    }
    mutate((next) => {
      if (command === "lock") {
        const chosen = next.elements.filter((node) => selectedIds().includes(node.id));
        const lock = !chosen.every((node) => node.locked);
        chosen.forEach((node) => { node.locked = lock; });
      }
      if (command === "forward" || command === "backward") reorderElements(next.elements, selectedIds(), command);
    });
  }

  function deleteSelection() {
    if (selectedIds().length) executeCommand("delete");
    else if (state.selectedRelationshipId) mutate((next) => {
      next.relationships = next.relationships.filter((relationship) => relationship.id !== state.selectedRelationshipId);
      state.selectedRelationshipId = null;
    });
  }

  element.addEventListener("pointerdown", (event) => {
    if (event.button !== 0 || event.target.closest(".canvas-toolbar,.format-toolbar,.canvas-context-menu")) return;
    contextMenu = null;
    const start = pointOnCanvas(event);
    gesture = { type: "marquee", start, rect: { left: start.x, top: start.y, right: start.x, bottom: start.y }, additive: event.shiftKey, baseSelection: event.shiftKey ? [...selectedIds()] : [] };
    if (!event.shiftKey) setSelection([]); else render();
  });
  element.addEventListener("contextmenu", (event) => { if (!event.target.closest("[data-node]")) { event.preventDefault(); contextMenu = null; render(); } });
  element.addEventListener("dragover", (event) => event.preventDefault());
  element.addEventListener("drop", (event) => {
    event.preventDefault();
    const kind = event.dataTransfer.getData("application/sysml-element");
    if (!kind) return;
    const point = pointOnCanvas(event); const size = canvasSize();
    mutate((next) => next.elements.push({ id: id(kind), kind, name: `${kind[0].toUpperCase()}${kind.slice(1)}`, x: clamp(snap(point.x), 0, size.width - 180), y: clamp(snap(point.y), 0, size.height - 100), width: 180, height: 100, properties: {} }));
  });

  window.addEventListener("pointermove", (event) => {
    if (connectDrag) { const point = pointOnCanvas(event); connectDrag.x2 = point.x; connectDrag.y2 = point.y; render(); return; }
    if (!gesture) return;
    const point = pointOnCanvas(event);
    if (gesture.type === "marquee") {
      gesture.rect = { left: Math.min(gesture.start.x, point.x), top: Math.min(gesture.start.y, point.y), right: Math.max(gesture.start.x, point.x), bottom: Math.max(gesture.start.y, point.y) };
      const hits = nodesInRect(state.diagram.elements, gesture.rect);
      state.selectedElementIds = gesture.additive ? [...new Set([...gesture.baseSelection, ...hits])] : hits;
      render(); return;
    }
    const next = structuredClone(state.diagram); const dx = point.x - gesture.start.x; const dy = point.y - gesture.start.y;
    if (gesture.type === "move") moveSelection(next.elements, gesture.ids, gesture.originals, dx, dy, canvasSize());
    if (gesture.type === "resize") {
      const node = next.elements.find((item) => item.id === gesture.id);
      node.width = clamp(snap(gesture.original.width + dx), MIN_NODE_WIDTH, canvasSize().width - node.x);
      node.height = clamp(snap(gesture.original.height + dy), MIN_NODE_HEIGHT, canvasSize().height - node.y);
    }
    gesture.changed = true; state.diagram = next; bus.emit("diagram:changed", next);
  });

  window.addEventListener("pointerup", (event) => {
    if (connectDrag) {
      const targetId = event.target.closest?.("[data-node]")?.dataset.node;
      if (targetId && targetId !== connectDrag.sourceId) {
        const sourceId = connectDrag.sourceId; const kind = state.relationshipKind ?? "association";
        mutate((next) => { const relationship = { id: id("rel"), kind, source_id: sourceId, target_id: targetId, label: "", properties: {} }; next.relationships.push(relationship); state.selectedRelationshipId = relationship.id; state.selectedElementIds = []; });
      }
      connectDrag = null; render(); return;
    }
    if (gesture?.changed && gesture.diagramBefore) {
      const completedDiagram = structuredClone(state.diagram);
      state.diagram = gesture.diagramBefore;
      setDiagram(completedDiagram);
    }
    gesture = null;
  });

  window.addEventListener("keydown", (event) => {
    const editing = ["INPUT", "TEXTAREA", "SELECT"].includes(document.activeElement?.tagName);
    if (editing) return;
    const modifier = event.ctrlKey || event.metaKey;
    if (modifier && event.key.toLowerCase() === "a") { event.preventDefault(); setSelection(state.diagram.elements.map((node) => node.id)); }
    if (modifier && event.key.toLowerCase() === "c") copySelection();
    if (modifier && event.key.toLowerCase() === "x") executeCommand("cut");
    if (modifier && event.key.toLowerCase() === "d") { event.preventDefault(); executeCommand("duplicate"); }
    if (modifier && event.key.toLowerCase() === "v") duplicateSelection();
    if (event.key === "Delete" || event.key === "Backspace") deleteSelection();
    if (event.key === "Escape") { gesture = null; connectDrag = null; contextMenu = null; render(); }
  });

  bus.on("diagram:changed", render);
  bus.on("selection:changed", render);
  render();
});
