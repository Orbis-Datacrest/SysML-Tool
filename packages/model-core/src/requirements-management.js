export const requirementRelationshipKinds = Object.freeze(["satisfy", "verify", "derive-reqt", "refine", "trace"]);

export const requirementApprovalStatuses = Object.freeze(["draft", "in-review", "approved", "rejected", "retired"]);
export const requirementVerificationStatuses = Object.freeze(["not-started", "planned", "in-progress", "passed", "failed", "waived"]);
export const requirementPriorities = Object.freeze(["low", "medium", "high", "critical"]);
export const requirementRisks = Object.freeze(["low", "medium", "high", "critical"]);
export const verificationMethods = Object.freeze(["inspection", "analysis", "demonstration", "test", "simulation"]);

function semanticOf(item) {
  return item?.semantic ?? item?.properties ?? {};
}

function baselineKey(item) {
  const baseline = semanticOf(item).baseline ?? {};
  if (typeof baseline === "string") return baseline;
  return [baseline.id, baseline.version, baseline.revision, baseline.hash, baseline.updatedAt].filter(Boolean).join(":");
}

function requirementId(element) {
  return semanticOf(element).requirementId ?? semanticOf(element).stableId ?? element.id;
}

function relationshipEndpoints(repository) {
  const byId = new Map((repository?.elements ?? []).map((item) => [item.id, item]));
  return (repository?.relationships ?? []).map((relationship) => ({
    relationship,
    source: byId.get(relationship.source_id),
    target: byId.get(relationship.target_id)
  }));
}

export function nextRequirementId(repository, { prefix = "REQ", width = 3 } = {}) {
  const used = new Set((repository?.elements ?? [])
    .filter((element) => element.kind === "requirement")
    .map((element) => String(requirementId(element)).toUpperCase()));
  let index = 1;
  do {
    const candidate = `${prefix}-${String(index).padStart(width, "0")}`;
    if (!used.has(candidate.toUpperCase())) return candidate;
    index += 1;
  } while (index < 1000000);
  return `${prefix}-${Date.now()}`;
}

export function createRequirement(input = {}, repository = { elements: [] }) {
  const id = input.id ?? `requirement_${Math.random().toString(36).slice(2, 10)}`;
  const requirementIdValue = input.requirementId ?? nextRequirementId(repository, input.idOptions);
  return {
    id,
    kind: "requirement",
    name: input.name ?? requirementIdValue,
    owner_id: input.owner_id ?? null,
    package_id: input.package_id ?? null,
    semantic: {
      requirementId: requirementIdValue,
      text: input.text ?? "",
      parentRequirementId: input.parentRequirementId ?? null,
      owner: input.owner ?? "",
      priority: input.priority ?? "medium",
      risk: input.risk ?? "medium",
      approvalStatus: input.approvalStatus ?? "draft",
      verificationStatus: input.verificationStatus ?? "not-started",
      verificationMethod: input.verificationMethod ?? "test",
      baseline: input.baseline ?? { id: "working", version: 1 }
    },
    stereotypes: [...(input.stereotypes ?? ["requirement"])]
  };
}

export function buildRequirementHierarchy(repository) {
  const requirements = (repository?.elements ?? []).filter((element) => element.kind === "requirement");
  const byStableId = new Map(requirements.map((element) => [String(requirementId(element)), element]));
  const children = new Map(requirements.map((element) => [element.id, []]));
  const roots = [];

  for (const requirement of requirements) {
    const parentStableId = semanticOf(requirement).parentRequirementId;
    const parent = parentStableId ? byStableId.get(String(parentStableId)) : null;
    if (parent && parent.id !== requirement.id) children.get(parent.id).push(requirement);
    else roots.push(requirement);
  }

  const toNode = (requirement) => ({
    id: requirement.id,
    requirementId: requirementId(requirement),
    name: requirement.name,
    semantic: semanticOf(requirement),
    children: (children.get(requirement.id) ?? []).map(toNode)
  });

  return roots.map(toNode);
}

