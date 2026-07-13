import { registerMfe } from "/packages/ui/src/moduleRegistry.js";

registerMfe("ai-advisor", (element, { state, bus, api, setDiagram }) => {
  let preview = null;
  const messages = [];

  function render() {
    element.innerHTML = `
      <div class="ai-shell">
        <div class="ai-header">
          <h2>AI Intelligence</h2>
          <p>Project, diagram, selection, and current canvas context are sent with each preview request.</p>
        </div>
        <div class="chat-log">${messages.map((message) => `<div class="chat-message"><strong>${message.role}</strong><br>${message.text}</div>`).join("") || "<span class='muted'>Ask for generation, validation, refactoring, explanations, or requirement conversion.</span>"}</div>
        <div class="ai-compose stack">
          <input id="attachments" type="file" multiple accept=".txt,.md,.pdf,.png,.jpg,.jpeg" />
          <textarea id="prompt" placeholder="Update this diagram with a controller dependency, validate relationships, or convert requirements..."></textarea>
          <div class="row">
            <button id="ask" class="primary">Preview AI Change</button>
            <button id="explain">Explain</button>
          </div>
          ${preview ? `<div class="preview"><strong>${preview.patch.summary}</strong><br>${preview.patch.operations.length} proposed operation(s)<div class="row preview-actions"><button id="apply" class="primary">Apply</button><button id="discard">Discard</button></div></div>` : ""}
        </div>
      </div>
    `;
    element.querySelector("#ask").addEventListener("click", async () => {
      const prompt = element.querySelector("#prompt").value;
      messages.push({ role: "User", text: prompt });
      preview = await api.request("/api/ai/preview", { method: "POST", body: JSON.stringify({ project_id: state.project.id, diagram_id: state.diagram.id, selected_element_ids: state.selectedElementIds, prompt, attachments: [] }) });
      messages.push({ role: "AI", text: preview.patch.summary });
      render();
    });
    element.querySelector("#explain").addEventListener("click", () => {
      messages.push({ role: "AI", text: `${state.diagram.name} contains ${state.diagram.elements.length} elements and ${state.diagram.relationships.length} relationships. Selected context: ${state.selectedElementIds.join(", ") || "none"}.` });
      render();
    });
    element.querySelector("#apply")?.addEventListener("click", async () => {
      const updated = await api.request("/api/ai/apply", { method: "POST", body: JSON.stringify({ diagram_id: state.diagram.id, patch: preview.patch }) });
      preview = null;
      setDiagram(updated);
      render();
    });
    element.querySelector("#discard")?.addEventListener("click", () => { preview = null; render(); });
  }
  const unsubscribe = bus.on("diagram:changed", render);
  render();
  return unsubscribe;
});
