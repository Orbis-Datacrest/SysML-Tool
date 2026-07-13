import { clampSidebarWidth, nextRightPanelState, persistSidebarLayout, SIDEBAR_CONSTRAINTS } from "../app/sidebarLayout.js";
import { resetEditorInteractionState } from "../app/state.js";
import { createScopedStyles } from "../../../../packages/ui/src/scopedStyles.js";

export function createShellRenderer({
  api, applyTheme, bus, escapeHtml, icons, loadVersionHistory, mountMfe, projectUrl,
  redoDiagram, saveCurrentDiagram, setDiagram, showDashboard, state, undoDiagram, updateDiagramDraft
}) {
let cleanupSidebarInteractions = () => {};
let cleanupMountedModules = () => {};
let themeRequestVersion = 0;
let rightPanelRequestVersion = 0;
function renderShell() {
  if (!state.user && state.view === "editor") {
    state.view = "dashboard";
    resetEditorInteractionState(state);
  }
  cleanupSidebarInteractions();
  cleanupMountedModules();
  cleanupSidebarInteractions = () => {};
  cleanupMountedModules = () => {};
  applyTheme(state.settings.theme);
  document.querySelector("#app").innerHTML = `
    <header class="topbar">
      <div class="topbar-left">
        <button id="brand-home" class="brand-button" title="Open Project Dashboard" aria-label="Open Project Dashboard"><strong class="brand-mark"><span class="brand-icon">S</span>SysML Studio</strong></button>
        ${state.view === "editor" ? `<button id="manual-save" class="icon-button" title="Save Diagram" aria-label="Save Diagram">${icons.save}</button><span id="save-status" class="save-status">${state.saveStatus}</span>` : ""}
        ${state.view === "editor" ? `<button id="project-title" class="top-project-name" title="Rename project" aria-label="Rename project: ${escapeHtml(state.project?.name ?? "Untitled Project")}"><span class="project-name-text">${escapeHtml(state.project?.name ?? "Untitled Project")}</span><span class="project-name-edit" aria-hidden="true">✎</span></button>` : `<span id="project-title">Project Dashboard</span>`}
      </div>
      <div class="topbar-actions">
        ${state.view === "editor" ? `<button id="ai-sidebar-toggle" class="icon-button ${state.sidebarLayout.right.open && state.rightPanel === "advisor" ? "active" : ""}" title="${state.sidebarLayout.right.open && state.rightPanel === "advisor" ? "Close" : "Open"} AI advisor" aria-label="${state.sidebarLayout.right.open && state.rightPanel === "advisor" ? "Close" : "Open"} AI advisor" aria-controls="right-sidebar-content" aria-expanded="${state.sidebarLayout.right.open && state.rightPanel === "advisor"}">${icons.ai}</button><button id="history-toggle" class="icon-button ${state.sidebarLayout.right.open && state.rightPanel === "history" ? "active" : ""}" title="${state.sidebarLayout.right.open && state.rightPanel === "history" ? "Close" : "Open"} History" aria-label="${state.sidebarLayout.right.open && state.rightPanel === "history" ? "Close" : "Open"} History" aria-controls="right-sidebar-content" aria-expanded="${state.sidebarLayout.right.open && state.rightPanel === "history"}">${icons.history}</button>` : ""}
        <button id="theme-toggle" class="icon-button" title="Toggle ${state.settings.theme === "dark" ? "Light" : "Dark"} Mode" aria-label="Toggle ${state.settings.theme === "dark" ? "Light" : "Dark"} Mode">${state.settings.theme === "dark" ? icons.moon : icons.sun}</button>
        ${state.view === "editor" ? `<div class="share-control">
          <button id="share-project" class="share-button" title="Share project" aria-label="Open project sharing" aria-haspopup="dialog" aria-expanded="false"><span class="share-lock" aria-hidden="true">${icons.share}</span><span>Share</span><span class="share-chevron" aria-hidden="true">▾</span></button>
          <div id="share-popover" class="share-popover" role="dialog" aria-modal="false" aria-labelledby="share-popover-title" hidden>
            <div class="share-popover-header"><div><strong id="share-popover-title">Share project</strong><small>${escapeHtml(state.project?.name ?? "Untitled Project")}</small></div><button id="close-share" class="share-close" aria-label="Close sharing">×</button></div>
            <form id="share-form">
              <label for="share-email">Invite by email</label>
              <div class="share-invite-row"><input id="share-email" type="email" autocomplete="email" value="${escapeHtml(state.shareDraft.email)}" placeholder="name@example.com" required><select id="share-role" aria-label="Access level"><option value="Viewer" ${state.shareDraft.role === "Viewer" ? "selected" : ""}>Viewer</option><option value="Commenter" ${state.shareDraft.role === "Commenter" ? "selected" : ""}>Commenter</option><option value="Editor" ${state.shareDraft.role === "Editor" ? "selected" : ""}>Editor</option></select></div>
              <p id="share-role-help" class="share-role-help">Can view the project but cannot make changes.</p>
              <button class="primary share-send" type="submit">Send invite</button>
            </form>
            <button id="copy-project-link" class="copy-project-link" type="button">Copy project link</button>
          </div>
        </div>` : ""}
        <section id="topbar-project-export" class="topbar-export"></section>
        ${state.view === "dashboard" ? `<section id="auth-session" class="topbar-auth"></section>` : ""}
      </div>
    </header>
    ${state.view === "editor" ? `
      <main class="workspace ${state.sidebarLayout.left.open ? "left-open" : ""} ${state.sidebarLayout.right.open ? "right-open" : ""}">
        <aside id="project-tools-sidebar" class="left-rail" data-open="${state.sidebarLayout.left.open}" aria-label="Project tools">
          <div class="sidebar-header"><button id="sidebar-toggle" class="sidebar-toggle" title="${state.sidebarLayout.left.open ? "Collapse" : "Expand"} project tools" aria-label="${state.sidebarLayout.left.open ? "Collapse" : "Expand"} project tools" aria-controls="project-tools-content" aria-expanded="${state.sidebarLayout.left.open}">☰</button><strong>Project tools</strong></div>
          <div id="project-tools-content" class="sidebar-content">
            <section id="project-explorer"></section>
            <section id="project-import" class="project-import"></section>
            <section id="element-palette"></section>
            <section id="properties-panel"></section>
            <section id="project-validation" class="sidebar-bottom-panel"></section>
          </div>
          <section id="left-account" class="left-account" aria-label="Signed in account"></section>
          <div class="sidebar-resize-handle" data-resize-sidebar="left" role="separator" aria-label="Resize project tools" aria-orientation="vertical" aria-valuemin="${SIDEBAR_CONSTRAINTS.left.minimum}" aria-valuemax="${SIDEBAR_CONSTRAINTS.left.maximum}" aria-valuenow="${state.sidebarLayout.left.width}" tabindex="0"></div>
        </aside>
        <section id="diagram-canvas" class="canvas-host"></section>
        <aside id="ai-advisor-sidebar" class="right-rail" data-open="${state.sidebarLayout.right.open}" aria-label="${state.rightPanel === "history" ? "Project history" : "AI advisor"}">
          <div class="sidebar-header right-sidebar-header">
            <strong>${state.rightPanel === "history" ? "History" : "AI advisor"}</strong>
            <button id="right-sidebar-collapse" class="sidebar-toggle" title="${state.sidebarLayout.right.open ? "Collapse" : "Expand"} ${state.rightPanel === "history" ? "History" : "AI advisor"}" aria-label="${state.sidebarLayout.right.open ? "Collapse" : "Expand"} ${state.rightPanel === "history" ? "History" : "AI advisor"}" aria-controls="right-sidebar-content" aria-expanded="${state.sidebarLayout.right.open}">${state.sidebarLayout.right.open ? "×" : "‹"}</button>
          </div>
          <div id="right-sidebar-content" class="sidebar-content">
            ${state.rightPanel === "history" ? `<section class="history-sidebar" aria-label="Project history">
              <div class="history-sidebar-summary"><div><span class="history-state-dot"></span><strong>Current workspace</strong></div><small>Your active project state</small></div>
              <div class="history-state-list" role="listbox" aria-label="Available project states">
                <button class="history-state-card ${state.selectedHistoryVersion === "current" ? "selected" : ""}" data-history-version="current" role="option" aria-selected="${state.selectedHistoryVersion === "current"}"><span><strong>Current workspace</strong><small>Unsaved and latest saved changes</small></span><span class="current-state-badge">Current</span></button>
                ${state.versionHistory.map((item) => `<button class="history-state-card ${String(state.selectedHistoryVersion) === String(item.version) ? "selected" : ""}" data-history-version="${item.version}" role="option" aria-selected="${String(state.selectedHistoryVersion) === String(item.version)}"><span><strong>Version ${item.version}</strong><small>${escapeHtml(item.description || "Saved project state")} · ${new Date(item.created_at).toLocaleString()}</small></span>${String(state.selectedHistoryVersion) === String(item.version) ? `<span class="selected-state-badge">Selected</span>` : ""}</button>`).join("") || `<p class="history-empty">No saved states yet. Use Save Diagram to create one.</p>`}
              </div>
              <div class="history-sidebar-actions"><button id="refresh-history" type="button">Refresh</button><button id="restore-selected-version" class="primary" type="button" ${state.selectedHistoryVersion === "current" ? "disabled" : ""}>Restore selected state</button></div>
            </section>` : `<section id="ai-advisor"></section><div class="ai-settings-actions"><button id="settings-toggle" class="settings-toggle" type="button" aria-expanded="${state.settingsOpen}" aria-controls="auth-tenant-settings">${state.settingsOpen ? "Close Settings" : "Settings"}</button></div>${state.settingsOpen ? `<section id="auth-tenant-settings" class="ai-settings-slot"></section>` : ""}`}
          </div>
          <div class="sidebar-resize-handle" data-resize-sidebar="right" role="separator" aria-label="Resize assistant panel" aria-orientation="vertical" aria-valuemin="${SIDEBAR_CONSTRAINTS.right.minimum}" aria-valuemax="${SIDEBAR_CONSTRAINTS.right.maximum}" aria-valuenow="${state.sidebarLayout.right.width}" tabindex="0"></div>
        </aside>
        <button class="workspace-drawer-backdrop" aria-label="Close open panel"></button>
      </main>
    ` : `
      <main class="dashboard-host">
        <section id="project-dashboard"></section>
      </main>
    `}
  `;
  // Sidebar widths are live application state, so apply them after rendering instead of embedding presentation in the markup.
  const workspace = document.querySelector(".workspace");
  const layoutStyles = workspace ? createScopedStyles(workspace, "workspace-layout") : null;
  const setWorkspaceWidths = (leftWidth, rightWidth) => {
    if (!layoutStyles) return;
    layoutStyles.set("sidebar-widths", "&", {
      "--left-sidebar-width": `${leftWidth}px`,
      "--right-sidebar-width": `${rightWidth}px`
    });
    layoutStyles.commit();
  };
  if (workspace) {
    setWorkspaceWidths(
      state.sidebarLayout.left.open ? state.sidebarLayout.left.width : SIDEBAR_CONSTRAINTS.collapsedWidth,
      state.sidebarLayout.right.open ? state.sidebarLayout.right.width : SIDEBAR_CONSTRAINTS.collapsedWidth
    );
  }
  const context = { state, bus, api, setDiagram, undoDiagram, redoDiagram, updateDiagramDraft };
  const moduleCleanups = [];
  const mount = (name, target) => {
    const cleanup = mountMfe(name, target, context);
    if (typeof cleanup === "function") moduleCleanups.push(cleanup);
  };
  if (state.view === "dashboard") mount("auth-session", document.querySelector("#auth-session"));
  if (state.view === "dashboard") {
    mount("project-dashboard", document.querySelector("#project-dashboard"));
  } else {
    mount("project-explorer", document.querySelector("#project-explorer"));
    mount("element-palette", document.querySelector("#element-palette"));
    mount("project-validation", document.querySelector("#project-validation"));
    mount("diagram-canvas", document.querySelector("#diagram-canvas"));
    if (state.rightPanel === "advisor") mount("ai-advisor", document.querySelector("#ai-advisor"));
    mount("project-export", document.querySelector("#topbar-project-export"));
    mount("project-import", document.querySelector("#project-import"));
    if (state.settingsOpen) mount("auth-tenant-settings", document.querySelector("#auth-tenant-settings"));
    mount("auth-session", document.querySelector("#left-account"));
  }
  cleanupMountedModules = () => moduleCleanups.splice(0).reverse().forEach((cleanup) => cleanup());

  document.querySelectorAll(".topbar, .left-rail, .right-rail").forEach((region) => {
    region.addEventListener("dragstart", (event) => {
      if (!event.target.closest(".palette-item")) event.preventDefault();
    });
    region.addEventListener("drop", (event) => event.preventDefault());
  });

  document.querySelector("#brand-home")?.addEventListener("click", () => {
    if (state.view === "editor") showDashboard();
  });
  const notifyCanvasResize = () => document.querySelector("#diagram-canvas")?.dispatchEvent(new Event("canvas:resize"));
  const applySidebarLayout = ({ persist = true } = {}) => {
    if (!workspace) return;
    const workspaceWidth = workspace.getBoundingClientRect().width;
    const renderedWidths = {};
    for (const side of ["left", "right"]) {
      if (state.sidebarLayout[side].open) state.sidebarLayout[side].width = clampSidebarWidth(side, state.sidebarLayout[side].width, workspaceWidth, state.sidebarLayout);
      const width = state.sidebarLayout[side].open ? state.sidebarLayout[side].width : SIDEBAR_CONSTRAINTS.collapsedWidth;
      renderedWidths[side] = width;
      workspace.classList.toggle(`${side}-open`, state.sidebarLayout[side].open);
      const rail = document.querySelector(side === "left" ? "#project-tools-sidebar" : "#ai-advisor-sidebar");
      rail.dataset.open = String(state.sidebarLayout[side].open);
      rail.querySelector("[data-resize-sidebar]")?.setAttribute("aria-valuenow", String(state.sidebarLayout[side].width));
      if (side === "left") {
        const toggle = document.querySelector("#sidebar-toggle");
        toggle?.setAttribute("aria-expanded", String(state.sidebarLayout.left.open));
        toggle?.setAttribute("title", `${state.sidebarLayout.left.open ? "Collapse" : "Expand"} project tools`);
      } else {
        for (const [panel, selector, label] of [["advisor", "#ai-sidebar-toggle", "AI advisor"], ["history", "#history-toggle", "History"]]) {
          const toggle = document.querySelector(selector);
          const expanded = state.sidebarLayout.right.open && state.rightPanel === panel;
          toggle?.setAttribute("aria-expanded", String(expanded));
          toggle?.setAttribute("title", `${expanded ? "Close" : "Open"} ${label}`);
          toggle?.classList.toggle("active", expanded);
        }
        const collapse = document.querySelector("#right-sidebar-collapse");
        collapse?.setAttribute("aria-expanded", String(state.sidebarLayout.right.open));
        if (collapse) collapse.textContent = state.sidebarLayout.right.open ? "×" : "‹";
      }
    }
    setWorkspaceWidths(renderedWidths.left, renderedWidths.right);
    if (persist) persistSidebarLayout(state.sidebarLayout);
    notifyCanvasResize();
  };
  const toggleSidebar = (side) => {
    if (side === "right") rightPanelRequestVersion += 1;
    state.sidebarLayout[side].open = !state.sidebarLayout[side].open;
    applySidebarLayout();
  };
  document.querySelector("#sidebar-toggle")?.addEventListener("click", () => toggleSidebar("left"));
  document.querySelector("#right-sidebar-collapse")?.addEventListener("click", () => toggleSidebar("right"));
  const activateRightPanel = async (panel) => {
    const requestVersion = ++rightPanelRequestVersion;
    const next = nextRightPanelState(state.sidebarLayout.right, state.rightPanel, panel);
    if (!next.open) {
      state.sidebarLayout.right.open = next.open;
      applySidebarLayout();
      return;
    }
    if (panel === "history") {
      await loadVersionHistory();
      if (requestVersion !== rightPanelRequestVersion) return;
      const selectedExists = state.versionHistory.some((item) => String(item.version) === String(state.selectedHistoryVersion));
      if (state.selectedHistoryVersion !== "current" && !selectedExists) state.selectedHistoryVersion = "current";
    }
    state.rightPanel = next.panel;
    state.sidebarLayout.right.open = next.open;
    renderShell();
  };
  document.querySelector("#ai-sidebar-toggle")?.addEventListener("click", () => activateRightPanel("advisor").catch((error) => bus.emit("toast", error.message)));
  document.querySelector("#history-toggle")?.addEventListener("click", () => activateRightPanel("history").catch((error) => bus.emit("toast", error.message)));

  let stopActiveResize = () => {};
  let sidebarResizeFrame = null;
  let pendingResizeClientX = null;
  const stopResize = (handle, pointerId) => {
    if (sidebarResizeFrame !== null) cancelAnimationFrame(sidebarResizeFrame);
    sidebarResizeFrame = null;
    pendingResizeClientX = null;
    document.removeEventListener("pointermove", handle._sidebarPointerMove);
    document.removeEventListener("pointerup", handle._sidebarPointerUp);
    document.removeEventListener("pointercancel", handle._sidebarPointerUp);
    try {
      if (handle.hasPointerCapture?.(pointerId)) handle.releasePointerCapture(pointerId);
    } catch { /* Pointer capture can disappear when Safari replaces a dragged element. */ }
    document.documentElement.classList.remove("sidebar-resizing");
    stopActiveResize = () => {};
  };
  document.querySelectorAll("[data-resize-sidebar]").forEach((handle) => {
    handle.addEventListener("pointerdown", (event) => {
      if (event.button !== 0) return;
      const side = handle.dataset.resizeSidebar;
      if (!state.sidebarLayout[side].open) return;
      event.preventDefault();
      stopActiveResize();
      const pointerId = event.pointerId;
      const startX = event.clientX;
      const startWidth = state.sidebarLayout[side].width;
      try { handle.setPointerCapture?.(pointerId); } catch { /* Document listeners below are the cross-browser fallback. */ }
      document.documentElement.classList.add("sidebar-resizing");
      handle._sidebarPointerMove = (moveEvent) => {
        if (moveEvent.pointerId !== pointerId) return;
        pendingResizeClientX = moveEvent.clientX;
        if (sidebarResizeFrame !== null) return;
        sidebarResizeFrame = requestAnimationFrame(() => {
          sidebarResizeFrame = null;
          const delta = (pendingResizeClientX - startX) * (side === "left" ? 1 : -1);
          pendingResizeClientX = null;
          state.sidebarLayout[side].width = clampSidebarWidth(side, startWidth + delta, workspace.getBoundingClientRect().width, state.sidebarLayout);
          applySidebarLayout({ persist: false });
        });
      };
      handle._sidebarPointerUp = (endEvent) => {
        if (endEvent.pointerId !== pointerId) return;
        if (sidebarResizeFrame !== null) {
          cancelAnimationFrame(sidebarResizeFrame);
          sidebarResizeFrame = null;
          const delta = (pendingResizeClientX - startX) * (side === "left" ? 1 : -1);
          pendingResizeClientX = null;
          state.sidebarLayout[side].width = clampSidebarWidth(side, startWidth + delta, workspace.getBoundingClientRect().width, state.sidebarLayout);
          applySidebarLayout({ persist: false });
        }
        stopResize(handle, pointerId);
        persistSidebarLayout(state.sidebarLayout);
      };
      // Document-level listeners keep resizing active if capture is unavailable or the pointer leaves the thin handle.
      document.addEventListener("pointermove", handle._sidebarPointerMove);
      document.addEventListener("pointerup", handle._sidebarPointerUp);
      document.addEventListener("pointercancel", handle._sidebarPointerUp);
      stopActiveResize = () => stopResize(handle, pointerId);
    });
    handle.addEventListener("keydown", (event) => {
      if (!state.sidebarLayout[handle.dataset.resizeSidebar].open || !["ArrowLeft", "ArrowRight"].includes(event.key)) return;
      event.preventDefault();
      const side = handle.dataset.resizeSidebar;
      const direction = event.key === "ArrowRight" ? 1 : -1;
      state.sidebarLayout[side].width = clampSidebarWidth(side, state.sidebarLayout[side].width + direction * 10 * (side === "left" ? 1 : -1), workspace.getBoundingClientRect().width, state.sidebarLayout);
      applySidebarLayout();
    });
  });
  let workspaceResizeFrame = null;
  const handleWorkspaceResize = () => {
    if (workspaceResizeFrame !== null) return;
    workspaceResizeFrame = requestAnimationFrame(() => {
      workspaceResizeFrame = null;
      applySidebarLayout({ persist: false });
    });
  };
  const workspaceObserver = workspace && typeof ResizeObserver === "function" ? new ResizeObserver(handleWorkspaceResize) : null;
  if (workspaceObserver) workspaceObserver.observe(workspace);
  else if (workspace) window.addEventListener("resize", handleWorkspaceResize, { passive: true });
  const closeRightPanelOnOutsidePointer = (event) => {
    if (!state.sidebarLayout.right.open) return;
    if (event.target.closest?.("#ai-advisor-sidebar,#ai-sidebar-toggle,#history-toggle")) return;
    rightPanelRequestVersion += 1;
    state.sidebarLayout.right.open = false;
    applySidebarLayout();
  };
  document.addEventListener("pointerdown", closeRightPanelOnOutsidePointer, true);
  cleanupSidebarInteractions = () => {
    stopActiveResize();
    if (sidebarResizeFrame !== null) cancelAnimationFrame(sidebarResizeFrame);
    sidebarResizeFrame = null;
    if (workspaceResizeFrame !== null) cancelAnimationFrame(workspaceResizeFrame);
    workspaceResizeFrame = null;
    workspaceObserver?.disconnect();
    window.removeEventListener("resize", handleWorkspaceResize);
    document.removeEventListener("pointerdown", closeRightPanelOnOutsidePointer, true);
    layoutStyles?.destroy();
  };
  document.querySelector("#settings-toggle")?.addEventListener("click", () => {
    state.settingsOpen = !state.settingsOpen;
    renderShell();
  });
  document.querySelector(".workspace-drawer-backdrop")?.addEventListener("click", () => {
    state.sidebarLayout.left.open = false;
    state.sidebarLayout.right.open = false;
    applySidebarLayout();
  });
  document.querySelector("#theme-toggle")?.addEventListener("click", async () => {
    const requestedTheme = state.settings.theme === "dark" ? "light" : "dark";
    const requestVersion = ++themeRequestVersion;
    state.settings.theme = requestedTheme;
    applyTheme(requestedTheme);
    const toggle = document.querySelector("#theme-toggle");
    if (toggle) {
      toggle.innerHTML = requestedTheme === "dark" ? icons.moon : icons.sun;
      toggle.title = `Toggle ${requestedTheme === "dark" ? "Light" : "Dark"} Mode`;
      toggle.setAttribute("aria-label", toggle.title);
    }
    bus.emit("theme:changed", requestedTheme);
    if (state.user) {
      try {
        const result = await api.request("/api/settings", { method: "PATCH", body: JSON.stringify({ theme: requestedTheme }) });
        if (requestVersion !== themeRequestVersion || state.settings.theme !== requestedTheme) return;
        state.settings = { ...state.settings, ...result.settings, theme: requestedTheme };
      } catch (error) {
        if (requestVersion === themeRequestVersion) bus.emit("toast", `Theme preference was not saved: ${error.message}`);
      }
    }
  });
  const sharePopover = document.querySelector("#share-popover");
  const shareButton = document.querySelector("#share-project");
  const setShareOpen = (open) => {
    if (!sharePopover || !shareButton) return;
    sharePopover.hidden = !open;
    shareButton.setAttribute("aria-expanded", String(open));
  };
  const stopTopbarMenuSync = bus.on("ui:menu-open", (menu) => { if (menu !== "share") setShareOpen(false); });
  const previousSidebarCleanup = cleanupSidebarInteractions;
  cleanupSidebarInteractions = () => { previousSidebarCleanup(); stopTopbarMenuSync(); };
  document.querySelector("#share-project")?.addEventListener("click", () => {
    const opening = sharePopover.hidden;
    if (opening) bus.emit("ui:menu-open", "share");
    setShareOpen(opening);
    if (opening) document.querySelector("#share-email")?.focus();
  });
  document.querySelector("#close-share")?.addEventListener("click", () => setShareOpen(false));
  const shareRoleHelp = {
    Viewer: "Can view the project but cannot make changes.",
    Commenter: "Can view the project and leave comments.",
    Editor: "Can edit diagrams and project content."
  };
  document.querySelector("#share-email")?.addEventListener("input", (event) => {
    state.shareDraft.email = event.target.value;
  });
  document.querySelector("#share-role")?.addEventListener("change", (event) => {
    state.shareDraft.role = event.target.value;
    document.querySelector("#share-role-help").textContent = shareRoleHelp[event.target.value];
  });
  const shareRoleHelpTarget = document.querySelector("#share-role-help");
  if (shareRoleHelpTarget) shareRoleHelpTarget.textContent = shareRoleHelp[state.shareDraft.role];
  document.querySelector("#share-form")?.addEventListener("submit", async (event) => {
    event.preventDefault();
    const submit = event.currentTarget.querySelector("button[type='submit']");
    submit.disabled = true;
    try {
      await api.request(`/api/projects/${state.project.id}/shares`, {
        method: "POST",
        body: JSON.stringify({ email: state.shareDraft.email, role: state.shareDraft.role })
      });
      state.shareDraft.email = "";
      document.querySelector("#share-email").value = "";
      setShareOpen(false);
      bus.emit("toast", "Project invitation sent");
    } catch (error) {
      bus.emit("toast", error.message);
    } finally {
      submit.disabled = false;
    }
  });
  document.querySelector("#copy-project-link")?.addEventListener("click", async () => {
    const url = projectUrl(state.project.id).toString();
    try { await navigator.clipboard.writeText(url); bus.emit("toast", "Project link copied"); }
    catch { prompt("Copy project link", url); }
  });
  document.querySelector("#manual-save")?.addEventListener("click", async () => {
    await saveCurrentDiagram({ snapshot: true });
    bus.emit("toast", "Diagram milestone saved");
    if (state.sidebarLayout.right.open && state.rightPanel === "history") renderShell();
  });
  document.querySelectorAll("[data-history-version]").forEach((button) => button.addEventListener("click", () => {
    state.selectedHistoryVersion = button.dataset.historyVersion === "current" ? "current" : Number(button.dataset.historyVersion);
    document.querySelectorAll("[data-history-version]").forEach((card) => {
      const selected = String(card.dataset.historyVersion) === String(state.selectedHistoryVersion);
      card.classList.toggle("selected", selected);
      card.setAttribute("aria-selected", String(selected));
      card.querySelector(".selected-state-badge")?.remove();
      if (selected && card.dataset.historyVersion !== "current") {
        const badge = document.createElement("span");
        badge.className = "selected-state-badge";
        badge.textContent = "Selected";
        card.append(badge);
      }
    });
    const restore = document.querySelector("#restore-selected-version");
    if (restore) restore.disabled = state.selectedHistoryVersion === "current";
  }));
  document.querySelector("#refresh-history")?.addEventListener("click", async () => {
    try { await loadVersionHistory(); renderShell(); }
    catch (error) { bus.emit("toast", error.message); }
  });
  document.querySelector("#restore-selected-version")?.addEventListener("click", async (event) => {
    const version = state.selectedHistoryVersion;
    if (version === "current" || !confirm(`Restore project version ${version}? Current workspace changes will be replaced.`)) return;
    event.currentTarget.disabled = true;
    try {
      const result = await api.request(`/api/projects/${state.project.id}/versions/${version}/restore`, { method: "POST" });
      state.project = result.project;
      state.diagrams = result.diagrams ?? [];
      state.diagram = state.diagrams[0] ?? null;
      resetEditorInteractionState(state);
      state.selectedHistoryVersion = "current";
      await loadVersionHistory();
      renderShell();
      bus.emit("bootstrap", { projects: [state.project], diagrams: state.diagrams });
      if (state.diagram) bus.emit("diagram:changed", state.diagram);
      bus.emit("toast", `Restored project version ${version}`);
    } catch (error) {
      event.currentTarget.disabled = false;
      bus.emit("toast", error.message);
    }
  });
  document.querySelector("#project-title.top-project-name")?.addEventListener("click", () => {
    const button = document.querySelector("#project-title.top-project-name");
    if (!button || !state.project) return;
    const input = document.createElement("input");
    input.className = "top-project-name-editor";
    input.value = state.project.name;
    input.setAttribute("aria-label", "Project name");
    button.replaceWith(input);
    let finished = false;
    const finish = async (save) => {
      if (finished) return;
      finished = true;
      const name = input.value.trim();
      if (save && name && name !== state.project.name) {
        try {
          state.project = await api.request(`/api/projects/${state.project.id}`, { method: "PATCH", body: JSON.stringify({ name }) });
          bus.emit("toast", "Project renamed");
        } catch (error) {
          bus.emit("toast", error.message);
        }
      }
      renderShell();
    };
    input.addEventListener("keydown", (event) => {
      if (event.key === "Enter") { event.preventDefault(); finish(true); }
      if (event.key === "Escape") { event.preventDefault(); finish(false); }
    });
    input.addEventListener("blur", () => finish(true));
    input.focus();
    input.select();
  });
}

return renderShell;
}