export function generateTraceabilityMatrix(repository) {
  const requirements = (repository?.elements ?? []).filter((element) => element.kind === "requirement");
  const rows = requirements.map((requirement) => ({
    requirementId: requirementId(requirement),
    modelElementId: requirement.id,
    name: requirement.name,
    owner: semanticOf(requirement).owner ?? "",
    priority: semanticOf(requirement).priority ?? "medium",
    risk: semanticOf(requirement).risk ?? "medium",
    approvalStatus: semanticOf(requirement).approvalStatus ?? "draft",
    verificationStatus: semanticOf(requirement).verificationStatus ?? "not-started",
    verificationMethod: semanticOf(requirement).verificationMethod ?? "",
    baseline: semanticOf(requirement).baseline ?? null,
    satisfiedBy: [],
    verifiedBy: [],
    derivedFrom: [],
    derives: [],
    refinedBy: [],
    traces: []
  }));
  const byRequirementId = new Map(rows.map((row) => [row.modelElementId, row]));

  for (const { relationship, source, target } of relationshipEndpoints(repository)) {
    if (!requirementRelationshipKinds.includes(relationship.kind)) continue;
    if (relationship.kind === "satisfy" && target?.kind === "requirement") byRequirementId.get(target.id)?.satisfiedBy.push(source?.id ?? relationship.source_id);
    if (relationship.kind === "verify" && target?.kind === "requirement") byRequirementId.get(target.id)?.verifiedBy.push(source?.id ?? relationship.source_id);
    if (relationship.kind === "derive-reqt") {
      if (target?.kind === "requirement") byRequirementId.get(target.id)?.derivedFrom.push(source?.id ?? relationship.source_id);
      if (source?.kind === "requirement") byRequirementId.get(source.id)?.derives.push(target?.id ?? relationship.target_id);
    }
    if (relationship.kind === "refine" && target?.kind === "requirement") byRequirementId.get(target.id)?.refinedBy.push(source?.id ?? relationship.source_id);
    if (relationship.kind === "trace") {
      if (source?.kind === "requirement") byRequirementId.get(source.id)?.traces.push(target?.id ?? relationship.target_id);
      if (target?.kind === "requirement") byRequirementId.get(target.id)?.traces.push(source?.id ?? relationship.source_id);
    }
  }

  return rows;
}

export function generateRequirementCoverageReport(repository) {
  const matrix = generateTraceabilityMatrix(repository);
  const uncovered = matrix.filter((row) => row.satisfiedBy.length === 0);
  const unverified = matrix.filter((row) => row.verifiedBy.length === 0 || !["passed", "waived"].includes(row.verificationStatus));
  const unapproved = matrix.filter((row) => row.approvalStatus !== "approved");
  return {
    total: matrix.length,
    satisfied: matrix.length - uncovered.length,
    verified: matrix.length - unverified.length,
    approved: matrix.length - unapproved.length,
    coveragePercent: matrix.length ? Math.round(((matrix.length - uncovered.length) / matrix.length) * 100) : 100,
    verificationPercent: matrix.length ? Math.round(((matrix.length - unverified.length) / matrix.length) * 100) : 100,
    uncovered,
    unverified,
    unapproved
  };
}

export function analyzeRequirementImpact(repository, changedElementId) {
  const relationships = (repository?.relationships ?? []).filter((relationship) => requirementRelationshipKinds.includes(relationship.kind));
  const adjacency = new Map();
  for (const relationship of relationships) {
    adjacency.set(relationship.source_id, [...(adjacency.get(relationship.source_id) ?? []), { relationship, next: relationship.target_id }]);
    adjacency.set(relationship.target_id, [...(adjacency.get(relationship.target_id) ?? []), { relationship, next: relationship.source_id }]);
  }

  const visited = new Set([changedElementId]);
  const impactedRelationshipIds = new Set();
  const queue = [changedElementId];
  while (queue.length) {
    const current = queue.shift();
    for (const edge of adjacency.get(current) ?? []) {
      impactedRelationshipIds.add(edge.relationship.id);
      if (!visited.has(edge.next)) {
        visited.add(edge.next);
        queue.push(edge.next);
      }
    }
  }

  const byId = new Map((repository?.elements ?? []).map((element) => [element.id, element]));
  const impactedElements = [...visited].filter((id) => id !== changedElementId).map((id) => byId.get(id)).filter(Boolean);
  return {
    changedElementId,
    impactedRequirements: impactedElements.filter((element) => element.kind === "requirement"),
    impactedElements,
    impactedRelationshipIds: [...impactedRelationshipIds]
  };
}

export function detectSuspectRequirementLinks(repository) {
  const findings = [];
  for (const { relationship, source, target } of relationshipEndpoints(repository)) {
    if (!requirementRelationshipKinds.includes(relationship.kind)) continue;
    const semantic = semanticOf(relationship);
    if (!source || !target) {
      findings.push({ relationshipId: relationship.id, kind: relationship.kind, reason: "missing-endpoint", message: "Trace link references a missing source or target." });
      continue;
    }
    if (semantic.suspect === true) findings.push({ relationshipId: relationship.id, kind: relationship.kind, reason: "explicit-suspect", message: "Trace link is explicitly marked suspect." });
    const expectedSourceBaseline = semantic.sourceBaseline ?? semantic.baseline?.source;
    const expectedTargetBaseline = semantic.targetBaseline ?? semantic.baseline?.target;
    if (expectedSourceBaseline && expectedSourceBaseline !== baselineKey(source)) findings.push({ relationshipId: relationship.id, kind: relationship.kind, reason: "source-baseline-changed", message: "Source baseline changed since the trace link was created." });
    if (expectedTargetBaseline && expectedTargetBaseline !== baselineKey(target)) findings.push({ relationshipId: relationship.id, kind: relationship.kind, reason: "target-baseline-changed", message: "Target baseline changed since the trace link was created." });
  }
  return findings;
}
