export const ROUTE_CLEARANCE = 18;
const SIDES = ["top", "right", "bottom", "left"];

const round = (value) => Math.round(value * 100) / 100;
const key = (point) => `${round(point.x)},${round(point.y)}`;
const inside = (point, box) => point.x > box.left && point.x < box.right && point.y > box.top && point.y < box.bottom;

export function anchorPoint(node, anchor = {}) {
  if (anchor.portId) {
    const port = (node.ports ?? node.properties?.ports ?? []).find((item) => item.id === anchor.portId);
    if (port) return { x: node.x + Number(port.x ?? 0), y: node.y + Number(port.y ?? 0), side: port.side ?? anchor.side ?? "right", portId: port.id };
  }
  const side = SIDES.includes(anchor.side) ? anchor.side : "right";
  const offset = Math.max(0, Math.min(1, Number(anchor.offset ?? 0.5)));
  if (side === "top") return { x: node.x + node.width * offset, y: node.y, side, offset };
  if (side === "bottom") return { x: node.x + node.width * offset, y: node.y + node.height, side, offset };
  if (side === "left") return { x: node.x, y: node.y + node.height * offset, side, offset };
  return { x: node.x + node.width, y: node.y + node.height * offset, side, offset };
}

export function nearestAnchor(node, point) {
  const ports = node.ports ?? node.properties?.ports ?? [];
  for (const port of ports) {
    const candidate = anchorPoint(node, { portId: port.id });
    if (Math.hypot(candidate.x - point.x, candidate.y - point.y) <= 14) return { side: candidate.side, portId: port.id };
  }
  const choices = SIDES.map((side) => {
    const horizontal = side === "top" || side === "bottom";
    const offset = horizontal ? (point.x - node.x) / node.width : (point.y - node.y) / node.height;
    const anchor = anchorPoint(node, { side, offset });
    return { side, offset: anchor.offset, distance: Math.hypot(anchor.x - point.x, anchor.y - point.y) };
  });
  const best = choices.sort((a, b) => a.distance - b.distance)[0];
  return { side: best.side, offset: best.offset };
}

export function automaticAnchorPair(source, target) {
  const sourceCenter = { x: source.x + source.width / 2, y: source.y + source.height / 2 };
  const targetCenter = { x: target.x + target.width / 2, y: target.y + target.height / 2 };
  const dx = targetCenter.x - sourceCenter.x;
  const dy = targetCenter.y - sourceCenter.y;
  if (Math.abs(dx) >= Math.abs(dy)) {
    return dx >= 0
      ? [{ side: "right", offset: Math.max(0, Math.min(1, (targetCenter.y - source.y) / source.height)) }, { side: "left", offset: Math.max(0, Math.min(1, (sourceCenter.y - target.y) / target.height)) }]
      : [{ side: "left", offset: Math.max(0, Math.min(1, (targetCenter.y - source.y) / source.height)) }, { side: "right", offset: Math.max(0, Math.min(1, (sourceCenter.y - target.y) / target.height)) }];
  }
  return dy >= 0
    ? [{ side: "bottom", offset: Math.max(0, Math.min(1, (targetCenter.x - source.x) / source.width)) }, { side: "top", offset: Math.max(0, Math.min(1, (sourceCenter.x - target.x) / target.width)) }]
    : [{ side: "top", offset: Math.max(0, Math.min(1, (targetCenter.x - source.x) / source.width)) }, { side: "bottom", offset: Math.max(0, Math.min(1, (sourceCenter.x - target.x) / target.width)) }];
}

function outward(point, distance = ROUTE_CLEARANCE) {
  const vectors = { top: [0, -1], right: [1, 0], bottom: [0, 1], left: [-1, 0] };
  const [dx, dy] = vectors[point.side] ?? vectors.right;
  return { x: point.x + dx * distance, y: point.y + dy * distance };
}

function clearSegment(a, b, obstacles) {
  if (a.x !== b.x && a.y !== b.y) return false;
  return !obstacles.some((box) => {
    if (a.x === b.x) return a.x > box.left && a.x < box.right && Math.max(Math.min(a.y, b.y), box.top) < Math.min(Math.max(a.y, b.y), box.bottom);
    return a.y > box.top && a.y < box.bottom && Math.max(Math.min(a.x, b.x), box.left) < Math.min(Math.max(a.x, b.x), box.right);
  });
}

function simplify(points) {
  const result = [];
  for (const point of points) {
    const previous = result.at(-1);
    if (previous && previous.x === point.x && previous.y === point.y) continue;
    const before = result.at(-2);
    if (before && ((before.x === previous.x && previous.x === point.x) || (before.y === previous.y && previous.y === point.y))) result.pop();
    result.push({ x: round(point.x), y: round(point.y) });
  }
  return result;
}

