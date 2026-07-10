import { registerMfe } from "/packages/ui/src/moduleRegistry.js";

function escapeHtml(value = "") {
  return String(value).replace(/[&<>'"]/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", "\"": "&quot;" })[character]);
}

function textList(value) {
  return Array.isArray(value) ? value.join("\n") : String(value ?? "");
}

function selectField(key, label, value, options) {
  return `<label>${label}<select data-property="${key}">${options.map((option) => `<option value="${option}" ${value === option ? "selected" : ""}>${option}</option>`).join("")}</select></label>`;
}

function propertyFields(selected) {
  const props = selected.properties ?? {};
  if (selected.kind === "requirement") return `
    <label>Requirement ID<input data-property="requirementId" value="${escapeHtml(props.requirementId ?? "")}"></label>
    <label>Text<textarea data-property="text" rows="4">${escapeHtml(props.text ?? "")}</textarea></label>
    <label>Parent Requirement<input data-property="parentRequirementId" value="${escapeHtml(props.parentRequirementId ?? "")}"></label>
    <label>Owner<input data-property="owner" value="${escapeHtml(props.owner ?? "")}"></label>
    ${selectField("priority", "Priority", props.priority ?? "medium", ["low", "medium", "high", "critical"])}
    ${selectField("risk", "Risk", props.risk ?? "medium", ["low", "medium", "high", "critical"])}
    ${selectField("approvalStatus", "Approval", props.approvalStatus ?? "draft", ["draft", "in-review", "approved", "rejected", "retired"])}
    ${selectField("verificationStatus", "Verification Status", props.verificationStatus ?? "not-started", ["not-started", "planned", "in-progress", "passed", "failed", "waived"])}
    ${selectField("verificationMethod", "Verification Method", props.verificationMethod ?? "test", ["inspection", "analysis", "demonstration", "test", "simulation"])}
    <label>Baseline ID<input data-baseline="id" value="${escapeHtml(props.baseline?.id ?? "")}"></label>
    <label>Baseline Version<input data-baseline="version" value="${escapeHtml(props.baseline?.version ?? "")}"></label>
  `;
  if (selected.kind === "interface-block" || selected.kind === "interface-definition" || selected.kind === "interface") return `
    <label>Interface ID<input data-property="interfaceId" value="${escapeHtml(props.interfaceId ?? "")}"></label>
    ${selectField("interfaceKind", "Interface Type", props.interfaceKind ?? "software", ["electrical", "mechanical", "software"])}
    <label>Protocols<textarea data-list-property="protocols" rows="2">${escapeHtml(textList(props.protocols))}</textarea></label>
    <label>Signals<textarea data-list-property="signals" rows="2">${escapeHtml(textList(props.signals))}</textarea></label>
    <label>Commands<textarea data-list-property="commands" rows="2">${escapeHtml(textList(props.commands))}</textarea></label>
    <label>Pins<textarea data-list-property="pins" rows="2">${escapeHtml(textList(props.pins))}</textarea></label>
    <label>Connector<input data-property="connector" value="${escapeHtml(props.connector ?? "")}"></label>
    <label>Voltage<input data-number-property="voltage" value="${escapeHtml(props.voltage ?? "")}"></label>
    <label>Current<input data-number-property="current" value="${escapeHtml(props.current ?? "")}"></label>
    <label>Frequency<input data-number-property="frequency" value="${escapeHtml(props.frequency ?? "")}"></label>
    <label>Bandwidth<input data-number-property="bandwidth" value="${escapeHtml(props.bandwidth ?? "")}"></label>
  `;
  if (["port", "proxy-port", "full-port"].includes(selected.kind)) return `
    ${selectField("direction", "Direction", props.direction ?? "inout", ["in", "out", "inout"])}
    <label>Interface ID<input data-property="interfaceId" value="${escapeHtml(props.interfaceId ?? props.interfaceType ?? "")}"></label>
    <label>Multiplicity<input data-property="multiplicity" value="${escapeHtml(props.multiplicity ?? "1")}"></label>
  `;
  return "";
}

registerMfe("properties-panel", (element, { state, setDiagram, bus }) => {
  function render() {
    const selected = state.diagram?.elements.find((item) => item.id === state.selectedElementIds[0]);
    element.innerHTML = `
      <div class="panel">
        <h2>Properties</h2>
        ${selected ? `<div class="stack">
          <label>Name<input id="name" value="${escapeHtml(selected.name)}"></label>
          ${propertyFields(selected)}
          <span class="muted property-meta">${escapeHtml(selected.kind)} / ${escapeHtml(selected.id)}</span>
        </div>` : `<span class="muted empty-panel-note">Select an element to edit its properties.</span>`}
      </div>
    `;
    const updateSelected = (mutator) => {
      const next = structuredClone(state.diagram);
      const target = next.elements.find((item) => item.id === selected.id);
      target.properties ??= {};
      mutator(target);
      setDiagram(next);
    };
    element.querySelector("#name")?.addEventListener("change", (event) => updateSelected((target) => { target.name = event.target.value; }));
    element.querySelectorAll("[data-property]").forEach((input) => input.addEventListener("change", () => updateSelected((target) => {
      target.properties[input.dataset.property] = input.value;
      if (input.dataset.property === "interfaceId") delete target.properties.interfaceType;
    })));
    element.querySelectorAll("[data-number-property]").forEach((input) => input.addEventListener("change", () => updateSelected((target) => {
      target.properties[input.dataset.numberProperty] = input.value === "" ? null : Number(input.value);
    })));
    element.querySelectorAll("[data-list-property]").forEach((input) => input.addEventListener("change", () => updateSelected((target) => {
      target.properties[input.dataset.listProperty] = input.value.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
    })));
    element.querySelectorAll("[data-baseline]").forEach((input) => input.addEventListener("change", () => updateSelected((target) => {
      target.properties.baseline = { ...(target.properties.baseline ?? {}), [input.dataset.baseline]: input.value };
      if (input.dataset.baseline === "version" && input.value !== "" && !Number.isNaN(Number(input.value))) target.properties.baseline.version = Number(input.value);
    })));
    element.querySelectorAll("input, textarea, select").forEach((control) => {
      control.addEventListener("pointerdown", (event) => event.stopPropagation());
    });
  }
  bus.on("diagram:changed", render);
  bus.on("selection:changed", render);
  render();
});
