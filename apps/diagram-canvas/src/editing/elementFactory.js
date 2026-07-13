import { nextRequirementId } from "../../../../packages/model-core/src/index.js";
import { circleKinds, diamondKinds, ellipseKinds, noteKinds, roundedKinds } from "../config/canvasConfig.js";

const createId = (prefix) => `${prefix}_${Math.random().toString(36).slice(2, 10)}`;
export const nodeLabel = (kind) => kind.split("-").map((word) => `${word[0]?.toUpperCase() ?? ""}${word.slice(1)}`).join(" ");

export function defaultSizeFor(kind) {
  const sizes = {
    actor: [110, 170], "compact-class": [118, 56], component: [165, 98], object: [155, 78],
    "object-compact": [150, 78], "interface-class": [180, 190], "template-class": [170, 150],
    "nary-association": [100, 86], "divider-vertical": [72, 210], "self-association": [220, 112],
    "frame-fragment": [150, 110], callout: [170, 150], "text-label": [120, 44],
    "symbol-braces": [98, 42], "symbol-guillemets": [98, 42], lifeline: [120, 240],
    "accept-event-action": [180, 80], "send-signal-action": [180, 80], "input-pin": [54, 54],
    "output-pin": [54, 54], "destruction-occurrence": [70, 70]
  };
  if (sizes[kind]) return { width: sizes[kind][0], height: sizes[kind][1] };
  if (ellipseKinds.has(kind)) return { width: 160, height: 86 };
  if (diamondKinds.has(kind)) return { width: 110, height: 90 };
  if (circleKinds.has(kind)) return { width: 56, height: 56 };
  if (["fork-join", "fork-node", "join-node"].includes(kind)) return { width: 150, height: 34 };
  if (roundedKinds.has(kind)) return { width: 160, height: 90 };
  if (noteKinds.has(kind)) return { width: 150, height: 110 };
  return { width: 190, height: 170 };
}

export function defaultNameFor(kind) {
  const names = {
    "compact-class": "Class", "interface-class": "Class", "template-class": "Template Class",
    component: "Component Name", object: ":Object", "object-compact": ":Object", "nary-association": "NARY",
    "divider-vertical": "{Text}", "self-association": "Class", "frame-fragment": "Name", callout: "Text",
    "text-label": "Text", "symbol-braces": "{ }", "symbol-guillemets": "<< >>"
  };
  return names[kind] ?? nodeLabel(kind);
}

export function defaultPropertiesFor(kind, diagram) {
  if (kind === "requirement") {
    const requirementId = nextRequirementId({ elements: diagram.elements.map((node) => ({ id: node.id, kind: node.kind, semantic: node.properties ?? {} })) });
    return { requirementId, text: "The system shall ...", owner: "", priority: "medium", risk: "medium", approvalStatus: "draft", verificationStatus: "not-started", verificationMethod: "test", parentRequirementId: "", baseline: { id: "working", version: diagram.version ?? 1 } };
  }
  if (kind === "interface-block" || kind === "interface-definition") return { interfaceId: createId("if"), interfaceKind: "software", signals: [], commands: [], protocols: [], pins: [], pinAssignments: {}, voltage: null, current: null, frequency: null, bandwidth: null, units: { voltage: "V", current: "A", frequency: "Hz", bandwidth: "bps" }, compatibleWith: [] };
  if (["port", "proxy-port", "full-port"].includes(kind)) return { direction: "inout", interfaceId: "", multiplicity: "1" };
  if (kind === "unit") return { unitSymbol: "u", quantityKind: "dimensionless", factor: 1, offset: 0, dimension: {} };
  if (kind === "quantity-kind") return { quantityKind: "customQuantity", dimension: {} };
  if (kind === "value-type") return { quantity: { value: 0, unit: "1", quantityKind: "dimensionless" }, quantitySchema: { unit: "1", quantityKind: "dimensionless", min: null, max: null, default: 0 } };
  return {};
}
