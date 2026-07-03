export const projectEvents = {
  created: "project.created",
  updated: "project.updated",
  archived: "project.archived"
};

export function projectTopic(tenantId) {
  return `tenant.${tenantId}.project-events`;
}
