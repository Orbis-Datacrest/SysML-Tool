export function createShellRenderer({
  api, applyTheme, bus, escapeHtml, icons, loadVersionHistory, mountMfe, projectUrl,
  redoDiagram, saveCurrentDiagram, setDiagram, showDashboard, state, undoDiagram
}) {
function renderShell() {
  applyTheme(state.settings.theme);
  document.querySelector("#app").innerHTML = `
    <header class="topbar">
      <div class="topbar-left">
        ${state.view === "editor" ? `<button id="sidebar-toggle" class="icon-button" title="${state.sidebarOpen ? "Collapse" : "Expand"} project tools" aria-label="${state.sidebarOpen ? "Collapse" : "Expand"} project tools" aria-controls="project-tools-sidebar" aria-expanded="${state.sidebarOpen}">☰</button>` : ""}
        <button id="brand-home" class="brand-button" title="Open Project Dashboard" aria-label="Open Project Dashboard"><strong class="brand-mark"><span class="brand-icon">S</span>SysML Studio</strong></button>
        ${state.view === "editor" ? `<button id="manual-save" class="icon-button" title="Save Diagram" aria-label="Save Diagram">${icons.save}</button><span id="save-status" class="save-status">${state.saveStatus}</span>` : ""}
        ${state.view === "editor" ? `<button id="project-title" class="top-project-name" title="Rename project" aria-label="Rename project: ${escapeHtml(state.project?.name ?? "Untitled Project")}"><span class="project-name-text">${escapeHtml(state.project?.name ?? "Untitled Project")}</span><span class="project-name-edit" aria-hidden="true">✎</span></button>` : `<span id="project-title">Project Dashboard</span>`}
      </div>
      <div class="topbar-actions">
        ${state.view === "editor" ? `<button id="ai-sidebar-toggle" class="icon-button" title="${state.mobilePanel === "advisor" ? "Close" : "Open"} AI advisor" aria-label="${state.mobilePanel === "advisor" ? "Close" : "Open"} AI advisor" aria-controls="ai-advisor-sidebar" aria-expanded="${state.mobilePanel === "advisor"}">${icons.ai}</button>` : ""}
        ${state.view === "editor" ? `<button id="history-toggle" class="icon-button" title="Version History" aria-label="Version History">${icons.history}</button>` : ""}
        <button id="theme-toggle" class="icon-button" title="Toggle ${state.settings.theme === "dark" ? "Light" : "Dark"} Mode" aria-label="Toggle ${state.settings.theme === "dark" ? "Light" : "Dark"} Mode">${state.settings.theme === "dark" ? icons.moon : icons.sun}</button>
        ${state.view === "editor" ? `<div class="share-control">
          <button id="share-project" class="share-button" title="Share project" aria-label="Open project sharing"><span class="share-lock" aria-hidden="true">${icons.share}</span><span>Share</span><span class="share-chevron" aria-hidden="true">▾</span></button>
          <div id="share-popover" class="share-popover" hidden>
            <div class="share-popover-header"><div><strong>Share project</strong><small>${escapeHtml(state.project?.name ?? "Untitled Project")}</small></div><button id="close-share" class="share-close" aria-label="Close sharing">×</button></div>
            <form id="share-form">
              <label for="share-email">Invite by email</label>
              <div class="share-invite-row"><input id="share-email" type="email" autocomplete="email" value="${escapeHtml(state.shareDraft.email)}" placeholder="name@example.com" required><select id="share-role" aria-label="Access level"><option value="Viewer" ${state.shareDraft.role === "Viewer" ? "selected" : ""}>Viewer</option><option value="Commenter" ${state.shareDraft.role === "Commenter" ? "selected" : ""}>Commenter</option><option value="Editor" ${state.shareDraft.role === "Editor" ? "selected" : ""}>Editor</option></select></div>
              <p id="share-role-help" class="share-role-help">Can view the project but cannot make changes.</p>
              <button class="primary share-send" type="submit">Send invite</button>
            </form>
            <button id="copy-project-link" class="copy-project-link" type="button">Copy project link</button>
          </div>
        </div>` : ""}
        <section id="topbar-import-export" class="topbar-export"></section>
        ${state.view === "dashboard" ? `<section id="auth-session" class="topbar-auth"></section>` : ""}
      </div>
    </header>
    ${state.view === "editor" ? `
      <main class="workspace ${state.sidebarOpen ? "sidebar-open" : ""} ${state.mobilePanel === "advisor" ? "advisor-open" : ""}">
        <aside id="project-tools-sidebar" class="left-rail ${state.sidebarOpen ? "drawer-open" : ""}" aria-label="Project tools">
          <div class="mobile-drawer-header mobile-only"><strong>Project tools</strong><button class="close-mobile-panel" aria-label="Close project tools">×</button></div>
          <section id="project-explorer"></section>
          <section id="element-palette"></section>
          <section id="properties-panel"></section>
          <section id="drawer-import-export" class="drawer-import-export"></section>
          <section id="left-account" class="left-account"></section>
        </aside>
        <section id="diagram-canvas" class="canvas-host"></section>
        <aside id="ai-advisor-sidebar" class="right-rail ${state.mobilePanel === "advisor" ? "drawer-open" : ""}" aria-label="AI advisor">
          <div class="mobile-drawer-header mobile-only"><strong>AI advisor</strong><button class="close-mobile-panel" aria-label="Close AI advisor">×</button></div>
          <section id="ai-advisor"></section>
          <div class="ai-settings-actions">
            <button id="settings-toggle" class="settings-toggle" type="button" aria-expanded="${state.settingsOpen}" aria-controls="auth-tenant-settings">${state.settingsOpen ? "Close Settings" : "Settings"}</button>
          </div>
          ${state.settingsOpen ? `<section id="auth-tenant-settings" class="ai-settings-slot"></section>` : ""}
        </aside>
        <button class="workspace-drawer-backdrop ${state.mobilePanel === "advisor" ? "advisor-backdrop" : ""} ${state.sidebarOpen ? "sidebar-backdrop" : ""}" aria-label="Close open panel"></button>
      </main>
    ` : `
      <main class="dashboard-host">
        <section id="project-dashboard"></section>
      </main>
    `}
    ${state.historyOpen ? `
      <div class="history-backdrop" role="presentation">
        <aside class="history-drawer" role="dialog" aria-modal="true" aria-labelledby="history-title">
          <div class="history-header">
            <div>
              <p class="eyebrow">Version History</p>
              <h2 id="history-title">${state.project?.name ?? "Project"}</h2>
            </div>
            <button id="close-history" title="Close history" aria-label="Close history">×</button>
          </div>
          <div class="history-body">
            <form id="baseline-form" class="history-form">
              <input id="baseline-name" placeholder="Baseline name" aria-label="Baseline name" required>
              <input id="baseline-description" placeholder="Change description" aria-label="Change description">
              <label class="checkbox-row"><input id="baseline-release" type="checkbox"> Release immutable baseline</label>
              <button class="primary" type="submit">Create Baseline</button>
            </form>
            <div class="history-section">
              <strong>Named Baselines</strong>
              ${state.baselines.map((item) => `
                <div class="version-card baseline-card">
                  <strong>${escapeHtml(item.name)} ${item.released ? `<span class="baseline-state">Released</span>` : `<span class="baseline-state draft">Draft</span>`}</strong>
                  <span class="muted">Version ${item.version} · ${new Date(item.created_at).toLocaleString()}</span>
                  <span>${escapeHtml(item.description)}</span>
                  ${item.released ? "" : `<button data-release-baseline="${item.id}">Release</button>`}
                </div>
              `).join("") || `<p class="muted">No named baselines yet.</p>`}
            </div>
            <form id="compare-form" class="history-form compact">
              <select id="compare-from" aria-label="Compare from">${state.versionHistory.map((item) => `<option value="${item.version}" ${String(state.versionCompare.from) === String(item.version) ? "selected" : ""}>v${item.version}</option>`).join("")}</select>
              <select id="compare-to" aria-label="Compare to">${state.versionHistory.map((item) => `<option value="${item.version}" ${String(state.versionCompare.to || state.versionHistory[0]?.version) === String(item.version) ? "selected" : ""}>v${item.version}</option>`).join("")}</select>
              <button type="submit">Compare</button>
            </form>
            ${state.versionCompare.diff ? `<div class="diff-panel">
              ${["modelChanges", "diagramChanges", "relationshipChanges", "requirementChanges"].map((key) => `
                <section><strong>${key.replace(/([A-Z])/g, " $1")}</strong>
                  ${(state.versionCompare.diff[key] ?? []).slice(0, 8).map((item) => `<div class="diff-row ${item.kind}"><span>${escapeHtml(item.label ?? item.id)}</span><small>${escapeHtml(item.path || item.kind)}: ${escapeHtml(String(item.before ?? "∅"))} → ${escapeHtml(String(item.after ?? "∅"))}</small></div>`).join("") || `<p class="muted">No changes.</p>`}
                </section>
              `).join("")}
            </div>` : ""}
            <div class="history-section">
              <strong>Reviews & Approvals</strong>
              <form id="review-form" class="history-form compact"><input id="review-title" placeholder="Review title" aria-label="Review title"><button type="submit">Open Review</button></form>
              ${state.reviews.map((item) => `<div class="version-card">
                <strong>${escapeHtml(item.title)}</strong><span class="muted">${escapeHtml(item.status)} · ${new Date(item.created_at).toLocaleString()}</span>
                <button data-approve-review="${item.id}" ${item.status === "approved" ? "disabled" : ""}>Approve</button>
                <button data-request-changes="${item.id}" ${item.status === "approved" ? "disabled" : ""}>Request changes</button>
              </div>`).join("") || `<p class="muted">No active reviews.</p>`}
            </div>
            <div class="history-section">
              <strong>Collaboration</strong>
              <div class="collab-summary"><span>${escapeHtml(state.collaboration.role)}</span><span>${state.collaboration.presence.length} online</span><span>${state.collaboration.comments.length} comments</span></div>
              ${state.collaboration.comments.slice(-5).reverse().map((item) => `<div class="comment-card"><strong>${escapeHtml(item.author)}</strong><span>${escapeHtml(item.body)}</span><small>${escapeHtml(item.anchor_type)} ${escapeHtml(item.anchor_id)}</small></div>`).join("") || `<p class="muted">No anchored discussions yet.</p>`}
            </div>
            <div class="history-section">
              <strong>Model History</strong>
            ${state.versionHistory.map((item) => `
              <div class="version-card">
                <strong>Version ${item.version}</strong>
                <span class="muted">${new Date(item.created_at).toLocaleString()}</span>
                <span>${item.description}</span>
                ${state.diagram ? `<button data-restore-diagram-version="${item.version}">Restore diagram</button>` : ""}
                ${state.selectedElementIds?.[0] && state.diagram ? `<button data-restore-element-version="${item.version}">Restore selected element</button>` : ""}
                <button data-restore-version="${item.version}">Restore</button>
              </div>
            `).join("") || `<p class="muted">No manual save milestones yet. Click the save icon to create one.</p>`}
            </div>
            <div class="history-section">
              <strong>Audit History</strong>
              ${state.auditHistory.slice(0, 12).map((item) => `<div class="audit-row"><span>${escapeHtml(item.description)}</span><small>${new Date(item.created_at).toLocaleString()}</small></div>`).join("") || `<p class="muted">No audited actions yet.</p>`}
            </div>
          </div>
        </aside>
      </div>
    ` : ""}
  `;
  const context = { state, bus, api, setDiagram, undoDiagram, redoDiagram };
  if (state.view === "dashboard") mountMfe("auth-session", document.querySelector("#auth-session"), context);
  if (state.view === "dashboard") {
    mountMfe("project-dashboard", document.querySelector("#project-dashboard"), context);
  } else {
    mountMfe("project-explorer", document.querySelector("#project-explorer"), context);
    mountMfe("element-palette", document.querySelector("#element-palette"), context);
    mountMfe("diagram-canvas", document.querySelector("#diagram-canvas"), context);
    mountMfe("ai-advisor", document.querySelector("#ai-advisor"), context);
    mountMfe("import-export", document.querySelector("#topbar-import-export"), context);
    mountMfe("import-export", document.querySelector("#drawer-import-export"), context);
    if (state.settingsOpen) mountMfe("auth-tenant-settings", document.querySelector("#auth-tenant-settings"), context);
    mountMfe("auth-session", document.querySelector("#left-account"), context);
  }

  document.querySelectorAll(".topbar, .left-rail, .right-rail").forEach((region) => {
    region.addEventListener("dragstart", (event) => {
      if (!event.target.closest(".palette-item")) event.preventDefault();
    });
    region.addEventListener("drop", (event) => event.preventDefault());
  });

  document.querySelector("#brand-home")?.addEventListener("click", () => {
    if (state.view === "editor") showDashboard();
  });
  const setMobilePanel = (panel) => {
    state.mobilePanel = state.mobilePanel === panel ? null : panel;
    renderShell();
  };
  document.querySelector("#sidebar-toggle")?.addEventListener("click", () => {
    state.sidebarOpen = !state.sidebarOpen;
    renderShell();
  });
  document.querySelector("#ai-sidebar-toggle")?.addEventListener("click", () => setMobilePanel("advisor"));
  document.querySelector("#settings-toggle")?.addEventListener("click", () => {
    state.settingsOpen = !state.settingsOpen;
    renderShell();
  });
  document.querySelectorAll(".close-mobile-panel,.workspace-drawer-backdrop").forEach((button) => button.addEventListener("click", () => {
    state.mobilePanel = null;
    state.sidebarOpen = false;
    renderShell();
  }));
  document.querySelector("#history-toggle")?.addEventListener("click", async () => {
    await loadVersionHistory();
    state.historyOpen = true;
    renderShell();
  });
  document.querySelector("#close-history")?.addEventListener("click", () => {
    state.historyOpen = false;
    renderShell();
  });
  document.querySelector(".history-backdrop")?.addEventListener("click", (event) => {
    if (event.target === event.currentTarget) {
      state.historyOpen = false;
      renderShell();
    }
  });
  document.querySelector("#theme-toggle")?.addEventListener("click", async () => {
    state.settings.theme = state.settings.theme === "dark" ? "light" : "dark";
    applyTheme(state.settings.theme);
    if (state.user) {
      const result = await api.request("/api/settings", { method: "PATCH", body: JSON.stringify({ theme: state.settings.theme }) });
      state.settings = result.settings;
      applyTheme(state.settings.theme);
    }
    renderShell();
  });
  const sharePopover = document.querySelector("#share-popover");
  document.querySelector("#share-project")?.addEventListener("click", () => {
    sharePopover.hidden = !sharePopover.hidden;
    if (!sharePopover.hidden) document.querySelector("#share-email")?.focus();
  });
  document.querySelector("#close-share")?.addEventListener("click", () => { sharePopover.hidden = true; });
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
      sharePopover.hidden = true;
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
  });
  document.querySelector("#baseline-form")?.addEventListener("submit", async (event) => {
    event.preventDefault();
    const name = document.querySelector("#baseline-name").value.trim();
    const description = document.querySelector("#baseline-description").value.trim();
    const release = document.querySelector("#baseline-release").checked;
    try {
      const result = await api.createBaseline(state.project.id, { name, description, release });
      state.versionHistory = result.versions ?? [];
      state.baselines = result.baselines ?? [];
      renderShell();
      bus.emit("toast", release ? "Released baseline created" : "Baseline created");
    } catch (error) {
      bus.emit("toast", error.message);
    }
  });
  document.querySelector("#compare-form")?.addEventListener("submit", async (event) => {
    event.preventDefault();
    const from = document.querySelector("#compare-from").value;
    const to = document.querySelector("#compare-to").value;
    try {
      const result = await api.compareVersions(state.project.id, from, to);
      state.versionCompare = { from, to, diff: result.diff };
      renderShell();
    } catch (error) {
      bus.emit("toast", error.message);
    }
  });
  document.querySelector("#review-form")?.addEventListener("submit", async (event) => {
    event.preventDefault();
    const title = document.querySelector("#review-title").value.trim() || "Engineering Review";
    try {
      await api.createReview(state.project.id, { title, baseline_id: state.baselines[0]?.id });
      await loadVersionHistory();
      renderShell();
      bus.emit("toast", "Review opened");
    } catch (error) {
      bus.emit("toast", error.message);
    }
  });
  document.querySelectorAll("[data-release-baseline]").forEach((button) => button.addEventListener("click", async () => {
    try {
      await api.releaseBaseline(state.project.id, button.dataset.releaseBaseline);
      await loadVersionHistory();
      renderShell();
      bus.emit("toast", "Baseline released");
    } catch (error) {
      bus.emit("toast", error.message);
    }
  }));
  document.querySelectorAll("[data-approve-review],[data-request-changes]").forEach((button) => button.addEventListener("click", async () => {
    const reviewId = button.dataset.approveReview ?? button.dataset.requestChanges;
    const decision = button.dataset.approveReview ? "approved" : "changes-requested";
    try {
      await api.approveReview(state.project.id, reviewId, { decision });
      await loadVersionHistory();
      renderShell();
      bus.emit("toast", decision === "approved" ? "Review approved" : "Changes requested");
    } catch (error) {
      bus.emit("toast", error.message);
    }
  }));
  document.querySelectorAll("[data-restore-element-version]").forEach((button) => {
    button.addEventListener("click", async () => {
      const elementId = state.selectedElementIds?.[0];
      if (!elementId) return;
      if (!confirm(`Restore selected element from project version ${button.dataset.restoreElementVersion}?`)) return;
      state.diagram = await api.restoreElement(state.project.id, button.dataset.restoreElementVersion, { diagram_id: state.diagram.id, element_id: elementId });
      state.historyOpen = false;
      renderShell();
      bus.emit("diagram:changed", state.diagram);
      bus.emit("toast", "Element restored");
    });
  });
  document.querySelectorAll("[data-restore-diagram-version]").forEach((button) => {
    button.addEventListener("click", async () => {
      if (!confirm(`Restore current diagram from project version ${button.dataset.restoreDiagramVersion}?`)) return;
      state.diagram = await api.restoreDiagram(state.project.id, button.dataset.restoreDiagramVersion, { diagram_id: state.diagram.id });
      state.diagrams = state.diagrams.map((diagram) => diagram.id === state.diagram.id ? state.diagram : diagram);
      state.historyOpen = false;
      renderShell();
      bus.emit("diagram:changed", state.diagram);
      bus.emit("toast", "Diagram restored");
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
  document.querySelectorAll("[data-restore-version]").forEach((button) => {
    button.addEventListener("click", async () => {
      if (!confirm(`Restore project version ${button.dataset.restoreVersion}? Current unsaved canvas changes will be replaced.`)) return;
      const result = await api.request(`/api/projects/${state.project.id}/versions/${button.dataset.restoreVersion}/restore`, { method: "POST" });
      state.project = result.project;
      state.diagrams = result.diagrams ?? [];
      state.diagram = state.diagrams[0] ?? null;
      state.historyOpen = false;
      await loadVersionHistory();
      renderShell();
      bus.emit("bootstrap", { projects: [state.project], diagrams: state.diagrams });
      if (state.diagram) bus.emit("diagram:changed", state.diagram);
      bus.emit("toast", "Version restored");
    });
  });
}

return renderShell;
}
