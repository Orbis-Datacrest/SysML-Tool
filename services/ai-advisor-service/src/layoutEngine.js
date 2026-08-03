const sizes = { actor: [110, 170], "use-case": [160, 86], requirement: [220, 140], class: [210, 160], block: [210, 160] };
const clamp = (value, minimum, maximum) => Math.min(maximum, Math.max(minimum, value));
const withPortLayout = (properties, width, height) => {
  if (!Array.isArray(properties?.ports)) return properties;
  const ports = properties.ports.map((port, index) => {
    const side = ["in", "input"].includes(port.direction) ? "left" : ["out", "output"].includes(port.direction) ? "right" : index % 2 ? "right" : "left";
    return { ...port, side, x: side === "left" ? 0 : width, y: Math.round(((index + 1) * height) / (properties.ports.length + 1)) };
  });
  return { ...properties, ports };
};

export function materializeSemanticProposal(diagram, proposal, createId) {
  const existing = new Map(diagram.elements.map((item) => [item.id, item.id]));
  const refToId = new Map(existing);
  const additions = proposal.operations.filter((item) => item.type === "add_element");
  const occupiedRight = diagram.elements.reduce((max, item) => Math.max(max, Number(item.x ?? 0) + Number(item.width ?? 180)), 80);
  additions.forEach((operation) => refToId.set(operation.element.ref, createId(operation.element.kind.replace(/[^a-z0-9]/gi, "") || "element")));
  const operations = [];
  let addIndex = 0;
  for (const semantic of proposal.operations) {
    if (semantic.type === "add_element") {
      const [width, height] = sizes[semantic.element.kind] ?? [190, 120];
      const column = addIndex % 3; const row = Math.floor(addIndex / 3); addIndex += 1;
      operations.push({ semantic_operation_id: semantic.id, op: "addElement", element: {
        id: refToId.get(semantic.element.ref), kind: semantic.element.kind, name: semantic.element.name,
        ...(semantic.element.variant ? { variant: semantic.element.variant } : {}),
        x: clamp(occupiedRight + 80 + column * 250, 40, 4700), y: clamp(120 + row * 210, 40, 3700), width, height,
        properties: semantic.element.kind === "requirement" ? {
          requirementId: semantic.element.properties.requirementId || `REQ-AI-${String(addIndex).padStart(3, "0")}`,
          text: semantic.element.properties.text || semantic.element.name,
          priority: "medium", risk: "medium", approvalStatus: "draft", verificationStatus: "not-started", verificationMethod: "test",
          ...semantic.element.properties
        } : withPortLayout(semantic.element.properties, width, height),
        stereotypes: semantic.element.stereotypes
      } });
    } else if (semantic.type === "update_element") {
      const current = diagram.elements.find((item) => item.id === semantic.target_id);
      const mergedProperties = semantic.changes.properties ? { ...(current?.properties ?? {}), ...semantic.changes.properties } : null;
      const changes = { ...semantic.changes, ...(mergedProperties ? { properties: withPortLayout(mergedProperties, current?.width ?? 190, current?.height ?? 170) } : {}) };
      operations.push({ semantic_operation_id: semantic.id, op: "updateElement", element_id: semantic.target_id, changes });
    } else if (semantic.type === "remove_element") {
      operations.push({ semantic_operation_id: semantic.id, op: "removeElement", element_id: semantic.target_id });
    } else if (semantic.type === "add_relationship") {
      operations.push({ semantic_operation_id: semantic.id, op: "addRelationship", relationship: {
        id: createId("relationship"), kind: semantic.relationship.kind,
        source_id: refToId.get(semantic.relationship.source_ref), target_id: refToId.get(semantic.relationship.target_ref),
        label: semantic.relationship.label, properties: semantic.relationship.properties, stereotypes: semantic.relationship.stereotypes
      } });
    } else if (semantic.type === "remove_relationship") {
      operations.push({ semantic_operation_id: semantic.id, op: "removeRelationship", relationship_id: semantic.relationship_id });
    }
  }
  const layouts = proposal.layout_suggestions.map((layout) => ({
    ...layout,
    element_ids: layout.element_refs.map((ref) => refToId.get(ref)).filter(Boolean)
  }));
  return { summary: proposal.summary, base_element_ids: [...existing.keys()], operations, layouts };
}

export function validateProposalReferences(diagram, proposal) {
  const elementIds = new Set(diagram.elements.map((item) => item.id));
  const relationshipIds = new Set(diagram.relationships.map((item) => item.id));
  const refs = new Set(elementIds);
  for (const operation of proposal.operations) {
    if (operation.type === "add_element") {
      if (refs.has(operation.element.ref)) throw new Error(`Duplicate or existing element reference: ${operation.element.ref}`);
      refs.add(operation.element.ref);
    }
  }
  for (const operation of proposal.operations) {
    if (["update_element", "remove_element"].includes(operation.type) && !elementIds.has(operation.target_id)) throw new Error(`"${operation.target_id}" isn't on the diagram yet, so it can't be changed — apply it first, or ask again describing the full element.`);
    if (operation.type === "remove_relationship" && !relationshipIds.has(operation.relationship_id)) throw new Error(`Relationship does not exist: ${operation.relationship_id}`);
    if (operation.type === "add_relationship" && (!refs.has(operation.relationship.source_ref) || !refs.has(operation.relationship.target_ref))) throw new Error(`Relationship ${operation.id} references an unknown element.`);
  }
  for (const layout of proposal.layout_suggestions) {
    const unknown = layout.element_refs.find((ref) => !refs.has(ref));
    if (unknown) throw new Error(`Layout ${layout.id} references an unknown element: ${unknown}`);
  }
  return true;
}

export function selectMaterializedOperations(patch, selectedIds) {
  const selected = new Set(selectedIds);
  const chosen = patch.operations.filter((item) => selected.has(item.semantic_operation_id));
  const addedIds = new Set(chosen.filter((item) => item.op === "addElement").map((item) => item.element.id));
  for (const operation of chosen) {
    if (operation.op === "addRelationship" && [operation.relationship.source_id, operation.relationship.target_id].some((id) => !addedIds.has(id) && !patch.base_element_ids?.includes(id))) {
      throw new Error("Select the proposed elements required by the relationship before applying it.");
    }
  }
  return chosen.map(({ semantic_operation_id, ...operation }) => operation);
}

export function selectMaterializedLayouts(patch, selectedIds) {
  const selected = new Set(selectedIds);
  return (patch.layouts ?? []).filter((layout) => selected.has(layout.id));
}
