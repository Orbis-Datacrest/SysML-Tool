export const diagramEvents = {
  created: "diagram.created",
  updated: "diagram.updated",
  patchApplied: "diagram.patch_applied",
  collaborationEvent: "diagram.collaboration_event"
};

export function diagramTopic(tenantId, projectId) {
  return `tenant.${tenantId}.project.${projectId}.diagram-events`;
}
