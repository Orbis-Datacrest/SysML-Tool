import test from "node:test";
import assert from "node:assert/strict";
import { applyElementStyle, expandGroupedSelection, groupElements, moveSelection, nodesInRect, removeElements, reorderElements, ungroupElements } from "../src/canvas-model.js";

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

test("group movement supports pixel-accurate canvas dragging", () => {
  const elements = [node("a", 10, 10), node("b", 130, 30)];
  const originals = Object.fromEntries(elements.map((item) => [item.id, structuredClone(item)]));
  moveSelection(elements, ["a", "b"], originals, 7, 13, { width: 500, height: 500 }, 1);
  assert.deepEqual(elements.map(({ x, y }) => ({ x, y })), [{ x: 17, y: 23 }, { x: 137, y: 43 }]);
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

test("groups expand selection and can be ungrouped from one member", () => {
  const elements = [node("a", 0, 0), node("b", 100, 0), node("c", 200, 0)];
  groupElements(elements, ["a", "b"], "group_1");
  assert.deepEqual(expandGroupedSelection(elements, ["a"]), ["a", "b"]);
  ungroupElements(elements, ["a"]);
  assert.equal(elements.some((item) => item.groupId), false);
});

test("shared styling applies to every selected element", () => {
  const elements = [node("a", 0, 0), node("b", 100, 0), node("c", 200, 0)];
  applyElementStyle(elements, ["a", "b"], "borderWidth", 3, { borderWidth: 1 });
  applyElementStyle(elements, ["a", "b"], "fillColor", "#336699", { fillColor: "#ffffff" });
  assert.equal(elements[0].style.borderWidth, 3);
  assert.equal(elements[1].style.borderWidth, 3);
  assert.equal(elements[0].style.fillColor, "#336699");
  assert.equal(elements[1].style.fillColor, "#336699");
  assert.equal(elements[2].style, undefined);
});
