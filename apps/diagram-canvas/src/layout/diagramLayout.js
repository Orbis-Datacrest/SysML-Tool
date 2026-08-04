const DEFAULT_OPTIONS = Object.freeze({ direction: "left-to-right", layerGap: 120, nodeGap: 60, componentGap: 120, margin: 40 });
const byStableOrder = (a, b) => a.order - b.order || String(a.node.id).localeCompare(String(b.node.id));
const overlaps = (a, b, padding = 0) => a.x < b.x + b.width + padding && a.x + a.width + padding > b.x && a.y < b.y + b.height + padding && a.y + a.height + padding > b.y;
export function rectanglesOverlap(a, b, padding = 0) { return overlaps(a, b, padding); }

export function nearestFreePosition(node, obstacles, canvas, config = {}) {
  const grid = Math.max(1, Number(config.grid) || 20); const padding = Math.max(0, Number(config.padding) || 20);
  const preferred = { x: Math.max(0, Math.min(Math.round(node.x / grid) * grid, canvas.width - node.width)), y: Math.max(0, Math.min(Math.round(node.y / grid) * grid, canvas.height - node.height)) };
  const free = (position) => !obstacles.some((item) => overlaps({ ...node, ...position }, item, padding));
  if (free(preferred)) return preferred;
  const maxRing = Math.ceil(Math.max(canvas.width, canvas.height) / grid);
  for (let ring = 1; ring <= maxRing; ring += 1) {
    const candidates = [];
    for (let offset = -ring; offset <= ring; offset += 1) candidates.push([offset, -ring], [ring, offset], [offset, ring], [-ring, offset]);
    for (const [dx, dy] of candidates) {
      const position = { x: preferred.x + dx * grid, y: preferred.y + dy * grid };
      if (position.x < 0 || position.y < 0 || position.x + node.width > canvas.width || position.y + node.height > canvas.height) continue;
      if (free(position)) return position;
    }
  }
  return preferred;
}

function connectedComponents(records, edges) {
  const neighbors = new Map(records.map(({ node }) => [node.id, new Set()]));
  edges.forEach(({ source_id: source, target_id: target }) => { neighbors.get(source)?.add(target); neighbors.get(target)?.add(source); });
  const remaining = new Set(records.map(({ node }) => node.id)); const components = [];
  while (remaining.size) {
    const first = records.find(({ node }) => remaining.has(node.id)).node.id; const queue = [first]; const ids = new Set(); remaining.delete(first);
    while (queue.length) { const current = queue.shift(); ids.add(current); for (const neighbor of neighbors.get(current) ?? []) if (remaining.delete(neighbor)) queue.push(neighbor); }
    components.push(records.filter(({ node }) => ids.has(node.id)));
  }
  return components;
}

function assignLayers(component, edges) {
  const ids = new Set(component.map(({ node }) => node.id)); const outgoing = new Map(component.map(({ node }) => [node.id, []])); const indegree = new Map(component.map(({ node }) => [node.id, 0]));
  edges.filter(({ source_id: s, target_id: t }) => ids.has(s) && ids.has(t) && s !== t).forEach(({ source_id: source, target_id: target }) => {
    if (!outgoing.get(source).includes(target)) { outgoing.get(source).push(target); indegree.set(target, indegree.get(target) + 1); }
  });
  const layer = new Map(component.map(({ node }) => [node.id, 0])); const processed = new Set();
  const queue = component.filter(({ node }) => indegree.get(node.id) === 0).sort(byStableOrder).map(({ node }) => node.id);
  if (!queue.length && component.length) queue.push([...component].sort(byStableOrder)[0].node.id);
  while (processed.size < component.length) {
    if (!queue.length) queue.push(component.filter(({ node }) => !processed.has(node.id)).sort(byStableOrder)[0].node.id);
    const current = queue.shift(); if (processed.has(current)) continue; processed.add(current);
    for (const target of outgoing.get(current) ?? []) { if (!processed.has(target)) layer.set(target, Math.max(layer.get(target), layer.get(current) + 1)); indegree.set(target, Math.max(0, indegree.get(target) - 1)); if (indegree.get(target) === 0) queue.push(target); }
  }
  return layer;
}

function placeComponent(component, edges, origin, options, grid) {
  const layers = assignLayers(component, edges); const grouped = new Map();
  component.forEach((record) => { const index = layers.get(record.node.id) ?? 0; if (!grouped.has(index)) grouped.set(index, []); grouped.get(index).push(record); });
  const horizontal = options.direction === "left-to-right"; let primary = horizontal ? origin.x : origin.y; let crossExtent = 0;
  for (const [, records] of [...grouped.entries()].sort(([a], [b]) => a - b)) {
    records.sort((a, b) => String(a.node.groupId ?? "").localeCompare(String(b.node.groupId ?? "")) || (horizontal ? a.node.y - b.node.y : a.node.x - b.node.x) || byStableOrder(a, b));
    const primarySize = Math.max(...records.map(({ node }) => horizontal ? node.width : node.height)); let cross = horizontal ? origin.y : origin.x;
    for (const { node } of records) { node.x = Math.round((horizontal ? primary : cross) / grid) * grid; node.y = Math.round((horizontal ? cross : primary) / grid) * grid; cross += (horizontal ? node.height : node.width) + options.nodeGap; }
    crossExtent = Math.max(crossExtent, cross - (horizontal ? origin.y : origin.x) - options.nodeGap); primary += primarySize + options.layerGap;
  }
  return horizontal ? { width: primary - origin.x - options.layerGap, height: crossExtent } : { width: crossExtent, height: primary - origin.y - options.layerGap };
}

export function layoutDiagram(elements, relationships = [], config = {}) {
  const options = { ...DEFAULT_OPTIONS, ...config }; const grid = Math.max(1, Number(options.grid) || 20);
  const ids = new Set(options.selectedIds?.length ? options.selectedIds : elements.map(({ id }) => id));
  const records = elements.map((node, order) => ({ node, order })).filter(({ node }) => ids.has(node.id) && !node.locked);
  if (!records.length) return { moved: [], bounds: null };
  const recordIds = new Set(records.map(({ node }) => node.id)); const edges = relationships.filter(({ source_id: s, target_id: t }) => recordIds.has(s) && recordIds.has(t));
  const components = connectedComponents(records, edges).sort((a, b) => byStableOrder(a[0], b[0]));
  const minimumX = Math.max(options.margin, Math.min(...records.map(({ node }) => node.x))); const minimumY = Math.max(options.margin, Math.min(...records.map(({ node }) => node.y))); let cursor = { x: minimumX, y: minimumY };
  for (const component of components) { const size = placeComponent(component, edges, cursor, options, grid); if (options.direction === "left-to-right") cursor.y += size.height + options.componentGap; else cursor.x += size.width + options.componentGap; }
  const placed = [...elements.filter((node) => !recordIds.has(node.id))];
  for (const { node } of records) { const position = nearestFreePosition(node, placed, options.canvas, { grid, padding: options.nodeGap }); node.x = position.x; node.y = position.y; placed.push(node); }
  return { moved: records.map(({ node }) => node.id), bounds: { left: Math.min(...records.map(({ node }) => node.x)), top: Math.min(...records.map(({ node }) => node.y)), right: Math.max(...records.map(({ node }) => node.x + node.width)), bottom: Math.max(...records.map(({ node }) => node.y + node.height)) } };
}
