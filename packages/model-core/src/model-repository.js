import { requirementRelationshipKinds } from "./requirements-management.js";
import { portKinds, validateInterfaceConnection } from "./interface-management.js";
import { createUnitRegistry, validateQuantityCompatibility } from "./units-system.js";

const semanticKeys = {
  package: ["memberIds", "importedPackageIds"],
  interface: ["operations", "receptions", "properties", "interfaceId", "interfaceKind", "signals", "commands", "protocols", "pins", "connector", "pinAssignments", "voltage", "current", "frequency", "bandwidth", "units", "compatibleWith"],
  "interface-block": ["interfaceId", "interfaceKind", "signals", "commands", "protocols", "pins", "connector", "pinAssignments", "voltage", "current", "frequency", "bandwidth", "units", "compatibleWith"],
  "interface-definition": ["interfaceId", "interfaceKind", "signals", "commands", "protocols", "pins", "connector", "pinAssignments", "voltage", "current", "frequency", "bandwidth", "units", "compatibleWith"],
  block: ["attributes", "parts", "references", "values", "operations", "responsibilities", "constraints", "quantity", "unit", "quantityKind", "min", "max", "default"],
  requirement: ["requirementId", "text", "parentRequirementId", "owner", "verificationMethod", "verificationStatus", "approvalStatus", "risk", "priority", "baseline"],
  port: ["direction", "interfaceId", "interfaceType", "multiplicity", "conjugated", "signals", "commands", "protocols", "pins", "voltage", "current", "frequency", "bandwidth", "units"],
  "proxy-port": ["direction", "interfaceId", "interfaceType", "multiplicity", "conjugated", "signals", "commands", "protocols", "pins", "voltage", "current", "frequency", "bandwidth", "units"],
  "full-port": ["direction", "interfaceId", "interfaceType", "multiplicity", "conjugated", "signals", "commands", "protocols", "pins", "voltage", "current", "frequency", "bandwidth", "units"],
  activity: ["parameters", "objectFlows", "guards", "rates"],
  state: ["entry", "exit", "doActivity"],
  "value-type": ["unit", "quantityKind", "dimensions", "quantity", "quantitySchema", "min", "max", "default"],
  "unit": ["symbol", "unitSymbol", "quantityKind", "factor", "conversionFactor", "offset", "dimension"],
  "quantity-kind": ["quantityKind", "dimension"],
  "constraint-block": ["parameters", "constraints", "quantity", "unit", "quantityKind", "min", "max", "default"]
};

const legacyAliases = {
  requirement: { id: "requirementId", parent_id: "parentRequirementId", verification_method: "verificationMethod", verification_status: "verificationStatus", approval_status: "approvalStatus" },
  port: { interface_id: "interfaceId", interface_type: "interfaceType", conjugation: "conjugated" },
  "proxy-port": { interface_id: "interfaceId", interface_type: "interfaceType", conjugation: "conjugated" },
  "full-port": { interface_id: "interfaceId", interface_type: "interfaceType", conjugation: "conjugated" },
  "value-type": { quantity_kind: "quantityKind" }
};

const layoutKeys = new Set(["x", "y", "width", "height", "variant", "style", "locked", "groupId"]);
const routeKeys = new Set(["style", "routing", "waypoints", "sourceAnchor", "targetAnchor", "labelPosition", "roleLabel", "multiplicity", "sourceMultiplicity"]);

export const CURRENT_MODEL_SCHEMA_VERSION = 2;

export function semanticProperties(kind, properties = {}) {
  const aliases = legacyAliases[kind] ?? {};
  const normalized = Object.fromEntries(Object.entries(properties).map(([key, value]) => [aliases[key] ?? key, value]));
  const keys = semanticKeys[kind];
  if (!keys) return normalized;
  return Object.fromEntries(keys.filter((key) => normalized[key] !== undefined).map((key) => [key, normalized[key]]));
}

export function createModelElement(element, scope) {
  return {
    id: element.model_element_id ?? element.id,
    tenant_id: scope.tenant_id,
    project_id: scope.project_id,
    kind: element.kind,
    name: element.name ?? "",
    owner_id: element.owner_id ?? null,
    package_id: element.package_id ?? null,
    semantic: semanticProperties(element.kind, element.semantic ?? element.properties),
    stereotypes: [...(element.stereotypes ?? [])]
  };
}

export function createModelRelationship(relationship, scope) {
  const semantic = relationship.semantic ?? relationship.properties ?? {};
  const transitionSemantic = relationship.kind === "transition" ? {
    trigger: semantic.trigger ?? "",
    guard: semantic.guard ?? "",
    effect: semantic.effect ?? ""
  } : semantic;
  return {
    id: relationship.model_relationship_id ?? relationship.id,
    tenant_id: scope.tenant_id,
    project_id: scope.project_id,
    kind: relationship.kind,
    source_id: relationship.source_id,
    target_id: relationship.target_id,
    label: relationship.label ?? "",
    stereotypes: [...(relationship.stereotypes ?? semantic.stereotypes ?? [])],
    semantic: Object.fromEntries(Object.entries(transitionSemantic).filter(([key]) => !routeKeys.has(key))),
    validation: relationship.validation ?? semantic.validation ?? { status: "unchecked", diagnostics: [] }
  };
}

