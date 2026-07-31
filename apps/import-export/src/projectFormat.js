export const PROJECT_FORMAT = "model-studio-project";
export const PROJECT_SCHEMA_VERSION = 3;
export const MAX_IMPORT_BYTES = 10 * 1024 * 1024;

const MAX_ITEMS = 20_000;
const MAX_TEXT_LENGTH = 100_000;
const COLOR_PATTERN = /^#(?:[0-9a-f]{3}|[0-9a-f]{4}|[0-9a-f]{6}|[0-9a-f]{8})$/i;

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function requireRecord(value, label) {
  if (!isRecord(value)) throw new Error(`${label} must be an object.`);
}

function requireText(value, label) {
  if (typeof value !== "string" || !value.trim()) throw new Error(`${label} must be a non-empty string.`);
  if (value.length > MAX_TEXT_LENGTH) throw new Error(`${label} is too long.`);
}

function requireNumber(value, label, { positive = false } = {}) {
  if (!Number.isFinite(value) || (positive && value <= 0)) throw new Error(`${label} must be ${positive ? "a positive" : "a finite"} number.`);
}

function validateColor(value, label) {
  if (value !== undefined && (typeof value !== "string" || !COLOR_PATTERN.test(value))) {
    throw new Error(`${label} must be a hexadecimal color.`);
  }
}

function validateElement(element, index, ids) {
  const label = `Element ${index + 1}`;
  requireRecord(element, label);
  requireText(element.id, `${label} id`);
  if (ids.has(element.id)) throw new Error(`Duplicate element id "${element.id}".`);
  ids.add(element.id);
  requireText(element.kind, `${label} kind`);
  if (element.variant !== undefined && !["full", "simple"].includes(element.variant)) throw new Error(`${label} variant must be "full" or "simple".`);
  if (typeof element.name !== "string") throw new Error(`${label} name must be text.`);
  for (const key of ["x", "y"]) requireNumber(element[key], `${label} ${key}`);
  for (const key of ["width", "height"]) requireNumber(element[key], `${label} ${key}`, { positive: true });
  if (element.properties !== undefined) requireRecord(element.properties, `${label} properties`);
  if (element.metadata !== undefined) requireRecord(element.metadata, `${label} metadata`);
  if (element.stereotypes !== undefined && (!Array.isArray(element.stereotypes) || element.stereotypes.some((item) => typeof item !== "string"))) {
    throw new Error(`${label} stereotypes must be a list of text values.`);
  }
  if (element.style !== undefined) {
    requireRecord(element.style, `${label} style`);
    for (const key of ["fillColor", "borderColor", "textColor", "backgroundColor", "strokeColor", "fontColor"]) validateColor(element.style[key], `${label} style.${key}`);
    for (const key of ["borderWidth", "textSize"]) {
      if (element.style[key] !== undefined) requireNumber(element.style[key], `${label} style.${key}`, { positive: true });
    }
  }
}

function validateRelationship(relationship, index, elementIds, relationshipIds) {
  const label = `Relationship ${index + 1}`;
  requireRecord(relationship, label);
  requireText(relationship.id, `${label} id`);
  if (relationshipIds.has(relationship.id)) throw new Error(`Duplicate relationship id "${relationship.id}".`);
  relationshipIds.add(relationship.id);
  requireText(relationship.kind, `${label} kind`);
  requireText(relationship.source_id, `${label} source_id`);
  requireText(relationship.target_id, `${label} target_id`);
  if (!elementIds.has(relationship.source_id) || !elementIds.has(relationship.target_id)) {
    throw new Error(`${label} references an element that is not in the file.`);
  }
  if (relationship.style !== undefined) {
    requireRecord(relationship.style, `${label} style`);
    for (const key of ["color", "lineColor", "strokeColor"]) validateColor(relationship.style[key], `${label} style.${key}`);
    if (relationship.style.width !== undefined) requireNumber(relationship.style.width, `${label} style.width`, { positive: true });
  }
  if (relationship.waypoints !== undefined) {
    if (!Array.isArray(relationship.waypoints)) throw new Error(`${label} waypoints must be a list.`);
    relationship.waypoints.forEach((point, pointIndex) => {
      requireRecord(point, `${label} waypoint ${pointIndex + 1}`);
      requireNumber(point.x, `${label} waypoint ${pointIndex + 1} x`);
      requireNumber(point.y, `${label} waypoint ${pointIndex + 1} y`);
    });
  }
}

