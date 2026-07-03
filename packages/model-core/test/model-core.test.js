import test from "node:test";
import assert from "node:assert/strict";
import { applyPatch, validateDiagram } from "../src/index.js";

test("validates tenant-scoped diagrams and relationships", () => {
  const diagram = {
    id: "diagram_1",
    tenant_id: "tenant_1",
    project_id: "project_1",
    type: "uml-class",
    version: 1,
    elements: [{ id: "class_1", kind: "class", name: "Order", x: 0, y: 0, width: 160, height: 96, properties: {} }],
    relationships: []
  };

  assert.equal(validateDiagram(diagram).valid, true);
});

test("applies AI preview patches without mutating original diagram", () => {
  const diagram = {
    id: "diagram_1",
    tenant_id: "tenant_1",
    project_id: "project_1",
    type: "uml-class",
    version: 1,
    elements: [],
    relationships: []
  };

  const next = applyPatch(diagram, {
    summary: "Add User class",
    operations: [
      {
        op: "addElement",
        element: { id: "class_user", kind: "class", name: "User", x: 20, y: 20, width: 160, height: 96, properties: {} }
      }
    ]
  });

  assert.equal(diagram.elements.length, 0);
  assert.equal(next.elements.length, 1);
  assert.equal(next.version, 2);
});

test("validates the interactive canvas relationship variants", () => {
  const elements = [
    { id: "a", kind: "class", name: "A", x: 0, y: 0, width: 100, height: 60, properties: {} },
    { id: "b", kind: "class", name: "B", x: 200, y: 0, width: 100, height: 60, properties: {} }
  ];
  for (const kind of ["directional-association", "bidirectional-association", "containment"]) {
    const result = validateDiagram({ tenant_id: "tenant", project_id: "project", type: "uml-class", elements, relationships: [{ id: kind, kind, source_id: "a", target_id: "b" }] });
    assert.equal(result.valid, true, `${kind} should be supported`);
  }
});
