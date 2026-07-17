import { registerMfe } from "/packages/ui/src/moduleRegistry.js";

registerMfe("auth-tenant-settings", (element, { api, bus }) => {
  const gearIcon = `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" fill="currentColor" class="bi bi-gear" viewBox="0 0 16 16" aria-hidden="true">
  <path d="M8 4.754a3.246 3.246 0 1 0 0 6.492 3.246 3.246 0 0 0 0-6.492M5.754 8a2.246 2.246 0 1 1 4.492 0 2.246 2.246 0 0 1-4.492 0"/>
  <path d="M9.796 1.343c-.527-1.79-3.065-1.79-3.592 0l-.094.319a.873.873 0 0 1-1.255.52l-.292-.16c-1.64-.892-3.433.902-2.54 2.541l.159.292a.873.873 0 0 1-.52 1.255l-.319.094c-1.79.527-1.79 3.065 0 3.592l.319.094a.873.873 0 0 1 .52 1.255l-.16.292c-.892 1.64.901 3.434 2.541 2.54l.292-.159a.873.873 0 0 1 1.255.52l.094.319c.527 1.79 3.065 1.79 3.592 0l.094-.319a.873.873 0 0 1 1.255-.52l.292.16c1.64.893 3.434-.902 2.54-2.541l-.159-.292a.873.873 0 0 1 .52-1.255l.319-.094c1.79-.527 1.79-3.065 0-3.592l-.319-.094a.873.873 0 0 1-.52-1.255l.16-.292c.893-1.64-.902-3.433-2.541-2.54l-.292.159a.873.873 0 0 1-1.255-.52zm-2.633.283c.246-.835 1.428-.835 1.674 0l.094.319a1.873 1.873 0 0 0 2.693 1.115l.291-.16c.764-.415 1.6.42 1.184 1.185l-.159.292a1.873 1.873 0 0 0 1.116 2.692l.318.094c.835.246.835 1.428 0 1.674l-.319.094a1.873 1.873 0 0 0-1.115 2.693l.16.291c.415.764-.42 1.6-1.185 1.184l-.291-.159a1.873 1.873 0 0 0-2.693 1.116l-.094.318c-.246.835-1.428.835-1.674 0l-.094-.319a1.873 1.873 0 0 0-2.692-1.115l-.292.16c-.764.415-1.6-.42-1.184-1.185l.159-.291A1.873 1.873 0 0 0 1.945 8.93l-.319-.094c-.835-.246-.835-1.428 0-1.674l.319-.094A1.873 1.873 0 0 0 3.06 4.377l-.16-.292c-.415-.764.42-1.6 1.185-1.184l.292.159a1.873 1.873 0 0 0 2.692-1.115z"/>
</svg>`;

  let settings = { provider: "local", model: "structured-local-parser", keys: [] };
  const escapeHtml = (value) => String(value ?? "").replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#39;" })[character]);

  function render() {
    const openAi = settings.provider === "openai";
    const activeKey = settings.keys.find((item) => item.active);
    element.innerHTML = `
      <div class="panel">
        <h2 class="settings-heading">${gearIcon}<span>Tenant Settings</span></h2>
        <div class="stack">
          <span class="muted">Current provider: <strong>${openAi ? "OpenAI" : "Local AI"}</strong>${activeKey ? ` · ${escapeHtml(activeKey.model)}` : ""}</span>
          <label>AI provider
            <select id="provider"><option value="local" ${openAi ? "" : "selected"}>Local AI (no key)</option><option value="openai" ${openAi ? "selected" : ""}>OpenAI API</option></select>
          </label>
          <div id="openai-fields" ${openAi ? "" : "hidden"}>
            <div class="stack">
              <label>OpenAI model<input id="model" autocomplete="off" value="${escapeHtml(openAi ? settings.model : "gpt-4o-mini")}" /></label>
              <label>Key name<input id="key-name" maxlength="80" value="${escapeHtml(activeKey?.display_name ?? "Production OpenAI key")}" /></label>
              <label>OpenAI API key<input id="api-key" autocomplete="new-password" placeholder="Paste a server-side API key" type="password" /></label>
            </div>
          </div>
          <button id="save-provider">${openAi ? "Save and use OpenAI" : "Use local AI"}</button>
          <span id="provider-message" class="muted">${openAi ? "Saving a new key replaces the active OpenAI key. Keys are encrypted server-side and are never returned." : "Local AI runs without an external API key."}</span>
        </div>
      </div>
    `;

    element.querySelector("#provider").addEventListener("change", (event) => {
      settings = { ...settings, provider: event.target.value, model: event.target.value === "openai" ? (activeKey?.model ?? "gpt-4o-mini") : "structured-local-parser" };
      render();
    });

    element.querySelector("#save-provider").addEventListener("click", async () => {
      const button = element.querySelector("#save-provider");
      const message = element.querySelector("#provider-message");
      button.disabled = true;
      try {
        if (settings.provider === "local") {
          await api.request("/api/ai/provider", { method: "POST", body: JSON.stringify({ provider: "local" }) });
          bus.emit("toast", "Local AI is now active");
        } else {
          await api.request("/api/ai/keys", { method: "POST", body: JSON.stringify({
            provider: "openai",
            model: element.querySelector("#model").value,
            display_name: element.querySelector("#key-name").value,
            api_key: element.querySelector("#api-key").value,
            active: true
          }) });
          bus.emit("toast", "OpenAI key encrypted; OpenAI is now active");
        }
        await load();
      } catch (error) {
        message.textContent = error.message;
        button.disabled = false;
      }
    });
  }

  async function load() {
    try { settings = await api.request("/api/ai/keys"); }
    catch (error) { settings = { provider: "local", model: "structured-local-parser", keys: [], error: error.message }; }
    render();
    if (settings.error) element.querySelector("#provider-message").textContent = settings.error;
  }

  const unsubscribe = bus.on("auth:changed", load);
  load();
  return () => unsubscribe();
});
