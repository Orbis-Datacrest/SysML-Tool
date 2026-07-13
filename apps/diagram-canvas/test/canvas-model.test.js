import test from "node:test";
import assert from "node:assert/strict";
import { alignElements, applyElementStyle, autoLayoutElements, canvasScrollFromMinimap, distributeElements, expandGroupedSelection, groupElements, isColorInputValue, minimapViewport, moveSelection, nodesInRect, normalizeColor, removeElements, reorderElements, snapLinesForMove, ungroupElements } from "../src/canvas-model.js";

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

test("alignment and distribution edit multi-selection geometry", () => {
  const elements = [node("a", 10, 10), node("b", 140, 40), node("c", 300, 80)];
  alignElements(elements, ["a", "b", "c"], "top");
  assert.deepEqual(elements.map((item) => item.y), [10, 10, 10]);
  distributeElements(elements, ["a", "b", "c"], "horizontal");
  assert.deepEqual(elements.map((item) => item.x), [10, 155, 300]);
});

test("auto-layout places selected elements on a bounded grid", () => {
  const elements = [node("a", 10, 10), node("b", 10, 10), node("c", 10, 10), node("d", 10, 10)];
  autoLayoutElements(elements, ["a", "b", "c", "d"], { width: 500, height: 500 }, 20);
  assert.equal(new Set(elements.map((item) => `${item.x},${item.y}`)).size, 4);
  assert.equal(elements.every((item) => item.x % 20 === 0 && item.y % 20 === 0), true);
});

test("smart guides report nearby alignment lines", () => {
  const elements = [node("a", 10, 10), node("b", 200, 10)];
  const guides = snapLinesForMove(elements, ["a"], { left: 198, right: 298, top: 12, bottom: 72 });
  assert.equal(guides.some((guide) => guide.axis === "x" && guide.value === 200), true);
  assert.equal(guides.some((guide) => guide.axis === "y" && guide.value === 10), true);
});

test("minimap viewport and drag positions stay synchronized with canvas zoom and scroll", () => {
  const view = minimapViewport({ canvas: { width: 8000, height: 6000 }, viewport: { width: 1000, height: 750 }, minimap: { width: 160, height: 120 }, scroll: { left: 2000, top: 1500 }, zoom: 1 });
  assert.deepEqual(view, { left: 40, top: 30, width: 20, height: 15 });
  assert.deepEqual(canvasScrollFromMinimap({ canvas: { width: 8000, height: 6000 }, minimap: { width: 160, height: 120 }, viewport: { width: 20, height: 15 }, position: { left: 40, top: 30 }, zoom: 1 }), { left: 2000, top: 1500 });
});

test("colors are normalized for native pickers and invalid values use a safe fallback", () => {
  assert.equal(normalizeColor("#3af"), "#33aaff");
  assert.equal(normalizeColor("rgb(300, 16, -2)"), "#ff1000");
  assert.equal(normalizeColor("transparent", "#123456"), "#123456");
  assert.equal(isColorInputValue("#3af"), true);
  assert.equal(isColorInputValue("#33AAFF"), true);
  assert.equal(isColorInputValue("33AAFF"), false);
});
