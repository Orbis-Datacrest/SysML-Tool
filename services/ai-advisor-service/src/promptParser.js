const TYPE_ALIASES = {
  class: "class", classes: "class", block: "block", blocks: "block", interface: "interface",
  "interface block": "interface-block", requirement: "requirement", requirements: "requirement",
  package: "package", packages: "package", note: "note", notes: "note", actor: "actor", actors: "actor",
  "use case": "use-case", "use cases": "use-case", activity: "activity", activities: "activity", action: "action", actions: "action",
  state: "state", states: "state"
};

const DIAGRAM_INTENTS = [
  [/\b(?:activity|activities|actions?|control flow)\b/i, ["uml-activity", "sysml-activity"], "an Activity diagram"],
  [/\b(?:state machine|states?|transitions?)\b/i, ["uml-state-machine", "sysml-state-machine"], "a State Machine diagram"],
  [/\b(?:use cases?|actors?|include|extend)\b/i, ["uml-use-case", "sysml-use-case"], "a Use Case diagram"],
  [/\b(?:requirements?|derive(?:reqt)?|satisfy|verify)\b/i, ["sysml-requirement"], "a Requirement diagram"],
  [/\b(?:blocks?|ports?|interface blocks?)\b/i, ["sysml-bdd"], "a Block Definition diagram"],
  [/\b(?:classes?|attributes?|operations?|methods?)\b/i, ["uml-class"], "a Class diagram"]
];

const relationshipKinds = {
  association: "association", dependency: "dependency", composition: "composition", aggregation: "aggregation",
  generalization: "generalization", inheritance: "generalization", include: "include", extend: "extend",
  satisfy: "satisfy", verify: "verify", trace: "trace", refine: "refine", "derive requirement": "derive-reqt",
  "control flow": "control-flow", transition: "transition"
};

