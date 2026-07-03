export const GRID_SIZE = 20;
export const MIN_NODE_WIDTH = 100;
export const MIN_NODE_HEIGHT = 60;

export function clamp(value, minimum, maximum) {
  return Math.min(Math.max(value, minimum), Math.max(minimum, maximum));
}

export function snap(value, grid = GRID_SIZE) {
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

export function moveSelection(elements, selectedIds, originals, dx, dy, canvas) {
  const bounds = selectionBounds(Object.values(originals), selectedIds);
  if (!bounds) return;
  const safeDx = clamp(snap(dx), -bounds.left, canvas.width - bounds.right);
  const safeDy = clamp(snap(dy), -bounds.top, canvas.height - bounds.bottom);
  for (const node of elements) {
    const original = originals[node.id];
    if (!original || original.locked) continue;
    node.x = original.x + safeDx;
    node.y = original.y + safeDy;
  }
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
