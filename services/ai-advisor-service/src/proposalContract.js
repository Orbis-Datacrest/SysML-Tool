import { diagramTypes, elementKinds, relationshipKinds } from "../../../packages/model-core/src/index.js";

const SUPPORTED_DIAGRAMS = new Set(diagramTypes);
const ALLOWED_ELEMENT_KINDS = new Set(elementKinds);
const ALLOWED_RELATIONSHIP_KINDS = new Set(relationshipKinds);
const OPERATION_TYPES = new Set(["add_element", "update_element", "remove_element", "add_relationship", "remove_relationship"]);
const LAYOUT_STRATEGIES = new Set(["flow", "hierarchical", "grid", "radial"]);
const forbiddenGeometry = new Set(["x", "y", "width", "height", "left", "top", "points", "waypoints", "sourceAnchor", "targetAnchor"]);

export const aiProposalJsonSchema = {
  type: "object",
  additionalProperties: false,
  required: ["summary", "assumptions", "clarification_questions", "comments", "operations", "layout_suggestions"],
  properties: {
    summary: { type: "string", maxLength: 600 },
    assumptions: { type: "array", maxItems: 12, items: { type: "string", maxLength: 400 } },
    clarification_questions: { type: "array", maxItems: 8, items: { type: "string", maxLength: 400 } },
    comments: { type: "array", maxItems: 30, items: { $ref: "#/$defs/comment" } },
    operations: { type: "array", maxItems: 80, items: { anyOf: [
      { $ref: "#/$defs/addElement" }, { $ref: "#/$defs/updateElement" }, { $ref: "#/$defs/removeElement" }, { $ref: "#/$defs/addRelationship" }, { $ref: "#/$defs/removeRelationship" }
    ] } },
    layout_suggestions: { type: "array", maxItems: 8, items: { $ref: "#/$defs/layout" } }
  },
  $defs: {
    stringList: { type: "array", maxItems: 50, items: { type: "string" } },
    port: { type: "object", additionalProperties: false, required: ["id", "name", "direction", "type"], properties: { id: { type: "string" }, name: { type: "string" }, direction: { type: "string", enum: ["in", "out", "inout"] }, type: { type: "string" } } },
    elementProperties: { type: "object", additionalProperties: false, required: ["attributes", "operations", "ports", "requirementId", "text"], properties: {
      attributes: { $ref: "#/$defs/stringList" }, operations: { $ref: "#/$defs/stringList" }, ports: { type: "array", maxItems: 50, items: { $ref: "#/$defs/port" } }, requirementId: { type: ["string", "null"] }, text: { type: ["string", "null"] }
    } },
    relationshipProperties: { type: "object", additionalProperties: false, required: ["sourceMultiplicity", "targetMultiplicity", "guard"], properties: { sourceMultiplicity: { type: ["string", "null"] }, targetMultiplicity: { type: ["string", "null"] }, guard: { type: ["string", "null"] } } },
    element: { type: "object", additionalProperties: false, required: ["ref", "kind", "name", "variant", "properties", "stereotypes"], properties: { ref: { type: "string" }, kind: { type: "string", enum: elementKinds }, name: { type: "string" }, variant: { type: ["string", "null"] }, properties: { $ref: "#/$defs/elementProperties" }, stereotypes: { $ref: "#/$defs/stringList" } } },
    changes: { type: "object", additionalProperties: false, required: ["name", "variant", "properties", "stereotypes"], properties: { name: { type: ["string", "null"] }, variant: { type: ["string", "null"] }, properties: { $ref: "#/$defs/elementProperties" }, stereotypes: { $ref: "#/$defs/stringList" } } },
    relationship: { type: "object", additionalProperties: false, required: ["ref", "kind", "source_ref", "target_ref", "label", "properties", "stereotypes"], properties: { ref: { type: "string" }, kind: { type: "string", enum: relationshipKinds }, source_ref: { type: "string" }, target_ref: { type: "string" }, label: { type: "string" }, properties: { $ref: "#/$defs/relationshipProperties" }, stereotypes: { $ref: "#/$defs/stringList" } } },
    addElement: { type: "object", additionalProperties: false, required: ["id", "type", "element", "rationale"], properties: { id: { type: "string" }, type: { const: "add_element" }, element: { $ref: "#/$defs/element" }, rationale: { type: "string" } } },
    updateElement: { type: "object", additionalProperties: false, required: ["id", "type", "target_id", "changes", "rationale"], properties: { id: { type: "string" }, type: { const: "update_element" }, target_id: { type: "string" }, changes: { $ref: "#/$defs/changes" }, rationale: { type: "string" } } },
    removeElement: { type: "object", additionalProperties: false, required: ["id", "type", "target_id", "rationale"], properties: { id: { type: "string" }, type: { const: "remove_element" }, target_id: { type: "string" }, rationale: { type: "string" } } },
    addRelationship: { type: "object", additionalProperties: false, required: ["id", "type", "relationship", "rationale"], properties: { id: { type: "string" }, type: { const: "add_relationship" }, relationship: { $ref: "#/$defs/relationship" }, rationale: { type: "string" } } },
    removeRelationship: { type: "object", additionalProperties: false, required: ["id", "type", "relationship_id", "rationale"], properties: { id: { type: "string" }, type: { const: "remove_relationship" }, relationship_id: { type: "string" }, rationale: { type: "string" } } },
    comment: { type: "object", additionalProperties: false, required: ["id", "anchor_type", "anchor_id", "severity", "message", "suggestion"], properties: { id: { type: "string" }, anchor_type: { type: "string", enum: ["diagram", "element"] }, anchor_id: { type: "string" }, severity: { type: "string", enum: ["info", "warning", "error"] }, message: { type: "string" }, suggestion: { type: "string" } } },
    layout: { type: "object", additionalProperties: false, required: ["id", "strategy", "element_refs", "rationale"], properties: { id: { type: "string" }, strategy: { type: "string", enum: [...LAYOUT_STRATEGIES] }, element_refs: { $ref: "#/$defs/stringList" }, rationale: { type: "string" } } }
  }
};

