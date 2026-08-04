import test from "node:test";
import assert from "node:assert/strict";
import { alignElements, applyElementStyle, autoLayoutElements, canvasScrollFromMinimap, distributeElements, expandGroupedSelection, groupElements, isColorInputValue, layoutElementsByStrategy, minimapViewport, moveSelection, nodesInRect, normalizeColor, placeWithoutOverlap, removeElements, reorderElements, resolveSelectionOverlap, snapLinesForMove, ungroupElements } from "../src/canvas-model.js";

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

test("moving one member moves its complete group without removing membership", () => {
  const elements = [node("a", 10, 10), node("b", 130, 30), node("c", 300, 40)];
  groupElements(elements, ["a", "b"], "group_1");
  const originals = Object.fromEntries(elements.map((item) => [item.id, structuredClone(item)]));

  moveSelection(elements, ["a"], originals, 20, 40, { width: 500, height: 500 }, 1);

  assert.deepEqual(elements.map(({ x, y }) => ({ x, y })), [{ x: 30, y: 50 }, { x: 150, y: 70 }, { x: 300, y: 40 }]);
  assert.deepEqual(elements.map((item) => item.groupId), ["group_1", "group_1", undefined]);
});

test("individual group movement changes one member without removing membership", () => {
  const elements = [node("a", 10, 10), node("b", 130, 30)];
  groupElements(elements, ["a", "b"], "group_1");
  const originals = Object.fromEntries(elements.map((item) => [item.id, structuredClone(item)]));

  moveSelection(elements, ["a"], originals, 17, 23, { width: 500, height: 500 }, 1, false);

  assert.deepEqual(elements.map(({ x, y }) => ({ x, y })), [{ x: 27, y: 33 }, { x: 130, y: 30 }]);
  assert.deepEqual(elements.map((item) => item.groupId), ["group_1", "group_1"]);
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

test("auto-layout uses relationship direction to create readable layers", () => {
  const elements = [node("target", 10, 10), node("source", 10, 10), node("peer", 10, 10)];
  autoLayoutElements(elements, [], { width: 1000, height: 800 }, 20, [
    { source_id: "source", target_id: "target" },
    { source_id: "source", target_id: "peer" }
  ]);
  const source = elements.find((item) => item.id === "source");
  const target = elements.find((item) => item.id === "target");
  const peer = elements.find((item) => item.id === "peer");
  assert.ok(source.x < target.x);
  assert.equal(target.x, peer.x);
  assert.notEqual(target.y, peer.y);
});

test("top-to-bottom layout follows relationships without overlap", () => {
  const elements = [node("root", 20, 20, 180, 90), node("left", 20, 20, 120, 140), node("right", 20, 20, 220, 70)];
  autoLayoutElements(elements, [], { width: 1400, height: 1000 }, 20, [{ source_id: "root", target_id: "left" }, { source_id: "root", target_id: "right" }], "top-to-bottom");
  assert.ok(elements[0].y < elements[1].y && elements[0].y < elements[2].y);
  assert.ok(elements[1].x + elements[1].width <= elements[2].x || elements[2].x + elements[2].width <= elements[1].x);
});

test("auto-layout is deterministic and preserves locks and model identity", () => {
  const elements = [node("a", 0, 0, 140, 80), { ...node("locked", 40, 40), locked: true }, node("b", 0, 0, 190, 120)]; const relationships = [{ id: "rel", kind: "satisfy", source_id: "a", target_id: "b" }]; const locked = structuredClone(elements[1]);
  autoLayoutElements(elements, [], { width: 1200, height: 900 }, 20, relationships); const once = structuredClone(elements); autoLayoutElements(elements, [], { width: 1200, height: 900 }, 20, relationships);
  assert.deepEqual(elements, once); assert.deepEqual(elements[1], locked); assert.equal(relationships[0].kind, "satisfy");
});

test("placement, completed moves, and large layouts prevent overlap", () => {
  const existing = [node("existing", 100, 100, 180, 120)]; const added = node("added", 120, 120, 180, 120); placeWithoutOverlap(added, existing, { width: 800, height: 600 }, 20);
  assert.equal(added.x < 280 && added.x + added.width > 100 && added.y < 220 && added.y + added.height > 100, false);
  const moved = [node("fixed", 200, 200, 160, 100), node("moving", 220, 220, 160, 100)]; assert.equal(resolveSelectionOverlap(moved, ["moving"], { width: 900, height: 700 }, 20), true);
  const elements = Array.from({ length: 18 }, (_, index) => node(`n${index}`, 390, 290, 110, 70)); autoLayoutElements(elements, [], { width: 900, height: 700 }, 20);
  for (let a = 0; a < elements.length; a += 1) for (let b = a + 1; b < elements.length; b += 1) assert.equal(elements[a].x < elements[b].x + elements[b].width && elements[a].x + elements[a].width > elements[b].x && elements[a].y < elements[b].y + elements[b].height && elements[a].y + elements[a].height > elements[b].y, false);
});

test("AI layout strategies rearrange geometry without changing model content", () => {
  const elements = [node("a", 10, 10), node("b", 10, 10), node("c", 10, 10)];
  const names = elements.map((item) => item.name);
  layoutElementsByStrategy(elements, [], "radial", { width: 1000, height: 800 }, 20, []);
  assert.equal(new Set(elements.map((item) => `${item.x},${item.y}`)).size, 3);
  assert.deepEqual(elements.map((item) => item.name), names);
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
