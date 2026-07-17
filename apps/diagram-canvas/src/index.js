import { registerMfe } from "../../../packages/ui/src/moduleRegistry.js";
import { elementKinds, isPaletteItemAllowed, validateRelationshipCompatibility } from "../../../packages/model-core/src/index.js";
import {
  MIN_NODE_HEIGHT, MIN_NODE_WIDTH, alignElements, autoLayoutElements, canvasScrollFromMinimap, clamp, distributeElements, expandGroupedSelection,
  groupElements, isColorInputValue, moveSelection, nodesInRect, normalizeColor, removeElements, reorderElements,
  minimapViewport, selectionBounds, snap, snapLinesForMove, ungroupElements
} from "./canvas-model.js";
import { anchorPoint, nearestAnchor, pointAlongRoute, relationshipRoute, routeOrthogonal, routeToJumpPath, routeToPath, segments } from "./connector-routing.js";
import {
  CANVAS, ZOOM, compartmentDefinitionsFor, defaultNodeStyle, defaultPageSize, defaultRelationshipStyle,
  lightTextKinds, pageSizes, relationshipTypes, shortcutRows, simpleShapeKinds, themeNodeStyles
} from "./config/canvasConfig.js";
import { defaultNameFor, defaultPropertiesFor, defaultSizeFor, nodeLabel } from "./editing/elementFactory.js";
import { createNodeRenderer } from "./rendering/createNodeRenderer.js";
import { createScopedStyles } from "../../../packages/ui/src/scopedStyles.js";

