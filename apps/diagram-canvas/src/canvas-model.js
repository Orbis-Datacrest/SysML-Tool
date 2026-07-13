export const GRID_SIZE = 20;
export const MIN_NODE_WIDTH = 100;
export const MIN_NODE_HEIGHT = 60;

export function clamp(value, minimum, maximum) {
  return Math.min(Math.max(value, minimum), Math.max(minimum, maximum));
}

export function snap(value, grid = GRID_SIZE) {
  if (!grid || grid <= 1) return Math.round(value);
  return Math.round(value / grid) * grid;
}

export function selectionBounds(elements, selectedIds) {
  const selected = elements.filter((node) => selectedIds.includes(node.id));
  if (!selected.length) return null;
  return {
    left: Math.min(...selected.map((node) => node.x)),
    top: Math.min(...selected.map((node) => node.y)),
    right: Math.max(...selected.map((node) => node.x + node.width)),
    bottom: Math.max(...selected.map((node) => node.y + node.height))
  };
}

export function nodesInRect(elements, rect) {
  return elements.filter((node) =>
    node.x < rect.right && node.x + node.width > rect.left &&
    node.y < rect.bottom && node.y + node.height > rect.top
  ).map((node) => node.id);
}

export function expandGroupedSelection(elements, ids) {
  const requested = new Set(ids);
  const groupIds = new Set(elements.filter((node) => requested.has(node.id) && node.groupId).map((node) => node.groupId));
  for (const node of elements) {
    if (node.groupId && groupIds.has(node.groupId)) requested.add(node.id);
  }
  return [...requested];
}

export function groupElements(elements, ids, groupId) {
  const selected = new Set(ids);
  elements.forEach((node) => {
    if (selected.has(node.id)) node.groupId = groupId;
  });
}

export function ungroupElements(elements, ids) {
  const selectedGroups = new Set(elements.filter((node) => ids.includes(node.id) && node.groupId).map((node) => node.groupId));
  elements.forEach((node) => {
    if (selectedGroups.has(node.groupId)) delete node.groupId;
  });
}

export function applyElementStyle(elements, ids, property, value, defaults) {
  const selected = new Set(ids);
  elements.forEach((node) => {
    if (selected.has(node.id)) node.style = { ...defaults, ...(node.style ?? {}), [property]: value };
  });
}

export function moveSelection(elements, selectedIds, originals, dx, dy, canvas, grid = GRID_SIZE) {
  const bounds = selectionBounds(Object.values(originals), selectedIds);
  if (!bounds) return;
  const safeDx = clamp(snap(dx, grid), -bounds.left, canvas.width - bounds.right);
  const safeDy = clamp(snap(dy, grid), -bounds.top, canvas.height - bounds.bottom);
  for (const node of elements) {
    const original = originals[node.id];
    if (!original || original.locked) continue;
    node.x = original.x + safeDx;
    node.y = original.y + safeDy;
  }
}

export function alignElements(elements, selectedIds, alignment) {
  const selected = elements.filter((node) => selectedIds.includes(node.id) && !node.locked);
  if (selected.length < 2) return;
  const bounds = selectionBounds(elements, selectedIds);
  if (!bounds) return;
  for (const node of selected) {
    if (alignment === "left") node.x = bounds.left;
    if (alignment === "center") node.x = bounds.left + (bounds.right - bounds.left - node.width) / 2;
    if (alignment === "right") node.x = bounds.right - node.width;
    if (alignment === "top") node.y = bounds.top;
    if (alignment === "middle") node.y = bounds.top + (bounds.bottom - bounds.top - node.height) / 2;
    if (alignment === "bottom") node.y = bounds.bottom - node.height;
  }
}

export function distributeElements(elements, selectedIds, axis) {
  const selected = elements.filter((node) => selectedIds.includes(node.id) && !node.locked);
  if (selected.length < 3) return;
  const ordered = [...selected].sort((a, b) => axis === "horizontal" ? a.x - b.x : a.y - b.y);
  const first = ordered[0];
  const last = ordered[ordered.length - 1];
  const totalSize = ordered.reduce((sum, node) => sum + (axis === "horizontal" ? node.width : node.height), 0);
  const start = axis === "horizontal" ? first.x : first.y;
  const end = axis === "horizontal" ? last.x + last.width : last.y + last.height;
  const gap = (end - start - totalSize) / (ordered.length - 1);
  let cursor = start;
  for (const node of ordered) {
    if (axis === "horizontal") node.x = cursor;
    else node.y = cursor;
    cursor += (axis === "horizontal" ? node.width : node.height) + gap;
  }
}