export function routeOrthogonal({ source, target, sourceAnchor, targetAnchor, obstacles = [], existingSegments = [] }) {
  const start = anchorPoint(source, sourceAnchor);
  const end = anchorPoint(target, targetAnchor);
  const first = outward(start);
  const last = outward(end);
  const boxes = obstacles.filter((node) => node.id !== source.id && node.id !== target.id).map((node) => ({
    left: node.x - ROUTE_CLEARANCE, top: node.y - ROUTE_CLEARANCE,
    right: node.x + node.width + ROUTE_CLEARANCE, bottom: node.y + node.height + ROUTE_CLEARANCE
  }));
  const xs = new Set([first.x, last.x]); const ys = new Set([first.y, last.y]);
  for (const box of boxes) { xs.add(box.left); xs.add(box.right); ys.add(box.top); ys.add(box.bottom); }
  const points = [];
  for (const x of xs) for (const y of ys) if (!boxes.some((box) => inside({ x, y }, box))) points.push({ x, y });
  points.push(first, last);
  const unique = [...new Map(points.map((point) => [key(point), point])).values()];
  const index = new Map(unique.map((point, i) => [key(point), i]));
  const graph = unique.map(() => []);
  const crossingCost = (a, b) => existingSegments.reduce((cost, [c, d]) => {
    const crosses = a.x === b.x && c.y === d.y
      ? Math.min(a.y, b.y) < c.y && c.y < Math.max(a.y, b.y) && Math.min(c.x, d.x) < a.x && a.x < Math.max(c.x, d.x)
      : a.y === b.y && c.x === d.x && Math.min(a.x, b.x) < c.x && c.x < Math.max(a.x, b.x) && Math.min(c.y, d.y) < a.y && a.y < Math.max(c.y, d.y);
    return cost + (crosses ? 240 : 0);
  }, 0);
  for (let i = 0; i < unique.length; i += 1) for (let j = i + 1; j < unique.length; j += 1) {
    const a = unique[i]; const b = unique[j];
    if ((a.x === b.x || a.y === b.y) && clearSegment(a, b, boxes)) {
      const cost = Math.abs(a.x - b.x) + Math.abs(a.y - b.y) + crossingCost(a, b);
      graph[i].push([j, cost]); graph[j].push([i, cost]);
    }
  }
  const begin = index.get(key(first)); const finish = index.get(key(last));
  const queue = [{ node: begin, direction: "", cost: 0, path: [] }]; const best = new Map();
  let found = null;
  while (queue.length) {
    queue.sort((a, b) => a.cost - b.cost); const current = queue.shift();
    const signature = `${current.node}:${current.direction}`;
    if ((best.get(signature) ?? Infinity) <= current.cost) continue;
    best.set(signature, current.cost);
    if (current.node === finish) { found = [...current.path, current.node]; break; }
    for (const [next, distance] of graph[current.node]) {
      const direction = unique[next].x === unique[current.node].x ? "v" : "h";
      queue.push({ node: next, direction, cost: current.cost + distance + (current.direction && current.direction !== direction ? 28 : 0), path: [...current.path, current.node] });
    }
  }
  const middle = found ? found.map((item) => unique[item]) : [first, { x: first.x, y: last.y }, last];
  return simplify([start, ...middle, end]);
}

export function relationshipRoute(relationship, elements, options = {}) {
  const source = elements.find((item) => item.id === relationship.source_id);
  const target = elements.find((item) => item.id === relationship.target_id);
  if (!source || !target) return [];
  if (source.id === target.id && !relationship.waypoints?.length) {
    const start = anchorPoint(source, relationship.sourceAnchor ?? { side: "right", offset: 0.35 });
    const end = anchorPoint(target, relationship.targetAnchor ?? { side: "right", offset: 0.65 });
    const loopX = source.x + source.width + ROUTE_CLEARANCE * 2;
    return simplify([start, { x: loopX, y: start.y }, { x: loopX, y: end.y }, end]);
  }
  const automatic = automaticAnchorPair(source, target);
  const sourceAnchor = relationship.sourceAnchor ?? automatic[0];
  const targetAnchor = relationship.targetAnchor ?? automatic[1];
  if (relationship.waypoints?.length && !options.force) return simplify([
    anchorPoint(source, sourceAnchor), ...relationship.waypoints, anchorPoint(target, targetAnchor)
  ]);
  return routeOrthogonal({ source, target, sourceAnchor, targetAnchor, obstacles: elements, existingSegments: options.existingSegments });
}

export function routeToPath(points) {
  return points.length ? `M ${points.map((point) => `${point.x} ${point.y}`).join(" L ")}` : "";
}

export function pointAlongRoute(points, fraction = 0.5) {
  const lengths = points.slice(1).map((point, index) => Math.hypot(point.x - points[index].x, point.y - points[index].y));
  const target = lengths.reduce((sum, item) => sum + item, 0) * fraction; let traveled = 0;
  for (let index = 0; index < lengths.length; index += 1) {
    if (traveled + lengths[index] >= target) {
      const ratio = lengths[index] ? (target - traveled) / lengths[index] : 0;
      return { x: points[index].x + (points[index + 1].x - points[index].x) * ratio, y: points[index].y + (points[index + 1].y - points[index].y) * ratio };
    }
    traveled += lengths[index];
  }
  return points.at(-1) ?? { x: 0, y: 0 };
}

export function segments(points) { return points.slice(1).map((point, index) => [points[index], point]); }

export function routeToJumpPath(points, earlierSegments = [], radius = 6) {
  if (!points.length) return "";
  let path = `M ${points[0].x} ${points[0].y}`;
  for (let index = 1; index < points.length; index += 1) {
    const a = points[index - 1]; const b = points[index];
    if (a.y === b.y) {
      const direction = Math.sign(b.x - a.x) || 1;
      const crossings = earlierSegments.filter(([c, d]) => c.x === d.x && Math.min(a.x, b.x) + radius < c.x && c.x < Math.max(a.x, b.x) - radius && Math.min(c.y, d.y) < a.y && a.y < Math.max(c.y, d.y)).map(([c]) => c.x).sort((x, y) => direction * (x - y));
      for (const x of crossings) path += ` L ${x - direction * radius} ${a.y} Q ${x} ${a.y - radius} ${x + direction * radius} ${a.y}`;
    }
    path += ` L ${b.x} ${b.y}`;
  }
  return path;
}
