export const diagramTypes = [
  "uml-class",
  "uml-state-machine",
  "uml-activity",
  "uml-sequence",
  "sysml-bdd",
  "sysml-ibd",
  "sysml-requirement",
  "sysml-parametric",
  "sysml-use-case"
];

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
  "note"
];

export const relationshipKinds = [
  "association",
  "aggregation",
  "composition",
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
