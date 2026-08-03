import { circleKinds, compartmentDefinitionsFor, diamondKinds, ellipseKinds, noteKinds, packageKinds, roundedKinds } from "../config/canvasConfig.js";
import { nodeLabel } from "../editing/elementFactory.js";

const escapeHtml = (value = "") => String(value).replace(/[&<>'"]/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", "\"": "&quot;" })[character]);

export function createNodeRenderer({ getEditingNode }) {
  function sectionEditor(node, section, value, label, displayClass = "") {
    return `<textarea class="node-inline-editor compartment-editor ${section === "name" ? "name-editor" : ""} ${displayClass}" rows="1" spellcheck="true" data-node-editor="${node.id}" data-node-section="${section}" aria-label="Edit ${escapeHtml(label)}">${escapeHtml(value)}</textarea>`;
  }

  function editableText(node, section, value, className, label) {
    if (getEditingNode()?.id === node.id && getEditingNode().section === section) return `<div class="${className}">${sectionEditor(node, section, value, label)}</div>`;
    return `<div class="${className}" data-edit-section="${section}" title="Double-click to edit ${escapeHtml(label.toLowerCase())}">${escapeHtml(value)}</div>`;
  }

  function sectionValue(node, section, fallback = "") {
    const value = node.properties?.[section];
    if (Array.isArray(value)) return value.join("\n") || fallback;
    return String(value ?? fallback);
  }

  function editableSection(node, section, label, className, fallback = "") {
    const value = sectionValue(node, section, fallback);
    if (getEditingNode()?.id === node.id && getEditingNode().section === section) {
      return `<div class="${className} editing">${sectionEditor(node, section, value, label)}</div>`;
    }
    const content = value ? escapeHtml(value).replace(/\n/g, "<br>") : `<span class="compartment-placeholder">Add ${escapeHtml(label.toLowerCase())}...</span>`;
    return `<div class="${className}" data-edit-section="${section}" title="Double-click to edit ${escapeHtml(label.toLowerCase())}">${content}</div>`;
  }

  function renderNodeContent(node) {
    const simpleName = (className, label = `${nodeLabel(node.kind)} text`) => editableText(node, "name", node.name, className, label);
    if (node.kind === "actor") return `<svg class="actor-figure" viewBox="0 0 100 126" aria-hidden="true"><circle cx="50" cy="20" r="17"></circle><path d="M50 37v50M18 51h64M50 87 19 123M50 87l31 36"></path></svg>${simpleName("actor-name")}`;
    if (diamondKinds.has(node.kind)) return `<div class="diamond-shape"></div>${simpleName("shape-caption centered")}`;
    if (circleKinds.has(node.kind)) return `<div class="circle-shape ${node.kind.startsWith("final") ? "final" : ""}"></div>${simpleName("shape-caption below")}`;
    if (["fork-join", "fork-node", "join-node"].includes(node.kind)) return `<div class="fork-join-shape"></div>${simpleName("shape-caption below")}`;
    if (node.kind === "accept-event-action") return `<div class="event-action-shape accept"></div>${simpleName("shape-caption centered")}`;
    if (node.kind === "send-signal-action") return `<div class="event-action-shape send"></div>${simpleName("shape-caption centered")}`;
    if (node.kind === "destruction-occurrence") return `<div class="destruction-shape"></div>${simpleName("shape-caption below")}`;
    if (node.kind === "component") return `<div class="component-lugs"><span></span><span></span></div>${simpleName("component-content", "Component name")}`;
    if (node.kind === "provided-interface") return `<div class="provided-interface-symbol"><span></span></div>${simpleName("interface-symbol-name", "Provided interface name")}`;
    if (node.kind === "required-interface") return `<div class="required-interface-symbol"><span></span></div>${simpleName("interface-symbol-name", "Required interface name")}`;
    if (["port", "proxy-port", "full-port"].includes(node.kind)) return `<div class="port-symbol"></div>${simpleName("port-symbol-name", "Port name")}`;
    if (node.kind === "object") return `<div class="object-content">${simpleName("object-title", "Object name")}${editableSection(node, "attributes", "Attributes", "object-attributes", "Attributes")}</div>`;
    if (node.kind === "compact-class") return simpleName("compact-class-content", "Class name");
    if (node.kind === "object-compact") return simpleName("object-compact-content", "Object name");
    if (node.kind === "interface-class") return `<div class="structured-class-content interface-class-content">
      <div class="structured-class-title"><strong>&lt;&lt;interface&gt;&gt;</strong>${simpleName("", "Interface name")}</div>
      ${editableSection(node, "attributes", "Attributes", "structured-class-section", "Attributes")}
      ${editableSection(node, "operations", "Operations", "structured-class-section", "Operations")}
    </div>`;
    if (node.kind === "template-class") return `<div class="template-parameter">${editableSection(node, "templateParameter", "Template parameter", "template-parameter-text", "T")}</div><div class="structured-class-content template-class-content">
      <div class="structured-class-title">${simpleName("", "Template class name")}</div>
      ${editableSection(node, "attributes", "Attributes", "structured-class-section")}
      ${editableSection(node, "operations", "Operations", "structured-class-section")}
    </div>`;
    if (node.kind === "nary-association") return `<div class="nary-shape"></div>${simpleName("shape-caption below", "N-ary association name")}`;
    if (node.kind === "divider-vertical") return `<div class="divider-vertical-line"></div>${simpleName("divider-label", "Divider text")}`;
    if (node.kind === "self-association") return `<div class="self-association-class">${simpleName("", "Class name")}</div><div class="self-association-loop"></div>${editableSection(node, "upperMultiplicity", "Upper multiplicity", "self-association-multiplicity top", "0..1")}${editableSection(node, "lowerMultiplicity", "Lower multiplicity", "self-association-multiplicity bottom", "0..*")}`;
    if (node.kind === "frame-fragment") return `<div class="frame-fragment-corner"></div>${simpleName("frame-fragment-label", "Frame label")}`;
    if (node.kind === "callout") return `<div class="callout-dot"></div><div class="callout-curve"></div>${simpleName("callout-text", "Callout text")}`;
    if (node.kind === "text-label") return simpleName("text-label-content", "Text label");
    if (node.kind === "symbol-braces") return simpleName("symbol-content", "Symbol text");
    if (node.kind === "symbol-guillemets") return simpleName("symbol-content", "Symbol text");
    if (node.kind === "lifeline") return `${simpleName("lifeline-head")}<div class="lifeline-line"></div>`;
    if (packageKinds.has(node.kind)) return `<div class="package-tab"></div><div class="package-body"><strong>${simpleName("")}</strong><small>«${escapeHtml(nodeLabel(node.kind))}»</small></div>`;
    if (noteKinds.has(node.kind)) return `<div class="note-fold"></div>${simpleName("note-content")}`;
    if (node.kind === "requirement") return `<div class="node-title" data-edit-section="name">${editableText(node, "name", node.name, "node-title-text", "Requirement name")}<div class="node-stereotype">«requirement»</div></div>
      <div class="node-compartments">
        <section class="node-compartment"><span class="compartment-label">id</span><div class="compartment-content">${escapeHtml(node.properties?.requirementId ?? node.id)}</div></section>
        ${getEditingNode()?.id === node.id && getEditingNode().section === "text"
          ? `<section class="node-compartment editing"><span class="compartment-label">text</span>${sectionEditor(node, "text", node.properties?.text ?? "", "Requirement text")}</section>`
          : `<section class="node-compartment" data-edit-section="text" title="Click to edit requirement text"><span class="compartment-label">text</span><div class="compartment-content">${escapeHtml(node.properties?.text ?? "").replace(/\n/g, "<br>") || `<span class="compartment-placeholder">Add shall statement...</span>`}</div></section>`}
        <section class="node-compartment"><span class="compartment-label">verification</span><div class="compartment-content">${escapeHtml([node.properties?.verificationMethod, node.properties?.verificationStatus].filter(Boolean).join(" / "))}</div></section>
      </div>`;
    if (node.kind === "interface-block" || node.kind === "interface-definition") return `<div class="node-title" data-edit-section="name">${editableText(node, "name", node.name, "node-title-text", "Interface name")}<div class="node-stereotype">«${escapeHtml(node.properties?.interfaceKind ?? "interface")} interface»</div></div>
      <div class="node-compartments">
        <section class="node-compartment"><span class="compartment-label">protocols</span><div class="compartment-content">${escapeHtml((node.properties?.protocols ?? []).join(", "))}</div></section>
        <section class="node-compartment"><span class="compartment-label">signals</span><div class="compartment-content">${escapeHtml((node.properties?.signals ?? []).join(", "))}</div></section>
        <section class="node-compartment"><span class="compartment-label">limits</span><div class="compartment-content">${escapeHtml([node.properties?.voltage ? `${node.properties.voltage} V` : "", node.properties?.current ? `${node.properties.current} A` : "", node.properties?.bandwidth ? `${node.properties.bandwidth} bps` : ""].filter(Boolean).join(" · "))}</div></section>
      </div>`;
    if (ellipseKinds.has(node.kind)) return simpleName("ellipse-content");
    if (roundedKinds.has(node.kind)) return `<div class="rounded-content"><strong>${simpleName("")}</strong><small>${escapeHtml(nodeLabel(node.kind))}</small></div>`;
    const title = editableText(node, "name", node.name, "node-title-text", "Name");
    return `<div class="node-title" data-edit-section="name">${title}${node.locked ? `<span class="lock-indicator" title="Locked">●</span>` : ""}<div class="node-stereotype">«${escapeHtml(nodeLabel(node.kind))}»</div></div>
      <div class="node-compartments">${compartmentDefinitionsFor(node).map(({ key, label }) => {
        const values = node.properties?.[key] ?? [];
        const text = Array.isArray(values) ? values.join("\n") : String(values ?? "");
        const collapsed = Boolean(node.properties?.collapsedCompartments?.[key]);
        const toggle = `<button class="compartment-toggle" data-compartment-toggle="${node.id}" data-compartment-key="${key}" title="${collapsed ? "Expand" : "Collapse"} ${escapeHtml(label)}">${collapsed ? "+" : "−"}</button>`;
        if (getEditingNode()?.id === node.id && getEditingNode().section === key) return `<section class="node-compartment editing"><span class="compartment-label">${label}</span>${sectionEditor(node, key, text, label)}</section>`;
        return `<section class="node-compartment ${collapsed ? "collapsed" : ""}" data-edit-section="${key}" title="Double-click to edit ${label.toLowerCase()}"><span class="compartment-label">${toggle}${label}</span><div class="compartment-content">${collapsed ? "" : text ? escapeHtml(text).replace(/\n/g, "<br>") : `<span class="compartment-placeholder">Add ${label.toLowerCase()}…</span>`}</div></section>`;
      }).join("")}</div>`;
  }

  return renderNodeContent;
}
