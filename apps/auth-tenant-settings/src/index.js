import { registerMfe } from "/packages/ui/src/moduleRegistry.js";

registerMfe("auth-tenant-settings", (element, { api, bus }) => {
  element.innerHTML = `
    <div class="panel">
      <h2>Tenant Settings</h2>
      <div class="stack">
        <select id="provider"><option value="local">Local LLM</option><option value="openai">OpenAI</option><option value="anthropic">Anthropic</option><option value="custom">Custom</option></select>
        <input id="model" placeholder="Model" value="local-diagram-planner" />
        <input id="key-name" placeholder="Display name" value="Local development key" />
        <input id="api-key" placeholder="API key" type="password" />
        <button id="save-key">Save Encrypted Key</button>
        <span class="muted">Keys are encrypted server-side and never returned after save. RBAC roles: Owner, Admin, Editor, Viewer.</span>
      </div>
    </div>
  `;
  element.querySelector("#save-key").addEventListener("click", async () => {
    await api.request("/api/ai/keys", {
      method: "POST",
      body: JSON.stringify({
        provider: element.querySelector("#provider").value,
        model: element.querySelector("#model").value,
        display_name: element.querySelector("#key-name").value,
        api_key: element.querySelector("#api-key").value,
        active: true
      })
    });
    element.querySelector("#api-key").value = "";
    bus.emit("toast", "API key encrypted and saved");
  });
});
