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
