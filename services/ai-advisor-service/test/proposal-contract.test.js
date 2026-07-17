import test from "node:test";
import assert from "node:assert/strict";
import { buildAiContext } from "../src/contextBuilder.js";
import { materializeSemanticProposal, selectMaterializedOperations, validateProposalReferences } from "../src/layoutEngine.js";
import { validateAiProposal } from "../src/proposalContract.js";
import { AiProviderRegistry, createOllamaProvider, createOpenAiProvider } from "../src/providerRegistry.js";

const baseProposal = () => ({
  summary: "Add a domain class",
  assumptions: ["The name is provisional."],
  clarification_questions: [],
  comments: [],
  operations: [{ id: "add_customer", type: "add_element", rationale: "Represent a customer.", element: { ref: "customer", kind: "class", name: "Customer", variant: "full", properties: { attributes: ["id"] }, stereotypes: [] } }],
  layout_suggestions: [{ id: "layout", strategy: "grid", element_refs: ["customer"], rationale: "Keep additions visible." }]
});

test("strict proposal validation accepts semantic operations without geometry", () => {
  const proposal = validateAiProposal(baseProposal(), "uml-class");
  assert.equal(proposal.operations[0].element.name, "Customer");
});

test("strict proposal validation rejects coordinates, executable fields, and unknown model kinds", () => {
  const geometry = baseProposal(); geometry.operations[0].element.properties = { x: 10 };
  assert.throws(() => validateAiProposal(geometry, "uml-class"), /Unsafe AI proposal field/);
  const code = baseProposal(); code.operations[0].element.properties = { executableCode: "alert(1)" };
  assert.throws(() => validateAiProposal(code, "uml-class"), /Unsafe AI proposal field/);
  const wrongKind = baseProposal(); wrongKind.operations[0].element.kind = "invented-ai-kind";
  assert.throws(() => validateAiProposal(wrongKind, "uml-class"), /Unsupported element kind/);
});

test("AI context excludes canvas coordinates and includes selection, repository, and validation", () => {
  const diagram = { id: "d1", type: "uml-class", name: "Domain", version: 4, elements: [{ id: "e1", kind: "class", name: "Order", x: 999, y: 222, properties: { attributes: ["id"] } }], relationships: [] };
  const context = buildAiContext({ task: "review", prompt: "Review", diagram, selectedElementIds: ["e1"], repository: { elements: [{ id: "repo", kind: "class", name: "Shared", semantic: {} }], relationships: [] }, validation: { valid: true, diagnostics: [] } });
  assert.equal(context.selection[0].id, "e1");
  assert.equal(context.repository.elements[0].id, "repo");
  assert.equal("x" in context.diagram.elements[0], false);
  assert.equal(context.deterministic_validation.valid, true);
});

test("deterministic layout materializes coordinates only after semantic validation", () => {
  const diagram = { id: "d1", type: "uml-class", version: 2, elements: [{ id: "existing", kind: "class", name: "Existing", x: 50, y: 50, width: 200, height: 150 }], relationships: [] };
  const semantic = validateAiProposal(baseProposal(), "uml-class");
  const patch = materializeSemanticProposal(diagram, semantic, (prefix) => `${prefix}_generated`);
  assert.equal(typeof patch.operations[0].element.x, "number");
  assert.equal(semantic.operations[0].element.x, undefined);
  assert.equal(selectMaterializedOperations(patch, ["add_customer"]).length, 1);
});

test("relationship acceptance requires its proposed endpoint operation", () => {
  const raw = baseProposal();
  raw.operations.push({ id: "add_link", type: "add_relationship", rationale: "Link it.", relationship: { ref: "link", kind: "association", source_ref: "existing", target_ref: "customer", label: "owns", properties: {}, stereotypes: [] } });
  const semantic = validateAiProposal(raw, "uml-class");
  const diagram = { elements: [{ id: "existing", kind: "class", x: 0, y: 0, width: 100, height: 100 }], relationships: [] };
  const patch = materializeSemanticProposal(diagram, semantic, (prefix) => `${prefix}_generated`);
  assert.throws(() => selectMaterializedOperations(patch, ["add_link"]), /required by the relationship/);
  assert.equal(selectMaterializedOperations(patch, ["add_customer", "add_link"]).length, 2);
});

test("proposal references must resolve against the diagram or declared temporary refs", () => {
  const diagram = { elements: [{ id: "existing" }], relationships: [] };
  const proposal = baseProposal();
  proposal.operations.push({ id: "bad_link", type: "add_relationship", rationale: "Invalid target.", relationship: { ref: "link", kind: "association", source_ref: "existing", target_ref: "missing", label: "", properties: {}, stereotypes: [] } });
  assert.throws(() => validateProposalReferences(diagram, validateAiProposal(proposal, "uml-class")), /unknown element/);
});

test("provider registry gives Ollama the strict response schema", async () => {
  let requestBody;
  const provider = createOllamaProvider({ fetchImpl: async (_url, options) => {
    requestBody = JSON.parse(options.body);
    return { ok: true, json: async () => ({ message: { content: JSON.stringify(baseProposal()) } }) };
  } });
  const registry = new AiProviderRegistry().register("test", provider);
  await registry.propose("test", { context: { diagram: { type: "uml-class" } }, instructions: "Return a proposal." });
  assert.equal(requestBody.format.additionalProperties, false);
  assert.match(requestBody.messages[0].content, /matching this schema exactly/);
});

test("OpenAI provider uses Responses structured outputs without exposing or storing the key", async () => {
  let requestUrl; let requestHeaders; let requestBody;
  const provider = createOpenAiProvider({ apiKey: "sk-test-secret-key-value-123456", model: "gpt-4o-mini", fetchImpl: async (url, options) => {
    requestUrl = url; requestHeaders = options.headers; requestBody = JSON.parse(options.body);
    return { ok: true, json: async () => ({ output: [{ type: "message", content: [{ type: "output_text", text: JSON.stringify(baseProposal()) }] }] }) };
  } });
  const registry = new AiProviderRegistry();
  const result = await registry.proposeWith(provider, { context: { request: "Create a class Customer" }, instructions: "Return a proposal." });
  assert.equal(requestUrl, "https://api.openai.com/v1/responses");
  assert.equal(requestHeaders.authorization, "Bearer sk-test-secret-key-value-123456");
  assert.equal(requestBody.text.format.type, "json_schema");
  assert.equal(requestBody.text.format.strict, true);
  assert.equal(requestBody.store, false);
  assert.equal(result.operations[0].element.name, "Customer");
});
