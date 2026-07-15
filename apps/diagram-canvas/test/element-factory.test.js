import assert from "node:assert/strict";
import test from "node:test";
import { defaultNameFor, defaultPropertiesFor, defaultSizeFor } from "../src/editing/elementFactory.js";

test("element factory supplies presentation defaults without canvas DOM state", () => {
  assert.deepEqual(defaultSizeFor("actor"), { width: 110, height: 170 });
  assert.deepEqual(defaultSizeFor("unknown-kind"), { width: 190, height: 170 });
  assert.equal(defaultNameFor("template-class"), "Template Class");
  assert.equal(defaultNameFor("custom-node"), "Custom Node");
  assert.deepEqual(defaultSizeFor("class", "full"), { width: 190, height: 170 });
  assert.deepEqual(defaultSizeFor("class", "simple"), { width: 190, height: 120 });
  assert.deepEqual(defaultPropertiesFor("block", { elements: [] }, "full"), { attributes: [], operations: [] });
  assert.deepEqual(defaultPropertiesFor("block", { elements: [] }, "simple"), { attributes: [] });
});

test("requirement defaults use the next available requirement identifier", () => {
  const properties = defaultPropertiesFor("requirement", {
    version: 4,
    elements: [{ id: "one", kind: "requirement", properties: { requirementId: "REQ-001" } }]
  });

  assert.equal(properties.requirementId, "REQ-002");
  assert.equal(properties.baseline.version, 4);
});
