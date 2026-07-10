export const roles = ["Owner", "Admin", "Editor", "Commenter", "Reviewer", "Viewer"];

export function can(role, action) {
  const permissions = {
    Owner: ["tenant:*", "project:*", "diagram:*", "ai:*", "export:*"],
    Admin: ["project:*", "diagram:*", "ai:*", "export:*"],
    Editor: ["diagram:read", "diagram:write", "collaboration:comment", "review:participate", "ai:request", "export:create"],
    Commenter: ["diagram:read", "collaboration:comment", "review:participate", "export:create"],
    Reviewer: ["diagram:read", "collaboration:comment", "review:participate", "review:approve", "export:create"],
    Viewer: ["diagram:read", "export:create"]
  };
  return permissions[role]?.some((permission) => permission === action || permission.endsWith(":*") && action.startsWith(permission.slice(0, -1)));
}