export function decomposeDiagram(diagram) {
  const scope = { tenant_id: diagram.tenant_id, project_id: diagram.project_id };
  const elements = (diagram.elements ?? []).map((element) => createModelElement(element, scope));
  const relationships = (diagram.relationships ?? []).map((relationship) => createModelRelationship(relationship, scope));
  const view = {
    schema_version: CURRENT_MODEL_SCHEMA_VERSION,
    element_refs: (diagram.elements ?? []).map((element, index) => ({
      model_element_id: element.model_element_id ?? element.id,
      ...Object.fromEntries(Object.entries(element).filter(([key]) => layoutKeys.has(key))),
      display: element.display ?? {},
      z_index: element.z_index ?? index
    })),
    relationship_refs: (diagram.relationships ?? []).map((relationship) => ({
      model_relationship_id: relationship.model_relationship_id ?? relationship.id,
      ...Object.fromEntries(Object.entries(relationship).filter(([key]) => routeKeys.has(key))),
      display: relationship.display ?? {}
    })),
    viewport: diagram.viewport ?? diagram.metadata?.viewport ?? { x: 0, y: 0, zoom: 1 },
    display: diagram.display ?? {},
    metadata: diagram.metadata ?? {}
  };
  return { elements, relationships, view };
}

export function hydrateDiagram(diagram, repository, view) {
  const elementsById = new Map(repository.elements.map((item) => [item.id, item]));
  const relationshipsById = new Map(repository.relationships.map((item) => [item.id, item]));
  return {
    ...diagram,
    metadata: view.metadata ?? {},
    viewport: view.viewport,
    display: view.display,
    elements: (view.element_refs ?? []).flatMap((reference) => {
      const model = elementsById.get(reference.model_element_id);
      if (!model) return [];
      return [{ id: model.id, model_element_id: model.id, kind: model.kind, name: model.name, owner_id: model.owner_id ?? null, package_id: model.package_id ?? null, properties: model.semantic ?? {}, stereotypes: model.stereotypes ?? [], ...reference }];
    }),
    relationships: (view.relationship_refs ?? []).flatMap((reference) => {
      const model = relationshipsById.get(reference.model_relationship_id);
      if (!model) return [];
      return [{ id: model.id, model_relationship_id: model.id, kind: model.kind, source_id: model.source_id, target_id: model.target_id, label: model.label, properties: model.semantic ?? {}, stereotypes: model.stereotypes ?? [], validation: model.validation, ...reference }];
    })
  };
}

export function migrateLegacyProject(project) {
  const elements = new Map();
  const relationships = new Map();
  const diagrams = (project.diagrams ?? []).map((diagram) => {
    const decomposed = decomposeDiagram(diagram);
    decomposed.elements.forEach((item) => elements.set(item.id, { ...elements.get(item.id), ...item }));
    decomposed.relationships.forEach((item) => relationships.set(item.id, { ...relationships.get(item.id), ...item }));
    return { ...diagram, elements: undefined, relationships: undefined, view: decomposed.view };
  });
  return { ...project, schema_version: CURRENT_MODEL_SCHEMA_VERSION, model: { elements: [...elements.values()], relationships: [...relationships.values()] }, diagrams };
}

export function validateRelationshipCompatibility(relationship, elements) {
  const byId = new Map(elements.map((element) => [element.id, element]));
  const source = byId.get(relationship.source_id);
  const target = byId.get(relationship.target_id);
  const unitRegistry = createUnitRegistry({ elements });
  const diagnostics = [];
  if (!source) diagnostics.push(`Missing source ${relationship.source_id}`);
  if (!target) diagnostics.push(`Missing target ${relationship.target_id}`);
  if (relationship.kind === "satisfy" && target?.kind !== "requirement") diagnostics.push("Satisfy must target a requirement");
  if (relationship.kind === "verify" && target?.kind !== "requirement") diagnostics.push("Verify must target a requirement");
  if (requirementRelationshipKinds.includes(relationship.kind) && relationship.kind !== "trace" && ![source?.kind, target?.kind].includes("requirement")) diagnostics.push(`${relationship.kind} must involve a requirement`);
  if (["connector", "item-flow"].includes(relationship.kind) && portKinds.includes(source?.kind) && portKinds.includes(target?.kind)) diagnostics.push(...validateInterfaceConnection(relationship, { elements, relationships: [] }).diagnostics);
  const quantityFor = (element) => {
    const semantic = element?.semantic ?? element?.properties ?? {};
    if (semantic.quantity) return semantic.quantity;
    if (semantic.value !== undefined || semantic.unit || semantic.quantityKind) return { value: semantic.value ?? semantic.default ?? semantic.nominal ?? 0, unit: semantic.unit, quantityKind: semantic.quantityKind };
    return null;
  };
  diagnostics.push(...validateQuantityCompatibility(quantityFor(source), quantityFor(target), unitRegistry).diagnostics);
  return { status: diagnostics.length ? "invalid" : "valid", diagnostics };
}
