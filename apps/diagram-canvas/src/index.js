import { registerMfe } from "/packages/ui/src/moduleRegistry.js";

const relationshipOptions = [
  "association",
  "aggregation",
  "composition",
  "generalization",
  "realization",
  "dependency",
  "trace",
  "satisfy",
  "verify",
  "refine",
  "allocate",
  "flow",
  "connector"
];

function id(prefix) {
  return `${prefix}_${Math.random().toString(36).slice(2, 10)}`;
}

function isDashed(kind) {
  return ["dependency", "trace", "satisfy", "verify", "refine", "allocate"].includes(kind);
}

registerMfe("diagram-canvas", (element, { state, bus, setDiagram }) => {
  let zoom = 1;
  let drag = null;
  let connectDrag = null;

  function mutate(mutator) {
    const next = structuredClone(state.diagram);
    mutator(next);
    setDiagram(next);
  }

  function nodeCenterRight(node) {
    return { x: node.x + node.width, y: node.y + node.height / 2 };
  }

  function nodeCenterLeft(node) {
    return { x: node.x, y: node.y + node.height / 2 };
  }

  function renderRelationships(diagram) {
    return `
      <svg class="relationship-layer">
        <defs>
          <marker id="arrow" markerWidth="10" markerHeight="10" refX="9" refY="3" orient="auto" markerUnits="strokeWidth">
            <path d="M0,0 L0,6 L9,3 z" fill="#9aa8bb"></path>
          </marker>
        </defs>
        ${(diagram.relationships ?? []).map((rel) => {
          const source = diagram.elements.find((item) => item.id === rel.source_id);
          const target = diagram.elements.find((item) => item.id === rel.target_id);
          if (!source || !target) return "";
          const start = nodeCenterRight(source);
          const end = nodeCenterLeft(target);
          const selected = state.selectedRelationshipId === rel.id;
          const midX = (start.x + end.x) / 2;
          const path = `M ${start.x} ${start.y} C ${midX} ${start.y}, ${midX} ${end.y}, ${end.x} ${end.y}`;
          return `
            <path class="relationship-hit" data-rel="${rel.id}" d="${path}"></path>
            <path class="relationship-line ${selected ? "selected" : ""}" data-rel="${rel.id}" d="${path}" stroke-dasharray="${isDashed(rel.kind) ? "6 5" : "0"}" marker-end="url(#arrow)"></path>
            <text class="relationship-label ${selected ? "selected" : ""}" data-rel="${rel.id}" x="${midX}" y="${(start.y + end.y) / 2 - 10}">${rel.label || rel.kind}</text>
          `;
        }).join("")}
        ${connectDrag ? `<path class="relationship-preview" d="M ${connectDrag.x1} ${connectDrag.y1} C ${(connectDrag.x1 + connectDrag.x2) / 2} ${connectDrag.y1}, ${(connectDrag.x1 + connectDrag.x2) / 2} ${connectDrag.y2}, ${connectDrag.x2} ${connectDrag.y2}" marker-end="url(#arrow)"></path>` : ""}
      </svg>
    `;
  }

  function render() {
    const diagram = state.diagram;
    if (!diagram) return;
    element.innerHTML = `
      <div class="canvas-toolbar">
        <button id="zoom-out" title="Zoom out">-</button>
        <button id="zoom-in" title="Zoom in">+</button>
        <select id="relationship-kind" title="Relationship type">${relationshipOptions.map((kind) => `<option value="${kind}" ${state.relationshipKind === kind ? "selected" : ""}>${kind}</option>`).join("")}</select>
        <span class="toolbar-hint">Drag from an element handle to another element. Click a relationship, then press Delete.</span>
      </div>
      <div id="canvas-plane" style="position:absolute;inset:0;transform:scale(${zoom});transform-origin:0 0;">
        ${renderRelationships(diagram)}
        ${diagram.elements.map((node) => `
          <div class="diagram-node ${state.selectedElementIds.includes(node.id) ? "selected" : ""}" data-node="${node.id}" style="left:${node.x}px;top:${node.y}px;width:${node.width}px;min-height:${node.height}px">
            <div class="node-title">${node.name}</div>
            <div class="node-body">
              <div>${node.kind}</div>
              ${(node.properties?.attributes ?? []).map((attr) => `<div>+ ${attr}</div>`).join("")}
              ${(node.properties?.operations ?? []).map((op) => `<div>${op}</div>`).join("")}
            </div>
            <span class="connector-handle connector-out" data-handle="${node.id}" title="Drag to create relationship"></span>
            <span class="connector-handle connector-in" title="Relationship target"></span>
          </div>
        `).join("")}
      </div>
    `;

    element.querySelector("#zoom-in").addEventListener("click", () => {
      zoom = Math.min(2, zoom + 0.1);
      render();
    });
    element.querySelector("#zoom-out").addEventListener("click", () => {
      zoom = Math.max(0.5, zoom - 0.1);
      render();
    });
    element.querySelector("#relationship-kind").addEventListener("change", (event) => {
      state.relationshipKind = event.target.value;
    });
    element.querySelectorAll("[data-rel]").forEach((relationship) => {
      relationship.addEventListener("mousedown", (event) => {
        event.stopPropagation();
        state.selectedRelationshipId = relationship.dataset.rel;
        state.selectedElementIds = [];
        bus.emit("selection:changed", state.selectedElementIds);
        render();
      });
    });
    element.querySelectorAll("[data-handle]").forEach((handle) => {
      handle.addEventListener("mousedown", (event) => {
        event.stopPropagation();
        const sourceId = handle.dataset.handle;
        const source = state.diagram.elements.find((item) => item.id === sourceId);
        const start = nodeCenterRight(source);
        connectDrag = { sourceId, x1: start.x, y1: start.y, x2: start.x + 80, y2: start.y };
        drag = null;
        state.selectedElementIds = [sourceId];
        state.selectedRelationshipId = null;
        bus.emit("selection:changed", state.selectedElementIds);
        render();
      });
    });
    element.querySelectorAll("[data-node]").forEach((node) => {
      node.addEventListener("mousedown", (event) => {
        const nodeId = node.dataset.node;
        state.selectedRelationshipId = null;
        state.selectedElementIds = event.shiftKey ? [...new Set([...state.selectedElementIds, nodeId])] : [nodeId];
        drag = {
          id: nodeId,
          startX: event.clientX,
          startY: event.clientY,
          original: state.diagram.elements.find((item) => item.id === nodeId)
        };
        bus.emit("selection:changed", state.selectedElementIds);
        render();
      });
    });
  }

  function createRelationshipFromDrag(targetId) {
    if (!connectDrag || !targetId || targetId === connectDrag.sourceId) return;
    const kind = state.relationshipKind ?? "association";
    const sourceId = connectDrag.sourceId;
    mutate((next) => {
      const relationship = {
        id: id("rel"),
        kind,
        source_id: sourceId,
        target_id: targetId,
        label: "",
        properties: {}
      };
      next.relationships.push(relationship);
      state.selectedRelationshipId = relationship.id;
      state.selectedElementIds = [];
    });
  }

  function deleteSelectedRelationship() {
    if (!state.selectedRelationshipId) return;
    mutate((next) => {
      next.relationships = next.relationships.filter((relationship) => relationship.id !== state.selectedRelationshipId);
      state.selectedRelationshipId = null;
    });
  }

  element.addEventListener("dragover", (event) => event.preventDefault());
  element.addEventListener("drop", (event) => {
    event.preventDefault();
    const kind = event.dataTransfer.getData("application/sysml-element");
    if (!kind) return;
    const rect = element.getBoundingClientRect();
    const name = `${kind[0].toUpperCase()}${kind.slice(1)}`;
    mutate((next) => next.elements.push({
      id: id(kind),
      kind,
      name,
      x: Math.round((event.clientX - rect.left) / 20) * 20,
      y: Math.round((event.clientY - rect.top) / 20) * 20,
      width: 180,
      height: 100,
      properties: {}
    }));
  });
  window.addEventListener("mousemove", (event) => {
    if (connectDrag) {
      const rect = element.getBoundingClientRect();
      connectDrag.x2 = (event.clientX - rect.left) / zoom;
      connectDrag.y2 = (event.clientY - rect.top) / zoom;
      render();
      return;
    }
    if (!drag) return;
    const dx = (event.clientX - drag.startX) / zoom;
    const dy = (event.clientY - drag.startY) / zoom;
    const next = structuredClone(state.diagram);
    const node = next.elements.find((item) => item.id === drag.id);
    node.x = Math.round((drag.original.x + dx) / 20) * 20;
    node.y = Math.round((drag.original.y + dy) / 20) * 20;
    state.diagram = next;
    bus.emit("diagram:changed", next);
  });
  window.addEventListener("mouseup", (event) => {
    if (connectDrag) {
      const targetNode = event.target.closest?.("[data-node]");
      createRelationshipFromDrag(targetNode?.dataset.node);
      connectDrag = null;
      render();
      return;
    }
    drag = null;
  });
  window.addEventListener("keydown", (event) => {
    if (event.key !== "Delete" && event.key !== "Backspace") return;
    const tagName = document.activeElement?.tagName;
    if (tagName === "INPUT" || tagName === "TEXTAREA" || tagName === "SELECT") return;
    deleteSelectedRelationship();
  });
  bus.on("diagram:changed", render);
  bus.on("selection:changed", render);
  render();
});
