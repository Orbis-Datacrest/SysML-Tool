export const roles = ["Owner", "Admin", "Editor", "Viewer"];

export function can(role, action) {
  const permissions = {
    Owner: ["tenant:*", "project:*", "diagram:*", "ai:*", "export:*"],
    Admin: ["project:*", "diagram:*", "ai:*", "export:*"],
    Editor: ["diagram:read", "diagram:write", "ai:request", "export:create"],
    Viewer: ["diagram:read", "export:create"]
  };
  return permissions[role]?.some((permission) => permission === action || permission.endsWith(":*") && action.startsWith(permission.slice(0, -1)));
}
