const PORT_KINDS = new Set(["port", "proxy-port", "full-port"]);
const ACTIVITY_NODES = new Set(["activity", "action", "decision", "merge-node", "fork-node", "join-node", "object-node", "activity-final", "flow-final", "initial-node"]);
const FLOW_KINDS = new Set(["control-flow", "object-flow"]);
const KNOWN_UNITS = new Set(["m", "kg", "s", "A", "K", "mol", "cd", "rad", "sr", "Hz", "N", "Pa", "J", "W", "C", "V", "F", "ohm", "S", "Wb", "T", "H", "°C", "lm", "lx", "Bq", "Gy", "Sv", "kat", "mm", "cm", "km", "ms", "min", "h", "g", "L", "m/s", "m/s²", "kg/m³", "N·m"]);

const relationshipRules = {
  satisfy: { sources: new Set(["block", "part", "part-property", "component", "class"]), targets: new Set(["requirement"]) },
  verify: { sources: new Set(["test-case", "activity"]), targets: new Set(["requirement"]) },
  transition: { sources: new Set(["state", "initial-state", "choice", "junction", "history-state", "entry-point"]), targets: new Set(["state", "final-state", "choice", "junction", "exit-point", "terminate"]) },
  "control-flow": { sources: ACTIVITY_NODES, targets: ACTIVITY_NODES },
  "object-flow": { sources: ACTIVITY_NODES, targets: ACTIVITY_NODES },
  connector: { sources: PORT_KINDS, targets: PORT_KINDS },
  "binding-connector": { sources: new Set(["constraint-parameter", "value-property", "parameter"]), targets: new Set(["constraint-parameter", "value-property", "parameter"]) }
};

function diagnostic(code, severity, element, message, suggestedFix) {
  return { code, severity, affectedElement: { id: element.id, kind: element.kind, type: element.source_id === undefined ? "element" : "relationship", name: element.name ?? element.label ?? "" }, message, suggestedFix };
}

function multiplicityValid(value) {
  if (value === undefined || value === null || value === "") return true;
  const text = String(value).trim();
  if (/^(\d+|\*)$/.test(text)) return true;
  const match = text.match(/^(\d+)\.\.(\d+|\*)$/);
  return Boolean(match && (match[2] === "*" || Number(match[1]) <= Number(match[2])));
}

function direction(port) { return String(port.semantic?.direction ?? "inout").toLowerCase(); }
function interfaceType(port) { return port.semantic?.interfaceType ?? port.semantic?.type ?? null; }