const plainObject = (value) => Boolean(value) && typeof value === "object" && !Array.isArray(value);
const text = (value, field, max = 400, allowEmpty = false) => {
  if (typeof value !== "string" || (!allowEmpty && !value.trim()) || value.length > max) throw new Error(`Invalid AI proposal field: ${field}`);
  return value.trim();
};
const exactKeys = (value, allowed, field) => {
  if (!plainObject(value)) throw new Error(`Invalid AI proposal field: ${field}`);
  const extra = Object.keys(value).find((key) => !allowed.includes(key));
  if (extra) throw new Error(`Unsupported AI proposal field: ${field}.${extra}`);
};
const safeData = (value, field, depth = 0) => {
  if (depth > 4) throw new Error(`AI proposal field is too deeply nested: ${field}`);
  if (value === null || typeof value === "string" || typeof value === "number" || typeof value === "boolean") return value;
  if (Array.isArray(value)) {
    if (value.length > 50) throw new Error(`AI proposal field is too large: ${field}`);
    return value.map((item, index) => safeData(item, `${field}[${index}]`, depth + 1));
  }
  if (!plainObject(value)) throw new Error(`Invalid AI proposal field: ${field}`);
  const result = {};
  for (const [key, item] of Object.entries(value)) {
    if (forbiddenGeometry.has(key) || /(?:html|script|code|sql|command|query|executable)/i.test(key)) throw new Error(`Unsafe AI proposal field: ${field}.${key}`);
    result[key] = safeData(item, `${field}.${key}`, depth + 1);
  }
  return result;
};

function validateOperation(raw, index) {
  exactKeys(raw, ["id", "type", "element", "target_id", "changes", "relationship", "relationship_id", "rationale"], `operations[${index}]`);
  const id = text(raw.id, `operations[${index}].id`, 80);
  const type = text(raw.type, `operations[${index}].type`, 40);
  if (!OPERATION_TYPES.has(type)) throw new Error(`Unsupported AI operation: ${type}`);
  const base = { id, type, rationale: text(raw.rationale ?? "AI suggestion", `operations[${index}].rationale`, 500) };
  if (type === "add_element") {
    exactKeys(raw.element, ["ref", "kind", "name", "variant", "properties", "stereotypes"], `operations[${index}].element`);
    return { ...base, element: {
      ref: text(raw.element.ref, `operations[${index}].element.ref`, 80),
      kind: text(raw.element.kind, `operations[${index}].element.kind`, 80),
      name: text(raw.element.name, `operations[${index}].element.name`, 200),
      ...(raw.element.variant ? { variant: text(raw.element.variant, `operations[${index}].element.variant`, 20) } : {}),
      properties: safeData(raw.element.properties ?? {}, `operations[${index}].element.properties`),
      stereotypes: (raw.element.stereotypes ?? []).map((item, itemIndex) => text(item, `operations[${index}].element.stereotypes[${itemIndex}]`, 80))
    } };
  }
  if (type === "update_element") {
    exactKeys(raw.changes, ["name", "properties", "stereotypes", "variant"], `operations[${index}].changes`);
    return { ...base, target_id: text(raw.target_id, `operations[${index}].target_id`, 100), changes: safeData(raw.changes, `operations[${index}].changes`) };
  }
  if (type === "remove_element") return { ...base, target_id: text(raw.target_id, `operations[${index}].target_id`, 100) };
  if (type === "add_relationship") {
    exactKeys(raw.relationship, ["ref", "kind", "source_ref", "target_ref", "label", "properties", "stereotypes"], `operations[${index}].relationship`);
    return { ...base, relationship: {
      ref: text(raw.relationship.ref, `operations[${index}].relationship.ref`, 80),
      kind: text(raw.relationship.kind, `operations[${index}].relationship.kind`, 80),
      source_ref: text(raw.relationship.source_ref, `operations[${index}].relationship.source_ref`, 100),
      target_ref: text(raw.relationship.target_ref, `operations[${index}].relationship.target_ref`, 100),
      label: text(raw.relationship.label ?? "", `operations[${index}].relationship.label`, 200, true),
      properties: safeData(raw.relationship.properties ?? {}, `operations[${index}].relationship.properties`),
      stereotypes: (raw.relationship.stereotypes ?? []).map((item, itemIndex) => text(item, `operations[${index}].relationship.stereotypes[${itemIndex}]`, 80))
    } };
  }
  return { ...base, relationship_id: text(raw.relationship_id, `operations[${index}].relationship_id`, 100) };
}

