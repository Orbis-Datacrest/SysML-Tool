import crypto from "node:crypto";

export const auditEvents = {
  recorded: "audit.recorded",
  historyQueried: "audit.history_queried"
};

export function createAuditRecord({ tenant_id, actor_id, action, resource_type, resource_id, reason }) {
  return {
    id: `audit_${crypto.randomUUID?.() ?? Math.random().toString(36).slice(2)}`,
    tenant_id,
    actor_id,
    action,
    resource_type,
    resource_id,
    reason,
    created_at: new Date().toISOString()
  };
}
