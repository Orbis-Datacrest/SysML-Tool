import { diagramCatalog } from "./diagram-catalog.js";

export * from "./model-repository.js";

export { commonElements, diagramCatalog, isPaletteItemAllowed, paletteForDiagram } from "./diagram-catalog.js";

export const diagramTypes = diagramCatalog.map((diagram) => diagram.value);

export const elementKinds = [
  "class",
  "interface",
  "block",
  "package",
  "requirement",
  "actor",
  "use-case",
  "state",
  "activity",
  "action",
  "decision",
  "lifeline",
  "message",
  "port",
  "connector",
  "note", "comment", "enumeration", "data-type", "object", "slot", "component", "artifact",
  "node", "device", "execution-environment", "model", "import", "structured-classifier", "part",
  "collaboration", "profile", "stereotype", "metaclass", "system-boundary", "initial-node", "final-node",
  "fork-join", "initial-state", "final-state", "choice", "history-state", "activation", "combined-fragment",
  "interaction", "interaction-use", "state-invariant", "time-constraint", "duration-constraint", "value-type",
  "interface-block", "constraint-block", "reference", "flow-property", "view", "viewpoint",
  "constraint-property", "value-property", "parameter", "binding-connector", "object-node", "test-case",
  "rationale", "problem", "primitive-type", "signal", "accept-event-action", "send-signal-action", "merge-node",
  "activity-final", "flow-final", "fork-node", "join-node", "input-pin", "output-pin",
  "activity-partition", "composite-state", "junction", "entry-point", "exit-point", "terminate",
  "destruction-occurrence", "continuation", "rate"
  , "diagram-frame", "constraint", "instance-specification", "provided-interface", "required-interface", "region",
  "state-timeline", "unit", "quantity-kind", "part-property", "reference-property", "proxy-port", "full-port",
  "constraint-parameter", "control-operator"
];

export const relationshipKinds = [
  "association",
  "directional-association",
  "bidirectional-association",
  "aggregation",
  "composition",
  "containment",
  "generalization",
  "realization",
  "dependency",
  "include",
  "extend",
  "trace",
  "satisfy",
  "verify",
  "refine",
  "allocate",
  "flow",
  "connector",
  "sequence-message"
  , "note-connector", "link", "communication-path", "package-merge", "extension", "control-flow", "object-flow",
  "transition", "synchronous-message", "asynchronous-message", "return-message", "numbered-message", "item-flow",
  "binding-connector", "derive-reqt"
];

export function validateDiagram(diagram) {
  const errors = [];
  if (!diagram?.tenant_id) errors.push("diagram.tenant_id is required");
  if (!diagram?.project_id) errors.push("diagram.project_id is required");
  if (!diagramTypes.includes(diagram?.type)) errors.push(`Unsupported diagram type: ${diagram?.type}`);

  const elementIds = new Set();
  for (const element of diagram.elements ?? []) {
    if (!element.id) errors.push("Element id is required");
    if (!elementKinds.includes(element.kind)) errors.push(`Unsupported element kind: ${element.kind}`);
    if (elementIds.has(element.id)) errors.push(`Duplicate element id: ${element.id}`);
    elementIds.add(element.id);
  }

  for (const relationship of diagram.relationships ?? []) {
    if (!relationshipKinds.includes(relationship.kind)) {
      errors.push(`Unsupported relationship kind: ${relationship.kind}`);
    }
    if (!elementIds.has(relationship.source_id)) {
      errors.push(`Relationship ${relationship.id} has missing source ${relationship.source_id}`);
    }
    if (!elementIds.has(relationship.target_id)) {
      errors.push(`Relationship ${relationship.id} has missing target ${relationship.target_id}`);
    }
  }

  return { valid: errors.length === 0, errors };
}

export function applyPatch(diagram, patch) {
  const next = structuredClone(diagram);
  for (const operation of patch.operations ?? []) {
    if (operation.op === "addElement") {
      next.elements.push(operation.element);
    }
    if (operation.op === "updateElement") {
      next.elements = next.elements.map((element) =>
        element.id === operation.element_id ? { ...element, ...operation.changes } : element
      );
    }
    if (operation.op === "removeElement") {
      next.elements = next.elements.filter((element) => element.id !== operation.element_id);
      next.relationships = next.relationships.filter(
        (relationship) =>
          relationship.source_id !== operation.element_id && relationship.target_id !== operation.element_id
      );
    }
    if (operation.op === "addRelationship") {
      next.relationships.push(operation.relationship);
    }
    if (operation.op === "removeRelationship") {
      next.relationships = next.relationships.filter((relationship) => relationship.id !== operation.relationship_id);
    }
  }
  next.version = (next.version ?? 0) + 1;
  next.updated_at = new Date().toISOString();
  return next;
}

export function createId(prefix) {
  return `${prefix}_${Math.random().toString(36).slice(2, 10)}`;
}
