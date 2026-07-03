import { registerMfe } from "/packages/ui/src/moduleRegistry.js";
import {
  MIN_NODE_HEIGHT, MIN_NODE_WIDTH, applyElementStyle, clamp, expandGroupedSelection,
  groupElements, moveSelection, nodesInRect, removeElements, reorderElements,
  selectionBounds, snap, ungroupElements
} from "./canvas-model.js";

const CANVAS = { width: 5000, height: 4000 };
const ZOOM = { minimum: 0.25, maximum: 2.5 };
const relationshipTypes = [
  ["association", "Association"], ["directional-association", "Directional Association"],
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

registerMfe("diagram-canvas", (element, { state, bus, setDiagram }) => {
  let zoom = 1;
  let gesture = null;
  let connectDrag = null;
  let contextMenu = null;
  let relationshipToolbar = null;
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
    if (!relationshipId) relationshipToolbar = null;
    bus.emit("selection:changed", state.selectedElementIds);
  };

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
      <marker id="open-arrow" markerWidth="12" markerHeight="12" refX="10" refY="6" orient="auto-start-reverse" markerUnits="strokeWidth"><path d="M2,1 L10,6 L2,11" fill="none" stroke="context-stroke" stroke-width="1.5"></path></marker>
      <marker id="hollow-triangle" markerWidth="13" markerHeight="13" refX="11" refY="6.5" orient="auto-start-reverse" markerUnits="strokeWidth"><path d="M1,1 L11,6.5 L1,12 z" fill="var(--canvas)" stroke="context-stroke" stroke-width="1.5"></path></marker>
      <marker id="filled-diamond" markerWidth="14" markerHeight="12" refX="1" refY="6" orient="auto-start-reverse" markerUnits="strokeWidth"><path d="M1,6 L7,1 L13,6 L7,11 z" fill="context-stroke" stroke="context-stroke"></path></marker>
      <marker id="hollow-diamond" markerWidth="14" markerHeight="12" refX="1" refY="6" orient="auto-start-reverse" markerUnits="strokeWidth"><path d="M1,6 L7,1 L13,6 L7,11 z" fill="var(--canvas)" stroke="context-stroke" stroke-width="1.3"></path></marker>
      <marker id="containment" markerWidth="17" markerHeight="17" refX="2" refY="8.5" orient="auto-start-reverse" markerUnits="strokeWidth"><circle cx="8.5" cy="8.5" r="6.5" fill="var(--canvas)" stroke="context-stroke"></circle><path d="M5,8.5 H12 M8.5,5 V12" stroke="context-stroke" stroke-width="1.3"></path></marker>
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
    element.innerHTML = `<div class="canvas-chrome"><div class="canvas-toolbar">
      <button id="history-undo" title="Undo">↶</button><button id="history-redo" title="Redo">↷</button>
      <span class="toolbar-separator"></span><button id="zoom-out" title="Zoom out">−</button><span class="zoom-level">${Math.round(zoom * 100)}%</span><button id="zoom-in" title="Zoom in">+</button>
      <button id="select-all" title="Select all elements">Select all</button><span class="toolbar-hint">Shift-click selects precisely · Drag a side handle to connect · Space-drag to pan</span>
    </div></div>
    <div class="canvas-content" style="width:${CANVAS.width * zoom}px;height:${CANVAS.height * zoom}px">
      <div id="canvas-plane" style="width:${CANVAS.width}px;height:${CANVAS.height}px;transform:scale(${zoom})">
        ${renderRelationships(diagram)}
        ${diagram.elements.map((node) => {
          const selected = selectedIds().includes(node.id); const style = nodeStyle(node);
          return `<div class="diagram-node ${selected ? "selected" : ""} ${node.locked ? "locked" : ""} ${node.groupId ? "grouped" : ""}" data-node="${node.id}" style="left:${node.x}px;top:${node.y}px;width:${node.width}px;height:${node.height}px;--node-fill:${style.fillColor};--node-border:${style.borderColor};--node-border-width:${style.borderWidth}px;--node-font-weight:${style.textStyle === "bold" ? 700 : 400}">
            <div class="node-title">${escapeHtml(node.name)}${node.locked ? `<span class="lock-indicator" title="Locked">●</span>` : ""}</div>
            <div class="node-body"><div>${escapeHtml(node.kind)}</div>${(node.properties?.attributes ?? []).map((attribute) => `<div>+ ${escapeHtml(attribute)}</div>`).join("")}${(node.properties?.operations ?? []).map((operation) => `<div>${escapeHtml(operation)}</div>`).join("")}</div>
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
    element.querySelector("#history-undo").addEventListener("click", () => bus.emit("history:undo"));
    element.querySelector("#history-redo").addEventListener("click", () => bus.emit("history:redo"));
    element.querySelector("#zoom-in").addEventListener("click", () => setZoom(zoom + 0.1));
    element.querySelector("#zoom-out").addEventListener("click", () => setZoom(zoom - 0.1));
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
      nodeElement.addEventListener("pointerdown", (event) => startNodeGesture(event, nodeElement.dataset.node));
      nodeElement.addEventListener("contextmenu", (event) => openContextMenu(event, nodeElement.dataset.node));
    });
    element.querySelectorAll("[data-style]").forEach((input) => {
      const apply = () => applyStyle(input.dataset.style, input.type === "color" ? input.value : Number(input.value));
      input.addEventListener(input.type === "color" ? "input" : "change", apply);
    });
    element.querySelectorAll("[data-style-button]").forEach((button) => button.addEventListener("click", () => {
      const first = state.diagram.elements.find((node) => node.id === selectedIds()[0]);
      applyStyle("textStyle", nodeStyle(first).textStyle === "bold" ? "normal" : "bold");
    }));
    element.querySelectorAll("[data-relationship-style]").forEach((input) => {
      const apply = () => applyRelationshipStyle(input.dataset.relationshipStyle, input.value);
      input.addEventListener(input.type === "color" ? "input" : "change", apply);
    });
    element.querySelector("[data-relationship-command='delete']")?.addEventListener("click", deleteSelectedRelationship);
    element.querySelectorAll("[data-command]").forEach((button) => button.addEventListener("click", () => executeCommand(button.dataset.command)));
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
    gesture = { type: "move", start: pointOnCanvas(event), ids: movableIds, originals: Object.fromEntries(state.diagram.elements.filter((node) => movableIds.includes(node.id)).map((node) => [node.id, structuredClone(node)])), diagramBefore: structuredClone(state.diagram), changed: false };
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
  element.addEventListener("scroll", positionFormattingToolbar, { passive: true });
  element.addEventListener("contextmenu", (event) => {
    if (!event.target.closest("[data-node],[data-rel],.relationship-toolbar")) { event.preventDefault(); contextMenu = null; relationshipToolbar = null; render(); }
  });
  element.addEventListener("dragover", (event) => event.preventDefault());
  element.addEventListener("drop", (event) => {
    event.preventDefault(); const kind = event.dataTransfer.getData("application/sysml-element"); if (!kind) return;
    const point = pointOnCanvas(event);
    mutate((next) => next.elements.push({ id: id(kind), kind, name: `${kind[0].toUpperCase()}${kind.slice(1)}`, x: clamp(snap(point.x), 0, CANVAS.width - 180), y: clamp(snap(point.y), 0, CANVAS.height - 100), width: 180, height: 100, properties: {} }));
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
    if (gesture.type === "move") moveSelection(next.elements, gesture.ids, gesture.originals, dx, dy, CANVAS);
    if (gesture.type === "resize") { const node = next.elements.find((item) => item.id === gesture.id); node.width = clamp(snap(gesture.original.width + dx), MIN_NODE_WIDTH, CANVAS.width - node.x); node.height = clamp(snap(gesture.original.height + dy), MIN_NODE_HEIGHT, CANVAS.height - node.y); }
    gesture.changed = true; state.diagram = next; bus.emit("diagram:changed", next);
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
    if (gesture?.changed && gesture.diagramBefore) { const completed = structuredClone(state.diagram); state.diagram = gesture.diagramBefore; setDiagram(completed); }
    gesture = null;
  });

  window.addEventListener("keydown", (event) => {
    const editing = ["INPUT", "TEXTAREA", "SELECT"].includes(document.activeElement?.tagName); if (editing) return;
    const modifier = event.ctrlKey || event.metaKey; const key = event.key.toLowerCase();
    if (event.code === "Space") { spaceHeld = true; if (!editing) event.preventDefault(); }
    if (modifier && key === "a") { event.preventDefault(); setSelection(state.diagram.elements.map((node) => node.id)); }
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
  render();
});
