import test from "node:test";
import assert from "node:assert/strict";
import { applyPatch, commonElements, decomposeDiagram, diagramCatalog, diagramTypes, hydrateDiagram, isPaletteItemAllowed, migrateLegacyProject, validateDiagram, validateRelationshipCompatibility } from "../src/index.js";

test("catalog contains every unique UML and SysML diagram type", () => {
  assert.equal(diagramCatalog.filter(({ family }) => family === "UML").length, 14);
  assert.equal(diagramCatalog.filter(({ family }) => family === "SysML").length, 9);
  assert.equal(new Set(diagramTypes).size, 23);
});

test("palette keeps common tools global and diagram tools strictly scoped", () => {
  assert.equal(commonElements.some(({ kind }) => kind === "package"), true);
  assert.equal(isPaletteItemAllowed("uml-class", "node", "class"), true);
  assert.equal(isPaletteItemAllowed("uml-class", "relationship", "composition"), true);
  assert.equal(isPaletteItemAllowed("uml-class", "node", "actor"), false);
  assert.equal(isPaletteItemAllowed("uml-use-case", "node", "actor"), true);
  assert.equal(isPaletteItemAllowed("sysml-requirement", "relationship", "satisfy"), true);
  assert.equal(isPaletteItemAllowed("sysml-requirement", "node", "class"), false);
});

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

test("decomposes model semantics from diagram layout and hydrates a compatible canvas view", () => {
  const diagram = { id: "d1", tenant_id: "t1", project_id: "p1", type: "sysml-bdd", metadata: { grid: 20 }, elements: [
    { id: "b1", kind: "block", name: "Vehicle", x: 40, y: 60, width: 200, height: 140, style: { fillColor: "#fff" }, properties: { parts: ["engine: Engine"], operations: ["start()"] } }
  ], relationships: [] };
  const decomposed = decomposeDiagram(diagram);
  assert.deepEqual(decomposed.elements[0].semantic.parts, ["engine: Engine"]);
  assert.equal(decomposed.elements[0].x, undefined);
  assert.equal(decomposed.view.element_refs[0].model_element_id, "b1");
  assert.equal(decomposed.view.element_refs[0].x, 40);
  const hydrated = hydrateDiagram(diagram, { elements: decomposed.elements, relationships: [] }, decomposed.view);
  assert.equal(hydrated.elements[0].name, "Vehicle");
  assert.equal(hydrated.elements[0].x, 40);
});

test("legacy project migration reuses one model element across diagram views", () => {
  const shared = { id: "block_shared", kind: "block", name: "Controller", x: 10, y: 20, width: 100, height: 60, properties: { values: ["status: Boolean"] } };
  const migrated = migrateLegacyProject({ diagrams: [
    { id: "d1", tenant_id: "t", project_id: "p", elements: [shared], relationships: [] },
    { id: "d2", tenant_id: "t", project_id: "p", elements: [{ ...shared, x: 400 }], relationships: [] }
  ] });
  assert.equal(migrated.model.elements.length, 1);
  assert.equal(migrated.diagrams[0].view.element_refs[0].model_element_id, "block_shared");
  assert.equal(migrated.diagrams[1].view.element_refs[0].x, 400);
});

test("relationship compatibility records semantic diagnostics", () => {
  const result = validateRelationshipCompatibility({ kind: "satisfy", source_id: "b", target_id: "b" }, [{ id: "b", kind: "block" }]);
  assert.equal(result.status, "invalid");
  assert.match(result.diagnostics[0], /requirement/);
});
