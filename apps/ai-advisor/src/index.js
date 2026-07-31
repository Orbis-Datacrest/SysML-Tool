import { registerMfe } from "/packages/ui/src/moduleRegistry.js";
import { applyPatch, createId } from "/packages/model-core/src/index.js";
import { autoLayoutElements } from "/apps/diagram-canvas/src/canvas-model.js";
import { buildAiContext } from "/services/ai-advisor-service/src/contextBuilder.js";
import { materializeSemanticProposal, selectMaterializedOperations, validateProposalReferences } from "/services/ai-advisor-service/src/layoutEngine.js";
import { validateAiProposal } from "/services/ai-advisor-service/src/proposalContract.js";

const escapeHtml = (value) => String(value ?? "").replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character]);

function previewOperation(operation) {
  if (operation.op === "addElement") return { operation_id: operation.semantic_operation_id, element: operation.element };
  if (operation.op === "updateElement") return { operation_id: operation.semantic_operation_id, kind: "updateElement", element_id: operation.element_id, changes: operation.changes };
  if (operation.op === "removeElement") return { operation_id: operation.semantic_operation_id, kind: "removeElement", element_id: operation.element_id };
  if (operation.op === "addRelationship") return { operation_id: operation.semantic_operation_id, relationship: operation.relationship };
  return { operation_id: operation.semantic_operation_id, kind: "removeRelationship", relationship_id: operation.relationship_id };
}

registerMfe("ai-advisor", (element, { state, bus, api, setDiagram }) => {
  let proposal = null;
  let patch = null;
  let selected = new Set();
  let task = "generate";
  let draft = "";
  let busy = false;
  let error = "";
  let disposed = false;
  let requestSequence = 0;

  const emitPreview = () => bus.emit("ai:preview", patch ? {
    operations: patch.operations.map(previewOperation).filter((item) => selected.has(item.operation_id))
  } : null);

  function render() {
    if (disposed) return;
    const operations = proposal?.operations ?? [];
    element.innerHTML = `<div class="ai-shell">
      <header class="ai-header"><span>Modeling assistant</span><h2>AI Advisor</h2><p>Generate or review the active tab. Changes stay local until you approve them.</p></header>
      <div class="ai-results">${error ? `<p class="ai-error" role="alert">${escapeHtml(error)}</p>` : ""}
      ${proposal ? `<section class="ai-proposal" aria-live="polite">
        <h3>${escapeHtml(proposal.summary)}</h3>
        ${proposal.assumptions?.length ? `<ul class="ai-assumptions">${proposal.assumptions.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ul>` : ""}
        ${proposal.clarification_questions?.length ? `<p class="ai-clarification">${escapeHtml(proposal.clarification_questions[0])}</p>` : ""}
        <div class="ai-operation-list">${operations.map((operation) => `<label class="ai-operation ${selected.has(operation.id) ? "accepted" : ""}"><input type="checkbox" data-operation="${escapeHtml(operation.id)}" ${selected.has(operation.id) ? "checked" : ""}><span><strong>${escapeHtml(operation.rationale || operation.type)}</strong><small>${escapeHtml(operation.type.replaceAll("_", " "))}</small></span></label>`).join("") || `<p>No model changes were proposed.</p>`}</div>
        <div class="ai-actions"><button id="discard-ai" type="button">Discard</button><button id="apply-ai" class="primary" type="button" ${selected.size && !busy ? "" : "disabled"}>Apply ${selected.size || ""}</button></div>
      </section>` : ""}</div>
      <footer class="ai-compose">
        <div class="ai-task-switch"><button data-task="generate" class="${task === "generate" ? "active" : ""}">Generate</button><button data-task="review" class="${task === "review" ? "active" : ""}">Review</button></div>
        <textarea id="ai-prompt" maxlength="6000" placeholder="${task === "generate" ? "Describe the diagram or changes you need…" : "What should the review focus on?"}">${escapeHtml(draft)}</textarea>
        <button id="ask-ai" class="primary" ${busy ? "disabled" : ""}>${busy ? "Contacting AI…" : "Preview changes"}</button>
      </footer>
    </div>`;

    element.querySelector("#ai-prompt")?.addEventListener("input", (event) => { draft = event.target.value; });
    element.querySelectorAll("[data-task]").forEach((button) => button.addEventListener("click", () => { task = button.dataset.task; error = ""; render(); }));
    element.querySelectorAll("[data-operation]").forEach((input) => input.addEventListener("change", () => {
      input.checked ? selected.add(input.dataset.operation) : selected.delete(input.dataset.operation);
      emitPreview(); render();
    }));
    element.querySelector("#discard-ai")?.addEventListener("click", () => {
      proposal = null; patch = null; selected.clear(); emitPreview(); render();
    });
    element.querySelector("#apply-ai")?.addEventListener("click", () => {
      const diagramId = proposal.diagramId;
      if (state.diagram?.id !== diagramId) { error = "The active tab changed. Request a new proposal for this tab."; render(); return; }
      try {
        const operations = selectMaterializedOperations(patch, selected);
        const next = applyPatch(state.diagram, { operations });
        autoLayoutElements(next.elements, [], { width: 5000, height: 4000 }, 20, next.relationships);
        proposal = null; patch = null; selected.clear(); emitPreview();
        setDiagram(next);
        bus.emit("toast", "AI changes applied and arranged.");
      } catch (caught) { error = caught.message; render(); }
    });
    element.querySelector("#ask-ai")?.addEventListener("click", async () => {
      const prompt = draft.trim();
      if (task === "generate" && !prompt) { error = "Describe what you want to create."; render(); return; }
      const sequence = ++requestSequence;
      const diagramId = state.diagram.id;
      busy = true; error = ""; proposal = null; patch = null; selected.clear(); emitPreview(); render();
      try {
        const context = buildAiContext({
          task, prompt, diagram: state.diagram, selectedElementIds: state.selectedElementIds,
          repository: state.modelRepository
        });
        const response = await api.request("/api/ai", { method: "POST", body: JSON.stringify({ context }) });
        if (disposed || sequence !== requestSequence) return;
        if (state.diagram?.id !== diagramId) throw new Error("The active tab changed while AI was responding. Nothing was applied.");
        const validated = validateAiProposal(response.proposal ?? response, state.diagram.type);
        validateProposalReferences(state.diagram, validated);
        patch = materializeSemanticProposal(state.diagram, validated, createId);
        proposal = { ...validated, diagramId };
        selected = new Set(validated.operations.map((operation) => operation.id));
        emitPreview();
      } catch (caught) { error = caught.message; }
      finally { if (!disposed && sequence === requestSequence) { busy = false; render(); } }
    });
  }

  render();
  const unsubscribeDiagram = bus.on("diagram:changed", (diagram) => {
    requestSequence += 1;
    busy = false; proposal = null; patch = null; selected.clear(); error = "";
    emitPreview(); render();
  });
  return () => {
    disposed = true;
    requestSequence += 1;
    unsubscribeDiagram();
    bus.emit("ai:preview", null);
  };
});
