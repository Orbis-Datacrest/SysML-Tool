import test from "node:test";
import assert from "node:assert/strict";
import { analyzeRequirementImpact, applyPatch, assertBaselineMutable, buildRequirementHierarchy, calculateEngineeringValue, commonElements, compareProjectVersions, convertValue, createBaseline, createCollaborationSession, createInterfaceDefinition, createRequirement, createUnitRegistry, decomposeDiagram, detectSuspectRequirementLinks, diagramCatalog, diagramTypes, generateRequirementCoverageReport, generateTraceabilityMatrix, hydrateDiagram, isPaletteItemAllowed, migrateLegacyProject, resolveConflict, restoreElement, validateDiagram, validateInterfaceConnection, validateModel, validateQuantity, validateRelationshipCompatibility } from "../src/index.js";

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
    { id: "b1", kind: "block", name: "Vehicle", x: 40, y: 60, width: 200, height: 140, style: { fillColor: "#ffcc00", borderColor: "#123456", textColor: "#654321" }, properties: { parts: ["engine: Engine"], operations: ["start()"] } }
  ], relationships: [] };
  const decomposed = decomposeDiagram(diagram);
  assert.deepEqual(decomposed.elements[0].semantic.parts, ["engine: Engine"]);
  assert.equal(decomposed.elements[0].x, undefined);
  assert.equal(decomposed.view.element_refs[0].model_element_id, "b1");
  assert.equal(decomposed.view.element_refs[0].x, 40);
  const hydrated = hydrateDiagram(diagram, { elements: decomposed.elements, relationships: [] }, decomposed.view);
  assert.equal(hydrated.elements[0].name, "Vehicle");
  assert.equal(hydrated.elements[0].x, 40);
  assert.deepEqual(hydrated.elements[0].style, { fillColor: "#ffcc00", borderColor: "#123456", textColor: "#654321" });
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

test("semantic validation reports actionable repository diagnostics", () => {
  const repository = { elements: [
    { id: "r1", kind: "requirement", name: "First", semantic: { requirementId: "REQ-1" } },
    { id: "r2", kind: "requirement", name: "Second", semantic: { requirementId: "REQ-1" } },
    { id: "p1", kind: "port", name: "Input", semantic: { direction: "in", interfaceType: "I1", multiplicity: "2..1" } },
    { id: "p2", kind: "port", name: "Output", semantic: { direction: "out", interfaceType: "I2" } },
    { id: "t1", kind: "test-case", name: "Test", semantic: {} }
  ], relationships: [
    { id: "c1", kind: "connector", source_id: "p1", target_id: "p2", semantic: {} },
    { id: "v1", kind: "verify", source_id: "p1", target_id: "r1", semantic: {} },
    { id: "missing", kind: "trace", source_id: "r1", target_id: "gone", semantic: {} }
  ] };
  const result = validateModel(repository);
  for (const code of ["duplicate-requirement-id", "invalid-multiplicity", "incompatible-ports", "invalid-connector-direction", "invalid-verify", "missing-reference"]) assert.equal(result.some((item) => item.code === code), true, code);
  assert.equal(result.every((item) => item.severity && item.affectedElement?.id && item.message && item.suggestedFix), true);
});

test("requirement management creates stable IDs and project reports", () => {
  const parent = createRequirement({ id: "r_parent", requirementId: "REQ-001", name: "Parent", text: "The system shall fly.", approvalStatus: "approved", verificationStatus: "passed" });
  const child = createRequirement({ id: "r_child", name: "Child", parentRequirementId: "REQ-001", text: "The system shall stabilize.", verificationStatus: "planned" }, { elements: [parent] });
  assert.equal(child.semantic.requirementId, "REQ-002");
  const repository = { elements: [
    parent,
    child,
    { id: "block_fcs", kind: "block", name: "FCS", semantic: {} },
    { id: "test_stability", kind: "test-case", name: "Stability Test", semantic: {} }
  ], relationships: [
    { id: "sat_1", kind: "satisfy", source_id: "block_fcs", target_id: "r_parent", semantic: { targetBaseline: "old" } },
    { id: "ver_1", kind: "verify", source_id: "test_stability", target_id: "r_parent", semantic: {} },
    { id: "der_1", kind: "derive-reqt", source_id: "r_parent", target_id: "r_child", semantic: {} }
  ] };

  assert.equal(buildRequirementHierarchy(repository)[0].children[0].requirementId, "REQ-002");
  const matrix = generateTraceabilityMatrix(repository);
  assert.deepEqual(matrix.find((row) => row.requirementId === "REQ-001").satisfiedBy, ["block_fcs"]);
  const coverage = generateRequirementCoverageReport(repository);
  assert.equal(coverage.total, 2);
  assert.equal(coverage.coveragePercent, 50);
  assert.deepEqual(analyzeRequirementImpact(repository, "block_fcs").impactedRequirements.map((item) => item.id).sort(), ["r_child", "r_parent"]);
  assert.equal(detectSuspectRequirementLinks(repository).some((item) => item.reason === "target-baseline-changed"), true);
});