/** Validate a centralized SysML repository. This function is deterministic and UI-independent. */
export function validateModel(repository, options = {}) {
  const elements = repository?.elements ?? [];
  const relationships = repository?.relationships ?? [];
  const byId = new Map(elements.map((item) => [item.id, item]));
  const diagnostics = [];
  const add = (...args) => diagnostics.push(diagnostic(...args));

  const requirementIds = new Map();
  for (const element of elements) {
    if (element.kind === "requirement" && element.semantic?.requirementId) {
      const key = String(element.semantic.requirementId).trim().toLowerCase();
      if (requirementIds.has(key)) add("duplicate-requirement-id", "error", element, `Requirement ID “${element.semantic.requirementId}” is already used by ${requirementIds.get(key).name || requirementIds.get(key).id}.`, "Assign a unique requirement ID.");
      else requirementIds.set(key, element);
    }
    if (!multiplicityValid(element.semantic?.multiplicity)) add("invalid-multiplicity", "error", element, `Multiplicity “${element.semantic.multiplicity}” is not valid.`, "Use a value such as 1, 0..1, 1..*, or *.");
    if (element.kind === "value-type" && element.semantic?.unit && !KNOWN_UNITS.has(element.semantic.unit) && !byId.has(element.semantic.unit)) add("invalid-unit", "error", element, `Unit “${element.semantic.unit}” is not a recognized SI unit or model unit.`, "Select a defined unit element or use a recognized unit symbol.");
  }

  // Ownership and package ownership form one acyclic containment graph.
  for (const element of elements) {
    const seen = new Set([element.id]); let ownerId = element.owner_id ?? element.package_id;
    while (ownerId) {
      if (seen.has(ownerId)) { add("ownership-cycle", "error", element, "Ownership creates a containment cycle.", "Move the element to a package outside its descendant chain."); break; }
      seen.add(ownerId); ownerId = byId.get(ownerId)?.owner_id ?? byId.get(ownerId)?.package_id;
    }
    const referencedOwner = element.owner_id ?? element.package_id;
    if (referencedOwner && !byId.has(referencedOwner)) add("missing-reference", "error", element, `Owner ${referencedOwner} does not exist.`, "Choose an existing owner or move the element to the project root.");
  }

  for (const relationship of relationships) {
    const source = byId.get(relationship.source_id); const target = byId.get(relationship.target_id);
    if (!source || !target) {
      const missing = [!source && relationship.source_id, !target && relationship.target_id].filter(Boolean).join(" and ");
      add("missing-reference", "error", relationship, `Relationship references missing element ${missing}.`, "Reconnect the relationship to existing model elements or delete it.");
      continue;
    }
    const rule = relationshipRules[relationship.kind];
    if (rule && (!rule.sources.has(source.kind) || !rule.targets.has(target.kind))) add("invalid-relationship", "error", relationship, `${relationship.kind} is not valid between ${source.kind} and ${target.kind}.`, "Change the relationship type or connect compatible element types.");
    if (!multiplicityValid(relationship.semantic?.sourceMultiplicity) || !multiplicityValid(relationship.semantic?.targetMultiplicity)) add("invalid-multiplicity", "error", relationship, "A relationship end has an invalid multiplicity.", "Use a value such as 1, 0..1, 1..*, or *.");
    if (["connector", "item-flow"].includes(relationship.kind) && PORT_KINDS.has(source.kind) && PORT_KINDS.has(target.kind)) {
      const sourceType = interfaceType(source); const targetType = interfaceType(target);
      if (sourceType && targetType && sourceType !== targetType) add("incompatible-ports", "error", relationship, `Ports use incompatible interfaces “${sourceType}” and “${targetType}”.`, "Use the same or a compatible interface type on both ports.");
      const sd = direction(source); const td = direction(target);
      if (sd === "in" || td === "out" || (sd === td && sd !== "inout")) add("invalid-connector-direction", "error", relationship, `Connector direction ${sd} → ${td} is invalid.`, "Connect an out/inout port to an in/inout port, or reverse the connector.");
    }
    if (relationship.kind === "transition") {
      if (source.id === target.id && !relationship.semantic?.trigger && !relationship.semantic?.guard) add("invalid-state-transition", "warning", relationship, "Self-transition has neither a trigger nor a guard.", "Add a trigger or guard, or remove the transition.");
      if (source.kind === "final-state") add("invalid-state-transition", "error", relationship, "A final state cannot have outgoing transitions.", "Remove the transition or change its source state.");
      if (target.kind === "initial-state") add("invalid-state-transition", "error", relationship, "An initial state cannot have incoming transitions.", "Reverse or retarget the transition.");
    }
    if (relationship.kind === "satisfy" && (source.kind === "requirement" || target.kind !== "requirement")) add("invalid-satisfy", "error", relationship, "Satisfy must relate a design element to a requirement.", "Set the source to a block/design element and the target to a requirement.");
    if (relationship.kind === "verify" && (!["test-case", "activity"].includes(source.kind) || target.kind !== "requirement")) add("invalid-verify", "error", relationship, "Verify must relate a test case or verification activity to a requirement.", "Set the source to a test case and the target to a requirement.");
  }

  const activityNodes = elements.filter((item) => ACTIVITY_NODES.has(item.kind));
  const flows = relationships.filter((item) => FLOW_KINDS.has(item.kind));
  const incomingFlow = new Set(flows.map((item) => item.target_id));
  const activitiesWithFlows = new Set(flows.flatMap((item) => [item.source_id, item.target_id]));
  const starts = activityNodes.filter((item) => item.kind === "initial-node" && activitiesWithFlows.has(item.id));
  const reachable = new Set(starts.map((item) => item.id));
  if (starts.length) {
    let changed = true;
    while (changed) { changed = false; for (const flow of flows) if (reachable.has(flow.source_id) && !reachable.has(flow.target_id)) { reachable.add(flow.target_id); changed = true; } }
  }
  for (const element of activityNodes) {
    if (!activitiesWithFlows.has(element.id) || ["initial-node", "activity"].includes(element.kind)) continue;
    if ((starts.length && !reachable.has(element.id)) || (!starts.length && !incomingFlow.has(element.id))) add("unreachable-activity", "warning", element, `${element.name || element.kind} is unreachable from an initial activity node.`, "Connect it into a flow that starts at an initial node.");
  }

  const usage = new Set(relationships.flatMap((item) => [item.source_id, item.target_id]));
  for (const element of elements) {
    const owned = Boolean(element.owner_id || element.package_id);
    const shown = options.diagramElementIds?.has?.(element.id) ?? false;
    if (!owned && !usage.has(element.id) && !shown && element.kind !== "package") add("orphaned-element", "info", element, `${element.name || element.kind} is not owned, used, or shown on a diagram.`, "Move it into a package, add it to a diagram, or delete it if obsolete.");
  }
  const rank = { error: 0, warning: 1, info: 2 };
  return diagnostics.sort((a, b) => rank[a.severity] - rank[b.severity] || a.code.localeCompare(b.code));
}

export const supportedUnits = Object.freeze([...KNOWN_UNITS]);
