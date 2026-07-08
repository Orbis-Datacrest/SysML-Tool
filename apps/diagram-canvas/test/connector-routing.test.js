import test from "node:test";
import assert from "node:assert/strict";
import { nearestAnchor, relationshipRoute, routeToJumpPath } from "../src/connector-routing.js";

const node = (id, x, y, width = 100, height = 80) => ({ id, x, y, width, height });

test("orthogonal routes avoid intervening nodes", () => {
  const elements = [node("a", 0, 100), node("blocker", 160, 70, 100, 140), node("b", 360, 100)];
  const points = relationshipRoute({ source_id: "a", target_id: "b", sourceAnchor: { side: "right" }, targetAnchor: { side: "left" } }, elements);
  assert.ok(points.length >= 4);
  assert.ok(points.slice(1).every((point, index) => point.x === points[index].x || point.y === points[index].y));
  assert.ok(points.some((point) => point.y <= 52 || point.y >= 228), "route clears expanded obstacle");
});

test("manual waypoints remain stable when connected nodes move", () => {
  const relationship = { source_id: "a", target_id: "b", waypoints: [{ x: 180, y: 30 }, { x: 280, y: 30 }] };
  const before = relationshipRoute(relationship, [node("a", 0, 100), node("b", 360, 100)]);
  const after = relationshipRoute(relationship, [node("a", 20, 120), node("b", 400, 120)]);
  assert.deepEqual(before.slice(1, -1), after.slice(1, -1));
});

test("anchors can bind to ports and any side", () => {
  const item = { ...node("a", 10, 20), properties: { ports: [{ id: "p", x: 100, y: 20, side: "right" }] } };
  assert.equal(nearestAnchor(item, { x: 110, y: 40 }).portId, "p");
  assert.equal(nearestAnchor(item, { x: 50, y: 20 }).side, "top");
});

test("line jumps create quadratic bridge commands", () => {
  const path = routeToJumpPath([{ x: 0, y: 50 }, { x: 100, y: 50 }], [[{ x: 50, y: 0 }, { x: 50, y: 100 }]]);
  assert.match(path, / Q 50 44 56 50/);
});