function id(prefix) { return `${prefix}_${Math.random().toString(36).slice(2, 10)}`; }
function escapeHtml(value = "") {
  return String(value).replace(/[&<>'"]/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", "\"": "&quot;" })[character]);
}

function insertPlainText(target, text) {
  const selection = window.getSelection();
  if (!selection?.rangeCount) {
    target.append(document.createTextNode(text));
    return;
  }
  const range = selection.getRangeAt(0);
  range.deleteContents();
  const textNode = document.createTextNode(text);
  range.insertNode(textNode);
  range.setStartAfter(textNode);
  range.collapse(true);
  selection.removeAllRanges();
  selection.addRange(range);
}

function placeCaretAtPoint(target, clientX, clientY) {
  if (target instanceof HTMLTextAreaElement || target instanceof HTMLInputElement) {
    const end = target.value.length;
    target.setSelectionRange(end, end);
    return;
  }
  const selection = window.getSelection();
  if (!selection) return;
  let range = null;
  if (typeof document.caretPositionFromPoint === "function") {
    const position = document.caretPositionFromPoint(clientX, clientY);
    if (position && target.contains(position.offsetNode)) {
      range = document.createRange();
      range.setStart(position.offsetNode, position.offset);
      range.collapse(true);
    }
  } else if (typeof document.caretRangeFromPoint === "function") {
    const candidate = document.caretRangeFromPoint(clientX, clientY);
    if (candidate && target.contains(candidate.startContainer)) range = candidate;
  }
  if (!range) {
    range = document.createRange();
    range.selectNodeContents(target);
    range.collapse(false);
  }
  selection.removeAllRanges();
  selection.addRange(range);
}

function renderColorControl({ value, label, styleProperty = "", relationshipProperty = "" }) {
  const color = normalizeColor(value);
  const targetAttribute = styleProperty ? `data-style="${styleProperty}"` : `data-relationship-style="${relationshipProperty}"`;
  return `<span class="color-control" data-color-control>
    <input class="color-trigger color-native" ${targetAttribute} data-color-input="native" data-initial-color="${color}" type="color" value="${color}" aria-label="Choose ${escapeHtml(label.toLowerCase())}" title="Choose ${escapeHtml(label.toLowerCase())}">
  </span>`;
}

registerMfe("diagram-canvas", (element, { state, bus, setDiagram, undoDiagram, redoDiagram, updateDiagramDraft }) => {
  const mountedDiagramId = state.diagram?.id;
  const lifecycle = new AbortController();
  const runtimeStyles = createScopedStyles(element, "diagram-canvas");
  const subscriptions = [];
  let zoom = state.canvasViewport?.zoom ?? 1;
  const touchPoints = new Map();
  let pinch = null;
  let gesture = null;
  let connectDrag = null;
  let contextMenu = null;
  let relationshipToolbar = null;
  let selectionFrame = null;
  let paletteHover = null;
  let editingNode = null;
  let editingTimer = null;
  let activeNativeColorInput = null;
  let pointerDrag = null;
  let minimapDrag = null;
  let renderFrame = null;
  let viewportFrame = null;
  let lastNodePress = null;
  let clipboard = [];
  let pasteOffset = 0;
  let spaceHeld = false;
  let gridSize = state.diagram?.metadata?.gridSize ?? state.diagram?.metadata?.grid ?? 20;
  let showGrid = state.diagram?.metadata?.showGrid ?? true;
  let snapGuides = [];
  let searchOpen = false;
  let searchQuery = "";
  let shortcutHelpOpen = false;
  let printPreviewOpen = false;
  let collaboration = state.collaboration ?? { presence: [], comments: [] };
  let aiPreview = null;
  let lastPresenceSent = 0;
  const performUndo = typeof undoDiagram === "function" ? undoDiagram : () => bus.emit("history:undo");
  const performRedo = typeof redoDiagram === "function" ? redoDiagram : () => bus.emit("history:redo");
  const editorValue = (input) => "value" in input ? input.value : input.textContent;

  const scheduleRender = () => {
    if (renderFrame !== null) return;
    renderFrame = requestAnimationFrame(() => {
      renderFrame = null;
      render();
    });
  };
  const clearSelectedTool = () => {
    state.selectedTool = { type: "select", kind: null, label: "" };
  };

  // Keep every help entry point on one state transition so click, keyboard, and outside dismissal stay in sync.
  function setShortcutHelpOpen(open) {
    shortcutHelpOpen = open;
    if (open) {
      searchOpen = false;
      printPreviewOpen = false;
      bus.emit("ui:menu-open", "help");
    }
    render();
  }

  const selectedIds = () => state.selectedElementIds ?? [];
  const currentTheme = () => document.documentElement.dataset.theme === "light" ? "light" : "dark";
  const themeDefaultNodeStyle = (kind) => ({
    ...defaultNodeStyle,
    ...themeNodeStyles[currentTheme()],
    textColor: lightTextKinds.has(kind) ? "#f4f7fb" : themeNodeStyles[currentTheme()].textColor
  });
  const nodeStyle = (node) => {
    const defaults = themeDefaultNodeStyle(node.kind);
    const custom = node.style ?? {};
    const style = { ...defaults, ...custom };
    return {
      ...style,
      borderColor: normalizeColor(custom.borderColor ?? custom.strokeColor, defaults.borderColor),
      fillColor: normalizeColor(custom.fillColor ?? custom.backgroundColor, defaults.fillColor),
      textColor: normalizeColor(custom.textColor ?? custom.fontColor, defaults.textColor)
    };
  };
  const relationshipStyle = (relationship) => {
    const custom = relationship.style ?? {};
    const style = { ...defaultRelationshipStyle, ...custom };
    return { ...style, color: normalizeColor(custom.color ?? custom.lineColor ?? custom.strokeColor, defaultRelationshipStyle.color) };
  };
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
  const renderNodeContent = createNodeRenderer({ getEditingNode: () => editingNode });
  function fitNodeToContent(node) {
    const editableSectionKeys = [...compartmentDefinitionsFor(node).map(({ key }) => key), "text", "templateParameter", "upperMultiplicity", "lowerMultiplicity"];
    const sections = editableSectionKeys.map((key) => {
      const value = node.properties?.[key] ?? [];
      return Array.isArray(value) ? value : String(value).split(/\r?\n/);
    }).filter((section) => section.length && section.some((line) => String(line).length));
    const lines = [node.name, ...sections.flat()].flatMap((line) => String(line ?? "").split(/\r?\n/));
    const fontSize = Number(nodeStyle(node).textSize) || 13;
    const characterWidth = Math.max(6, fontSize * 0.56);
    const lineHeight = Math.max(17, Math.ceil(fontSize * 1.4));
    const longestLine = Math.max(1, ...lines.map((line) => line.length));
    const textShape = ["text-label", "note", "comment", "rationale", "problem", "callout"].includes(node.kind);
    if (simpleShapeKinds.has(node.kind) && !textShape) return;
    const minimumWidth = textShape ? Math.max(MIN_NODE_WIDTH, 120) : 190;
    const width = clamp(Math.ceil(longestLine * characterWidth + 32), minimumWidth, 520);
    const charactersPerLine = Math.max(12, Math.floor((width - 32) / characterWidth));
    const wrappedLines = lines.reduce((total, line) => total + Math.max(1, Math.ceil(line.length / charactersPerLine)), 0);
    node.width = width;
    node.height = textShape
      ? clamp(32 + wrappedLines * lineHeight, Math.max(MIN_NODE_HEIGHT, 70), 760)
      : clamp(50 + wrappedLines * lineHeight + sections.length * 30, 170, 760);
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
      , "note-connector": { dashed: true }, link: {}, "communication-path": {}, "package-merge": { end: "open-arrow", dashed: true },
      extension: { end: "hollow-triangle" }, "control-flow": { end: "open-arrow" }, "object-flow": { end: "open-arrow" },
      transition: { end: "open-arrow" }, "synchronous-message": { end: "open-arrow" }, "asynchronous-message": { end: "open-arrow" },
      "return-message": { end: "open-arrow", dashed: true }, "numbered-message": { end: "open-arrow" }, include: { end: "open-arrow", dashed: true },
      extend: { end: "open-arrow", dashed: true }, "item-flow": { end: "open-arrow" }, "binding-connector": {},
      "derive-reqt": { end: "open-arrow", dashed: true }, satisfy: { end: "open-arrow", dashed: true }, verify: { end: "open-arrow", dashed: true },
      refine: { end: "open-arrow", dashed: true }, trace: { end: "open-arrow", dashed: true }
    };
    return decorations[type] ?? decorations.association;
  }

  function renderMarkerDefinitions() {
    return `<defs>
      <marker id="open-arrow" viewBox="0 0 12 12" markerWidth="12" markerHeight="12" refX="10" refY="6" orient="auto-start-reverse" markerUnits="userSpaceOnUse"><path class="marker-stroke" d="M2,1 L10,6 L2,11" fill="none" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"></path></marker>
      <marker id="hollow-triangle" viewBox="0 0 14 14" markerWidth="14" markerHeight="14" refX="12" refY="7" orient="auto-start-reverse" markerUnits="userSpaceOnUse"><path class="marker-stroke" d="M1.5,1.5 L12,7 L1.5,12.5 Z" fill="var(--canvas)" stroke-width="1.5" stroke-linejoin="round"></path></marker>
      <marker id="filled-diamond" viewBox="0 0 16 12" markerWidth="16" markerHeight="12" refX="1" refY="6" orient="auto-start-reverse" markerUnits="userSpaceOnUse"><path class="marker-stroke marker-fill" d="M1,6 L8,1 L15,6 L8,11 Z" stroke-linejoin="round"></path></marker>
      <marker id="hollow-diamond" viewBox="0 0 16 12" markerWidth="16" markerHeight="12" refX="1" refY="6" orient="auto-start-reverse" markerUnits="userSpaceOnUse"><path class="marker-stroke" d="M1,6 L8,1 L15,6 L8,11 Z" fill="var(--canvas)" stroke-width="1.5" stroke-linejoin="round"></path></marker>
      <marker id="containment" viewBox="0 0 17 17" markerWidth="17" markerHeight="17" refX="2" refY="8.5" orient="auto-start-reverse" markerUnits="userSpaceOnUse"><circle class="marker-stroke" cx="8.5" cy="8.5" r="6.5" fill="var(--canvas)"></circle><path class="marker-stroke" d="M5,8.5 H12 M8.5,5 V12" stroke-width="1.3"></path></marker>
    </defs>`;
  }

  function renderRelationships(diagram) {
    const earlierSegments = [];
    return `<svg class="relationship-layer" width="${CANVAS.width}" height="${CANVAS.height}" aria-label="Diagram relationships">${renderMarkerDefinitions()}
      ${(diagram.relationships ?? []).map((relationship) => {
        const source = diagram.elements.find((node) => node.id === relationship.source_id);
        const target = diagram.elements.find((node) => node.id === relationship.target_id);
        if (!source || !target) return "";
        const points = relationshipRoute(relationship, diagram.elements, { existingSegments: earlierSegments });
        const d = routeToJumpPath(points, earlierSegments); earlierSegments.push(...segments(points));
        const labelPoint = pointAlongRoute(points, relationship.labelPosition ?? 0.5);
        const decoration = relationshipDecoration(relationship.kind);
        const style = relationshipStyle(relationship);
        const selected = state.selectedRelationshipId === relationship.id;
        const relationshipSelector = runtimeStyles.escape(relationship.id);
        runtimeStyles.set(`relationship-${relationship.id}`, `.relationship-line[data-relationship="${relationshipSelector}"]`, {
          "--relationship-color": style.color,
          "--relationship-width": `${style.width}px`
        });
        const labels = [relationship.label || relationshipTypes.find(([type]) => type === relationship.kind)?.[1] || relationship.kind, relationship.roleLabel, relationship.multiplicity].filter(Boolean).join("  ");
        return `<path class="relationship-hit" data-rel="${relationship.id}" d="${d}"></path>
          <path class="relationship-line ${selected ? "selected" : ""}" data-relationship="${relationship.id}" d="${d}" stroke-dasharray="${decoration.dashed ? "7 6" : "0"}" ${decoration.start ? `marker-start="url(#${decoration.start})"` : ""} ${decoration.end ? `marker-end="url(#${decoration.end})"` : ""}></path>
          <text class="relationship-label ${selected ? "selected" : ""}" data-rel="${relationship.id}" x="${labelPoint.x}" y="${labelPoint.y - 9}">${escapeHtml(labels)}</text>
          ${selected ? [0, points.length - 1].filter((index, position, indexes) => indexes.indexOf(index) === position).map((index) => `<circle class="route-handle endpoint" data-route-handle="${relationship.id}" data-route-index="${index}" cx="${points[index].x}" cy="${points[index].y}" r="${7 / zoom}"></circle>`).join("") : ""}`;
      }).join("")}
      ${connectDrag ? `<path class="relationship-preview" d="${routeToPath([connectDrag.start, { x: connectDrag.x2, y: connectDrag.start.y }, { x: connectDrag.x2, y: connectDrag.y2 }])}" marker-end="url(#open-arrow)"></path>` : ""}
    </svg>`;
  }

  function renderAiGhosts(diagram) {
    const previewOperations = aiPreview?.operations ?? [];
    if (!previewOperations.length) return "";
    const ghostElements = previewOperations.flatMap((item) => {
      if (item.element) return [{ ...item.element, aiPreviewKind: "addition" }];
      const current = item.element_id ? diagram.elements.find((node) => node.id === item.element_id) : null;
      if (!current) return [];
      if (item.kind === "updateElement") return [{ ...current, ...item.changes, properties: { ...(current.properties ?? {}), ...(item.changes?.properties ?? {}) }, id: `preview_${current.id}`, aiPreviewKind: "update" }];
      if (item.kind === "removeElement") return [{ ...current, id: `preview_${current.id}`, aiPreviewKind: "removal" }];
      return [];
    });
    const ghostRelationships = previewOperations.flatMap((item) => {
      if (item.relationship) return [{ ...item.relationship, aiPreviewKind: "addition" }];
      if (item.relationship_id) {
        const current = diagram.relationships.find((relationship) => relationship.id === item.relationship_id);
        return current ? [{ ...current, aiPreviewKind: "removal" }] : [];
      }
      return [];
    });
    const allElements = [...diagram.elements, ...ghostElements];
    const lines = ghostRelationships.map((relationship) => {
      const source = allElements.find((item) => item.id === relationship.source_id);
      const target = allElements.find((item) => item.id === relationship.target_id);
      if (!source || !target) return "";
      const x1 = source.x + source.width / 2; const y1 = source.y + source.height / 2;
      const x2 = target.x + target.width / 2; const y2 = target.y + target.height / 2;
      return `<path class="ai-ghost-relationship ${relationship.aiPreviewKind === "removal" ? "removal" : ""}" d="M ${x1} ${y1} L ${x2} ${y2}" marker-end="url(#open-arrow)"></path><text class="ai-ghost-label ${relationship.aiPreviewKind === "removal" ? "removal" : ""}" x="${(x1 + x2) / 2}" y="${(y1 + y2) / 2 - 8}">${relationship.aiPreviewKind === "removal" ? "Remove: " : ""}${escapeHtml(relationship.label || relationship.kind)}</text>`;
    }).join("");
    const nodes = ghostElements.map((node) => {
      const style = nodeStyle(node);
      runtimeStyles.set(`ai-ghost-${node.id}`, `.ai-ghost-node[data-ai-ghost="${runtimeStyles.escape(node.id)}"]`, { left: `${node.x}px`, top: `${node.y}px`, width: `${node.width}px`, height: `${node.height}px`, "--node-fill": style.fillColor, "--node-border": style.borderColor, "--node-text-color": style.textColor });
      return `<div class="diagram-node ai-ghost-node ai-ghost-${node.aiPreviewKind} ${nodeKindClass(node.kind)}" data-ai-ghost="${node.id}" aria-label="Proposed ${escapeHtml(node.kind)} ${escapeHtml(node.name)}">${renderNodeContent(node)}${renderModelPorts(node)}<span class="ai-ghost-badge">${node.aiPreviewKind === "removal" ? "AI remove" : node.aiPreviewKind === "update" ? "AI update" : "AI addition"}</span></div>`;
    }).join("");
    return `<svg class="ai-ghost-relationship-layer" width="${CANVAS.width}" height="${CANVAS.height}" aria-hidden="true">${lines}</svg>${nodes}`;
  }

  function renderModelPorts(node) {
    return (node.properties?.ports ?? []).map((port, index) => {
      const side = port.side === "right" ? "right" : "left";
      runtimeStyles.set(`port-${node.id}-${port.id ?? index}`, `.model-port[data-model-port="${runtimeStyles.escape(`${node.id}:${port.id ?? index}`)}"]`, { left: `${Number(port.x ?? (side === "right" ? node.width : 0))}px`, top: `${Number(port.y ?? ((index + 1) * node.height) / ((node.properties?.ports?.length ?? 0) + 1))}px` });
      return `<span class="model-port model-port-${side}" data-model-port="${node.id}:${port.id ?? index}" title="${escapeHtml(port.name)} · ${escapeHtml(port.direction ?? "inout")}${port.type ? ` · ${escapeHtml(port.type)}` : ""}"><span>${escapeHtml(port.name)}</span></span>`;
    }).join("");
  }

  function toolbarPosition(diagram, surfaceWidth = 650, surfaceHeight = 48) {
    const bounds = selectionBounds(diagram.elements, selectedIds());
    if (!bounds) return null;
    const rect = element.getBoundingClientRect();
    const width = Math.min(surfaceWidth, Math.max(0, rect.width - 16));
    const height = Math.min(surfaceHeight, Math.max(0, rect.height - 16));
    return {
      x: clamp(rect.left + bounds.left * zoom - element.scrollLeft, rect.left + 8, rect.right - width - 8),
      y: clamp(rect.top + bounds.top * zoom - element.scrollTop - height, rect.top + 8, rect.bottom - height - 8)
    };
  }

  function positionFormattingToolbar() {
    const toolbar = element.querySelector(".format-toolbar");
    if (!toolbar || !state.diagram) return;
    // Measure the rendered toolbar; guessed widths caused clipping beside open sidebars.
    const position = toolbarPosition(state.diagram, toolbar.offsetWidth, toolbar.offsetHeight);
    if (!position) return;
    runtimeStyles.set("format-toolbar-position", ".format-toolbar", { left: `${position.x}px`, top: `${position.y}px` });
  }

  function positionPointerSurface(selector, preferred) {
    const surface = element.querySelector(selector);
    if (!surface || !preferred) return;
    const rect = element.getBoundingClientRect();
    const maximumX = Math.max(rect.left + 8, rect.right - surface.offsetWidth - 8);
    const maximumY = Math.max(rect.top + 8, rect.bottom - surface.offsetHeight - 8);
    runtimeStyles.set(`surface-${selector}`, selector, {
      left: `${clamp(preferred.x, rect.left + 8, maximumX)}px`,
      top: `${clamp(preferred.y, rect.top + 8, maximumY)}px`
    });
  }

  function positionFloatingSurfaces() {
    positionFormattingToolbar();
    positionPointerSurface(".relationship-toolbar", relationshipToolbar);
    positionPointerSurface(".canvas-context-menu", contextMenu);
    positionShortcutHelp();
  }

  function positionShortcutHelp() {
    const trigger = element.querySelector("#keyboard-help");
    const menu = element.querySelector(".shortcut-overlay");
    if (!trigger || !menu) return;
    const hostRect = element.getBoundingClientRect();
    const triggerRect = trigger.getBoundingClientRect();
    // Anchor the menu to the trigger while keeping the complete panel inside the canvas viewport.
    const maximumLeft = Math.max(hostRect.left + 8, hostRect.right - menu.offsetWidth - 8);
    const maximumTop = Math.max(hostRect.top + 8, hostRect.bottom - menu.offsetHeight - 8);
    runtimeStyles.set("shortcut-position", ".shortcut-overlay", {
      "--canvas-available-width": `${hostRect.width}px`,
      left: `${clamp(triggerRect.right - menu.offsetWidth, hostRect.left + 8, maximumLeft)}px`,
      top: `${clamp(triggerRect.bottom + 6, hostRect.top + 8, maximumTop)}px`
    });
  }

  function renderFormattingToolbar(diagram) {
    if (!selectedIds().length) return "";
    const selected = diagram.elements.filter((node) => selectedIds().includes(node.id));
    if (!selected.length) return "";
    const style = nodeStyle(selected[0]);
    return `<div class="format-toolbar" aria-label="${selected.length > 1 ? "Selection" : "Element"} formatting toolbar">
      ${selected.length > 1 ? `<span class="selection-count" title="Formatting changes apply to every selected element">${selected.length} selected · apply to all</span>` : ""}
      <div class="format-toolbar-row color-toolbar-row">
        <span class="format-field" title="Border color">Border ${renderColorControl({ value: style.borderColor, label: "Border color", styleProperty: "borderColor" })}</span>
        <span class="format-field" title="Fill and background color">Fill ${renderColorControl({ value: style.fillColor, label: "Fill color", styleProperty: "fillColor" })}</span>
        <span class="format-field" title="Text color">Text ${renderColorControl({ value: style.textColor, label: "Text color", styleProperty: "textColor" })}</span>
      </div>
      <div class="format-toolbar-row style-toolbar-row">
        <label title="Border thickness">Line <select data-style="borderWidth">${[1, 2, 3, 4].map((width) => `<option value="${width}" ${style.borderWidth === width ? "selected" : ""}>${width}px</option>`).join("")}</select></label>
        <label title="Text size">Size <select data-style="textSize">${[10, 11, 12, 13, 14, 16, 18, 20, 24, 28, 32].map((size) => `<option value="${size}" ${style.textSize === size ? "selected" : ""}>${size}px</option>`).join("")}</select></label>
        <label title="Text style">Style <select data-style="textStyle">
        <option value="normal" ${style.textStyle === "normal" ? "selected" : ""}>Normal</option>
        <option value="bold" ${style.textStyle === "bold" ? "selected" : ""}>Bold</option>
        <option value="italic" ${style.textStyle === "italic" ? "selected" : ""}>Italic</option>
        <option value="bold-italic" ${style.textStyle === "bold-italic" ? "selected" : ""}>Bold italic</option>
        </select></label>
      </div>
    </div>`;
  }

  function renderRelationshipToolbar() {
    if (!relationshipToolbar || !state.selectedRelationshipId) return "";
    const relationship = state.diagram.relationships.find((item) => item.id === state.selectedRelationshipId);
    if (!relationship) return "";
    const style = relationshipStyle(relationship);
    return `<div class="relationship-toolbar" aria-label="Connection formatting toolbar">
      <select data-relationship-style="kind" title="Relation type">${relationshipTypes.map(([type, label]) => `<option value="${type}" ${relationship.kind === type ? "selected" : ""}>${label}</option>`).join("")}</select>
      <label title="Line thickness">Line <select data-relationship-style="width">${[1, 2, 3, 4, 5].map((width) => `<option value="${width}" ${style.width === width ? "selected" : ""}>${width}px</option>`).join("")}</select></label>
      <span class="format-field" title="Line and arrow color">Color ${renderColorControl({ value: style.color, label: "Line and arrow color", relationshipProperty: "color" })}</span>
      <input data-relationship-text="label" value="${escapeHtml(relationship.label ?? "")}" placeholder="Label" title="Connector label">
      <input data-relationship-text="roleLabel" value="${escapeHtml(relationship.roleLabel ?? "")}" placeholder="Role" title="Role label">
      <input data-relationship-text="multiplicity" value="${escapeHtml(relationship.multiplicity ?? "")}" placeholder="0..*" title="Multiplicity">
      <button data-relationship-command="reroute" title="Discard waypoints and route around obstacles">Reroute</button>
      <button data-relationship-command="delete" class="danger" title="Delete connection">Delete</button>
    </div>`;
  }

  function renderContextMenu() {
    if (!contextMenu || !selectedIds().length) return "";
    const selected = state.diagram.elements.filter((node) => selectedIds().includes(node.id));
    const allLocked = selected.every((node) => node.locked);
    const selectedGroups = new Set(selected.filter((node) => node.groupId).map((node) => node.groupId));
    const completeSingleGroup = selectedGroups.size === 1 && selected.every((node) => node.groupId === [...selectedGroups][0]);
    return `<div class="canvas-context-menu" role="menu">
      <button data-command="delete" class="context-danger" role="menuitem">Delete <kbd>Del</kbd></button>
      <span class="context-separator" role="separator"></span>
      <button data-command="cut" role="menuitem">Cut <kbd>Ctrl+X</kbd></button><button data-command="copy" role="menuitem">Copy <kbd>Ctrl+C</kbd></button><button data-command="duplicate" role="menuitem">Duplicate <kbd>Ctrl+D</kbd></button>
      <button data-command="comment" role="menuitem">Comment on selection</button>
      <span class="context-separator"></span>
      ${selected.length > 1 && !completeSingleGroup ? `<button data-command="group" role="menuitem">Group <kbd>Ctrl+G</kbd></button>` : ""}
      ${selectedGroups.size ? `<button data-command="ungroup" role="menuitem">Ungroup <kbd>⇧Ctrl+G</kbd></button>` : ""}
      <button data-command="lock" role="menuitem">${allLocked ? "Unlock" : "Lock"}</button>
      <button data-command="forward" role="menuitem">Bring Forward</button><button data-command="backward" role="menuitem">Bring Backward</button>
    </div>`;
  }

  function renderCollaborationOverlay(diagram) {
    const nodeMap = new Map((diagram.elements ?? []).map((node) => [node.id, node]));
    let selectionIndex = 0;
    const selections = (collaboration.presence ?? []).flatMap((person) => (person.selection ?? []).map((nodeId) => {
      const node = nodeMap.get(nodeId);
      if (!node) return "";
      const index = selectionIndex++;
      runtimeStyles.set(`remote-selection-${index}`, `[data-remote-selection="${index}"]`, { left: `${node.x - 5}px`, top: `${node.y - 5}px`, width: `${node.width + 10}px`, height: `${node.height + 10}px`, "--collab-color": normalizeColor(person.color, "#5aa7ff") });
      return `<div class="remote-selection" data-remote-selection="${index}" title="${escapeHtml(person.name)} selected ${escapeHtml(node.name)}"><span>${escapeHtml(person.name)}</span></div>`;
    }));
    const cursors = (collaboration.presence ?? []).map((person, index) => {
      if (!person.cursor) return "";
      runtimeStyles.set(`live-cursor-${index}`, `[data-live-cursor="${index}"]`, { left: `${person.cursor.x}px`, top: `${person.cursor.y}px`, "--collab-color": normalizeColor(person.color, "#5aa7ff") });
      return `<div class="live-cursor" data-live-cursor="${index}"><span></span><strong>${escapeHtml(person.name)}</strong></div>`;
    });
    const comments = (collaboration.comments ?? []).map((comment, index) => {
      const node = nodeMap.get(comment.anchor_id);
      if (!node) return "";
      runtimeStyles.set(`comment-pin-${index}`, `[data-comment-pin="${index}"]`, { left: `${node.x + node.width - 8}px`, top: `${node.y - 8}px` });
      return `<button class="comment-pin" data-comment-pin="${index}" data-focus-node="${comment.anchor_id}" title="${escapeHtml(comment.author)}: ${escapeHtml(comment.body)}">${(collaboration.comments ?? []).filter((item) => item.anchor_id === comment.anchor_id).length}</button>`;
    });
    return `${selections.join("")}${cursors.join("")}${comments.join("")}`;
  }

  function pageFrame() {
    return pageSizes[defaultPageSize];
  }

  function diagramBounds(diagram, ids = []) {
    const candidates = ids.length ? ids : diagram.elements.map((node) => node.id);
    return selectionBounds(diagram.elements, candidates) ?? { left: 0, top: 0, right: pageFrame().width, bottom: pageFrame().height };
  }

  function renderGuides() {
    if (!snapGuides.length) return "";
    return snapGuides.map((guide, index) => {
      runtimeStyles.set(`smart-guide-${index}`, `[data-smart-guide="${index}"]`, guide.axis === "x" ? { left: `${guide.value}px` } : { top: `${guide.value}px` });
      return `<div class="smart-guide ${guide.axis === "x" ? "vertical" : "horizontal"}" data-smart-guide="${index}"></div>`;
    }).join("");
  }

  function renderMinimap(diagram, hostRect) {
    const scale = 160 / CANVAS.width;
    const view = minimapViewport({ canvas: CANVAS, viewport: { width: element.clientWidth, height: element.clientHeight }, minimap: { width: CANVAS.width * scale, height: CANVAS.height * scale }, scroll: { left: element.scrollLeft, top: element.scrollTop }, zoom });
    runtimeStyles.set("minimap-position", ".canvas-minimap", { right: `${Math.max(12, window.innerWidth - hostRect.right + 18)}px`, bottom: `${Math.max(12, window.innerHeight - hostRect.bottom + 18)}px` });
    runtimeStyles.set("minimap-plane", "[data-minimap-plane]", { width: `${CANVAS.width * scale}px`, height: `${CANVAS.height * scale}px` });
    runtimeStyles.set("minimap-viewport", "[data-minimap-viewport]", { left: `${view.left}px`, top: `${view.top}px`, width: `${view.width}px`, height: `${view.height}px` });
    return `<div class="canvas-minimap" title="Drag to navigate the diagram">
      <div class="minimap-plane" data-minimap-plane role="application" aria-label="Diagram minimap. Drag or use arrow keys to navigate." tabindex="0">
        ${diagram.elements.map((node, index) => {
          runtimeStyles.set(`minimap-node-${index}`, `[data-minimap-node="${index}"]`, { left: `${node.x * scale}px`, top: `${node.y * scale}px`, width: `${Math.max(2, node.width * scale)}px`, height: `${Math.max(2, node.height * scale)}px` });
          return `<span class="minimap-node" data-minimap-node="${index}"></span>`;
        }).join("")}
        <span class="minimap-viewport" data-minimap-viewport></span>
      </div>
    </div>`;
  }

  function renderSearchOverlay(diagram, hostRect) {
    if (!searchOpen) return "";
    const query = searchQuery.trim().toLowerCase();
    const results = query ? diagram.elements.filter((node) => `${node.name} ${node.kind}`.toLowerCase().includes(query)).slice(0, 20) : [];
    runtimeStyles.set("search-overlay", ".search-overlay", { left: `${hostRect.left + hostRect.width / 2}px`, "--canvas-available-width": `${hostRect.width}px` });
    return `<div class="canvas-overlay search-overlay">
      <input id="diagram-search" value="${escapeHtml(searchQuery)}" placeholder="Search elements" aria-label="Search elements">
      <div class="overlay-results">${results.map((node) => `<button data-focus-node="${node.id}"><strong>${escapeHtml(node.name)}</strong><span>${escapeHtml(node.kind)}</span></button>`).join("") || `<span class="overlay-empty">${query ? "No matches" : "Type to search"}</span>`}</div>
    </div>`;
  }

  function renderShortcutHelp() {
    if (!shortcutHelpOpen) return "";
    return `<div id="keyboard-help-menu" class="canvas-overlay shortcut-overlay"><div class="overlay-title">Keyboard shortcuts</div>
      <div class="shortcut-grid">${shortcutRows.map(([keys, label]) => `<kbd>${escapeHtml(keys)}</kbd><span>${escapeHtml(label)}</span>`).join("")}</div>
    </div>`;
  }

  function renderPrintPreview(diagram) {
    if (!printPreviewOpen) return "";
    const page = pageFrame();
    runtimeStyles.set("print-sheet", ".print-sheet", { "aspect-ratio": `${page.width}/${page.height}` });
    return `<div class="print-preview-backdrop"><div class="print-preview">
      <div class="print-preview-header"><strong>Print preview</strong><button data-command="close-print">Close</button></div>
      <div class="print-sheet"><span>${escapeHtml(page.label)} · ${page.width} × ${page.height}</span></div>
      <button data-command="print-diagram" class="primary">Print</button>
    </div></div>`;
  }

  function render() {
    if (renderFrame !== null) {
      cancelAnimationFrame(renderFrame);
      renderFrame = null;
    }
    // Replacing the toolbar while a browser color dialog is open dismisses it
    // immediately in Chrome and Firefox. Model changes still happen below via
    // direct input listeners; defer the full canvas render until picking ends.
    if (activeNativeColorInput?.isConnected) return;
    // Collaboration, presence, resize, and theme notifications can arrive while
    // the user is typing. Replacing the canvas DOM here would discard the
    // textarea, move the caret, and make typing feel delayed. Those visual
    // updates are safely picked up by the commit render on blur.
    if (editingNode && element.querySelector("[data-node-editor]")) return;
    const diagram = state.diagram;
    if (!diagram) return;
    runtimeStyles.clear();
    gridSize = diagram.metadata?.gridSize ?? diagram.metadata?.grid ?? gridSize;
    showGrid = diagram.metadata?.showGrid ?? showGrid;
    const scroll = { left: element.scrollLeft, top: element.scrollTop };
    const hostRect = element.getBoundingClientRect();
    const previewTop = paletteHover ? clamp(paletteHover.clientY - 100, hostRect.top + 68, hostRect.bottom - 224) : 0;
    runtimeStyles.set("canvas-content", ".canvas-content", { width: `${CANVAS.width * zoom}px`, height: `${CANVAS.height * zoom}px`, "--grid-size": `${Math.max(1, gridSize)}px` });
    runtimeStyles.set("canvas-plane", "#canvas-plane", { width: `${CANVAS.width}px`, height: `${CANVAS.height}px`, transform: `scale(${zoom})` });
    runtimeStyles.set("relationship-hit-width", ".relationship-hit", { "stroke-width": `${18 / zoom}px` });
    runtimeStyles.set("route-handle-width", ".route-handle", { "stroke-width": `${2 / zoom}px` });
    if (paletteHover) runtimeStyles.set("palette-preview", ".palette-canvas-preview", { left: `${hostRect.left + 14}px`, top: `${previewTop}px` });
    if (pointerDrag) runtimeStyles.set("drag-ghost", ".canvas-drag-ghost", { left: `${pointerDrag.clientX + 16}px`, top: `${pointerDrag.clientY + 16}px` });
    const selectionBox = selectedIds().length > 1 ? selectionFrame ?? selectionBounds(diagram.elements, selectedIds()) : null;
    if (selectionBox) runtimeStyles.set("selection-box", "[data-selection-area]", { left: `${selectionBox.left}px`, top: `${selectionBox.top}px`, width: `${selectionBox.right - selectionBox.left}px`, height: `${selectionBox.bottom - selectionBox.top}px` });
    if (gesture?.type === "marquee") runtimeStyles.set("selection-marquee", ".selection-marquee", { left: `${gesture.rect.left}px`, top: `${gesture.rect.top}px`, width: `${gesture.rect.right - gesture.rect.left}px`, height: `${gesture.rect.bottom - gesture.rect.top}px` });
    // Live geometry is written to the scoped stylesheet, keeping generated markup free of inline presentation.
    element.innerHTML = `<div class="canvas-chrome"><div class="canvas-toolbar">
      <button id="history-undo" title="Undo last change" aria-label="Undo last change" ${state.history.length ? "" : "disabled"}>↶</button><button id="history-redo" title="Redo last change" aria-label="Redo last change" ${state.future.length ? "" : "disabled"}>↷</button>
      <span class="toolbar-separator"></span><button id="zoom-out" title="Zoom out" aria-label="Zoom out" ${zoom <= ZOOM.minimum ? "disabled" : ""}>−</button><button id="zoom-reset" title="Reset zoom" aria-label="Reset zoom to 100%" class="zoom-level ${zoom === 1 ? "active" : ""}" ${zoom === 1 ? "disabled" : ""}>${Math.round(zoom * 100)}%</button><button id="zoom-in" title="Zoom in" aria-label="Zoom in" ${zoom >= ZOOM.maximum ? "disabled" : ""}>+</button>
      <button id="fit-diagram" title="Fit diagram" aria-label="Fit diagram in canvas">Fit</button><button id="fit-selection" title="Fit selection" aria-label="Fit selected elements in canvas" ${selectedIds().length ? "" : "disabled"}>Fit sel</button>
      <button id="select-all" class="${diagram.elements.length > 0 && selectedIds().length === diagram.elements.length ? "active" : ""}" title="Select all elements" aria-label="Select all elements" aria-pressed="${diagram.elements.length > 0 && selectedIds().length === diagram.elements.length}" ${diagram.elements.length ? "" : "disabled"}>Select all</button>
      <select id="grid-size" title="Grid size" aria-label="Canvas grid size">${[0, 10, 20, 40, 80].map((size) => `<option value="${size}" ${gridSize === size ? "selected" : ""}>${size ? `${size}px grid` : "Grid off"}</option>`).join("")}</select>
      <button id="keyboard-help" class="${shortcutHelpOpen ? "active" : ""}" title="Keyboard shortcuts" aria-label="Keyboard shortcuts" aria-controls="keyboard-help-menu" aria-expanded="${shortcutHelpOpen}" aria-pressed="${shortcutHelpOpen}">?</button>
    </div>${paletteHover ? `<div class="palette-canvas-preview" aria-live="polite"><div class="palette-preview-name">${escapeHtml(paletteHover.label)}</div><div class="palette-preview-symbol">${paletteHover.preview}</div></div>` : ""}
      ${pointerDrag ? `<div class="canvas-drag-ghost"><span>${pointerDrag.preview}</span><strong>${escapeHtml(pointerDrag.label)}</strong></div>` : ""}</div>
    <div class="canvas-content ${showGrid && gridSize ? "" : "grid-hidden"}">
      <div id="canvas-plane">
        ${renderRelationships(diagram)}
        ${renderAiGhosts(diagram)}
        ${renderGuides()}
        ${renderCollaborationOverlay(diagram)}
        ${selectionBox ? `<div class="group-selection-box" data-selection-area title="Drag anywhere to move selection"><span class="selection-frame-label">${selectedIds().length} selected</span></div>` : ""}
        ${diagram.elements.map((node) => {
          const selected = selectedIds().includes(node.id); const style = nodeStyle(node);
          runtimeStyles.set(`node-${node.id}`, `.diagram-node[data-node="${runtimeStyles.escape(node.id)}"]`, { left: `${node.x}px`, top: `${node.y}px`, width: `${node.width}px`, height: `${node.height}px`, "--node-fill": style.fillColor, "--node-border": style.borderColor, "--node-border-width": `${style.borderWidth}px`, "--node-text-color": style.textColor, "--node-text-size": `${style.textSize}px`, "--node-font-weight": style.textStyle.includes("bold") ? 700 : 400, "--node-font-style": style.textStyle.includes("italic") ? "italic" : "normal" });
          return `<div class="diagram-node ${nodeKindClass(node.kind)} ${selected ? "selected" : ""} ${node.locked ? "locked" : ""} ${node.groupId ? "grouped" : ""}" data-node="${node.id}" title="Double-click to edit text">
            ${renderNodeContent(node)}${renderModelPorts(node)}
            ${selected ? ["top", "right", "bottom", "left"].map((side) => `<span class="connector-handle connector-${side}" data-handle="${node.id}" data-side="${side}" title="Connect from ${side} side"></span>`).join("") : ""}
            ${selected && selectedIds().length === 1 && !node.locked ? `<span class="resize-handle" data-resize="${node.id}" title="Resize element"></span>` : ""}
          </div>`;
        }).join("")}
        ${gesture?.type === "marquee" ? `<div class="selection-marquee"></div>` : ""}
      </div>
    </div>${renderMinimap(diagram, hostRect)}${renderFormattingToolbar(diagram)}${renderRelationshipToolbar()}${renderContextMenu()}${renderSearchOverlay(diagram, hostRect)}${renderShortcutHelp()}${renderPrintPreview(diagram)}`;
    element.scrollLeft = scroll.left; element.scrollTop = scroll.top;
    runtimeStyles.commit();
    bindRenderedEvents();
    positionFloatingSurfaces();
    syncMinimapViewport();
    runtimeStyles.commit();
  }

  function setZoom(nextZoom, clientX, clientY) {
    const rect = element.getBoundingClientRect();
    const focusX = clientX ?? rect.left + element.clientWidth / 2;
    const focusY = clientY ?? rect.top + element.clientHeight / 2;
    const canvasX = (focusX - rect.left + element.scrollLeft) / zoom;
    const canvasY = (focusY - rect.top + element.scrollTop) / zoom;
    const clampedZoom = clamp(nextZoom, ZOOM.minimum, ZOOM.maximum);
    if (Math.abs(clampedZoom - zoom) < 0.0001) return;
    zoom = clampedZoom;
    state.canvasViewport = { ...(state.canvasViewport ?? {}), zoom };
    runtimeStyles.set("canvas-content", ".canvas-content", { width: `${CANVAS.width * zoom}px`, height: `${CANVAS.height * zoom}px`, "--grid-size": `${Math.max(1, gridSize)}px` });
    runtimeStyles.set("canvas-plane", "#canvas-plane", { width: `${CANVAS.width}px`, height: `${CANVAS.height}px`, transform: `scale(${zoom})` });
    runtimeStyles.set("relationship-hit-width", ".relationship-hit", { "stroke-width": `${18 / zoom}px` });
    runtimeStyles.set("route-handle-width", ".route-handle", { "stroke-width": `${2 / zoom}px` });
    element.scrollLeft = canvasX * zoom - (focusX - rect.left);
    element.scrollTop = canvasY * zoom - (focusY - rect.top);
    state.canvasViewport = { zoom, scrollLeft: element.scrollLeft, scrollTop: element.scrollTop };
    const zoomReset = element.querySelector("#zoom-reset");
    if (zoomReset) { zoomReset.textContent = `${Math.round(zoom * 100)}%`; zoomReset.disabled = Math.abs(zoom - 1) < 0.0001; zoomReset.classList.toggle("active", zoomReset.disabled); }
    const zoomOut = element.querySelector("#zoom-out");
    const zoomIn = element.querySelector("#zoom-in");
    if (zoomOut) zoomOut.disabled = zoom <= ZOOM.minimum;
    if (zoomIn) zoomIn.disabled = zoom >= ZOOM.maximum;
    element.querySelectorAll(".route-handle").forEach((handle) => handle.setAttribute("r", String(7 / zoom)));
    positionFormattingToolbar();
    syncMinimapViewport();
    runtimeStyles.commit();
    scheduleRender();
  }

  function syncMinimapViewport() {
    const plane = element.querySelector("[data-minimap-plane]");
    const viewport = element.querySelector("[data-minimap-viewport]");
    if (!plane || !viewport) return;
    const view = minimapViewport({ canvas: CANVAS, viewport: { width: element.clientWidth, height: element.clientHeight }, minimap: { width: plane.clientWidth, height: plane.clientHeight }, scroll: { left: element.scrollLeft, top: element.scrollTop }, zoom });
    runtimeStyles.set("minimap-viewport", "[data-minimap-viewport]", { width: `${view.width}px`, height: `${view.height}px`, left: `${view.left}px`, top: `${view.top}px` });
  }

  function moveCanvasFromMinimap(event) {
    const plane = element.querySelector("[data-minimap-plane]");
    if (!plane || !minimapDrag) return;
    const rect = plane.getBoundingClientRect();
    const viewport = plane.querySelector("[data-minimap-viewport]");
    const scroll = canvasScrollFromMinimap({ canvas: CANVAS, minimap: { width: rect.width, height: rect.height }, viewport: { width: viewport.offsetWidth, height: viewport.offsetHeight }, position: { left: event.clientX - rect.left - minimapDrag.offsetX, top: event.clientY - rect.top - minimapDrag.offsetY }, zoom });
    element.scrollLeft = scroll.left;
    element.scrollTop = scroll.top;
  }

  function stopMinimapDrag(event) {
    if (!minimapDrag || event.pointerId !== minimapDrag.pointerId) return;
    const minimap = element.querySelector("[data-minimap-plane]");
    try {
      if (minimap?.hasPointerCapture?.(event.pointerId)) minimap.releasePointerCapture(event.pointerId);
    } catch { /* Pointer capture may already be gone after a Safari gesture cancellation. */ }
    minimap?.classList.remove("dragging");
    minimapDrag = null;
  }

  function bindRenderedEvents() {
    element.querySelector("#history-undo").addEventListener("click", (event) => { event.stopPropagation(); performUndo(); });
    element.querySelector("#history-redo").addEventListener("click", (event) => { event.stopPropagation(); performRedo(); });
    element.querySelector("#zoom-in").addEventListener("click", () => setZoom(Math.round((zoom + 0.1) * 10) / 10));
    element.querySelector("#zoom-out").addEventListener("click", () => setZoom(Math.round((zoom - 0.1) * 10) / 10));
    element.querySelector("#zoom-reset").addEventListener("click", () => setZoom(1));
    element.querySelector("#fit-diagram").addEventListener("click", () => fitToBounds(diagramBounds(state.diagram)));
    element.querySelector("#fit-selection").addEventListener("click", () => fitToBounds(diagramBounds(state.diagram, selectedIds())));
    element.querySelector("#select-all").addEventListener("click", () => setSelection(state.diagram.elements.map((node) => node.id)));
    element.querySelector("#keyboard-help").addEventListener("click", () => setShortcutHelpOpen(!shortcutHelpOpen));
    element.querySelector("#grid-size").addEventListener("change", (event) => setCanvasMetadata({ gridSize: Number(event.target.value), showGrid: Number(event.target.value) > 0 }));
    const searchInput = element.querySelector("#diagram-search");
    const minimap = element.querySelector("[data-minimap-plane]");
    minimap?.addEventListener("pointerdown", (event) => {
      if (event.button !== 0) return;
      event.preventDefault(); event.stopPropagation();
      const viewport = minimap.querySelector("[data-minimap-viewport]");
      const viewportRect = viewport.getBoundingClientRect();
      const grabbedViewport = event.target.closest("[data-minimap-viewport]");
      minimapDrag = { pointerId: event.pointerId, offsetX: grabbedViewport ? event.clientX - viewportRect.left : viewportRect.width / 2, offsetY: grabbedViewport ? event.clientY - viewportRect.top : viewportRect.height / 2 };
      try { minimap.setPointerCapture?.(event.pointerId); } catch { /* Window handlers below keep the minimap usable without capture. */ }
      minimap.classList.add("dragging");
      moveCanvasFromMinimap(event);
    });
    minimap?.addEventListener("keydown", (event) => {
      const step = event.shiftKey ? 240 : 60;
      const delta = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] }[event.key];
      if (!delta) return;
      event.preventDefault(); element.scrollBy({ left: delta[0], top: delta[1] }); syncMinimapViewport();
    });
    searchInput?.addEventListener("input", (event) => { searchQuery = event.target.value; render(); });
    searchInput?.addEventListener("keydown", (event) => { if (event.key === "Escape") { searchOpen = false; render(); } });
    if (searchInput) requestAnimationFrame(() => { searchInput.focus(); searchInput.setSelectionRange(searchInput.value.length, searchInput.value.length); });
    element.querySelectorAll("[data-focus-node]").forEach((button) => button.addEventListener("click", () => focusNode(button.dataset.focusNode)));
    element.querySelectorAll("[data-compartment-toggle]").forEach((button) => button.addEventListener("click", (event) => {
      event.preventDefault(); event.stopPropagation(); toggleCompartment(button.dataset.compartmentToggle, button.dataset.compartmentKey);
    }));
    element.querySelectorAll("[data-rel]").forEach((target) => {
      target.addEventListener("pointerdown", (event) => { event.stopPropagation(); contextMenu = null; setSelection([], target.dataset.rel); });
      target.addEventListener("contextmenu", (event) => openRelationshipToolbar(event, target.dataset.rel));
    });
    element.querySelectorAll("[data-handle]").forEach((handle) => handle.addEventListener("pointerdown", (event) => {
      event.preventDefault(); event.stopPropagation();
      const source = state.diagram.elements.find((node) => node.id === handle.dataset.handle);
      const sourceAnchor = { side: handle.dataset.side, offset: 0.5 }; const start = anchorPoint(source, sourceAnchor);
      const selectedTool = state.selectedTool?.type === "relationship" ? state.selectedTool : null;
      connectDrag = { sourceId: source.id, sourceAnchor, kind: selectedTool?.kind ?? "directional-association", label: selectedTool?.label ?? "", start, x2: start.x, y2: start.y };
      gesture = null; contextMenu = null; relationshipToolbar = null; setSelection([source.id]);
    }));
    element.querySelectorAll("[data-route-handle]").forEach((handle) => handle.addEventListener("pointerdown", (event) => {
      event.preventDefault(); event.stopPropagation();
      const relationship = state.diagram.relationships.find((item) => item.id === handle.dataset.routeHandle);
      const points = relationshipRoute(relationship, state.diagram.elements);
      gesture = { type: "route", relationshipId: relationship.id, index: Number(handle.dataset.routeIndex), points, start: pointOnCanvas(event), diagramBefore: structuredClone(state.diagram), changed: false };
    }));
    element.querySelectorAll("[data-resize]").forEach((handle) => handle.addEventListener("pointerdown", (event) => {
      event.preventDefault(); event.stopPropagation();
      const node = state.diagram.elements.find((item) => item.id === handle.dataset.resize);
      gesture = { type: "resize", id: node.id, start: pointOnCanvas(event), original: structuredClone(node), diagramBefore: structuredClone(state.diagram), changed: false };
    }));
    element.querySelectorAll("[data-node]").forEach((nodeElement) => {
      nodeElement.addEventListener("pointerdown", (event) => {
        if (event.target.closest(".node-inline-editor")) return;
        if (editingNode) {
          // Node pointer handlers stop propagation, so the canvas-level editor
          // commit handler never sees a click on another element. Commit here
          // and explicitly complete the navigation in the newly rendered DOM.
          event.preventDefault();
          event.stopPropagation();
          const targetNodeId = nodeElement.dataset.node;
          const editor = element.querySelector("[data-node-editor]");
          if (editor) commitNodeEditing(editor.dataset.nodeEditor, editor.dataset.nodeSection, editorValue(editor));
          gesture = null;
          snapGuides = [];
          setSelection([targetNodeId]);
          return;
        }
        const pressedAt = performance.now();
        const repeatedPress = event.button === 0 && lastNodePress?.nodeId === nodeElement.dataset.node && pressedAt - lastNodePress.at < 500;
        lastNodePress = repeatedPress ? null : { nodeId: nodeElement.dataset.node, at: pressedAt };
        if (event.button === 0 && (event.detail >= 2 || repeatedPress)) {
          beginNodeEditing(event, nodeElement.dataset.node, event.target.closest("[data-edit-section]")?.dataset.editSection);
          return;
        }
        startNodeGesture(event, nodeElement.dataset.node);
      });
      nodeElement.addEventListener("dblclick", (event) => beginNodeEditing(event, nodeElement.dataset.node, event.target.closest("[data-edit-section]")?.dataset.editSection));
      nodeElement.addEventListener("click", (event) => {
        const section = event.target.closest("[data-edit-section]")?.dataset.editSection;
        if (section && !event.shiftKey && !nodeElement.classList.contains("locked")) beginNodeEditing(event, nodeElement.dataset.node, section);
      });
      nodeElement.addEventListener("contextmenu", (event) => openContextMenu(event, nodeElement.dataset.node));
    });
    element.querySelectorAll("[data-node-editor]").forEach((input) => {
      input.addEventListener("pointerdown", (event) => event.stopPropagation());
      input.addEventListener("paste", (event) => {
        if (!input.isContentEditable) return;
        // contenteditable="plaintext-only" is inconsistent across browser versions, so sanitize legacy editors ourselves.
        event.preventDefault();
        insertPlainText(input, event.clipboardData?.getData("text/plain") ?? "");
      });
      input.addEventListener("input", () => scheduleNodeEditingDraft(input));
      input.addEventListener("keydown", (event) => {
        const editingName = input.dataset.nodeSection === "name";
        if (event.key === "Enter" && ((editingName && !event.shiftKey) || (!editingName && (event.ctrlKey || event.metaKey)))) { event.preventDefault(); input.blur(); }
        if (event.key === "Escape") {
          event.preventDefault();
          const before = editingNode?.diagramBefore;
          editingNode = null;
          if (editingTimer !== null) clearTimeout(editingTimer);
          editingTimer = null;
          if (before) setDiagram(before, false);
          else render();
        }
      });
      input.addEventListener("blur", () => commitNodeEditing(input.dataset.nodeEditor, input.dataset.nodeSection, editorValue(input)), { once: true });
      requestAnimationFrame(() => {
        input.focus();
        input.style.height = "auto";
        input.style.height = `${Math.max(input.scrollHeight, 24)}px`;
        placeCaretAtPoint(input, editingNode?.clientX ?? 0, editingNode?.clientY ?? 0);
      });
    });
    element.querySelector("[data-selection-area]")?.addEventListener("pointerdown", startSelectionGesture);
    element.querySelectorAll("[data-style-button]").forEach((button) => button.addEventListener("click", () => {
      const selected = state.diagram.elements.filter((node) => selectedIds().includes(node.id));
      const allBold = selected.length > 0 && selected.every((node) => nodeStyle(node).textStyle === "bold");
      applyStyle("textStyle", allBold ? "normal" : "bold");
    }));
    element.querySelectorAll("input[type='color'][data-color-input]").forEach((input) => {
      // Keep these listeners on the input itself as well as the delegated host.
      // A pending inline-editor blur can replace the toolbar while the native
      // Chrome/Firefox picker is open, leaving its eventual change event detached.
      input.addEventListener("input", () => previewColor(input));
      input.addEventListener("change", () => { previewColor(input); commitColor(input); });
    });
    element.querySelector("[data-relationship-command='delete']")?.addEventListener("click", deleteSelectedRelationship);
    element.querySelector("[data-relationship-command='reroute']")?.addEventListener("click", () => mutate((next) => {
      const relationship = next.relationships.find((item) => item.id === state.selectedRelationshipId); if (relationship) delete relationship.waypoints;
    }));
    element.querySelectorAll("[data-relationship-text]").forEach((input) => input.addEventListener("change", () => mutate((next) => {
      const relationship = next.relationships.find((item) => item.id === state.selectedRelationshipId); if (relationship) relationship[input.dataset.relationshipText] = input.value.trim();
    })));
    element.querySelectorAll("[data-command]").forEach((button) => button.addEventListener("click", () => executeCommand(button.dataset.command)));
  }

  function setCanvasMetadata(changes) {
    mutate((next) => { next.metadata = { ...(next.metadata ?? {}), ...changes }; });
  }

  function focusNode(nodeId) {
    const node = state.diagram.elements.find((item) => item.id === nodeId);
    if (!node) return;
    searchOpen = false; shortcutHelpOpen = false;
    setSelection([node.id]);
    element.scrollTo({ left: Math.max(0, (node.x + node.width / 2) * zoom - element.clientWidth / 2), top: Math.max(0, (node.y + node.height / 2) * zoom - element.clientHeight / 2), behavior: "smooth" });
  }

  function fitToBounds(bounds) {
    if (!bounds) return;
    const padding = 90;
    const width = Math.max(1, bounds.right - bounds.left + padding * 2);
    const height = Math.max(1, bounds.bottom - bounds.top + padding * 2);
    zoom = clamp(Math.min(element.clientWidth / width, element.clientHeight / height), ZOOM.minimum, ZOOM.maximum);
    render();
    element.scrollLeft = Math.max(0, (bounds.left - padding) * zoom);
    element.scrollTop = Math.max(0, (bounds.top - padding) * zoom);
  }

  function toggleCompartment(nodeId, key) {
    mutate((next) => {
      const node = next.elements.find((item) => item.id === nodeId);
      node.properties ??= {};
      node.properties.collapsedCompartments = { ...(node.properties.collapsedCompartments ?? {}), [key]: !node.properties.collapsedCompartments?.[key] };
    });
  }

  function beginNodeEditing(event, nodeId, section = "name") {
    event.preventDefault(); event.stopPropagation();
    if (editingNode?.id === nodeId && editingNode.section === (section || "name")) return;
    if (editingTimer !== null) clearTimeout(editingTimer);
    editingTimer = null;
    const activeSection = section || "name";
    const node = state.diagram.elements.find((item) => item.id === nodeId);
    const stored = activeSection === "name" ? node?.name : node?.properties?.[activeSection];
    const originalValue = Array.isArray(stored) ? stored.join("\n") : String(stored ?? "");
    editingNode = { id: nodeId, section: activeSection, clientX: event.clientX, clientY: event.clientY, originalValue, diagramBefore: structuredClone(state.diagram) };
    gesture = null; snapGuides = [];
    render();
  }

  function applyEditedText(diagram, nodeId, section, value) {
    const node = diagram.elements.find((item) => item.id === nodeId);
    if (!node) return null;
    const text = String(value ?? "").replace(/\u00a0/g, " ").trim();
    if (section === "name") node.name = text || nodeLabel(node.kind);
    else {
      node.properties ??= {};
      const scalarSection = ["text", "templateParameter", "upperMultiplicity", "lowerMultiplicity"].includes(section);
      node.properties[section] = scalarSection ? text : text ? text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean) : [];
    }
    fitNodeToContent(node);
    return node;
  }

  function updateNodeEditingDraft(input) {
    if (!editingNode || editingNode.id !== input.dataset.nodeEditor || editingNode.section !== input.dataset.nodeSection) return;
    const next = state.diagram;
    const node = applyEditedText(next, editingNode.id, editingNode.section, editorValue(input));
    if (!node) return;
    (updateDiagramDraft ?? ((diagram) => { state.diagram = diagram; }))(next);
    runtimeStyles.set(`editing-size-${node.id}`, `.diagram-node[data-node="${runtimeStyles.escape(node.id)}"]`, { width: `${node.width}px`, height: `${node.height}px` });
    runtimeStyles.commit();
    input.style.height = "auto";
    input.style.height = `${Math.max(input.scrollHeight, 24)}px`;
  }

  function scheduleNodeEditingDraft(input) {
    if (editingTimer !== null) clearTimeout(editingTimer);
    editingTimer = setTimeout(() => {
      editingTimer = null;
      updateNodeEditingDraft(input);
    }, 150);
  }

  function commitNodeEditing(nodeId, section, value) {
    if (editingNode?.id !== nodeId || editingNode.section !== section) return;
    if (editingTimer !== null) clearTimeout(editingTimer);
    editingTimer = null;
    const historySnapshot = editingNode.diagramBefore;
    const unchanged = String(value ?? "").replace(/\u00a0/g, " ").trim() === editingNode.originalValue.trim();
    editingNode = null;
    if (unchanged) { render(); return; }
    const next = structuredClone(state.diagram);
    applyEditedText(next, nodeId, section, value);
    setDiagram(next, true, historySnapshot);
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
    // The menu is clamped after render using its actual size.
    contextMenu = { x: event.clientX, y: event.clientY };
    render();
  }

  function openRelationshipToolbar(event, relationshipId) {
    event.preventDefault(); event.stopPropagation(); contextMenu = null;
    relationshipToolbar = { x: event.clientX, y: event.clientY };
    setSelection([], relationshipId);
  }

  function applyStyle(property, value) {
    if (!selectedIds().length) return;
    mutate((next) => {
      const selected = new Set(selectedIds());
      next.elements.forEach((node) => {
        if (selected.has(node.id)) {
          const fallback = nodeStyle(node)[property];
          const nextValue = ["borderColor", "fillColor", "textColor"].includes(property) ? normalizeColor(value, fallback) : value;
          // Explicit element formatting is authoritative. Theme defaults are
          // resolved only while rendering and must never be persisted over a
          // color selected by the user.
          node.style = { ...(node.style ?? {}), [property]: nextValue };
          if (property === "textSize") fitNodeToContent(node);
        }
      });
    });
  }

  function applyRelationshipStyle(property, value) {
    if (!state.selectedRelationshipId) return;
    mutate((next) => {
      const relationship = next.relationships.find((item) => item.id === state.selectedRelationshipId);
      if (property === "kind") relationship.kind = value;
      else relationship.style = { ...defaultRelationshipStyle, ...(relationship.style ?? {}), [property]: property === "width" ? Number(value) : normalizeColor(value, relationshipStyle(relationship).color) };
    });
  }

  function colorValueFromInput(input) {
    if (input.dataset.colorValue) return normalizeColor(input.dataset.colorValue, input.dataset.initialColor);
    if (input.type === "color") return normalizeColor(input.value, input.dataset.initialColor);
    return isColorInputValue(input.value) ? normalizeColor(input.value, input.dataset.initialColor) : null;
  }

  function synchronizeColorControl(input, value) {
    const control = input.closest("[data-color-control]");
    if (!control) return;
    const nativeInput = control.querySelector(".color-native");
    const trigger = control.querySelector(".color-trigger");
    if (trigger) {
      trigger.value = value;
    }
    if (nativeInput && nativeInput !== input) nativeInput.value = value;
    control.style.setProperty("--selected-color", value);
  }

  function previewColor(input, value = colorValueFromInput(input)) {
    if (!value) { input.setAttribute("aria-invalid", "true"); return false; }
    input.removeAttribute("aria-invalid");
    synchronizeColorControl(input, value);
    if (input.dataset.style) {
      const property = input.dataset.style;
      const cssProperty = { fillColor: "--node-fill", borderColor: "--node-border", textColor: "--node-text-color" }[property];
      if (cssProperty) element.querySelectorAll(".diagram-node.selected").forEach((node) => node.style.setProperty(cssProperty, value));
    }
    if (input.dataset.relationshipStyle === "color") {
      element.querySelector(".relationship-line.selected")?.style.setProperty("--relationship-color", value);
    }
    return true;
  }

  function commitColor(input) {
    if (!input || input.dataset.colorCommitted === "true") return;
    const value = colorValueFromInput(input);
    if (!value) { input.setAttribute("aria-invalid", "true"); return; }
    if (value === input.dataset.initialColor) return;
    input.dataset.colorCommitted = "true";
    if (input.dataset.style) applyStyle(input.dataset.style, value);
    else if (input.dataset.relationshipStyle === "color") applyRelationshipStyle("color", value);
  }

  function copySelection() {
    const ids = new Set(selectedIds());
    clipboard = state.diagram.elements.filter((node) => ids.has(node.id)).map((node) => structuredClone(node));
    const relationships = (state.diagram.relationships ?? []).filter((relationship) => ids.has(relationship.source_id) && ids.has(relationship.target_id)).map((relationship) => structuredClone(relationship));
    pasteOffset = 0;
    try { localStorage.setItem("sysml.diagramClipboard", JSON.stringify({ elements: clipboard, relationships })); } catch {}
  }
  function duplicateSelection() {
    if (!clipboard.length) {
      try {
        const stored = JSON.parse(localStorage.getItem("sysml.diagramClipboard") ?? "{}");
        clipboard = stored.elements ?? [];
      } catch {}
    }
    if (!clipboard.length) copySelection();
    if (!clipboard.length) return;
    pasteOffset += 20; const newIds = []; const groupMap = new Map();
    let storedRelationships = [];
    try { storedRelationships = JSON.parse(localStorage.getItem("sysml.diagramClipboard") ?? "{}").relationships ?? []; } catch {}
    mutate((next) => {
      const idMap = new Map();
      for (const copied of clipboard) {
        const duplicate = structuredClone(copied); duplicate.id = id(duplicate.kind); duplicate.name = `${duplicate.name} Copy`; duplicate.locked = false;
        idMap.set(copied.id, duplicate.id);
        duplicate.x = clamp(copied.x + pasteOffset, 0, CANVAS.width - copied.width); duplicate.y = clamp(copied.y + pasteOffset, 0, CANVAS.height - copied.height);
        if (duplicate.groupId) { if (!groupMap.has(duplicate.groupId)) groupMap.set(duplicate.groupId, id("group")); duplicate.groupId = groupMap.get(duplicate.groupId); }
        next.elements.push(duplicate); newIds.push(duplicate.id);
      }
      for (const relationship of storedRelationships) {
        if (!idMap.has(relationship.source_id) || !idMap.has(relationship.target_id)) continue;
        const duplicate = structuredClone(relationship);
        duplicate.id = id("rel"); duplicate.source_id = idMap.get(relationship.source_id); duplicate.target_id = idMap.get(relationship.target_id);
        next.relationships.push(duplicate);
      }
    });
    setSelection(newIds, null, false);
  }

  function executeCommand(command) {
    contextMenu = null;
    if (command === "keyboard-help") { setShortcutHelpOpen(!shortcutHelpOpen); return; }
    if (command === "print-preview") { printPreviewOpen = true; render(); return; }
    if (command === "close-print") { printPreviewOpen = false; render(); return; }
    if (command === "print-diagram") { window.print(); return; }
    if (command === "fit-selection") { fitToBounds(diagramBounds(state.diagram, selectedIds())); return; }
    if (command === "fit-diagram") { fitToBounds(diagramBounds(state.diagram)); return; }
    if (command === "comment") {
      const anchorId = selectedIds()[0];
      if (!anchorId) return;
      const body = prompt("Comment on selected element");
      if (body?.trim()) bus.emit("comment:create", { diagram_id: state.diagram.id, anchor_type: "element", anchor_id: anchorId, body: body.trim() });
      render();
      return;
    }
    if (command?.startsWith("align-")) { mutate((next) => alignElements(next.elements, selectedIds(), command.replace("align-", ""))); return; }
    if (command === "distribute-horizontal" || command === "distribute-vertical") { mutate((next) => distributeElements(next.elements, selectedIds(), command.replace("distribute-", ""))); return; }
    if (command === "auto-layout") { mutate((next) => autoLayoutElements(next.elements, selectedIds(), CANVAS, gridSize || 20)); return; }
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
    const directColorInput = event.target.closest?.("input[type='color'][data-color-input]");
    if (directColorInput && event.button === 0) {
      // Open while the trusted pointer event is active. This also keeps the
      // native picker alive when an inline editor blur rerenders the toolbar.
      activeNativeColorInput = directColorInput;
      if (typeof directColorInput.showPicker === "function") {
        event.preventDefault();
        try { directColorInput.showPicker(); } catch { directColorInput.click(); }
      }
      event.stopPropagation();
      return;
    }
    if (activeNativeColorInput) {
      activeNativeColorInput = null;
      scheduleRender();
    }
    if (editingNode && !event.target.closest("[data-node-editor]")) {
      const editor = element.querySelector("[data-node-editor]");
      if (editor && event.target.closest("[data-color-input]")) {
        // Keep the toolbar DOM alive through its click/change event. A
        // synchronous editor commit replaces that DOM on pointerdown, so the
        // browser never dispatches the color-picker click. Commit immediately
        // after the control has handled the interaction instead.
        const nodeId = editor.dataset.nodeEditor;
        const section = editor.dataset.nodeSection;
        const value = editorValue(editor);
        // Prevent the button from stealing focus and firing the editor's blur
        // commit before the ensuing click reaches the picker toggle.
        event.preventDefault();
        setTimeout(() => {
          if (editingNode?.id === nodeId && editingNode.section === section) commitNodeEditing(nodeId, section, value);
        }, 0);
        return;
      }
      if (editor) commitNodeEditing(editor.dataset.nodeEditor, editor.dataset.nodeSection, editorValue(editor));
      gesture = null;
      snapGuides = [];
      return;
    }
    if (event.pointerType === "touch") {
      touchPoints.set(event.pointerId, { x: event.clientX, y: event.clientY });
      if (touchPoints.size === 2) {
        const [a, b] = [...touchPoints.values()];
        pinch = { distance: Math.hypot(b.x - a.x, b.y - a.y), zoom };
        gesture = null;
        event.preventDefault();
        return;
      }
    }
    if (event.pointerType === "touch" && !event.target.closest(".diagram-node,[data-rel]")) {
      event.preventDefault();
      gesture = { type: "pan", startX: event.clientX, startY: event.clientY, scrollLeft: element.scrollLeft, scrollTop: element.scrollTop }; element.classList.add("panning");
      return;
    }
    if ((event.button === 1 || (event.button === 0 && spaceHeld)) && !event.target.closest(".diagram-node")) {
      event.preventDefault(); gesture = { type: "pan", startX: event.clientX, startY: event.clientY, scrollLeft: element.scrollLeft, scrollTop: element.scrollTop }; element.classList.add("panning"); return;
    }
    if (event.button !== 0 || event.target.closest(".canvas-toolbar,.format-toolbar,.relationship-toolbar,.canvas-context-menu")) return;
    contextMenu = null; relationshipToolbar = null;
    const start = pointOnCanvas(event);
    gesture = { type: "marquee", start, rect: { left: start.x, top: start.y, right: start.x, bottom: start.y }, additive: event.shiftKey, baseSelection: event.shiftKey ? [...selectedIds()] : [] };
    if (!event.shiftKey) setSelection([]); else render();
  }, { signal: lifecycle.signal });
  element.addEventListener("wheel", (event) => {
    if (!event.ctrlKey && !event.metaKey) return;
    event.preventDefault();
    const pixels = event.deltaY * (event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? element.clientHeight : 1);
    setZoom(zoom * Math.exp(-clamp(pixels, -120, 120) * 0.0015), event.clientX, event.clientY);
  }, { passive: false, signal: lifecycle.signal });
  element.addEventListener("input", (event) => {
    const input = event.target.closest("[data-color-input]");
    if (!input) return;
    event.stopPropagation();
    previewColor(input);
  }, { signal: lifecycle.signal });
  element.addEventListener("change", (event) => {
    const input = event.target.closest("[data-style],[data-relationship-style]");
    if (!input) return;
    event.stopPropagation();
    if (input.dataset.colorInput) { previewColor(input); commitColor(input); return; }
    if (input.dataset.style) {
      const numeric = input.dataset.style === "borderWidth" || input.dataset.style === "textSize";
      applyStyle(input.dataset.style, input.type === "color" ? input.value : numeric ? Number(input.value) : input.value);
    }
    if (input.dataset.relationshipStyle) applyRelationshipStyle(input.dataset.relationshipStyle, input.value);
  }, { signal: lifecycle.signal });
  element.addEventListener("focusout", (event) => {
    const input = event.target.closest?.("[data-color-input]");
    if (input) commitColor(input);
  }, { signal: lifecycle.signal });
  element.addEventListener("scroll", () => {
    if (viewportFrame !== null) return;
    viewportFrame = requestAnimationFrame(() => {
      viewportFrame = null;
      state.canvasViewport = { zoom, scrollLeft: element.scrollLeft, scrollTop: element.scrollTop };
      positionFormattingToolbar();
      syncMinimapViewport();
      runtimeStyles.commit();
    });
  }, { passive: true, signal: lifecycle.signal });
  element.addEventListener("contextmenu", (event) => {
    if (!event.target.closest("[data-node],[data-rel],.relationship-toolbar")) { event.preventDefault(); contextMenu = null; relationshipToolbar = null; render(); }
  }, { signal: lifecycle.signal });
  window.addEventListener("pointerdown", (event) => {
    if (!shortcutHelpOpen || event.target.closest?.("#keyboard-help,.shortcut-overlay")) return;
    // Capture dismissal before canvas pointer handlers can replace the clicked DOM during a render.
    setShortcutHelpOpen(false);
  }, { capture: true, signal: lifecycle.signal });
  window.addEventListener("click", (event) => {
    const hasOpenToolbarSurface = searchOpen || shortcutHelpOpen || printPreviewOpen;
    if (!hasOpenToolbarSurface) return;
    if (event.target.closest?.(".canvas-toolbar,.canvas-overlay,.print-preview")) return;
    searchOpen = false;
    shortcutHelpOpen = false;
    printPreviewOpen = false;
    render();
  }, { signal: lifecycle.signal });
  // Native browser drags (text, links, images, files, and UI fragments) never create model elements.
  element.addEventListener("dragenter", (event) => event.preventDefault(), { signal: lifecycle.signal });
  element.addEventListener("dragover", (event) => {
    event.preventDefault();
    if (event.dataTransfer) event.dataTransfer.dropEffect = "none";
  }, { signal: lifecycle.signal });
  element.addEventListener("dragleave", (event) => { if (!element.contains(event.relatedTarget)) element.classList.remove("drag-target-active"); }, { signal: lifecycle.signal });
  function placePaletteElement(kind, clientX, clientY, variant = "full", textPreset = null, label = "") {
    if (!elementKinds.includes(kind) || !state.diagram) return false;
    const rect = element.getBoundingClientRect();
    if (clientX < rect.left || clientX > rect.right || clientY < rect.top || clientY > rect.bottom) return false;
    const point = pointOnCanvas({ clientX, clientY });
    const structuralVariant = ["class", "block"].includes(kind) && variant === "simple" ? "simple" : "full";
    const size = defaultSizeFor(kind, structuralVariant);
    const nodeId = id(kind);
    // Drop is a placement action, not a text-editing action. Entering edit mode
    // here caused the render guard to keep the drag preview DOM alive and hide
    // subsequent placements until the page was refreshed.
    paletteHover = null;
    pointerDrag = null;
    element.classList.remove("drag-target-active");
    mutate((next) => next.elements.push({ id: nodeId, kind, ...(["class", "block"].includes(kind) ? { variant: structuralVariant } : {}), name: textPreset ? label : defaultNameFor(kind), x: clamp(snap(point.x - size.width / 2), 0, CANVAS.width - size.width), y: clamp(snap(point.y - size.height / 2), 0, CANVAS.height - size.height), ...size, ...(textPreset ? { style: textPreset } : {}), properties: defaultPropertiesFor(kind, next, structuralVariant) }));
    setSelection([nodeId]);
    return true;
  }
  element.addEventListener("drop", (event) => {
    event.preventDefault();
    event.stopPropagation();
    element.classList.remove("drag-target-active");
  }, { signal: lifecycle.signal });

  window.addEventListener("pointermove", (event) => {
    if (minimapDrag) {
      if (event.pointerId === minimapDrag.pointerId) moveCanvasFromMinimap(event);
      return;
    }
    if (event.pointerType === "touch" && touchPoints.has(event.pointerId)) {
      touchPoints.set(event.pointerId, { x: event.clientX, y: event.clientY });
      if (pinch && touchPoints.size >= 2) {
        const [a, b] = [...touchPoints.values()];
        const distance = Math.hypot(b.x - a.x, b.y - a.y);
        setZoom(pinch.zoom * distance / Math.max(1, pinch.distance), (a.x + b.x) / 2, (a.y + b.y) / 2);
        return;
      }
    }
    if (connectDrag) { const point = pointOnCanvas(event); connectDrag.x2 = point.x; connectDrag.y2 = point.y; scheduleRender(); return; }
    const hoverPoint = pointOnCanvas(event);
    const currentTime = performance.now();
    if (currentTime - lastPresenceSent > 250 && element.matches(":hover")) {
      lastPresenceSent = currentTime;
      bus.emit("canvas:pointer", { x: Math.round(hoverPoint.x), y: Math.round(hoverPoint.y) });
    }
    if (!gesture) return;
    if (gesture.type === "pan") { element.scrollLeft = gesture.scrollLeft - (event.clientX - gesture.startX); element.scrollTop = gesture.scrollTop - (event.clientY - gesture.startY); return; }
    const point = hoverPoint;
    if (gesture.type === "route") {
      gesture.previewPoint = { x: snap(point.x, 10), y: snap(point.y, 10) };
      const handle = element.querySelector(`[data-route-handle="${gesture.relationshipId}"][data-route-index="${gesture.index}"]`);
      handle?.setAttribute("cx", String(gesture.previewPoint.x));
      handle?.setAttribute("cy", String(gesture.previewPoint.y));
      return;
    }
    if (gesture.type === "marquee") {
      gesture.rect = { left: Math.min(gesture.start.x, point.x), top: Math.min(gesture.start.y, point.y), right: Math.max(gesture.start.x, point.x), bottom: Math.max(gesture.start.y, point.y) };
      const hits = expandGroupedSelection(state.diagram.elements, nodesInRect(state.diagram.elements, gesture.rect));
      state.selectedElementIds = gesture.additive ? [...new Set([...gesture.baseSelection, ...hits])] : hits; scheduleRender(); return;
    }
    const next = structuredClone(state.diagram); const dx = point.x - gesture.start.x; const dy = point.y - gesture.start.y;
    if (gesture.type === "move") {
      moveSelection(next.elements, gesture.ids, gesture.originals, dx, dy, CANVAS, event.altKey ? 1 : (gridSize || 1));
      const bounds = selectionBounds(next.elements, gesture.ids);
      snapGuides = bounds ? snapLinesForMove(next.elements, gesture.ids, bounds) : [];
    }
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
    scheduleRender();
  }, { signal: lifecycle.signal });

  window.addEventListener("pointerup", (event) => {
    if (minimapDrag) {
      stopMinimapDrag(event);
      return;
    }
    if (event.pointerType === "touch") {
      touchPoints.delete(event.pointerId);
      if (touchPoints.size < 2) pinch = null;
    }
    if (connectDrag) {
      const targetId = event.target.closest?.("[data-node]")?.dataset.node;
      if (targetId && targetId !== connectDrag.sourceId) {
        const sourceId = connectDrag.sourceId;
        const kind = connectDrag.kind; const label = connectDrag.label;
        const target = state.diagram.elements.find((item) => item.id === targetId); const targetAnchor = nearestAnchor(target, pointOnCanvas(event));
        const candidate = { id: id("rel"), kind, source_id: sourceId, target_id: targetId, sourceAnchor: connectDrag.sourceAnchor, targetAnchor, routing: "orthogonal", label, properties: {}, style: { ...defaultRelationshipStyle } };
        const validation = validateRelationshipCompatibility(candidate, state.diagram.elements.map((node) => ({ id: node.id, kind: node.kind, name: node.name, semantic: node.properties ?? {} })));
        if (validation.status === "invalid") bus.emit("toast", validation.diagnostics[0] ?? "Incompatible connection");
        else {
          mutate((next) => { next.relationships.push(candidate); state.selectedRelationshipId = candidate.id; state.selectedElementIds = []; });
          clearSelectedTool();
        }
      }
      connectDrag = null; render(); return;
    }
    // Toolbar controls (especially native color inputs) must survive through the
    // click event. Re-rendering on an unrelated pointerup detaches the input
    // before the browser can open its picker.
    if (!gesture) return;
    const completedGesture = gesture;
    if (completedGesture.type === "route" && (completedGesture.index === 0 || completedGesture.index === completedGesture.points.length - 1)) {
      const targetId = event.target.closest?.("[data-node]")?.dataset.node;
      if (targetId) {
        const completed = structuredClone(state.diagram); const relationship = completed.relationships.find((item) => item.id === completedGesture.relationshipId); const target = completed.elements.find((item) => item.id === targetId);
        if (completedGesture.index === 0) { relationship.source_id = targetId; relationship.sourceAnchor = nearestAnchor(target, pointOnCanvas(event)); }
        else { relationship.target_id = targetId; relationship.targetAnchor = nearestAnchor(target, pointOnCanvas(event)); }
        delete relationship.waypoints; state.diagram = completed; completedGesture.changed = true;
      }
    }
    if (completedGesture.type === "marquee") {
      selectionFrame = selectedIds().length > 1 ? { ...completedGesture.rect } : null;
      bus.emit("selection:changed", selectedIds());
    }
    if (completedGesture.changed && completedGesture.diagramBefore) {
      const completed = structuredClone(state.diagram);
      state.diagram = completedGesture.diagramBefore;
      gesture = null; snapGuides = [];
      setDiagram(completed);
      return;
    }
    gesture = null; element.classList.remove("panning");
    // A plain node click must keep its DOM target intact so the browser can
    // recognize the second click and dispatch dblclick for inline editing.
    if (completedGesture.type === "marquee" || completedGesture.type === "route") render();
  }, { signal: lifecycle.signal });
  window.addEventListener("pointercancel", (event) => {
    touchPoints.delete(event.pointerId);
    if (touchPoints.size < 2) pinch = null;
    gesture = null; element.classList.remove("panning");
  }, { signal: lifecycle.signal });

  window.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && shortcutHelpOpen) {
      event.preventDefault();
      setShortcutHelpOpen(false);
      return;
    }
    const activeElement = document.activeElement;
    const editing = ["INPUT", "TEXTAREA", "SELECT"].includes(activeElement?.tagName)
      || activeElement?.isContentEditable
      || Boolean(event.target.closest?.("[contenteditable='true'],[contenteditable='plaintext-only'],[data-node-editor]"));
    if (editing) return;
    const modifier = event.ctrlKey || event.metaKey; const key = event.key.toLowerCase();
    if (event.code === "Space") { spaceHeld = true; element.classList.add("pan-ready"); if (!editing) event.preventDefault(); }
    if (modifier && key === "a") { event.preventDefault(); setSelection(state.diagram.elements.map((node) => node.id)); }
    if (modifier && key === "z" && !event.shiftKey) { event.preventDefault(); performUndo(); }
    if (modifier && (key === "y" || (key === "z" && event.shiftKey))) { event.preventDefault(); performRedo(); }
    if (modifier && key === "c") copySelection();
    if (modifier && key === "x") executeCommand("cut");
    if (modifier && key === "d") { event.preventDefault(); executeCommand("duplicate"); }
    if (modifier && key === "v") duplicateSelection();
    if (modifier && key === "g") { event.preventDefault(); executeCommand(event.shiftKey ? "ungroup" : "group"); }
    if (modifier && key === "f") { event.preventDefault(); searchOpen = true; shortcutHelpOpen = false; render(); }
    if (modifier && key === "0") { event.preventDefault(); executeCommand("fit-diagram"); }
    if (modifier && key === "1") { event.preventDefault(); executeCommand("fit-selection"); }
    if (event.altKey && !modifier && ["arrowleft", "arrowright", "arrowup", "arrowdown"].includes(key)) {
      event.preventDefault();
      const command = { arrowleft: "align-left", arrowright: "align-right", arrowup: "align-top", arrowdown: "align-bottom" }[key];
      executeCommand(command);
    }
    if (key === "?") {
      event.preventDefault();
      setShortcutHelpOpen(!shortcutHelpOpen);
      return;
    }
    if (event.key === "Delete" || event.key === "Backspace") deleteSelection();
    if (event.key === "Escape") { gesture = null; connectDrag = null; contextMenu = null; relationshipToolbar = null; clearSelectedTool(); searchOpen = false; shortcutHelpOpen = false; printPreviewOpen = false; render(); }
  }, { signal: lifecycle.signal });
  window.addEventListener("keyup", (event) => { if (event.code === "Space") { spaceHeld = false; element.classList.remove("pan-ready"); } }, { signal: lifecycle.signal });

  let viewportResizeFrame = null;
  element.addEventListener("canvas:resize", () => {
    const hostRect = element.getBoundingClientRect();
    runtimeStyles.set("minimap-position", ".canvas-minimap", { right: `${Math.max(12, window.innerWidth - hostRect.right + 18)}px`, bottom: `${Math.max(12, window.innerHeight - hostRect.bottom + 18)}px` });
    syncMinimapViewport();
    runtimeStyles.commit();
    if (viewportResizeFrame !== null) return;
    viewportResizeFrame = requestAnimationFrame(() => {
      viewportResizeFrame = null;
      render();
    });
  }, { signal: lifecycle.signal });

  subscriptions.push(bus.on("diagram:changed", () => {
    if (state.selectedTool?.type === "relationship" && !isPaletteItemAllowed(state.diagram?.type, "relationship", state.selectedTool.kind)) clearSelectedTool();
    // Imports replace viewport state before this event so zoom and scroll are restored with the diagram.
    const importedViewport = state.canvasViewport;
    if (Number.isFinite(importedViewport?.zoom)) zoom = clamp(importedViewport.zoom, ZOOM.minimum, ZOOM.maximum);
    render();
    if (Number.isFinite(importedViewport?.scrollLeft) && Number.isFinite(importedViewport?.scrollTop)) {
      element.scrollLeft = importedViewport.scrollLeft;
      element.scrollTop = importedViewport.scrollTop;
      syncMinimapViewport();
    }
  }));
  subscriptions.push(bus.on("selection:changed", scheduleRender));
  subscriptions.push(bus.on("theme:changed", scheduleRender));
  subscriptions.push(bus.on("ui:menu-open", (menu) => {
    if (menu === "help" || !shortcutHelpOpen) return;
    shortcutHelpOpen = false;
    render();
  }));
  subscriptions.push(bus.on("palette:hover", (detail) => { paletteHover = detail; scheduleRender(); }));
  subscriptions.push(bus.on("palette:dragstart", () => { paletteHover = null; pointerDrag = null; scheduleRender(); }));
  subscriptions.push(bus.on("palette:pointermove", (detail) => {
    const rect = element.getBoundingClientRect();
    const inside = detail.clientX >= rect.left && detail.clientX <= rect.right && detail.clientY >= rect.top && detail.clientY <= rect.bottom;
    element.classList.toggle("drag-target-active", inside);
    paletteHover = null;
    pointerDrag = detail;
    scheduleRender();
  }));
  subscriptions.push(bus.on("palette:pointerdrop", ({ type, kind, variant, label, textPreset, crossDiagram, clientX, clientY }) => {
    const rect = element.getBoundingClientRect();
    const inside = clientX >= rect.left && clientX <= rect.right && clientY >= rect.top && clientY <= rect.bottom;
    const allowed = isPaletteItemAllowed(state.diagram?.type, type, kind) || (crossDiagram && type === "node");
    if (inside && allowed) {
      if (type === "node") placePaletteElement(kind, clientX, clientY, variant, textPreset, label);
      if (type === "relationship") { state.selectedTool = { type, kind, label }; setSelection([]); }
    }
    paletteHover = null; pointerDrag = null; element.classList.remove("drag-target-active"); scheduleRender();
  }));
  subscriptions.push(bus.on("palette:dragend", () => { paletteHover = null; pointerDrag = null; element.classList.remove("drag-target-active"); scheduleRender(); }));
  subscriptions.push(bus.on("model:focus", (modelId) => {
    const node = state.diagram?.elements.find((item) => (item.model_element_id ?? item.id) === modelId);
    if (!node) return;
    setSelection([node.id]);
    element.scrollTo({ left: Math.max(0, node.x * zoom - element.clientWidth / 2), top: Math.max(0, node.y * zoom - element.clientHeight / 2), behavior: "smooth" });
  }));
  subscriptions.push(bus.on("relationship:focus", (relationshipId) => {
    const relationship = state.diagram?.relationships.find((item) => (item.model_relationship_id ?? item.id) === relationshipId);
    if (relationship) setSelection([], relationship.id);
  }));
  subscriptions.push(bus.on("collaboration:changed", (next) => { collaboration = next ?? { presence: [], comments: [] }; render(); }));
  subscriptions.push(bus.on("ai:preview", (next) => { aiPreview = next; scheduleRender(); }));
  render();
  element.scrollLeft = state.canvasViewport?.scrollLeft ?? 0;
  element.scrollTop = state.canvasViewport?.scrollTop ?? 0;
  syncMinimapViewport();
  return () => {
    const viewport = { zoom, scrollLeft: element.scrollLeft, scrollTop: element.scrollTop };
    if (mountedDiagramId) state.tabStates[mountedDiagramId] = { ...(state.tabStates[mountedDiagramId] ?? {}), viewport };
    if (state.diagram?.id === mountedDiagramId) state.canvasViewport = viewport;
    lifecycle.abort();
    subscriptions.splice(0).forEach((unsubscribe) => unsubscribe());
    if (renderFrame !== null) cancelAnimationFrame(renderFrame);
    if (viewportFrame !== null) cancelAnimationFrame(viewportFrame);
    if (viewportResizeFrame !== null) cancelAnimationFrame(viewportResizeFrame);
    if (editingTimer !== null) clearTimeout(editingTimer);
    runtimeStyles.destroy();
  };
});
