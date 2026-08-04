import { registerMfe } from "/packages/ui/src/moduleRegistry.js";
import { applyPatch, createId } from "/packages/model-core/src/index.js";
import { layoutElementsByStrategy } from "/apps/diagram-canvas/src/canvas-model.js";
import { buildAiContext } from "/services/ai-advisor-service/src/contextBuilder.js";
import { materializeSemanticProposal, selectMaterializedLayouts, selectMaterializedOperations, validateProposalReferences } from "/services/ai-advisor-service/src/layoutEngine.js";
import { normalizeAiProposalForDiagram, normalizeAiProposalForRequest, validateAiProposal } from "/services/ai-advisor-service/src/proposalContract.js";

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
  let pendingMessage = "Preparing a recommendation…";
  let disposed = false;
  let requestSequence = 0;

  const liveTurn = () => turns.find((turn) => turn.role === "assistant" && turn.resolved === null);
  const latestAppliedTurn = () => [...turns].reverse().find((turn) => turn.role === "assistant" && turn.resolved === "applied");
  const diagramMatches = (left, right) => Boolean(left && right) && JSON.stringify(left) === JSON.stringify(right);

  const emitPreview = () => {
    const turn = liveTurn();
    if (!turn) { bus.emit("ai:preview", null); return; }
    const operations = turn.patch.operations.map(previewOperation).filter((item) => turn.selected.has(item.operation_id));
    const layouts = selectMaterializedLayouts(turn.patch, turn.selected);
    if (layouts.length) {
      const preview = applyPatch(state.diagram, { operations: selectMaterializedOperations(turn.patch, turn.selected) });
      layouts.forEach((layout) => layoutElementsByStrategy(preview.elements, layout.element_ids, layout.strategy, { width: 5000, height: 4000 }, 20, preview.relationships));
      const previewNodes = new Map(preview.elements.map((node) => [node.id, node]));
      const represented = new Set();
      operations.forEach((operation) => {
        const elementId = operation.element?.id ?? operation.element_id;
        const node = previewNodes.get(elementId);
        if (!node || operation.kind === "removeElement") return;
        represented.add(elementId);
        if (operation.element) operation.element = { ...operation.element, x: node.x, y: node.y };
        else operation.changes = { ...operation.changes, x: node.x, y: node.y };
      });
      for (const node of preview.elements) {
        const current = state.diagram.elements.find((item) => item.id === node.id);
        if (current && !represented.has(node.id) && (current.x !== node.x || current.y !== node.y)) operations.push({ operation_id: `layout_${node.id}`, kind: "updateElement", element_id: node.id, changes: { x: node.x, y: node.y } });
      }
    }
    bus.emit("ai:preview", { operations });
  };

  function renderAssistantTurn(turn) {
    if (turn.error) return `<div class="ai-bubble ai-bubble-assistant ai-bubble-error" role="alert">${escapeHtml(turn.error)}</div>`;
    const operations = turn.proposal.operations;
    const layouts = turn.proposal.layout_suggestions ?? [];
    const canUndo = turn === latestAppliedTurn() && diagramMatches(state.diagram, turn.appliedDiagram);
    const resolvedTag = turn.resolved === "applied" ? `<span class="ai-turn-resolution"><span class="ai-turn-status applied">Applied</span>${canUndo ? `<button class="ai-undo-button" data-undo-ai="${turn.id}" type="button" title="Undo this AI change">Undo</button>` : ""}</span>` : turn.resolved === "reverted" ? '<span class="ai-turn-status discarded">Undone</span>' : turn.resolved === "discarded" ? '<span class="ai-turn-status discarded">Not applied</span>' : "";
    return `<div class="ai-bubble ai-bubble-assistant" data-turn="${turn.id}">
      <div class="ai-bubble-summary">${escapeHtml(turn.proposal.summary)}${resolvedTag}</div>
      ${turn.proposal.assumptions?.length ? `<ul class="ai-assumptions">${turn.proposal.assumptions.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ul>` : ""}
      ${turn.proposal.clarification_questions?.length ? `<ul class="ai-clarification">${turn.proposal.clarification_questions.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ul>` : ""}
      ${operations.length ? `<div class="ai-operation-list">${operations.map((operation) => `<label class="ai-operation ${turn.selected.has(operation.id) ? "accepted" : ""} ${turn.resolved ? "locked" : ""}"><input type="checkbox" data-turn="${turn.id}" data-operation="${escapeHtml(operation.id)}" ${turn.selected.has(operation.id) ? "checked" : ""} ${turn.resolved ? "disabled" : ""}><span><strong>${escapeHtml(operation.rationale || operation.type)}</strong><small>${escapeHtml(operation.type.replaceAll("_", " "))}</small></span></label>`).join("")}</div>` : ""}
      ${layouts.length ? `<div class="ai-operation-list">${layouts.map((layout) => `<label class="ai-operation ai-layout-operation ${turn.selected.has(layout.id) ? "accepted" : ""} ${turn.resolved ? "locked" : ""}"><input type="checkbox" data-turn="${turn.id}" data-operation="${escapeHtml(layout.id)}" ${turn.selected.has(layout.id) ? "checked" : ""} ${turn.resolved ? "disabled" : ""}><span><strong>${escapeHtml(layout.rationale)}</strong><small>Rearrange · ${escapeHtml(layout.strategy)}</small></span></label>`).join("")}</div>` : ""}
      ${turn.resolved === null && (operations.length || layouts.length) ? `<div class="ai-actions"><button data-discard="${turn.id}" type="button">Discard</button><button data-apply="${turn.id}" class="primary" type="button" ${turn.selected.size ? "" : "disabled"}>Apply ${turn.selected.size || ""}</button></div>` : ""}
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
        ${busy ? `<div class="ai-bubble ai-bubble-assistant ai-bubble-pending">${escapeHtml(pendingMessage)}</div>` : ""}
      </div>
      <footer class="ai-compose">
        <textarea id="ai-prompt" maxlength="6000" placeholder="Ask me anything…" aria-label="Message AI advisor">${escapeHtml(draft)}</textarea>
        <div class="ai-compose-actions">
          <label class="ai-mode-select"><select id="ai-task" aria-label="AI mode" ${busy ? "disabled" : ""}><option value="generate" ${state.aiAdvisorTask === "generate" ? "selected" : ""}>Generate</option><option value="review" ${state.aiAdvisorTask === "review" ? "selected" : ""}>Review</option></select></label>
          <button id="ask-ai" class="primary ai-send-button" title="Send message" aria-label="Send message" ${busy ? "disabled" : ""}><svg viewBox="0 0 16 16" aria-hidden="true"><path d="M8 13V3m0 0L4.5 6.5M8 3l3.5 3.5"/></svg></button>
        </div>
      </footer>
    </div>`;

    const thread = element.querySelector("#ai-thread");
    if (thread) thread.scrollTop = thread.scrollHeight;

    element.querySelector("#ai-prompt")?.addEventListener("input", (event) => { draft = event.target.value; });
    element.querySelector("#ai-task")?.addEventListener("change", (event) => {
      state.aiAdvisorTask = event.target.value === "review" ? "review" : "generate";
      try { localStorage.setItem("sysml.aiAdvisorTask", state.aiAdvisorTask); } catch {}
    });
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
    element.querySelectorAll("[data-undo-ai]").forEach((button) => button.addEventListener("click", () => {
      const turn = turns.find((item) => item.id === button.dataset.undoAi);
      if (!turn?.beforeDiagram || turn !== latestAppliedTurn() || !diagramMatches(state.diagram, turn.appliedDiagram)) {
        bus.emit("toast", "Undo is unavailable because the canvas changed after this AI result was applied.");
        render();
        return;
      }
      turn.resolved = "reverted";
      setDiagram(structuredClone(turn.beforeDiagram));
      bus.emit("toast", "AI change undone.");
      render();
    }));
    element.querySelectorAll("[data-apply]").forEach((button) => button.addEventListener("click", () => {
      const turn = turns.find((item) => item.id === button.dataset.apply);
      if (!turn) return;
      if (state.diagram?.id !== turn.diagramId) { turn.error = "The active tab changed. Ask again for this tab."; turn.proposal = null; render(); return; }
      try {
        const beforeDiagram = structuredClone(state.diagram);
        const operations = selectMaterializedOperations(turn.patch, turn.selected);
        const layouts = selectMaterializedLayouts(turn.patch, turn.selected);
        const next = applyPatch(state.diagram, { operations });
        layouts.forEach((layout) => layoutElementsByStrategy(next.elements, layout.element_ids, layout.strategy, { width: 5000, height: 4000 }, 20, next.relationships));
        turn.beforeDiagram = beforeDiagram;
        turn.appliedDiagram = structuredClone(next);
        turn.resolved = "applied"; emitPreview();
        setDiagram(next);
        bus.emit("toast", "AI changes applied and arranged.");
        render();
      } catch (caught) { turn.error = caught.message; render(); }
    }));
    const submitPrompt = async () => {
      const prompt = draft.trim();
      if (state.aiAdvisorTask === "generate" && !prompt) {
        turns.push({ id: createId("turn"), role: "assistant", proposal: null, patch: null, selected: new Set(), diagramId: state.diagram?.id, resolved: "discarded", error: "Describe what you want to create." });
        render();
        return;
      }
      const pending = liveTurn();
      if (pending) pending.resolved = "discarded";
      const history = turns.map((turn) => ({ role: turn.role, text: turn.role === "user" ? turn.text : (turn.error ?? turn.proposal?.summary ?? "") }));
      turns.push({ id: createId("turn"), role: "user", text: prompt || "Review this diagram." });
      draft = "";
      const sequence = ++requestSequence;
      const diagramId = state.diagram.id;
      pendingMessage = state.aiAdvisorTask === "review"
        ? "Reviewing the active diagram and preparing concrete recommendations…"
        : `Designing a complete recommended ${prompt.replace(/^(?:please\s+)?(?:create|generate|design|build|make)\s+/i, "").slice(0, 90) || "diagram"} with elements, details, and relationships…`;
      busy = true; emitPreview(); render();
      try {
        const context = buildAiContext({
          task: state.aiAdvisorTask, prompt, diagram: state.diagram, selectedElementIds: state.selectedElementIds,
          repository: state.aiAdvisorTask === "review" ? state.modelRepository : {}, history: history.slice(-4)
        });
        const response = await api.request("/api/ai", { method: "POST", body: JSON.stringify({ context }) });
        if (disposed || sequence !== requestSequence) return;
        if (state.diagram?.id !== diagramId) throw new Error("The active tab changed while AI was responding. Nothing was applied.");
        const normalized = normalizeAiProposalForDiagram(normalizeAiProposalForRequest(response.proposal ?? response, prompt), state.diagram);
        const validated = validateAiProposal(normalized, state.diagram.type);
        validateProposalReferences(state.diagram, validated);
        const patch = materializeSemanticProposal(state.diagram, validated, createId);
        const preselected = [
          ...validated.operations.filter((operation) => !["remove_element", "remove_relationship"].includes(operation.type)).map((operation) => operation.id),
          ...validated.layout_suggestions.map((layout) => layout.id)
        ];
        turns.push({ id: createId("turn"), role: "assistant", proposal: validated, patch, selected: new Set(preselected), diagramId, resolved: null, error: null });
        emitPreview();
      } catch (caught) {
        if (disposed || sequence !== requestSequence) return;
        turns.push({ id: createId("turn"), role: "assistant", proposal: null, patch: null, selected: new Set(), diagramId, resolved: "discarded", error: caught.message });
      } finally { if (!disposed && sequence === requestSequence) { busy = false; render(); } }
    };
    element.querySelector("#ask-ai")?.addEventListener("click", submitPrompt);
    element.querySelector("#ai-prompt")?.addEventListener("keydown", (event) => {
      if (event.key !== "Enter" || event.shiftKey || event.isComposing) return;
      event.preventDefault();
      if (!busy) submitPrompt();
    });
  }

  render();
  let currentDiagramId = state.diagram?.id;
  const unsubscribeDiagram = bus.on("diagram:changed", (diagram) => {
    if (diagram?.id === currentDiagramId) { render(); return; }
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
