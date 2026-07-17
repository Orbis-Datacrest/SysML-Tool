import { registerMfe } from "/packages/ui/src/moduleRegistry.js";

const escapeHtml = (value) => String(value ?? "").replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character]);
const operationTitle = (operation, diagram) => {
  const targetName = diagram?.elements?.find((item) => item.id === operation.target_id)?.name ?? operation.target_id;
  return ({ add_element: `Add ${operation.element?.kind}: ${operation.element?.name}`, update_element: `Update ${targetName}`, remove_element: `Remove ${targetName}`, add_relationship: `Add ${operation.relationship?.kind} relationship`, remove_relationship: `Remove relationship ${operation.relationship_id}` })[operation.type] ?? operation.type;
};
const values = (items) => Array.isArray(items) ? items.map((item) => typeof item === "string" ? item : item.name).filter(Boolean).join(", ") : "";

registerMfe("ai-advisor", (element, { state, bus, api, setDiagram, saveCurrentDiagram }) => {
  let proposal = null;
  let selected = new Set();
  let task = "generate";
  let draft = "";
  let submittedPrompt = "";
  let busy = false;
  let error = "";
  let approvalChecked = false;

  const emitGhosts = () => bus.emit("ai:preview", proposal ? {
    proposal_id: proposal.id,
    operations: (proposal.preview_operations ?? []).filter((item) => selected.has(item.operation_id))
  } : null);

  function operationDetails(operation) {
    const details = [];
    const properties = operation.element?.properties ?? operation.changes?.properties ?? {};
    if (values(properties.attributes)) details.push(`Attributes: ${values(properties.attributes)}`);
    if (values(properties.operations)) details.push(`Operations: ${values(properties.operations)}`);
    if (values(properties.ports)) details.push(`Ports: ${values(properties.ports)}`);
    if (properties.text) details.push(`Text: ${properties.text}`);
    if (operation.relationship) {
      const names = new Map(proposal.operations.filter((item) => item.element).map((item) => [item.element.ref, item.element.name]));
      details.push(`${names.get(operation.relationship.source_ref) ?? operation.relationship.source_ref} → ${names.get(operation.relationship.target_ref) ?? operation.relationship.target_ref}`);
      const source = operation.relationship.properties?.sourceMultiplicity; const target = operation.relationship.properties?.targetMultiplicity;
      if (source || target) details.push(`Multiplicity: ${source || "?"} → ${target || "?"}`);
    }
    return details;
  }

  function renderAssumptions() {
    if (!proposal.assumptions?.length) return "";
    return `<section class="ai-assumptions"><strong>Assumptions</strong><ul>${proposal.assumptions.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ul></section>`;
  }

  function renderDetails() {
    const hasDetails = proposal.summary || proposal.clarification_questions?.length || proposal.comments?.length || proposal.validation;
    if (!hasDetails) return "";
    return `<details class="ai-details"><summary>Details</summary><div class="ai-details-body">
      ${proposal.summary ? `<div><strong>Summary</strong><p>${escapeHtml(proposal.summary)}</p></div>` : ""}
      ${proposal.clarification_questions?.length ? `<div class="ai-detail-questions"><strong>Clarification needed</strong><ul>${proposal.clarification_questions.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ul></div>` : ""}
      ${proposal.comments?.length ? `<div><strong>Review comments</strong><div class="ai-comment-list">${proposal.comments.map((comment) => `<button type="button" class="ai-comment ${escapeHtml(comment.severity)}" data-comment-anchor="${escapeHtml(comment.anchor_id)}"><span>${escapeHtml(comment.severity)}</span><b>${escapeHtml(comment.message)}</b>${comment.suggestion ? `<small>${escapeHtml(comment.suggestion)}</small>` : ""}</button>`).join("")}</div></div>` : ""}
      <small>Diagram version ${proposal.base_diagram_version} · ${escapeHtml(proposal.provider)} · server validated</small>
    </div></details>`;
  }

  function renderProposal() {
    if (!proposal) return "";
    const canApply = proposal.operations?.length && selected.size && approvalChecked && !busy;
    return `<article class="ai-proposal" aria-live="polite">
      <section class="ai-prompt-result"><span>Prompt</span><p>${escapeHtml(submittedPrompt || `Review ${state.diagram?.name ?? "diagram"}`)}</p></section>
      ${renderAssumptions()}
      ${proposal.clarification_questions?.length && !proposal.operations?.length ? `<section class="ai-clarification" role="status"><strong>I need clarification</strong><p>${escapeHtml(proposal.clarification_questions[0])}</p></section>` : ""}
      <section class="ai-changes">
        <div class="ai-section-heading"><div><span>Proposal</span><h3>Proposed changes</h3></div>${proposal.operations?.length ? `<small>${selected.size} of ${proposal.operations.length} included</small>` : ""}</div>
        ${proposal.operations?.length ? `<div class="ai-operation-actions"><button type="button" data-select-all>Include all</button><button type="button" data-select-none>Exclude all</button></div><div class="ai-operation-list">${proposal.operations.map((operation) => `<label class="ai-operation ${selected.has(operation.id) ? "accepted" : "rejected"}"><input type="checkbox" data-operation-id="${escapeHtml(operation.id)}" ${selected.has(operation.id) ? "checked" : ""}><span><strong>${escapeHtml(operationTitle(operation, state.diagram))}</strong>${operationDetails(operation).map((detail) => `<small class="ai-operation-detail">${escapeHtml(detail)}</small>`).join("")}<small>${escapeHtml(operation.rationale)}</small></span><em>${selected.has(operation.id) ? "Included" : "Excluded"}</em></label>`).join("")}</div>` : `<p class="ai-no-changes">No changes are ready to apply.</p>`}
      </section>
      ${renderDetails()}
      ${proposal.operations?.length ? `<label class="ai-approval"><input id="ai-explicit-approval" type="checkbox" ${approvalChecked ? "checked" : ""}><span>I reviewed and approve the included changes.</span></label>` : ""}
      <div class="ai-proposal-actions">${proposal.operations?.length ? `<button id="apply-ai-proposal" class="primary" type="button" ${canApply ? "" : "disabled"}>Apply ${selected.size || ""}</button>` : ""}<button id="discard-ai-proposal" type="button" ${busy ? "disabled" : ""}>Reject</button></div>
    </article>`;
  }

  function render() {
    element.innerHTML = `<div class="ai-shell">
      <div class="ai-header"><div><span>Modeling assistant</span><h2>AI Advisor</h2></div><p>Describe the model you need. Review every change before applying.</p></div>
      <div class="chat-log">${error ? `<div class="ai-error" role="alert">${escapeHtml(error)}</div>` : ""}${renderProposal()}</div>
      <div class="ai-compose stack">
        <div class="ai-task-switch" role="group" aria-label="AI task"><button type="button" data-ai-task="generate" class="${task === "generate" ? "active" : ""}" aria-pressed="${task === "generate"}">Generate</button><button type="button" data-ai-task="review" class="${task === "review" ? "active" : ""}" aria-pressed="${task === "review"}">Review</button></div>
        <textarea id="prompt" maxlength="6000" placeholder="${task === "generate" ? "Example: Create a class Ethiopia with attributes population, capital, area…" : "Optional: what should the review focus on?"}">${escapeHtml(draft)}</textarea>
        <button id="ask" class="primary" type="button" ${busy ? "disabled" : ""}>${busy ? "Understanding prompt…" : task === "generate" ? "Preview changes" : "Review diagram"}</button>
      </div>
    </div>`;

    const promptInput = element.querySelector("#prompt");
    promptInput?.addEventListener("input", () => { draft = promptInput.value; });
    element.querySelectorAll("[data-ai-task]").forEach((button) => button.addEventListener("click", () => { task = button.dataset.aiTask; error = ""; render(); }));
    element.querySelector("#ask")?.addEventListener("click", async () => {
      const prompt = draft.trim();
      if (task === "generate" && !prompt) { error = "Describe what you want to generate."; render(); return; }
      submittedPrompt = prompt; busy = true; error = ""; proposal = null; selected.clear(); approvalChecked = false; emitGhosts(); render();
      try {
        const saved = state.dirtyTabIds?.has(state.diagram.id) ? await saveCurrentDiagram({ diagram: state.diagram }) : state.diagram;
        if (!saved) throw new Error("Save the current diagram before requesting an AI proposal.");
        proposal = await api.request("/api/ai/preview", { method: "POST", body: JSON.stringify({ project_id: state.project.id, diagram_id: saved.id, selected_element_ids: state.selectedElementIds, prompt, task }) });
        selected = new Set(proposal.operations.map((operation) => operation.id));
        emitGhosts();
      } catch (caught) { error = caught.message; }
      finally { busy = false; render(); }
    });
    element.querySelectorAll("[data-operation-id]").forEach((input) => input.addEventListener("change", () => { input.checked ? selected.add(input.dataset.operationId) : selected.delete(input.dataset.operationId); approvalChecked = false; emitGhosts(); render(); }));
    element.querySelector("[data-select-all]")?.addEventListener("click", () => { selected = new Set(proposal.operations.map((operation) => operation.id)); approvalChecked = false; emitGhosts(); render(); });
    element.querySelector("[data-select-none]")?.addEventListener("click", () => { selected.clear(); approvalChecked = false; emitGhosts(); render(); });
    element.querySelector("#ai-explicit-approval")?.addEventListener("change", (event) => { approvalChecked = event.target.checked; render(); });
    element.querySelectorAll("[data-comment-anchor]").forEach((button) => button.addEventListener("click", () => { if (button.dataset.commentAnchor !== "diagram") bus.emit("model:focus", button.dataset.commentAnchor); }));
    element.querySelector("#apply-ai-proposal")?.addEventListener("click", async () => {
      busy = true; error = ""; render();
      try {
        const result = await api.request("/api/ai/apply", { method: "POST", body: JSON.stringify({ proposal_id: proposal.id, selected_operation_ids: [...selected], approved: true }) });
        proposal = null; selected.clear(); approvalChecked = false; emitGhosts(); setDiagram(result.diagram, true, null, false); bus.emit("toast", "AI changes applied.");
      } catch (caught) { error = caught.message; }
      finally { busy = false; render(); }
    });
    element.querySelector("#discard-ai-proposal")?.addEventListener("click", async () => {
      const id = proposal.id; proposal = null; selected.clear(); approvalChecked = false; emitGhosts(); render();
      try { await api.request(`/api/ai/proposals/${encodeURIComponent(id)}`, { method: "DELETE" }); }
      catch (caught) { error = caught.message; render(); }
    });
  }

  const unsubscribeDiagram = bus.on("diagram:changed", (diagram) => {
    if (proposal && diagram.id === proposal.diagram_id) { proposal = null; selected.clear(); approvalChecked = false; emitGhosts(); }
    render();
  });
  render();
  return () => { unsubscribeDiagram(); bus.emit("ai:preview", null); };
});
