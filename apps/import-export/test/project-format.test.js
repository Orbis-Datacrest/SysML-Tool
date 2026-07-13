import assert from "node:assert/strict";
import test from "node:test";
import { parseProjectSnapshot, validateDiagramSnapshot } from "../src/projectFormat.js";

function validDiagram() {
  return {
    id: "diagram-1",
    name: "System",
    metadata: { gridSize: 20, showGrid: true },
    elements: [
      { id: "a", kind: "block", name: "A", x: 10, y: 20, width: 180, height: 120, properties: {}, style: { fillColor: "#ffffff" } },
      { id: "b", kind: "block", name: "B", x: 300, y: 20, width: 180, height: 120, properties: {} }
    ],
    relationships: [{ id: "r1", kind: "dependency", source_id: "a", target_id: "b", waypoints: [{ x: 240, y: 80 }], style: { color: "#334455", width: 2 } }]
  };
}

test("legacy diagram JSON remains importable", () => {
  const diagram = validDiagram();
  const imported = parseProjectSnapshot(JSON.stringify(diagram));
  assert.deepEqual(imported.diagram, diagram);
  assert.equal(imported.schemaVersion, 1);
});

test("validation rejects duplicate ids and broken relationship endpoints", () => {
  const duplicate = validDiagram();
  duplicate.elements[1].id = "a";
  assert.throws(() => validateDiagramSnapshot(duplicate), /Duplicate element id/);

  const broken = validDiagram();
  broken.relationships[0].target_id = "missing";
  assert.throws(() => validateDiagramSnapshot(broken), /references an element/);
});

test("invalid JSON, unsupported formats and unsupported versions have clear errors", () => {
  assert.throws(() => parseProjectSnapshot("not-json"), /not valid JSON/);
  assert.throws(() => parseProjectSnapshot(JSON.stringify({ format: "another-tool", diagram: validDiagram() })), /Unsupported file format/);
  assert.throws(() => parseProjectSnapshot(JSON.stringify({ format: "sysml-studio-project", schemaVersion: 99, diagram: validDiagram() })), /Unsupported schema version/);
});

test("validation returns a clone and does not mutate the supplied diagram", () => {
  const diagram = validDiagram();
  const validated = validateDiagramSnapshot(diagram);
  validated.elements[0].name = "Changed";
  assert.equal(diagram.elements[0].name, "A");
});