export function validateAiProposal(raw, diagramType) {
  if (!SUPPORTED_DIAGRAMS.has(diagramType)) throw new Error(`Unsupported active diagram type: ${diagramType}`);
  exactKeys(raw, ["summary", "assumptions", "clarification_questions", "comments", "operations", "layout_suggestions"], "proposal");
  for (const field of ["assumptions", "clarification_questions", "comments", "operations", "layout_suggestions"]) if (!Array.isArray(raw[field])) throw new Error(`Invalid AI proposal field: ${field}`);
  if (raw.operations.length > 80 || raw.comments.length > 30 || raw.assumptions.length > 12 || raw.clarification_questions.length > 8 || raw.layout_suggestions.length > 8) throw new Error("AI proposal exceeds the allowed size.");
  const operations = raw.operations.map(validateOperation);
  const ids = new Set();
  for (const operation of operations) {
    if (ids.has(operation.id)) throw new Error(`Duplicate AI operation id: ${operation.id}`);
    ids.add(operation.id);
    if (operation.type === "add_element" && !ALLOWED_ELEMENT_KINDS.has(operation.element.kind)) throw new Error(`Unsupported element kind: ${operation.element.kind}`);
    if (operation.type === "add_relationship" && !ALLOWED_RELATIONSHIP_KINDS.has(operation.relationship.kind)) throw new Error(`Unsupported relationship kind: ${operation.relationship.kind}`);
  }
  return {
    summary: text(raw.summary, "summary", 600),
    assumptions: raw.assumptions.slice(0, 12).map((item, index) => text(item, `assumptions[${index}]`, 400)),
    clarification_questions: raw.clarification_questions.slice(0, 8).map((item, index) => text(item, `clarification_questions[${index}]`, 400)),
    comments: raw.comments.slice(0, 30).map((item, index) => {
      exactKeys(item, ["id", "anchor_type", "anchor_id", "severity", "message", "suggestion"], `comments[${index}]`);
      const severity = text(item.severity ?? "info", `comments[${index}].severity`, 20);
      if (!["info", "warning", "error"].includes(severity)) throw new Error(`Invalid AI comment severity: ${severity}`);
      return { id: text(item.id, `comments[${index}].id`, 80), anchor_type: item.anchor_type === "diagram" ? "diagram" : "element", anchor_id: text(item.anchor_id ?? "diagram", `comments[${index}].anchor_id`, 100), severity, message: text(item.message, `comments[${index}].message`, 800), suggestion: text(item.suggestion ?? "", `comments[${index}].suggestion`, 800, true) };
    }),
    operations,
    layout_suggestions: raw.layout_suggestions.slice(0, 8).map((item, index) => {
      exactKeys(item, ["id", "strategy", "element_refs", "rationale"], `layout_suggestions[${index}]`);
      const strategy = text(item.strategy, `layout_suggestions[${index}].strategy`, 30);
      if (!LAYOUT_STRATEGIES.has(strategy)) throw new Error(`Unsupported layout strategy: ${strategy}`);
      return { id: text(item.id, `layout_suggestions[${index}].id`, 80), strategy, element_refs: (item.element_refs ?? []).map((ref, refIndex) => text(ref, `layout_suggestions[${index}].element_refs[${refIndex}]`, 100)), rationale: text(item.rationale, `layout_suggestions[${index}].rationale`, 500) };
    })
  };
}

export const isAiDiagramSupported = (diagramType) => SUPPORTED_DIAGRAMS.has(diagramType);
