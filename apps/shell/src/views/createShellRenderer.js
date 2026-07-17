import { clampSidebarWidth, nextRightPanelState, persistSidebarLayout, SIDEBAR_CONSTRAINTS } from "../app/sidebarLayout.js";
import { resetEditorInteractionState } from "../app/state.js";
import { createScopedStyles } from "../../../../packages/ui/src/scopedStyles.js";
import { diagramCatalog } from "../../../../packages/model-core/src/diagram-catalog.js";

const dashboardIcons = {
  logo: `<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="6" r="2.5"/><circle cx="6" cy="16" r="2.5"/><circle cx="18" cy="16" r="2.5"/><path d="M12 8.5v3M7.8 14.5l2.5-2.5h3.4l2.5 2.5"/></svg>`,
  grid: `<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/></svg>`,
  star: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m12 3 2.8 5.7 6.2.9-4.5 4.4 1.1 6.2-5.6-2.9-5.6 2.9 1.1-6.2L3 9.6l6.2-.9L12 3Z"/></svg>`,
  activity: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 12h4l2.4-7 4.2 14 2.4-7h5"/></svg>`,
  folder: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 7.5h6l2-2h3l2 2h5v11H3z"/><path d="M7 11h10v5H7z"/></svg>`
};

export function createShellRenderer({
  activateDiagramTab, api, applyTheme, bus, cancelAutoSave, escapeHtml, icons, loadVersionHistory, mountMfe, nextTheme, projectUrl,
  redoDiagram, rememberPage, saveCurrentDiagram, saveMilestone, setDiagram, showDashboard, state, undoDiagram, updateDiagramDraft
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
  const isLanding = state.view === "dashboard" && !state.user;
  document.querySelector("#app").innerHTML = `
    <header class="topbar ${isLanding ? "landing-topbar" : ""} ${state.view === "dashboard" && state.user ? "dashboard-topbar" : ""}">
      <div class="topbar-left">
        ${isLanding ? `<div class="landing-brand" aria-label="SysML Studio"><strong class="brand-mark"><span class="brand-icon">S</span><span class="brand-label">SysML Studio</span></strong></div>` : `<button id="brand-home" class="brand-button" title="Open Project Dashboard" aria-label="Open Project Dashboard"><strong class="brand-mark"><span class="brand-icon">S</span><span class="brand-label">SysML Studio</span></strong></button>`}
        ${state.view === "editor" ? `<button id="manual-save" class="icon-button" title="Save Diagram" aria-label="Save Diagram">${icons.save}</button><span id="save-status" class="save-status">${state.saveStatus}</span>` : ""}
        ${state.view === "editor" ? `<button id="project-title" class="top-project-name" title="Rename project" aria-label="Rename project: ${escapeHtml(state.project?.name ?? "Untitled Project")}"><span class="project-name-text">${escapeHtml(state.project?.name ?? "Untitled Project")}</span><span class="project-name-edit" aria-hidden="true">✎</span></button>` : isLanding ? "" : `<span id="project-title">Project Dashboard</span>`}
      </div>
      <div class="topbar-actions">
        ${isLanding ? `<nav class="landing-nav" aria-label="Landing page"><a href="#capabilities">Capabilities</a><a href="#workflow">Workflow</a><a href="#about">About</a></nav>` : ""}
        ${state.view === "editor" ? `<button id="ai-sidebar-toggle" class="icon-button ${state.sidebarLayout.right.open && state.rightPanel === "advisor" ? "active" : ""}" title="${state.sidebarLayout.right.open && state.rightPanel === "advisor" ? "Close" : "Open"} AI advisor" aria-label="${state.sidebarLayout.right.open && state.rightPanel === "advisor" ? "Close" : "Open"} AI advisor" aria-controls="right-sidebar-content" aria-expanded="${state.sidebarLayout.right.open && state.rightPanel === "advisor"}">${icons.ai}</button><button id="history-toggle" class="icon-button ${state.sidebarLayout.right.open && state.rightPanel === "history" ? "active" : ""}" title="${state.sidebarLayout.right.open && state.rightPanel === "history" ? "Close" : "Open"} History" aria-label="${state.sidebarLayout.right.open && state.rightPanel === "history" ? "Close" : "Open"} History" aria-controls="right-sidebar-content" aria-expanded="${state.sidebarLayout.right.open && state.rightPanel === "history"}">${icons.history}</button>` : ""}
        <button id="theme-toggle" class="icon-button" type="button" data-theme="${state.settings.theme}" title="Toggle ${state.settings.theme === "dark" ? "Light" : "Dark"} Mode" aria-label="Toggle ${state.settings.theme === "dark" ? "Light" : "Dark"} Mode" aria-pressed="${state.settings.theme === "light"}">${state.settings.theme === "dark" ? icons.moon : icons.sun}</button>
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
        ${isLanding ? `<section id="auth-session" class="topbar-auth"></section>` : ""}
      </div>
    </header>
    ${state.view === "editor" ? `
      <main class="workspace ${state.sidebarLayout.left.open ? "left-open" : ""} ${state.sidebarLayout.right.open ? "right-open" : ""}">
        <aside id="project-tools-sidebar" class="left-rail" data-open="${state.sidebarLayout.left.open}" aria-label="Project tools">
          <div class="sidebar-header"><button id="sidebar-toggle" class="sidebar-toggle" title="${state.sidebarLayout.left.open ? "Collapse" : "Expand"} project tools" aria-label="${state.sidebarLayout.left.open ? "Collapse" : "Expand"} project tools" aria-controls="project-tools-content" aria-expanded="${state.sidebarLayout.left.open}">☰</button><strong>Project tools</strong></div>
          <div id="project-tools-content" class="sidebar-content">
            <section id="project-import" class="project-import"></section>
            <section id="project-explorer"></section>
            <section id="element-palette"></section>
            <section id="properties-panel"></section>
            <section id="project-validation" class="sidebar-bottom-panel"></section>
          </div>
          <section id="left-account" class="left-account" aria-label="Signed in account"></section>
          <div class="sidebar-resize-handle" data-resize-sidebar="left" role="separator" aria-label="Resize project tools" aria-orientation="vertical" aria-valuemin="${SIDEBAR_CONSTRAINTS.left.minimum}" aria-valuemax="${SIDEBAR_CONSTRAINTS.left.maximum}" aria-valuenow="${state.sidebarLayout.left.width}" tabindex="0"></div>
        </aside>
        <section class="canvas-workarea">
          <section id="diagram-canvas" class="canvas-host"></section>
          <nav class="diagram-tabs" aria-label="Diagram tabs">
            <button id="add-diagram-tab" class="add-diagram-tab" title="Create diagram tab" aria-label="Create diagram tab"><svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" fill="currentColor" class="bi bi-folder-plus" viewBox="0 0 16 16" aria-hidden="true"><path d="m.5 3 .04.87a2 2 0 0 0-.342 1.311l.637 7A2 2 0 0 0 2.826 14H9v-1H2.826a1 1 0 0 1-.995-.91l-.637-7A1 1 0 0 1 2.19 4h11.62a1 1 0 0 1 .996 1.09L14.54 8h1.005l.256-2.819A2 2 0 0 0 13.81 3H9.828a2 2 0 0 1-1.414-.586l-.828-.828A2 2 0 0 0 6.172 1H2.5a2 2 0 0 0-2 2m5.672-1a1 1 0 0 1 .707.293L7.586 3H2.19q-.362.002-.683.12L1.5 2.98a1 1 0 0 1 1-.98z"/><path d="M13.5 9a.5.5 0 0 1 .5.5V11h1.5a.5.5 0 1 1 0 1H14v1.5a.5.5 0 1 1-1 0V12h-1.5a.5.5 0 0 1 0-1H13V9.5a.5.5 0 0 1 .5-.5"/></svg></button>
            <div class="diagram-tab-list" role="tablist">${state.diagrams.map((diagram) => `<div class="diagram-tab ${diagram.id === state.diagram?.id ? "active" : ""}" data-tab-id="${escapeHtml(diagram.id)}"><button class="diagram-tab-select" role="tab" aria-selected="${diagram.id === state.diagram?.id}" title="Switch to ${escapeHtml(diagram.name)}">${escapeHtml(diagram.name)}</button>${state.dirtyTabIds.has(diagram.id) ? `<span class="tab-dirty" title="Unsaved changes">●</span>` : ""}<button class="diagram-tab-close" title="Close ${escapeHtml(diagram.name)}" aria-label="Close ${escapeHtml(diagram.name)}">×</button></div>`).join("")}</div>
          </nav>
        </section>
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
                ${state.versionHistory.map((item) => `<button class="history-state-card ${String(state.selectedHistoryVersion) === String(item.version) ? "selected" : ""}" data-history-version="${item.version}" role="option" aria-selected="${String(state.selectedHistoryVersion) === String(item.version)}"><span><strong>Version ${item.version}</strong><small>${escapeHtml(item.description || "Saved tab milestone")} · ${(item.diagrams ?? []).length} tab${(item.diagrams ?? []).length === 1 ? "" : "s"} · ${new Date(item.created_at).toLocaleString()}</small></span>${String(state.selectedHistoryVersion) === String(item.version) ? `<span class="selected-state-badge">Selected</span>` : ""}</button>`).join("") || `<p class="history-empty">No saved states yet. Use Save Diagram to create one.</p>`}
              </div>
              <div class="history-sidebar-actions"><button id="refresh-history" type="button">Refresh</button><button id="restore-selected-version" class="primary" type="button" ${state.selectedHistoryVersion === "current" ? "disabled" : ""}>Restore tabs</button></div>
            </section>` : `<section id="ai-advisor"></section><div class="ai-settings-actions"><button id="settings-toggle" class="settings-toggle" type="button" aria-expanded="${state.settingsOpen}" aria-controls="auth-tenant-settings">${state.settingsOpen ? "Close Settings" : "Settings"}</button></div>${state.settingsOpen ? `<section id="auth-tenant-settings" class="ai-settings-slot"></section>` : ""}`}
          </div>
          <div class="sidebar-resize-handle" data-resize-sidebar="right" role="separator" aria-label="Resize assistant panel" aria-orientation="vertical" aria-valuemin="${SIDEBAR_CONSTRAINTS.right.minimum}" aria-valuemax="${SIDEBAR_CONSTRAINTS.right.maximum}" aria-valuenow="${state.sidebarLayout.right.width}" tabindex="0"></div>
        </aside>
        <button class="workspace-drawer-backdrop" aria-label="Close open panel"></button>
      </main>
    ` : isLanding ? `
      <main class="landing-page">
        <section class="landing-hero" aria-labelledby="landing-title">
          <div class="landing-orbit landing-orbit-one" aria-hidden="true"></div><div class="landing-orbit landing-orbit-two" aria-hidden="true"></div>
          <div class="landing-copy">
            <p class="landing-eyebrow"><span></span> Browser-based systems engineering</p>
            <h1 id="landing-title">Turn complex systems into <em>clear decisions.</em></h1>
            <p class="landing-lead">Model architecture, connect requirements, and validate your design in one collaborative SysML workspace built for focused engineering teams.</p>
            <div class="landing-cta"><button class="landing-primary" data-auth-mode="signup" type="button">Start modeling <span aria-hidden="true">→</span></button><button class="landing-secondary" data-auth-mode="login" type="button">Open your workspace</button></div>
            <div class="landing-proof" aria-label="Product benefits"><span><strong>01</strong> Visual modeling</span><span><strong>02</strong> Live validation</span><span><strong>03</strong> Team ready</span></div>
          </div>
          <div class="landing-visual" aria-label="Example connected system model">
            <div class="model-window">
              <div class="model-window-bar"><span></span><span></span><span></span><strong>Vehicle Architecture</strong><small>Validated</small></div>
              <div class="model-canvas">
                <div class="model-grid" aria-hidden="true"></div>
                <article class="model-card model-main"><small>«system»</small><strong>Electric Vehicle</strong><span>Architecture overview</span></article>
                <article class="model-card model-power"><small>«subsystem»</small><strong>Powertrain</strong><span>4 components</span></article>
                <article class="model-card model-control"><small>«subsystem»</small><strong>Control Unit</strong><span>12 requirements</span></article>
                <article class="model-card model-sensor"><small>«block»</small><strong>Sensor Array</strong><span>8 interfaces</span></article>
                <svg class="model-links" viewBox="0 0 600 410" aria-hidden="true"><path d="M300 129V178H157V231 M300 178H443V231 M300 178V306"/><circle cx="300" cy="178" r="5"/></svg>
                <div class="model-status"><span>✓</span><div><strong>Model health</strong><small>No critical issues</small></div><b>98%</b></div>
              </div>
            </div>
          </div>
        </section>
        <section id="capabilities" class="landing-features" aria-label="Core capabilities"><article><span>◇</span><div><strong>Architect visually</strong><p>Build connected SysML and UML diagrams without losing the underlying model.</p></div></article><article><span>⌁</span><div><strong>Validate continuously</strong><p>Catch incomplete relationships and design conflicts as the model evolves.</p></div></article><article><span>◎</span><div><strong>Collaborate with context</strong><p>Share decisions, history, and engineering intent in one secure workspace.</p></div></article></section>
        <section id="workflow" class="landing-statement"><p>One source of truth</p><h2>From first concept to validated architecture.</h2></section>
        <section id="about" class="landing-about"><span>SysML Studio</span><p>Purpose-built for teams designing the systems that shape tomorrow.</p></section>
      </main>
    ` : `
      <main class="dashboard-workspace">
        <aside class="dashboard-sidebar" aria-label="Workspace navigation">
          <div class="dashboard-sidebar-brand"><span class="dashboard-logo">${dashboardIcons.logo}</span><span><strong>SysML Studio</strong><small>Workspace</small></span></div>
          <nav class="dashboard-nav" aria-label="Dashboard">
            <small>Navigate</small>
            <button class="active" type="button" data-dashboard-view="workspace"><span class="dashboard-nav-icon">${dashboardIcons.grid}</span><span>Workspace</span><i></i></button>
            <button type="button" data-dashboard-view="starred"><span class="dashboard-nav-icon">${dashboardIcons.star}</span><span>Starred</span></button>
            <button type="button" data-dashboard-view="activity"><span class="dashboard-nav-icon">${dashboardIcons.activity}</span><span>Activity</span></button>
          </nav>
          <section class="dashboard-pinned"><header><small>Pinned</small><span>1</span></header><button type="button" disabled><span class="dashboard-nav-icon">${dashboardIcons.folder}</span><span>Untitled Project</span></button></section>
          <section id="auth-session" class="dashboard-account"></section>
        </aside>
        <section class="dashboard-main">
          <header class="dashboard-context"><span>Workspace</span><b aria-hidden="true">/</b><strong>Overview</strong></header>
          <section class="dashboard-host"><section id="project-dashboard"></section></section>
        </section>
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
  const context = { state, bus, api, setDiagram, undoDiagram, redoDiagram, updateDiagramDraft, saveCurrentDiagram };
  const moduleCleanups = [];
  const mount = (name, target) => {
    if (!target) return;
    const cleanup = mountMfe(name, target, context);
    if (typeof cleanup === "function") moduleCleanups.push(cleanup);
  };
  if (state.view === "dashboard") {
    mount("auth-session", document.querySelector("#auth-session"));
    if (state.user) mount("project-dashboard", document.querySelector("#project-dashboard"));
  } else if (state.view === "editor") {
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
  document.querySelectorAll("[data-auth-mode]").forEach((button) => button.addEventListener("click", () => bus.emit("auth:open", button.dataset.authMode)));
  document.querySelectorAll("[data-dashboard-view]").forEach((button) => button.addEventListener("click", () => {
    document.querySelectorAll("[data-dashboard-view]").forEach((item) => item.classList.toggle("active", item === button));
    bus.emit("dashboard:view", button.dataset.dashboardView);
  }));
  const switchTab = (diagram) => {
    if (!diagram || diagram.id === state.diagram?.id) return;
    activateDiagramTab(state, diagram);
    rememberPage("editor", state.project?.id, diagram.id);
    state.saveStatus = state.dirtyTabIds.has(diagram.id) ? "Unsaved" : "";
    renderShell();
    bus.emit("diagram:changed", diagram);
  };
  document.querySelectorAll(".diagram-tab").forEach((tab) => {
    tab.querySelector(".diagram-tab-select")?.addEventListener("click", () => switchTab(state.diagrams.find((item) => item.id === tab.dataset.tabId)));
    tab.querySelector(".diagram-tab-select")?.addEventListener("dblclick", (event) => {
      event.preventDefault();
      const diagram = state.diagrams.find((item) => item.id === tab.dataset.tabId);
      const button = event.currentTarget;
      if (!diagram || !button?.isConnected) return;
      const input = document.createElement("input");
      input.className = "diagram-tab-name-editor";
      input.value = diagram.name;
      input.setAttribute("aria-label", "Diagram tab name");
      button.replaceWith(input);
      let finished = false;
      const finish = async (save) => {
        if (finished) return;
        finished = true;
        const name = input.value.trim();
        if (save && name && name !== diagram.name) {
          try {
            const renamed = await api.request(`/api/diagrams/${diagram.id}`, { method: "PATCH", body: JSON.stringify({ name }) });
            state.diagrams = state.diagrams.map((item) => item.id === renamed.id ? { ...item, name: renamed.name, updated_at: renamed.updated_at } : item);
            if (state.diagram?.id === renamed.id) state.diagram = { ...state.diagram, name: renamed.name, updated_at: renamed.updated_at };
          } catch (error) { bus.emit("toast", error.message); }
        }
        renderShell();
      };
      input.addEventListener("keydown", (keyEvent) => {
        if (keyEvent.key === "Enter") { keyEvent.preventDefault(); finish(true); }
        if (keyEvent.key === "Escape") { keyEvent.preventDefault(); finish(false); }
      });
      input.addEventListener("blur", () => finish(true));
      input.focus();
      input.select();
    });
    tab.querySelector(".diagram-tab-close")?.addEventListener("click", () => {
      const diagram = state.diagrams.find((item) => item.id === tab.dataset.tabId);
      if (!diagram || state.diagrams.length === 1) { bus.emit("toast", "A project must keep at least one tab."); return; }
      const isNotEmpty = (diagram.elements?.length ?? 0) > 0 || (diagram.relationships?.length ?? 0) > 0;
      const deleteTab = async (deleteButton = null) => {
        if (deleteButton) deleteButton.disabled = true;
        try {
          cancelAutoSave(diagram.id);
          await api.request(`/api/diagrams/${diagram.id}`, { method: "DELETE" });
          const index = state.diagrams.findIndex((item) => item.id === diagram.id);
          state.diagrams = state.diagrams.filter((item) => item.id !== diagram.id);
          delete state.tabStates[diagram.id]; state.dirtyTabIds.delete(diagram.id);
          if (state.diagram?.id === diagram.id) {
            activateDiagramTab(state, state.diagrams[Math.min(index, state.diagrams.length - 1)]);
            rememberPage("editor", state.project?.id, state.diagram?.id);
          }
          renderShell();
          bus.emit("diagram:changed", state.diagram);
        } catch (error) {
          if (deleteButton) deleteButton.disabled = false;
          bus.emit("toast", error.message);
        }
      };
      if (!isNotEmpty) { deleteTab(); return; }
      if (document.querySelector("#delete-tab-dialog")) return;
      const backdrop = document.createElement("div");
      backdrop.className = "logout-confirmation-backdrop";
      backdrop.innerHTML = `<section id="delete-tab-dialog" class="logout-confirmation" role="dialog" aria-modal="true" aria-labelledby="delete-tab-title" aria-describedby="delete-tab-description" tabindex="-1"><div class="logout-confirmation-icon" aria-hidden="true">!</div><div class="logout-confirmation-copy"><h2 id="delete-tab-title">Delete tab?</h2><p id="delete-tab-description">“${escapeHtml(diagram.name)}” is not empty. Deleting it will permanently remove its elements and relationships.</p></div><div class="logout-confirmation-actions"><button id="cancel-delete-tab" type="button">Cancel</button><button id="confirm-delete-tab" class="danger" type="button">Delete</button></div></section>`;
      workspace.append(backdrop);
      const dialog = backdrop.querySelector("#delete-tab-dialog");
      const close = () => backdrop.remove();
      backdrop.addEventListener("click", (event) => { if (event.target === backdrop) close(); });
      backdrop.querySelector("#cancel-delete-tab").addEventListener("click", close);
      backdrop.querySelector("#confirm-delete-tab").addEventListener("click", (event) => deleteTab(event.currentTarget));
      dialog.addEventListener("keydown", (event) => { if (event.key === "Escape") { event.preventDefault(); close(); } });
      dialog.focus();
    });
  });
  document.querySelector("#add-diagram-tab")?.addEventListener("click", () => {
    if (document.querySelector("#create-tab-dialog")) return;
    const backdrop = document.createElement("div");
    backdrop.className = "create-tab-backdrop";
    backdrop.innerHTML = `<section id="create-tab-dialog" class="create-tab-dialog" role="dialog" aria-modal="true" aria-labelledby="create-tab-title" aria-describedby="create-tab-description" tabindex="-1">
      <header><h2 id="create-tab-title">Create a new tab</h2><p id="create-tab-description">Choose the diagram name to use for this tab.</p></header>
      <form id="create-tab-form">
        <label for="create-tab-type">Diagram name</label>
        <select id="create-tab-type" required>${diagramCatalog.map((diagram) => `<option value="${escapeHtml(diagram.value)}">${escapeHtml(diagram.label)}</option>`).join("")}</select>
        <div class="create-tab-actions"><button id="cancel-create-tab" type="button">Cancel</button><button class="primary" type="submit">Create</button></div>
      </form>
    </section>`;
    workspace.append(backdrop);
    const close = () => backdrop.remove();
    backdrop.addEventListener("click", (event) => { if (event.target === backdrop) close(); });
    backdrop.querySelector("#cancel-create-tab").addEventListener("click", close);
    backdrop.querySelector("#create-tab-dialog").addEventListener("keydown", (event) => { if (event.key === "Escape") { event.preventDefault(); close(); } });
    backdrop.querySelector("#create-tab-form").addEventListener("submit", async (event) => {
      event.preventDefault();
      const submit = event.currentTarget.querySelector("button[type='submit']");
      const selected = diagramCatalog.find((diagram) => diagram.value === event.currentTarget.querySelector("#create-tab-type").value);
      const baseName = selected?.label ?? "Diagram";
      const used = new Set(state.diagrams.map((diagram) => diagram.name));
      let name = baseName;
      let number = 2;
      while (used.has(name)) name = `${baseName} ${number++}`;
      submit.disabled = true;
      try {
        // The selection names the tab only; the canvas keeps the existing project diagram behavior.
        const created = await api.request("/api/diagrams", { method: "POST", body: JSON.stringify({ project_id: state.project.id, type: state.diagram?.type ?? "uml-class", name }) });
        state.diagrams.push(created);
        activateDiagramTab(state, created);
        rememberPage("editor", state.project?.id, created.id);
        close();
        renderShell();
        bus.emit("diagram:changed", created);
      } catch (error) {
        submit.disabled = false;
        bus.emit("toast", error.message);
      }
    });
    backdrop.querySelector("#create-tab-type").focus();
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
    const requestedTheme = nextTheme(state.settings.theme);
    const requestVersion = ++themeRequestVersion;
    state.settings.theme = requestedTheme;
    applyTheme(requestedTheme);
    const toggle = document.querySelector("#theme-toggle");
    if (toggle) {
      toggle.innerHTML = requestedTheme === "dark" ? icons.moon : icons.sun;
      toggle.dataset.theme = requestedTheme;
      toggle.title = `Toggle ${requestedTheme === "dark" ? "Light" : "Dark"} Mode`;
      toggle.setAttribute("aria-label", toggle.title);
      toggle.setAttribute("aria-pressed", String(requestedTheme === "light"));
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
  const openTabSelectionDialog = ({ title, description, tabs, confirmLabel, onConfirm }) => {
    if (!tabs.length || document.querySelector("#tab-selection-dialog")) return;
    const backdrop = document.createElement("div");
    backdrop.className = "create-tab-backdrop";
    backdrop.innerHTML = `<section id="tab-selection-dialog" class="create-tab-dialog" role="dialog" aria-modal="true" aria-labelledby="tab-selection-title" aria-describedby="tab-selection-description" tabindex="-1"><header><h2 id="tab-selection-title">${escapeHtml(title)}</h2><p id="tab-selection-description">${escapeHtml(description)}</p></header><form id="tab-selection-form"><fieldset class="tab-selection-list"><legend>Tabs</legend>${tabs.map((tab) => `<label><input type="checkbox" name="diagram" value="${escapeHtml(tab.id)}" ${tab.checked ? "checked" : ""}><span>${escapeHtml(tab.name)}</span></label>`).join("")}</fieldset><div class="create-tab-actions"><button class="cancel-tab-selection" type="button">Cancel</button><button class="primary" type="submit">${escapeHtml(confirmLabel)}</button></div></form></section>`;
    workspace.append(backdrop);
    const close = () => backdrop.remove();
    backdrop.addEventListener("click", (event) => { if (event.target === backdrop) close(); });
    backdrop.querySelector(".cancel-tab-selection").addEventListener("click", close);
    backdrop.querySelector("#tab-selection-dialog").addEventListener("keydown", (event) => { if (event.key === "Escape") { event.preventDefault(); close(); } });
    backdrop.querySelector("#tab-selection-form").addEventListener("submit", async (event) => {
      event.preventDefault();
      const ids = [...event.currentTarget.querySelectorAll("input[name='diagram']:checked")].map((input) => input.value);
      if (!ids.length) { bus.emit("toast", "Select at least one tab."); return; }
      const submit = event.currentTarget.querySelector("button[type='submit']");
      submit.disabled = true;
      try { await onConfirm(ids); close(); }
      catch (error) { submit.disabled = false; bus.emit("toast", error.message); }
    });
    backdrop.querySelector("input:checked, input").focus();
  };
  document.querySelector("#manual-save")?.addEventListener("click", () => {
    openTabSelectionDialog({
      title: "Save milestone",
      description: "The current tab is selected. Choose any additional tabs to include in this milestone.",
      tabs: state.diagrams.map((diagram) => ({ ...diagram, checked: diagram.id === state.diagram?.id })),
      confirmLabel: "Save milestone",
      onConfirm: async (ids) => {
        await saveMilestone(ids);
        bus.emit("toast", `Milestone saved for ${ids.length} tab${ids.length === 1 ? "" : "s"}`);
        if (state.sidebarLayout.right.open && state.rightPanel === "history") renderShell();
      }
    });
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
    const milestone = state.versionHistory.find((item) => String(item.version) === String(version));
    if (version === "current" || !milestone) return;
    const available = (milestone.diagrams ?? []).filter((saved) => state.diagrams.some((diagram) => diagram.id === saved.id));
    openTabSelectionDialog({
      title: `Restore milestone ${version}`,
      description: "Choose which tabs to restore. Tabs you do not select will remain unchanged.",
      tabs: available.map((diagram) => ({ ...diagram, checked: diagram.id === state.diagram?.id || available.length === 1 })),
      confirmLabel: "Restore selected",
      onConfirm: async (ids) => {
        for (const diagramId of ids) {
          const restored = await api.restoreDiagram(state.project.id, version, { diagram_id: diagramId });
          state.diagrams = state.diagrams.map((diagram) => diagram.id === restored.id ? restored : diagram);
          if (state.diagram?.id === restored.id) state.diagram = restored;
          delete state.tabStates[restored.id];
          state.dirtyTabIds.delete(restored.id);
        }
        state.selectedHistoryVersion = "current";
        renderShell();
        if (state.diagram) bus.emit("diagram:changed", state.diagram);
        bus.emit("toast", `Restored ${ids.length} tab${ids.length === 1 ? "" : "s"} from milestone ${version}`);
      }
    });
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
