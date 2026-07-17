import test from "node:test";
import assert from "node:assert/strict";
import { parseModelingPrompt } from "../src/promptParser.js";
import { validateAiProposal } from "../src/proposalContract.js";

const diagram = (type, elements = []) => ({ id: "diagram", type, name: "Test", version: 1, elements, relationships: [] });
const parse = (type, request, elements = []) => parseModelingPrompt({ diagram: diagram(type, elements), request });

test("extracts a class name, attributes, and operations instead of using the full prompt", () => {
  const result = parse("uml-class", "Create a class Ethiopia with attributes population, capital, area and operations getPopulation() and setPopulation()");
  const element = result.operations[0].element;
  assert.equal(element.name, "Ethiopia");
  assert.deepEqual(element.properties.attributes, ["population", "capital", "area"]);
  assert.deepEqual(element.properties.operations, ["getPopulation()", "setPopulation()"]);
  validateAiProposal(result, "uml-class");
});

test("creates multiple elements and a relationship with multiplicities", () => {
  const result = parse("uml-class", "Create classes Customer and Order. Connect Customer to Order with association multiplicities 1 to 0..*.");
  assert.deepEqual(result.operations.filter((item) => item.type === "add_element").map((item) => item.element.name), ["Customer", "Order"]);
  const relationship = result.operations.find((item) => item.type === "add_relationship").relationship;
  assert.equal(relationship.kind, "association");
  assert.deepEqual(relationship.properties, { sourceMultiplicity: "1", targetMultiplicity: "0..*" });
  validateAiProposal(result, "uml-class");
});

test("understands coordinated elements after one create verb", () => {
  const result = parse("uml-use-case", "Create an actor Customer and a use case Place Order. Connect Customer to Place Order with association.");
  assert.deepEqual(result.operations.filter((item) => item.type === "add_element").map((item) => [item.element.kind, item.element.name]), [["actor", "Customer"], ["use-case", "Place Order"]]);
  assert.equal(result.operations.find((item) => item.type === "add_relationship").relationship.kind, "association");
});

test("updates an existing named element", () => {
  const existing = { id: "ethiopia", kind: "class", name: "Ethiopia", properties: { attributes: ["population"], operations: [] } };
  const result = parse("uml-class", "Add attributes capital and area to Ethiopia", [existing]);
  assert.equal(result.operations[0].type, "update_element");
  assert.deepEqual(result.operations[0].changes.properties.attributes, ["population", "capital", "area"]);
});

test("extracts requirement identifiers and shall statements", () => {
  const result = parse("sysml-requirement", "Create a requirement Safety REQ-101: The system shall stop safely on critical failure");
  const element = result.operations[0].element;
  assert.equal(element.name, "Safety");
  assert.equal(element.properties.requirementId, "REQ-101");
  assert.equal(element.properties.text, "The system shall stop safely on critical failure");
});

test("extracts typed and directed block ports", () => {
  const result = parse("sysml-bdd", "Create a block Controller with ports input sensorData: Signal and output command: Command");
  assert.equal(result.operations[0].element.name, "Controller");
  assert.deepEqual(result.operations[0].element.properties.ports.map(({ name, direction, type }) => ({ name, direction, type })), [
    { name: "sensorData", direction: "in", type: "Signal" },
    { name: "command", direction: "out", type: "Command" }
  ]);
});

test("creates states and transitions on state-machine diagrams", () => {
  const result = parse("uml-state-machine", "Create states Idle and Running. Connect Idle to Running with transition.");
  assert.deepEqual(result.operations.filter((item) => item.type === "add_element").map((item) => item.element.name), ["Idle", "Running"]);
  assert.equal(result.operations.find((item) => item.type === "add_relationship").relationship.kind, "transition");
  validateAiProposal(result, "uml-state-machine");
});

test("understands a state-machine request containing a state list", () => {
  const result = parse("uml-state-machine", "Create a state machine OrderFlow with states Draft, Submitted and Complete");
  assert.deepEqual(result.operations.map((item) => item.element.name), ["Draft", "Submitted", "Complete"]);
});

test("continues generation and recommends a matching notation when the active diagram differs", () => {
  const result = parse("uml-timing", "Create a class Ethiopia with attributes population and capital");
  assert.equal(result.operations[0].element.name, "Ethiopia");
  assert.deepEqual(result.operations[0].element.properties.attributes, ["population", "capital"]);
  assert.match(result.assumptions[0], /Class diagram.*UML Timing/i);
  assert.equal(result.clarification_questions.length, 0);
  validateAiProposal(result, "uml-timing");
});
