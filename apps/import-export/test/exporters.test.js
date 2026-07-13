import test from "node:test";
import assert from "node:assert/strict";
import { exporters, importers, toPlantUml, toRequirementsCsv, toRequirementsXlsx, toSvg, toVectorPdf } from "../src/exporters.js";

const diagram = { name: "System", elements: [{ id: "a", kind: "requirement", name: "Safe", x: 10, y: 20, width: 180, height: 100, properties: { requirementId: "REQ-1", text: "Remain safe", attributes: ["risk: low"] }, stereotypes: ["critical"], style: { fillColor: "#ffeecc" } }, { id: "b", kind: "block", name: "Controller", x: 300, y: 20, width: 180, height: 100, properties: {} }], relationships: [{ id: "r", kind: "satisfy", source_id: "b", target_id: "a", label: "satisfies", roleLabel: "safety", multiplicity: "1", waypoints: [{ x: 250, y: 150 }] }] };

test("SVG preserves layout, style, compartments, route and labels", () => {
  const svg = toSvg(diagram);
  assert.match(svg, /viewBox=/); assert.match(svg, /#ffeecc/); assert.match(svg, /risk: low/); assert.match(svg, /satisfies  safety  1/); assert.match(svg, /L 250 150/);
});

test("PDF contains vector paths and text rather than a placeholder page", () => {
  const pdf = new TextDecoder().decode(toVectorPdf(diagram));
  assert.match(pdf, /^%PDF-1.4/); assert.match(pdf, /Controller/); assert.match(pdf, / re B/); assert.match(pdf, / l S/);
});

test("requirements CSV and XLSX contain requirement data", () => {
  assert.match(toRequirementsCsv(diagram), /REQ-1/); assert.match(toRequirementsCsv(diagram), /Remain safe/);
  const xlsx = toRequirementsXlsx(diagram); assert.equal(String.fromCharCode(...xlsx.slice(0, 2)), "PK"); assert.ok(new TextDecoder().decode(xlsx).includes("REQ-1"));
});

test("PlantUML emits semantic relationship and stable aliases", () => {
  const source = toPlantUml(diagram); assert.match(source, /n_b --> "1" n_a : satisfies \/ safety/); assert.match(source, /skinparam linetype ortho/);
});

test("Studio JSON round-trips canvas content, styling, routes and viewport", () => {
  const styled = structuredClone(diagram);
  styled.id = "diagram-1";
  styled.metadata = { gridSize: 28, showGrid: false, pageSize: "a3-landscape" };
  styled.elements[0].style = { fillColor: "#ffeecc", borderColor: "#123456", textColor: "#332211", borderWidth: 3, textSize: 16 };
  styled.relationships[0].style = { color: "#654321", width: 4 };
  styled.relationships[0].sourceAnchor = { side: "right", ratio: 0.4 };
  styled.relationships[0].targetAnchor = { side: "left", ratio: 0.7 };
  const staleDiagramList = structuredClone(styled);
  staleDiagramList.name = "Older saved name";
  const serialized = exporters.get("json").serialize(styled, {
    project: { id: "project-1", name: "Vehicle" },
    diagrams: [staleDiagramList],
    modelRepository: { schema_version: 2, elements: [], relationships: [] },
    canvasViewport: { zoom: 1.35, scrollLeft: 220, scrollTop: 140 }
  });

  const restored = importers.get("json").parse(serialized);
  const packageValue = JSON.parse(serialized);

  assert.equal(packageValue.format, "sysml-studio-project");
  assert.equal(packageValue.schemaVersion, 3);
  assert.deepEqual(packageValue.diagrams[0], styled);
  assert.deepEqual(restored.diagram, styled);
  assert.deepEqual(restored.viewport, { zoom: 1.35, scrollLeft: 220, scrollTop: 140 });
});
