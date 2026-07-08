export const modelRepositoryEvents = {
  elementCreated: "model.element_created",
  elementUpdated: "model.element_updated",
  relationshipCreated: "model.relationship_created",
  relationshipUpdated: "model.relationship_updated",
  versionCommitted: "model.version_committed"
};

export function assertTenantScope(entity, tenantId) {
  if (!entity || entity.tenant_id !== tenantId) {
    throw new Error("Tenant isolation violation");
  }
}

export class ModelRepositoryService {
  constructor({ elements = [], relationships = [] } = {}) {
    this.elements = new Map(elements.map((element) => [element.id, structuredClone(element)]));
    this.relationships = new Map(relationships.map((relationship) => [relationship.id, structuredClone(relationship)]));
  }

  getElement(id) { return structuredClone(this.elements.get(id)); }
  getRelationship(id) { return structuredClone(this.relationships.get(id)); }
  listElements(projectId) { return [...this.elements.values()].filter((item) => item.project_id === projectId).map((item) => structuredClone(item)); }
  listRelationships(projectId) { return [...this.relationships.values()].filter((item) => item.project_id === projectId).map((item) => structuredClone(item)); }

  saveElement(element) {
    const current = this.elements.get(element.id);
    if (current && (current.tenant_id !== element.tenant_id || current.project_id !== element.project_id)) throw new Error("Model element scope cannot change");
    this.elements.set(element.id, structuredClone({ ...current, ...element }));
    return this.getElement(element.id);
  }

  saveRelationship(relationship) {
    const current = this.relationships.get(relationship.id);
    if (current && (current.tenant_id !== relationship.tenant_id || current.project_id !== relationship.project_id)) throw new Error("Model relationship scope cannot change");
    if (!this.elements.has(relationship.source_id) || !this.elements.has(relationship.target_id)) throw new Error("Relationship endpoints must exist in the model repository");
    this.relationships.set(relationship.id, structuredClone({ ...current, ...relationship }));
    return this.getRelationship(relationship.id);
  }
}