const slug = (value) => String(value).toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "").slice(0, 45) || "element";
const cleanName = (value) => String(value ?? "").trim().replace(/^["'`]|["'`,.;:]$/g, "").replace(/\s+/g, " ");
const operationId = (prefix, value, index) => `${prefix}_${slug(value)}_${index + 1}`.slice(0, 78);

function splitModelList(value) {
  const items = []; let current = ""; let depth = 0;
  const source = String(value ?? "").trim().replace(/[.;]+$/, "");
  for (let index = 0; index < source.length; index += 1) {
    const character = source[index];
    if (character === "(") depth += 1;
    if (character === ")") depth = Math.max(0, depth - 1);
    const rest = source.slice(index);
    const andMatch = depth === 0 && rest.match(/^\s+and\s+/i);
    if (depth === 0 && (character === "," || andMatch)) {
      if (cleanName(current)) items.push(cleanName(current));
      current = "";
      if (andMatch) index += andMatch[0].length - 1;
    } else current += character;
  }
  if (cleanName(current)) items.push(cleanName(current));
  return items.map((item) => item.replace(/^(?:a|an|the)\s+/i, "").trim()).filter(Boolean);
}

function clause(request, names, stops) {
  const startPattern = new RegExp(`\\b(?:${names.join("|")})\\b\\s*(?::|=|are|include|including)?\\s*`, "i");
  const match = startPattern.exec(request);
  if (!match) return [];
  const tail = request.slice(match.index + match[0].length);
  const stopPattern = new RegExp(`\\s+(?=\\b(?:${stops.join("|")})\\b)`, "i");
  const stop = stopPattern.exec(tail);
  return splitModelList(stop ? tail.slice(0, stop.index) : tail);
}

function attributesFrom(request) { return clause(request, ["attributes?", "properties"], ["and operations?", "operations?", "methods?", "ports?", "connect", "linked", "relationships?"]); }
function operationsFrom(request) { return clause(request, ["operations?", "methods?"], ["and attributes?", "attributes?", "ports?", "connect", "linked", "relationships?"]); }
function portsFrom(request) {
  return clause(request, ["ports?"], ["and attributes?", "attributes?", "operations?", "methods?", "connect", "relationships?"]).map((raw, index) => {
    const match = raw.match(/^(?:(inout|input|output|in|out)\s+)?(?:port\s+)?([^:]+?)(?:\s*:\s*(.+))?$/i);
    const direction = ({ input: "in", output: "out" })[match?.[1]?.toLowerCase()] ?? match?.[1]?.toLowerCase() ?? "inout";
    return { id: `port_${slug(match?.[2] ?? raw)}_${index + 1}`, name: cleanName(match?.[2] ?? raw), direction, type: cleanName(match?.[3] ?? "") };
  });
}

function inferDiagramIntent(request) {
  return DIAGRAM_INTENTS.find(([pattern]) => pattern.test(request)) ?? null;
}

function diagramLabel(type) {
  return String(type ?? "diagram").replace(/^uml-/, "UML ").replace(/^sysml-/, "SysML ").replace(/\bbdd\b/i, "Block Definition").replace(/-/g, " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function existingElementMap(diagram) {
  return new Map((diagram.elements ?? []).flatMap((item) => [[item.name.toLowerCase(), item.id], [item.id.toLowerCase(), item.id]]));
}

function findRef(name, refs) { return refs.get(cleanName(name).toLowerCase()); }

function propertiesFor(kind, request, name) {
  if (["class", "block", "interface", "interface-block"].includes(kind)) {
    const properties = { attributes: attributesFrom(request), operations: operationsFrom(request) };
    const ports = portsFrom(request);
    if (ports.length) properties.ports = ports;
    return properties;
  }
  if (kind === "requirement") {
    const requirementId = request.match(/\b([A-Z]{2,12}-\d{1,8})\b/)?.[1];
    const text = cleanName(request.match(/(?:\bthat\b|:)\s*(.+)$/i)?.[1] ?? request.match(/\b(the\s+(?:system|component|user)\s+shall\b.+)$/i)?.[1] ?? name);
    return { ...(requirementId ? { requirementId } : {}), text };
  }
  if (kind === "note") return { text: cleanName(request.match(/["']([^"']+)["']/)?.[1] ?? request.replace(/^.*?\bnote\b\s*/i, "")) };
  return {};
}

function creationMatches(request) {
  const matches = [];
  const normalizeCreationName = (kind, rawName) => {
    let name = cleanName(rawName);
    if (kind === "requirement") name = cleanName(name.split(":")[0].replace(/\b[A-Z]{2,12}-\d{1,8}\b/, "")) || name.match(/\b[A-Z]{2,12}-\d{1,8}\b/)?.[0] || "Requirement";
    if (kind === "note") name = "Note";
    return name;
  };
  const typePattern = "interface\\s+block|use\\s+case|class|block|interface|requirement|package|note|actor|activity|action|state(?!\\s+machine)";
  const singular = new RegExp(`\\b(?:create|add|define|make)\\s+(?:(?:a|an)\\s+)?(${typePattern})\\s+(?:named\\s+|called\\s+)?(?:(?:\"([^\"]+)\")|(?:'([^']+)')|(.+?))(?=\\s+(?:with|having|that|attributes?|properties|operations?|methods?|ports?|and\\s+(?:(?:create|add|connect|link)|(?:(?:a|an)\\s+)?(?:${typePattern}))|connect(?:ed)?|linked)\\b|[.;]|$)`, "gi");
  for (const match of request.matchAll(singular)) {
    const kind = TYPE_ALIASES[match[1].toLowerCase().replace(/\s+/g, " ")];
    matches.push({ kind, name: normalizeCreationName(kind, match[2] ?? match[3] ?? match[4]), source: match[0], index: match.index });
  }
  const coordinated = new RegExp(`\\band\\s+(?:(?:a|an)\\s+)?(${typePattern})\\s+(?:named\\s+|called\\s+)?(?:(?:\"([^\"]+)\")|(?:'([^']+)')|(.+?))(?=\\s+(?:with|having|that|attributes?|properties|operations?|methods?|ports?|and\\s+(?:(?:connect|link)|(?:(?:a|an)\\s+)?(?:${typePattern}))|connect(?:ed)?|linked)\\b|[.;]|$)`, "gi");
  for (const match of request.matchAll(coordinated)) {
    const kind = TYPE_ALIASES[match[1].toLowerCase().replace(/\s+/g, " ")];
    matches.push({ kind, name: normalizeCreationName(kind, match[2] ?? match[3] ?? match[4]), source: match[0], index: match.index });
  }
  const plural = /\b(?:create|add|define|make)\s+(classes|blocks|requirements|packages|notes|actors|use\s+cases|activities|actions|states)\s+(.+?)(?=\s+(?:with|having|connect|linked|and\s+(?:create|add))\b|[.;]|$)/gi;
  for (const match of request.matchAll(plural)) for (const name of splitModelList(match[2])) matches.push({ kind: TYPE_ALIASES[match[1].toLowerCase().replace(/\s+/g, " ")], name, source: match[0], index: match.index });
  const containedLists = [
    [/\bstate\s+machine(?:\s+[A-Za-z][\w -]*?)?\s+with\s+states\s+(.+?)(?=[.;]|$)/gi, "state"],
    [/\bactivity(?:\s+[A-Za-z][\w -]*?)?\s+with\s+actions\s+(.+?)(?=[.;]|$)/gi, "action"]
  ];
  for (const [pattern, kind] of containedLists) for (const match of request.matchAll(pattern)) for (const name of splitModelList(match[1])) matches.push({ kind, name, source: match[0], index: match.index });
  const filtered = matches.filter((item) => item.name && !/^(?:with|having|attributes?|operations?|ports?)$/i.test(item.name)).sort((a, b) => a.index - b.index);
  return filtered.map((item, index) => ({ ...item, source: request.slice(item.index, filtered.slice(index + 1).find((candidate) => candidate.index > item.index)?.index ?? request.length) }));
}

function relationshipMatches(request, refs, diagramType) {
  const operations = []; const questions = [];
  const pattern = /\b(?:connect|link|associate)\s+["']?(.+?)["']?\s+(?:to|with|and|->)\s+["']?(.+?)["']?(?=\s+(?:using|with|as|by)\s+|\s+multiplicit(?:y|ies)\b|[.;]|$)(?:\s+(?:using|with|as|by)\s+(?:an?\s+)?(association|dependency|composition|aggregation|generalization|inheritance|include|extend|satisfy|verify|trace|refine|derive\s+requirement|control\s+flow|transition))?(?:\s+multiplicit(?:y|ies)\s+["']?([0-9.*]+)["']?\s+(?:to|and)\s+["']?([0-9.*]+)["']?)?/gi;
  for (const [index, match] of [...request.matchAll(pattern)].entries()) {
    const sourceName = cleanName(match[1]); const targetName = cleanName(match[2]);
    const sourceRef = findRef(sourceName, refs); const targetRef = findRef(targetName, refs);
    if (!sourceRef || !targetRef) { questions.push(`Which existing or proposed elements should “${sourceName}” and “${targetName}” refer to?`); continue; }
    const defaultKind = /activity/.test(diagramType) ? "control-flow" : /state-machine/.test(diagramType) ? "transition" : "association";
    const kind = relationshipKinds[match[3]?.toLowerCase().replace(/\s+/g, " ")] ?? defaultKind;
    operations.push({ id: operationId("rel", `${sourceName}_${targetName}`, index), type: "add_relationship", rationale: `Connect ${sourceName} to ${targetName}.`, relationship: { ref: `new_${slug(sourceName)}_${slug(targetName)}`, kind, source_ref: sourceRef, target_ref: targetRef, label: "", properties: { ...(match[4] ? { sourceMultiplicity: match[4].replace(/\.$/, "") } : {}), ...(match[5] ? { targetMultiplicity: match[5].replace(/\.$/, "") } : {}) }, stereotypes: [] } });
  }
  const inheritance = /\b(?:class\s+)?([A-Za-z][\w -]*?)\s+(?:inherits|extends)\s+(?:class\s+)?([A-Za-z][\w -]*?)(?=[.;]|$)/gi;
  for (const [index, match] of [...request.matchAll(inheritance)].entries()) {
    const sourceRef = findRef(match[1], refs); const targetRef = findRef(match[2], refs);
    if (sourceRef && targetRef) operations.push({ id: operationId("generalization", match[1], index), type: "add_relationship", rationale: `Model inheritance from ${cleanName(match[1])} to ${cleanName(match[2])}.`, relationship: { ref: `new_generalization_${index + 1}`, kind: "generalization", source_ref: sourceRef, target_ref: targetRef, label: "", properties: {}, stereotypes: [] } });
  }
  return { operations, questions };
}

function updateMatch(request, diagram) {
  const match = request.match(/^\s*add\s+(attributes?|properties|operations?|methods?|ports?)\s+(.+?)\s+to\s+(?:class\s+|block\s+|interface\s+)?["']?([^"'.;]+)["']?[.;]?\s*$/i);
  if (!match) return null;
  const target = diagram.elements.find((item) => item.name.toLowerCase() === cleanName(match[3]).toLowerCase());
  if (!target) return { question: `Which element should receive the ${match[1].toLowerCase()}? I could not find “${cleanName(match[3])}”.` };
  const key = /operation|method/i.test(match[1]) ? "operations" : /port/i.test(match[1]) ? "ports" : "attributes";
  const values = key === "ports" ? portsFrom(`ports ${match[2]}`) : splitModelList(match[2]);
  return { operation: { id: `update_${slug(target.id)}_${key}`, type: "update_element", target_id: target.id, rationale: `Add ${key} to ${target.name}.`, changes: { properties: { [key]: [...(target.properties?.[key] ?? []), ...values] } } } };
}

export function parseModelingPrompt(context) {
  const { diagram, request } = context;
  const result = { summary: "", assumptions: [], clarification_questions: [], comments: [], operations: [], layout_suggestions: [] };
  const update = updateMatch(request, diagram);
  if (update) {
    result.summary = update.operation ? "Proposed an update to an existing model element." : "The target element is ambiguous.";
    if (update.operation) result.operations.push(update.operation);
    if (update.question) result.clarification_questions.push(update.question);
    return result;
  }
  const intent = inferDiagramIntent(request);
  if (intent && !intent[1].includes(diagram.type)) {
    result.assumptions.push(`Recommendation: this request describes ${intent[2]}, while the active canvas is a ${diagramLabel(diagram.type)}. The requested model will still be created on the active canvas; use the matching diagram type for standard notation.`);
  }
  const creations = creationMatches(request);
  const refs = existingElementMap(diagram);
  for (const [index, item] of creations.entries()) {
    const kind = diagram.type === "sysml-bdd" && item.kind === "interface" ? "interface-block" : item.kind;
    const ref = `new_${slug(item.name)}_${index + 1}`;
    refs.set(item.name.toLowerCase(), ref);
    result.operations.push({ id: operationId("add", item.name, index), type: "add_element", rationale: `Create the requested ${kind}.`, element: { ref, kind, name: item.name, ...(["class", "block"].includes(kind) ? { variant: "full" } : {}), properties: propertiesFor(kind, item.source, item.name), stereotypes: [] } });
  }
  const relationships = relationshipMatches(request, refs, intent?.[1]?.[0] ?? diagram.type);
  result.operations.push(...relationships.operations);
  result.clarification_questions.push(...relationships.questions);
  if (!result.operations.length && !result.clarification_questions.length) result.clarification_questions.push("Which model elements and relationships should I create or update?");
  result.summary = result.operations.length ? `Proposed ${result.operations.length} semantic model change${result.operations.length === 1 ? "" : "s"}.` : "More detail is needed before creating a safe proposal.";
  if (creations.length > 1) result.assumptions.push("Items listed together are separate model elements.");
  return result;
}

export { splitModelList };
