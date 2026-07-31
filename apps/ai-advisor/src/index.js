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
  let turns = [];
  let draft = "";
  let busy = false;
  let disposed = false;
  let requestSequence = 0;

  const liveTurn = () => turns.find((turn) => turn.role === "assistant" && turn.resolved === null);

  const emitPreview = () => {
    const turn = liveTurn();
    bus.emit("ai:preview", turn ? { operations: turn.patch.operations.map(previewOperation).filter((item) => turn.selected.has(item.operation_id)) } : null);
  };

  function renderAssistantTurn(turn) {
    if (turn.error) return `<div class="ai-bubble ai-bubble-assistant ai-bubble-error" role="alert">${escapeHtml(turn.error)}</div>`;
    const operations = turn.proposal.operations;
    const resolvedTag = turn.resolved === "applied" ? '<span class="ai-turn-status applied">Applied</span>' : turn.resolved === "discarded" ? '<span class="ai-turn-status discarded">Not applied</span>' : "";
    return `<div class="ai-bubble ai-bubble-assistant" data-turn="${turn.id}">
      <div class="ai-bubble-summary">${escapeHtml(turn.proposal.summary)}${resolvedTag}</div>
      ${turn.proposal.assumptions?.length ? `<ul class="ai-assumptions">${turn.proposal.assumptions.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ul>` : ""}
      ${turn.proposal.clarification_questions?.length ? `<ul class="ai-clarification">${turn.proposal.clarification_questions.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ul>` : ""}
      ${operations.length ? `<div class="ai-operation-list">${operations.map((operation) => `<label class="ai-operation ${turn.selected.has(operation.id) ? "accepted" : ""} ${turn.resolved ? "locked" : ""}"><input type="checkbox" data-turn="${turn.id}" data-operation="${escapeHtml(operation.id)}" ${turn.selected.has(operation.id) ? "checked" : ""} ${turn.resolved ? "disabled" : ""}><span><strong>${escapeHtml(operation.rationale || operation.type)}</strong><small>${escapeHtml(operation.type.replaceAll("_", " "))}</small></span></label>`).join("")}</div>` : ""}
      ${turn.resolved === null && operations.length ? `<div class="ai-actions"><button data-discard="${turn.id}" type="button">Discard</button><button data-apply="${turn.id}" class="primary" type="button" ${turn.selected.size ? "" : "disabled"}>Apply ${turn.selected.size || ""}</button></div>` : ""}
    </div>`;
  }

  function render() {
    if (disposed) return;
    element.innerHTML = `<div class="ai-shell">
      <header class="ai-header"><span>Modeling assistant</span><h2>AI Advisor</h2><p>Chat about the active tab. Nothing changes on the diagram until you approve it, and this conversation isn't saved anywhere.</p></header>
      <div class="ai-results" id="ai-thread" aria-live="polite">
        ${turns.length ? turns.map((turn) => turn.role === "user"
          ? `<div class="ai-bubble ai-bubble-user">${escapeHtml(turn.text)}</div>`
          : renderAssistantTurn(turn)).join("") : `<p class="ai-empty">Ask for a diagram, or describe the change you want, in plain language.</p>`}
        ${busy ? `<div class="ai-bubble ai-bubble-assistant ai-bubble-pending">Thinking…</div>` : ""}
      </div>
      <footer class="ai-compose">
        <div class="ai-task-switch"><button data-task="generate" class="${state.aiAdvisorTask === "generate" ? "active" : ""}">Generate</button><button data-task="review" class="${state.aiAdvisorTask === "review" ? "active" : ""}">Review</button></div>
        <textarea id="ai-prompt" maxlength="6000" placeholder="${state.aiAdvisorTask === "generate" ? "Describe the diagram or changes you need…" : "What should the review focus on?"}">${escapeHtml(draft)}</textarea>
        <button id="ask-ai" class="primary" ${busy ? "disabled" : ""}>${busy ? "Contacting AI…" : "Send"}</button>
      </footer>
    </div>`;

    const thread = element.querySelector("#ai-thread");
    if (thread) thread.scrollTop = thread.scrollHeight;

    element.querySelector("#ai-prompt")?.addEventListener("input", (event) => { draft = event.target.value; });
    element.querySelectorAll("[data-task]").forEach((button) => button.addEventListener("click", () => {
      state.aiAdvisorTask = button.dataset.task;
      try { localStorage.setItem("sysml.aiAdvisorTask", state.aiAdvisorTask); } catch {}
      render();
    }));
    element.querySelectorAll("[data-operation]").forEach((input) => input.addEventListener("change", () => {
      const turn = turns.find((item) => item.id === input.dataset.turn);
      if (!turn || turn.resolved !== null) return;
      input.checked ? turn.selected.add(input.dataset.operation) : turn.selected.delete(input.dataset.operation);
      emitPreview(); render();
    }));
    element.querySelectorAll("[data-discard]").forEach((button) => button.addEventListener("click", () => {
      const turn = turns.find((item) => item.id === button.dataset.discard);
      if (!turn) return;
      turn.resolved = "discarded"; emitPreview(); render();
    }));
    element.querySelectorAll("[data-apply]").forEach((button) => button.addEventListener("click", () => {
      const turn = turns.find((item) => item.id === button.dataset.apply);
      if (!turn) return;
      if (state.diagram?.id !== turn.diagramId) { turn.error = "The active tab changed. Ask again for this tab."; turn.proposal = null; render(); return; }
      try {
        const operations = selectMaterializedOperations(turn.patch, turn.selected);
        const next = applyPatch(state.diagram, { operations });
        autoLayoutElements(next.elements, [], { width: 5000, height: 4000 }, 20, next.relationships);
        turn.resolved = "applied"; emitPreview();
        setDiagram(next);
        bus.emit("toast", "AI changes applied and arranged.");
        render();
      } catch (caught) { turn.error = caught.message; render(); }
    }));
    element.querySelector("#ask-ai")?.addEventListener("click", async () => {
      const prompt = draft.trim();
      if (state.aiAdvisorTask === "generate" && !prompt) {
        turns.push({ id: createId("turn"), role: "assistant", proposal: null, patch: null, selected: new Set(), diagramId: state.diagram?.id, resolved: "discarded", error: "Describe what you want to create." });
        render();
        return;
      }
      const pending = liveTurn();
      if (pending) pending.resolved = "discarded";
      const history = turns.map((turn) => ({ role: turn.role, text: turn.role === "user" ? turn.text : (turn.error ?? turn.proposal?.summary ?? "") }));
      turns.push({ id: createId("turn"), role: "user", text: prompt || (state.aiAdvisorTask === "review" ? "Review this diagram." : prompt) });
      draft = "";
      const sequence = ++requestSequence;
      const diagramId = state.diagram.id;
      busy = true; emitPreview(); render();
      try {
        const context = buildAiContext({
          task: state.aiAdvisorTask, prompt, diagram: state.diagram, selectedElementIds: state.selectedElementIds,
          repository: state.modelRepository, history
        });
        const response = await api.request("/api/ai", { method: "POST", body: JSON.stringify({ context }) });
        if (disposed || sequence !== requestSequence) return;
        if (state.diagram?.id !== diagramId) throw new Error("The active tab changed while AI was responding. Nothing was applied.");
        const validated = validateAiProposal(response.proposal ?? response, state.diagram.type);
        validateProposalReferences(state.diagram, validated);
        const patch = materializeSemanticProposal(state.diagram, validated, createId);
        turns.push({ id: createId("turn"), role: "assistant", proposal: validated, patch, selected: new Set(validated.operations.map((operation) => operation.id)), diagramId, resolved: null, error: null });
        emitPreview();
      } catch (caught) {
        if (disposed || sequence !== requestSequence) return;
        turns.push({ id: createId("turn"), role: "assistant", proposal: null, patch: null, selected: new Set(), diagramId, resolved: "discarded", error: caught.message });
      } finally { if (!disposed && sequence === requestSequence) { busy = false; render(); } }
    });
  }

  render();
  let currentDiagramId = state.diagram?.id;
  const unsubscribeDiagram = bus.on("diagram:changed", (diagram) => {
    if (diagram?.id === currentDiagramId) return;
    currentDiagramId = diagram?.id;
    requestSequence += 1;
    busy = false; turns = [];
    emitPreview(); render();
  });
  return () => {
    disposed = true;
    requestSequence += 1;
    unsubscribeDiagram();
    bus.emit("ai:preview", null);
  };
});
