const releasedStates = new Set(["released", "approved"]);

function stable(value) {
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stable(value[key])]));
  }
  return value;
}

function sameValue(a, b) {
  return JSON.stringify(stable(a ?? null)) === JSON.stringify(stable(b ?? null));
}

function byId(items = []) {
  return new Map(items.map((item) => [item.id, item]));
}

function change(kind, entity, id, label, before = null, after = null, path = "") {
  return { kind, entity, id, label, path, before: structuredClone(before), after: structuredClone(after) };
}

function propertyChanges(entity, id, label, before = {}, after = {}, prefix = "") {
  const keys = new Set([...Object.keys(before ?? {}), ...Object.keys(after ?? {})]);
  return [...keys].flatMap((key) => {
    const path = prefix ? `${prefix}.${key}` : key;
    const left = before?.[key];
    const right = after?.[key];
    if (left && right && typeof left === "object" && typeof right === "object" && !Array.isArray(left) && !Array.isArray(right)) {
      return propertyChanges(entity, id, label, left, right, path);
    }
    return sameValue(left, right) ? [] : [change("property", entity, id, label, left, right, path)];
  });
}

function compareCollection({ before = [], after = [], entity, labelFor, diffFor }) {
  const left = byId(before);
  const right = byId(after);
  const ids = new Set([...left.keys(), ...right.keys()]);
  const changes = [];
  for (const id of ids) {
    const previous = left.get(id);
    const next = right.get(id);
    const label = labelFor(next ?? previous);
    if (!previous) changes.push(change("added", entity, id, label, null, next));
    else if (!next) changes.push(change("removed", entity, id, label, previous, null));
    else changes.push(...diffFor(previous, next, label));
  }
  return changes;
}

export function compareModelStates(before = {}, after = {}) {
  const modelChanges = compareCollection({
    before: before.elements,
    after: after.elements,
    entity: "model-element",
    labelFor: (item) => item.name ?? item.id,
    diffFor: (previous, next, label) => [
      ...(["kind", "name", "owner_id", "package_id"].filter((key) => !sameValue(previous[key], next[key])).map((key) => change("model", "model-element", next.id, label, previous[key], next[key], key))),
      ...propertyChanges("model-element", next.id, label, previous.semantic ?? previous.properties ?? {}, next.semantic ?? next.properties ?? {}, "properties"),
      ...propertyChanges("model-element", next.id, label, { stereotypes: previous.stereotypes ?? [] }, { stereotypes: next.stereotypes ?? [] }, "")
    ]
  });
  const relationshipChanges = compareCollection({
    before: before.relationships,
    after: after.relationships,
    entity: "relationship",
    labelFor: (item) => item.label || item.kind || item.id,
    diffFor: (previous, next, label) => [
      ...(["kind", "source_id", "target_id", "label"].filter((key) => !sameValue(previous[key], next[key])).map((key) => change("relationship", "relationship", next.id, label, previous[key], next[key], key))),
      ...propertyChanges("relationship", next.id, label, previous.semantic ?? previous.properties ?? {}, next.semantic ?? next.properties ?? {}, "properties")
    ]
  });
  const requirementChanges = modelChanges.filter((item) => {
    const previous = byId(before.elements).get(item.id);
    const next = byId(after.elements).get(item.id);
    return previous?.kind === "requirement" || next?.kind === "requirement";
  }).map((item) => ({ ...item, entity: "requirement" }));
  return { modelChanges, relationshipChanges, requirementChanges };
}

export function compareDiagramStates(before = {}, after = {}) {
  return {
    diagramChanges: [
      ...propertyChanges("diagram", after.id ?? before.id, after.name ?? before.name ?? "Diagram", before.metadata ?? {}, after.metadata ?? {}, "metadata"),
      ...compareCollection({
        before: before.elements,
        after: after.elements,
        entity: "diagram-element",
        labelFor: (item) => item.name ?? item.id,
        diffFor: (previous, next, label) => propertyChanges("diagram-element", next.id, label, previous, next).filter((item) => ["x", "y", "width", "height", "style", "name", "kind", "properties"].some((key) => item.path === key || item.path.startsWith(`${key}.`)))
      }),
      ...compareCollection({
        before: before.relationships,
        after: after.relationships,
        entity: "diagram-relationship",
        labelFor: (item) => item.label || item.kind || item.id,
        diffFor: (previous, next, label) => propertyChanges("diagram-relationship", next.id, label, previous, next).filter((item) => ["waypoints", "style", "label", "kind", "source_id", "target_id", "properties"].some((key) => item.path === key || item.path.startsWith(`${key}.`)))
      })
    ]
  };
}

