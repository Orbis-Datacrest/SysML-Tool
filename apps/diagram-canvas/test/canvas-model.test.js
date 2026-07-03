import test from "node:test";
import assert from "node:assert/strict";
import { moveSelection, nodesInRect, removeElements, reorderElements } from "../src/canvas-model.js";

function node(id, x, y, width = 100, height = 60) {
  return { id, kind: "class", name: id, x, y, width, height, properties: {} };
}

test("marquee selection includes every intersecting element", () => {
  const elements = [node("a", 10, 10), node("b", 200, 200)];
  assert.deepEqual(nodesInRect(elements, { left: 0, top: 0, right: 120, bottom: 80 }), ["a"]);
});

test("group movement preserves spacing and stays inside the canvas", () => {
  const elements = [node("a", 10, 10), node("b", 130, 30)];
  const originals = Object.fromEntries(elements.map((item) => [item.id, structuredClone(item)]));
  moveSelection(elements, ["a", "b"], originals, 500, 500, { width: 300, height: 200 });
  assert.deepEqual(elements.map(({ x, y }) => ({ x, y })), [{ x: 80, y: 120 }, { x: 200, y: 140 }]);
});

test("deleting nodes also deletes attached relationships", () => {
  const diagram = { elements: [node("a", 0, 0), node("b", 100, 0)], relationships: [{ id: "r", source_id: "a", target_id: "b" }] };
  removeElements(diagram, ["a"]);
  assert.deepEqual(diagram.elements.map((item) => item.id), ["b"]);
  assert.equal(diagram.relationships.length, 0);
});

test("z-order commands move selected elements one layer", () => {
  const elements = [node("a", 0, 0), node("b", 0, 0), node("c", 0, 0)];
  reorderElements(elements, ["a"], "forward");
  assert.deepEqual(elements.map((item) => item.id), ["b", "a", "c"]);
  reorderElements(elements, ["c"], "backward");
  assert.deepEqual(elements.map((item) => item.id), ["b", "c", "a"]);
});