export function validateDiagramSnapshot(diagram) {
  requireRecord(diagram, "Diagram");
  if (!Array.isArray(diagram.elements) || !Array.isArray(diagram.relationships)) {
    throw new Error("The file must contain element and relationship lists.");
  }
  if (diagram.elements.length > MAX_ITEMS || diagram.relationships.length > MAX_ITEMS) throw new Error("The file contains too many diagram items.");
  if (diagram.metadata !== undefined) requireRecord(diagram.metadata, "Diagram metadata");

  const elementIds = new Set();
  diagram.elements.forEach((element, index) => validateElement(element, index, elementIds));
  const relationshipIds = new Set();
  diagram.relationships.forEach((relationship, index) => validateRelationship(relationship, index, elementIds, relationshipIds));
  return structuredClone(diagram);
}

function validateViewport(viewport) {
  if (viewport === undefined || viewport === null) return null;
  requireRecord(viewport, "Canvas viewport");
  requireNumber(viewport.zoom, "Canvas viewport zoom", { positive: true });
  if (viewport.zoom < 0.25 || viewport.zoom > 2.5) throw new Error("Canvas viewport zoom must be between 0.25 and 2.5.");
  requireNumber(viewport.scrollLeft, "Canvas viewport scrollLeft");
  requireNumber(viewport.scrollTop, "Canvas viewport scrollTop");
  if (viewport.scrollLeft < 0 || viewport.scrollTop < 0) throw new Error("Canvas scroll positions cannot be negative.");
  return { zoom: viewport.zoom, scrollLeft: viewport.scrollLeft, scrollTop: viewport.scrollTop };
}

export function createProjectSnapshot(diagram, context = {}) {
  const activeDiagram = validateDiagramSnapshot(diagram);
  const diagrams = (context.diagrams?.length ? context.diagrams : [activeDiagram]).map(validateDiagramSnapshot);
  const activeIndex = diagrams.findIndex((item) => item.id === activeDiagram.id);
  if (activeIndex >= 0) diagrams[activeIndex] = activeDiagram;
  else diagrams.push(activeDiagram);
  return {
    format: PROJECT_FORMAT,
    schemaVersion: PROJECT_SCHEMA_VERSION,
    exportedAt: new Date().toISOString(),
    project: context.project ? structuredClone(context.project) : null,
    activeDiagramId: activeDiagram.id ?? null,
    diagram: activeDiagram,
    diagrams,
    modelRepository: context.modelRepository ? structuredClone(context.modelRepository) : null,
    canvas: {
      settings: structuredClone(activeDiagram.metadata ?? {}),
      viewport: validateViewport(context.canvasViewport) ?? { zoom: 1, scrollLeft: 0, scrollTop: 0 }
    }
  };
}

export function serializeProjectSnapshot(diagram, context) {
  return JSON.stringify(createProjectSnapshot(diagram, context), null, 2);
}

export function parseProjectSnapshot(text) {
  let value;
  try {
    value = JSON.parse(text);
  } catch {
    throw new Error("The selected file is not valid JSON.");
  }
  requireRecord(value, "Import file");

  if (value.format !== undefined && ![PROJECT_FORMAT, "sysml-studio-project"].includes(value.format)) throw new Error(`Unsupported file format "${value.format}".`);
  if (value.schemaVersion !== undefined && ![2, PROJECT_SCHEMA_VERSION].includes(value.schemaVersion)) {
    throw new Error(`Unsupported schema version "${value.schemaVersion}".`);
  }

  // Version 2 and unversioned diagram exports remain readable for backwards compatibility.
  const diagrams = value.diagrams ?? (value.diagram ? [value.diagram] : [value]);
  if (!Array.isArray(diagrams) || !diagrams.length) throw new Error("The file does not contain a diagram.");
  const validatedDiagrams = diagrams.map(validateDiagramSnapshot);
  const activeDiagram = value.diagram
    ? validateDiagramSnapshot(value.diagram)
    : validatedDiagrams.find((diagram) => diagram.id === value.activeDiagramId) ?? validatedDiagrams[0];
  const viewport = validateViewport(value.canvas?.viewport ?? value.canvasViewport);

  return { diagram: activeDiagram, diagrams: validatedDiagrams, viewport, schemaVersion: value.schemaVersion ?? 1 };
}