export function compareProjectVersions(before = {}, after = {}) {
  const beforeDiagrams = byId(before.diagrams ?? []);
  const afterDiagrams = byId(after.diagrams ?? []);
  const diagramIds = new Set([...beforeDiagrams.keys(), ...afterDiagrams.keys()]);
  const diagramChanges = [];
  for (const id of diagramIds) {
    const previous = beforeDiagrams.get(id);
    const next = afterDiagrams.get(id);
    if (!previous || !next) diagramChanges.push(change(previous ? "removed" : "added", "diagram", id, (next ?? previous).name, previous, next));
    else diagramChanges.push(...compareDiagramStates(previous, next).diagramChanges);
  }
  const modelBefore = before.model ?? modelFromDiagrams(before.diagrams);
  const modelAfter = after.model ?? modelFromDiagrams(after.diagrams);
  return { ...compareModelStates(modelBefore, modelAfter), diagramChanges };
}

export function modelFromDiagrams(diagrams = []) {
  const elements = new Map();
  const relationships = new Map();
  for (const diagram of diagrams) {
    for (const item of diagram.elements ?? []) elements.set(item.model_element_id ?? item.id, { id: item.model_element_id ?? item.id, kind: item.kind, name: item.name, semantic: item.properties ?? {}, stereotypes: item.stereotypes ?? [] });
    for (const item of diagram.relationships ?? []) relationships.set(item.model_relationship_id ?? item.id, { id: item.model_relationship_id ?? item.id, kind: item.kind, source_id: item.source_id, target_id: item.target_id, label: item.label, semantic: item.properties ?? {}, stereotypes: item.stereotypes ?? [] });
  }
  return { schema_version: 2, elements: [...elements.values()], relationships: [...relationships.values()] };
}

export function createBaseline({ id, name, description = "", version, state = "draft", created_by = null, created_at = new Date().toISOString() }) {
  if (!String(name ?? "").trim()) throw new Error("Baseline name is required");
  return { id, name: name.trim(), description, version, state, released: releasedStates.has(state), created_by, created_at };
}

export function assertBaselineMutable(baseline) {
  if (baseline?.released || releasedStates.has(baseline?.state)) throw new Error("Released baselines are immutable");
}

export function restoreElement(diagram, snapshotDiagram, elementId) {
  const restored = structuredClone(diagram);
  const source = snapshotDiagram?.elements?.find((item) => item.id === elementId || item.model_element_id === elementId);
  if (!source) throw new Error("Element not found in version");
  restored.elements = restored.elements.filter((item) => item.id !== source.id && item.model_element_id !== elementId);
  restored.elements.push(structuredClone(source));
  const relationshipIds = new Set((snapshotDiagram.relationships ?? []).filter((item) => item.source_id === source.id || item.target_id === source.id).map((item) => item.id));
  restored.relationships = restored.relationships.filter((item) => !relationshipIds.has(item.id));
  restored.relationships.push(...(snapshotDiagram.relationships ?? []).filter((item) => relationshipIds.has(item.id)).map((item) => structuredClone(item)));
  return restored;
}

export function restoreDiagram(projectSnapshot, diagramId) {
  const diagram = projectSnapshot?.diagrams?.find((item) => item.id === diagramId);
  if (!diagram) throw new Error("Diagram not found in version");
  return structuredClone(diagram);
}

export function createCollaborationSession({ project_id, diagram_id, user, role = "Viewer", permissions = [] }) {
  return {
    project_id,
    diagram_id,
    user: user ? { id: user.id, email: user.email, name: user.name ?? user.email?.split("@")[0] ?? "Collaborator" } : { id: "anonymous", name: "Guest" },
    role,
    permissions,
    presence: { cursor: null, selection: [], active_at: new Date().toISOString() }
  };
}

export function mergeOptimisticState(serverState, localState, pendingOperations = []) {
  return pendingOperations.reduce((state, operation) => operation(state), structuredClone(serverState ?? localState));
}

export function resolveConflict({ server, local, base, prefer = "local" }) {
  const diffServer = compareDiagramStates(base, server).diagramChanges;
  const diffLocal = compareDiagramStates(base, local).diagramChanges;
  const touchedServer = new Set(diffServer.map((item) => `${item.entity}:${item.id}:${item.path}`));
  const conflicts = diffLocal.filter((item) => touchedServer.has(`${item.entity}:${item.id}:${item.path}`));
  return { state: structuredClone(prefer === "server" ? server : local), conflicts };
}
