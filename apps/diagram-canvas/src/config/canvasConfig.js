export const CANVAS = { width: 5000, height: 4000 };
export const ZOOM = { minimum: 0.25, maximum: 2.5 };

export const relationshipTypes = [
  ["association", "Association"], ["directional-association", "Directed Association"],
  ["bidirectional-association", "Bidirectional Association"], ["dependency", "Dependency"],
  ["generalization", "Generalization"], ["realization", "Realization"],
  ["composition", "Composition"], ["aggregation", "Aggregation"], ["containment", "Containment"],
  ["note-connector", "Anchor Link"], ["link", "Link"], ["connector", "Connector"], ["communication-path", "Communication Path"],
  ["package-merge", "Package Merge"], ["extension", "Extension"], ["control-flow", "Control Flow"],
  ["object-flow", "Object Flow"], ["transition", "Transition"], ["synchronous-message", "Synchronous Message"],
  ["asynchronous-message", "Asynchronous Message"], ["return-message", "Return Message"], ["numbered-message", "Numbered Message"],
  ["include", "Include"], ["extend", "Extend"], ["item-flow", "Item Flow"], ["binding-connector", "Binding Connector"],
  ["derive-reqt", "«deriveReqt»"], ["satisfy", "«satisfy»"], ["verify", "«verify»"], ["refine", "«refine»"], ["trace", "«trace»"]
];

const notationLabels = {
  include: "«include»", extend: "«extend»", "package-merge": "«merge»",
  "derive-reqt": "«deriveReqt»", satisfy: "«satisfy»", verify: "«verify»", refine: "«refine»", trace: "«trace»"
};

export function defaultRelationshipLabel(kind) {
  return notationLabels[kind] ?? "";
}

export function visibleRelationshipLabel(relationship) {
  const value = String(relationship?.label ?? "").trim();
  const paletteLabel = relationshipTypes.find(([kind]) => kind === relationship?.kind)?.[1] ?? "";
  return value && value !== paletteLabel ? value : defaultRelationshipLabel(relationship?.kind);
}

export const defaultNodeStyle = { borderColor: "#ffffff", fillColor: "#d7eadb", borderWidth: 1, textColor: "#ffffff", textSize: 13, textStyle: "normal" };
export const themeNodeStyles = {
  dark: { borderColor: "#ffffff", fillColor: "#172033", textColor: "#ffffff" },
  light: { borderColor: "#ffffff", fillColor: "#ffffff", textColor: "#111827" }
};
export const lightTextKinds = new Set(["actor", "initial-node", "initial-state", "final-node", "final-state", "activity-final", "flow-final", "entry-point", "exit-point", "terminate", "fork-join", "fork-node", "join-node", "destruction-occurrence"]);
export const defaultRelationshipStyle = { color: "#9aa8bb", textColor: "#ffffff", width: 2 };
export const pageSizes = {
  "letter-landscape": { label: "Letter", width: 1056, height: 816 },
  "a4-landscape": { label: "A4", width: 1123, height: 794 },
  "a3-landscape": { label: "A3", width: 1588, height: 1123 },
  "engineering-d": { label: "Eng D", width: 3264, height: 2112 }
};
export const defaultPageSize = "a3-landscape";
export const shortcutRows = [
  ["Ctrl+A", "Select all"], ["Ctrl+C / X / V", "Copy, cut, paste"], ["Ctrl+D", "Duplicate"],
  ["Ctrl+G", "Group"], ["Ctrl+Shift+G", "Ungroup"], ["Ctrl+F", "Search"],
  ["?", "Keyboard help"], ["Delete", "Delete selection"], ["Space-drag", "Pan"], ["Ctrl+wheel", "Zoom"]
];

export const ellipseKinds = new Set(["use-case"]);
export const roundedKinds = new Set(["activity", "action", "state", "composite-state", "interaction", "interaction-use"]);
export const diamondKinds = new Set(["decision", "merge-node", "choice"]);
export const circleKinds = new Set(["initial-node", "initial-state", "final-node", "final-state", "activity-final", "flow-final", "entry-point", "exit-point", "terminate"]);
export const packageKinds = new Set(["package", "model", "profile", "view", "viewpoint"]);
export const noteKinds = new Set(["note", "comment", "rationale", "problem"]);
export const simpleShapeKinds = new Set([
  "actor", "decision", "merge-node", "choice", "initial-node", "initial-state", "final-node", "final-state",
  "activity-final", "flow-final", "entry-point", "exit-point", "terminate", "fork-join", "fork-node", "join-node",
  "accept-event-action", "send-signal-action", "destruction-occurrence", "lifeline", ...packageKinds, ...noteKinds,
  ...ellipseKinds, ...roundedKinds, "component", "object", "compact-class", "object-compact", "interface-class", "template-class",
  "nary-association", "divider-vertical", "self-association", "frame-fragment", "callout", "text-label", "symbol-braces", "symbol-guillemets"
]);

export const compartmentDefinitions = [
  { key: "attributes", label: "Attributes" },
  { key: "operations", label: "Operations" }
];

export const classBlockKinds = new Set(["class", "block"]);

export function compartmentDefinitionsFor(node) {
  return classBlockKinds.has(node?.kind) && node.variant === "simple"
    ? compartmentDefinitions.slice(0, 1)
    : compartmentDefinitions;
}
