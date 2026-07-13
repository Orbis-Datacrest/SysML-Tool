export function escapeHtml(value = "") {
  return String(value).replace(/[&<>'"]/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", "\"": "&quot;" })[character]);
}

export function rememberPage(view, projectId, storage = localStorage) {
  storage.setItem("sysml.activeView", view);
  if (projectId) storage.setItem("sysml.activeProjectId", projectId);
}

export function projectUrl(projectId, location = window.location.href) {
  const url = new URL(location);
  url.searchParams.set("project", projectId);
  return url;
}

export function dashboardUrl(location = window.location.href) {
  const url = new URL(location);
  url.searchParams.delete("project");
  return url;
}

export function applyTheme(theme, root = document.documentElement, storage = localStorage) {
  const next = theme === "light" ? "light" : "dark";
  root.dataset.theme = next;
  storage.setItem("sysml.theme", next);
}
