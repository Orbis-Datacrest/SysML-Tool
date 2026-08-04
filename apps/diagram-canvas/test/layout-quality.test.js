import test from "node:test";
import assert from "node:assert/strict";
import { analyzeLayoutQuality } from "../src/layout/layoutQuality.js";
const node = (id, x, y) => ({ id, x, y, width: 180, height: 120 });
test("layout quality detects overlap and recommends hierarchy direction", () => {
  const result = analyzeLayoutQuality([node("a", 100, 100), node("b", 150, 140), node("c", 500, 100)], [{ kind: "generalization", source_id: "b", target_id: "a" }]);
  assert.equal(result.overlapping_pairs, 1); assert.equal(result.requires_repair, true); assert.equal(result.disconnected_elements, 1); assert.equal(result.suggested_direction, "top-to-bottom");
});