export function autoLayoutElements(elements, selectedIds, canvas, grid = GRID_SIZE) {
  const selected = elements.filter((node) => (selectedIds.length ? selectedIds.includes(node.id) : true) && !node.locked);
  if (!selected.length) return;
  const columns = Math.max(1, Math.ceil(Math.sqrt(selected.length * 1.35)));
  const maxWidth = Math.max(...selected.map((node) => node.width));
  const maxHeight = Math.max(...selected.map((node) => node.height));
  const left = Math.max(grid, Math.min(...selected.map((node) => node.x)));
  const top = Math.max(grid, Math.min(...selected.map((node) => node.y)));
  selected.forEach((node, index) => {
    const column = index % columns;
    const row = Math.floor(index / columns);
    node.x = clamp(snap(left + column * (maxWidth + grid * 3), grid), 0, canvas.width - node.width);
    node.y = clamp(snap(top + row * (maxHeight + grid * 3), grid), 0, canvas.height - node.height);
  });
}

export function snapLinesForMove(elements, selectedIds, movingBounds, tolerance = 6) {
  const selected = new Set(selectedIds);
  const guides = [];
  const moving = {
    left: movingBounds.left,
    centerX: (movingBounds.left + movingBounds.right) / 2,
    right: movingBounds.right,
    top: movingBounds.top,
    centerY: (movingBounds.top + movingBounds.bottom) / 2,
    bottom: movingBounds.bottom
  };
  for (const node of elements) {
    if (selected.has(node.id)) continue;
    const fixed = {
      left: node.x,
      centerX: node.x + node.width / 2,
      right: node.x + node.width,
      top: node.y,
      centerY: node.y + node.height / 2,
      bottom: node.y + node.height
    };
    for (const key of ["left", "centerX", "right"]) {
      for (const other of ["left", "centerX", "right"]) {
        if (Math.abs(moving[key] - fixed[other]) <= tolerance) guides.push({ axis: "x", value: fixed[other] });
      }
    }
    for (const key of ["top", "centerY", "bottom"]) {
      for (const other of ["top", "centerY", "bottom"]) {
        if (Math.abs(moving[key] - fixed[other]) <= tolerance) guides.push({ axis: "y", value: fixed[other] });
      }
    }
  }
  return guides.filter((guide, index, all) => all.findIndex((item) => item.axis === guide.axis && Math.round(item.value) === Math.round(guide.value)) === index);
}

export function removeElements(diagram, selectedIds) {
  const ids = new Set(selectedIds);
  diagram.elements = diagram.elements.filter((node) => !ids.has(node.id));
  diagram.relationships = (diagram.relationships ?? []).filter(
    (relationship) => !ids.has(relationship.source_id) && !ids.has(relationship.target_id)
  );
}

export function reorderElements(elements, selectedIds, direction) {
  const selected = new Set(selectedIds);
  if (direction === "forward") {
    for (let index = elements.length - 2; index >= 0; index -= 1) {
      if (selected.has(elements[index].id) && !selected.has(elements[index + 1].id)) {
        [elements[index], elements[index + 1]] = [elements[index + 1], elements[index]];
      }
    }
  } else {
    for (let index = 1; index < elements.length; index += 1) {
      if (selected.has(elements[index].id) && !selected.has(elements[index - 1].id)) {
        [elements[index], elements[index - 1]] = [elements[index - 1], elements[index]];
      }
    }
  }
}

export function minimapViewport({ canvas, viewport, minimap, scroll, zoom }) {
  const scaleX = minimap.width / canvas.width;
  const scaleY = minimap.height / canvas.height;
  const width = Math.min(minimap.width, viewport.width / zoom * scaleX);
  const height = Math.min(minimap.height, viewport.height / zoom * scaleY);
  return {
    left: clamp(scroll.left / zoom * scaleX, 0, minimap.width - width),
    top: clamp(scroll.top / zoom * scaleY, 0, minimap.height - height),
    width,
    height
  };
}

export function canvasScrollFromMinimap({ canvas, minimap, viewport, position, zoom }) {
  return {
    left: clamp(position.left, 0, minimap.width - viewport.width) / minimap.width * canvas.width * zoom,
    top: clamp(position.top, 0, minimap.height - viewport.height) / minimap.height * canvas.height * zoom
  };
}

export function normalizeColor(value, fallback = "#000000") {
  const candidate = String(value ?? "").trim().toLowerCase();
  const shortHex = candidate.match(/^#([0-9a-f]{3,4})$/i);
  if (shortHex) return `#${shortHex[1].slice(0, 3).split("").map((part) => part + part).join("")}`;
  const longHex = candidate.match(/^#([0-9a-f]{6})(?:[0-9a-f]{2})?$/i);
  if (longHex) return `#${longHex[1]}`;
  const rgb = candidate.match(/^rgba?\(\s*(-?\d+(?:\.\d+)?)\s*[, ]\s*(-?\d+(?:\.\d+)?)\s*[, ]\s*(-?\d+(?:\.\d+)?)/i);
  if (rgb) return `#${rgb.slice(1, 4).map((part) => Math.round(clamp(Number(part), 0, 255)).toString(16).padStart(2, "0")).join("")}`;
  return normalizeColor(fallback === value ? "#000000" : fallback, "#000000");
}

export function isColorInputValue(value) {
  return /^#[0-9a-f]{3}(?:[0-9a-f]{3})?$/i.test(String(value ?? "").trim());
}
