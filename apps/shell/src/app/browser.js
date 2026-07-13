export function escapeHtml(value = "") {
  return String(value).replace(/[&<>'"]/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", "\"": "&quot;" })[character]);
}

export function rememberPage(view, projectId, storage) {
  try {
    const target = storage ?? globalThis.localStorage;
    target?.setItem("sysml.activeView", view);
    if (projectId) target?.setItem("sysml.activeProjectId", projectId);
  } catch { /* Safari private browsing and embedded browsers can reject storage writes. */ }
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

export function normalizeTheme(theme) {
  return theme === "light" ? "light" : "dark";
}

export function applyTheme(theme, root = document.documentElement, storage) {
  const next = normalizeTheme(theme);
  root.dataset.theme = next;
  try { (storage ?? globalThis.localStorage)?.setItem("sysml.theme", next); } catch { /* The visible theme still works when storage is restricted. */ }
}