test("interface management validates reusable interface compatibility", () => {
  const can = createInterfaceDefinition({ id: "if_can", interfaceId: "CAN-A", category: "electrical", protocols: ["CAN"], signals: ["status"], pins: ["H", "L"], voltage: { min: 4.5, max: 5.5 }, current: { max: 1 }, bandwidth: 1000000 });
  const ethernet = createInterfaceDefinition({ id: "if_eth", interfaceId: "ETH-A", category: "software", protocols: ["Ethernet"], signals: ["status"], pins: ["TX", "RX"], voltage: { min: 1, max: 1.2 }, bandwidth: 100000000 });
  const repository = { elements: [
    can,
    ethernet,
    { id: "p_can", kind: "proxy-port", name: "CAN", semantic: { direction: "out", interfaceId: "CAN-A" } },
    { id: "p_eth", kind: "proxy-port", name: "ETH", semantic: { direction: "in", interfaceId: "ETH-A" } }
  ], relationships: [
    { id: "bad", kind: "connector", source_id: "p_can", target_id: "p_eth", semantic: {} }
  ] };
  const result = validateInterfaceConnection(repository.relationships[0], repository);
  assert.equal(result.status, "invalid");
  assert.equal(validateRelationshipCompatibility(repository.relationships[0], repository.elements).status, "invalid");
  assert.equal(validateModel(repository).some((item) => item.code === "incompatible-interface"), true);
});

test("unit system validates ranges, conversions, custom units, and calculations", () => {
  const repository = { elements: [
    { id: "q_rot", kind: "quantity-kind", name: "Rotational Speed", semantic: { quantityKind: "rotationalSpeed", dimension: { T: -1 } } },
    { id: "rpm", kind: "unit", name: "rpm", semantic: { unitSymbol: "rpm", quantityKind: "rotationalSpeed", factor: 1 / 60 } }
  ] };
  const registry = createUnitRegistry(repository);
  assert.equal(convertValue(1000, "mm", "m", registry), 1);
  assert.equal(Math.round(convertValue(120, "rpm", "Hz", registry)), 2);
  assert.equal(validateQuantity({ value: 13, unit: "V" }, { unit: "V", quantityKind: "voltage", min: 10, max: 16 }, registry).valid, true);
  assert.equal(validateQuantity({ value: 20, unit: "V" }, { unit: "V", quantityKind: "voltage", min: 10, max: 16 }, registry).valid, false);
  assert.deepEqual(calculateEngineeringValue("add", { value: 1, unit: "m" }, { value: 50, unit: "cm" }, "m", registry), { value: 1.5, unit: "m" });
});

test("dimensional analysis rejects incompatible quantity connections", () => {
  const elements = [
    { id: "voltage", kind: "value-type", name: "Voltage", semantic: { quantity: { value: 12, unit: "V", quantityKind: "voltage" } } },
    { id: "temperature", kind: "value-type", name: "Temperature", semantic: { quantity: { value: 20, unit: "°C", quantityKind: "thermodynamicTemperature" } } }
  ];
  const relationship = { id: "bad", kind: "binding-connector", source_id: "voltage", target_id: "temperature", semantic: {} };
  assert.equal(validateRelationshipCompatibility(relationship, elements).status, "invalid");
  assert.equal(validateModel({ elements, relationships: [relationship] }).some((item) => item.code === "incompatible-quantities"), true);
});

test("project version comparison reports model, diagram, relationship, and requirement changes", () => {
  const before = { diagrams: [{ id: "d1", name: "BDD", elements: [
    { id: "b1", kind: "block", name: "Controller", x: 10, y: 10, width: 120, height: 80, properties: { mass: "1 kg" } },
    { id: "r1", kind: "requirement", name: "Req", x: 220, y: 10, width: 150, height: 90, properties: { text: "shall fly" } }
  ], relationships: [{ id: "sat", kind: "satisfy", source_id: "b1", target_id: "r1", label: "satisfies", properties: {} }] }] };
  const after = structuredClone(before);
  after.diagrams[0].elements[0].x = 40;
  after.diagrams[0].elements[0].properties.mass = "2 kg";
  after.diagrams[0].elements[1].properties.text = "shall fly safely";
  after.diagrams[0].relationships[0].label = "verifies";
  const diff = compareProjectVersions(before, after);
  assert.equal(diff.diagramChanges.some((item) => item.entity === "diagram-element" && item.path === "x"), true);
  assert.equal(diff.modelChanges.some((item) => item.path === "properties.mass"), true);
  assert.equal(diff.relationshipChanges.some((item) => item.path === "label"), true);
  assert.equal(diff.requirementChanges.some((item) => item.path === "properties.text"), true);
});

test("released baselines are immutable and element restore is scoped", () => {
  const baseline = createBaseline({ id: "base_1", name: "PDR", version: 1, state: "released" });
  assert.throws(() => assertBaselineMutable(baseline), /immutable/);
  const current = { elements: [{ id: "b1", kind: "block", name: "New", x: 50, y: 50, width: 100, height: 60 }], relationships: [] };
  const snapshot = { elements: [{ id: "b1", kind: "block", name: "Old", x: 10, y: 10, width: 100, height: 60 }], relationships: [] };
  assert.equal(restoreElement(current, snapshot, "b1").elements[0].name, "Old");
});

test("collaboration sessions expose role permissions and conflict details", () => {
  const session = createCollaborationSession({ project_id: "p", diagram_id: "d", user: { id: "u1", email: "reviewer@example.com" }, role: "Reviewer", permissions: ["read", "comment", "approve"] });
  assert.equal(session.user.name, "reviewer");
  const base = { id: "d", elements: [{ id: "a", kind: "class", name: "A", x: 0, y: 0, width: 100, height: 60 }], relationships: [] };
  const local = structuredClone(base);
  const server = structuredClone(base);
  local.elements[0].x = 20;
  server.elements[0].x = 40;
  const result = resolveConflict({ base, local, server });
  assert.equal(result.conflicts.some((item) => item.path === "x"), true);
  assert.equal(result.state.elements[0].x, 20);
});
