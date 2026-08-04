import { rectanglesOverlap } from "./diagramLayout.js";
export function analyzeLayoutQuality(elements = [], relationships = []) {
  let overlaps = 0; for (let a = 0; a < elements.length; a += 1) for (let b = a + 1; b < elements.length; b += 1) if (rectanglesOverlap(elements[a], elements[b], 12)) overlaps += 1;
  const connectedIds = new Set(relationships.flatMap(({ source_id, target_id }) => [source_id, target_id]));
  const hierarchyKinds = new Set(["generalization", "realization", "containment", "composition", "aggregation", "derive-reqt", "satisfy", "verify"]);
  const hierarchical = relationships.filter(({ kind }) => hierarchyKinds.has(kind)).length; const xs = new Set(elements.map(({ x }) => Math.round(x / 20))); const ys = new Set(elements.map(({ y }) => Math.round(y / 20)));
  return { element_count: elements.length, relationship_count: relationships.length, overlapping_pairs: overlaps, disconnected_elements: elements.filter(({ id }) => !connectedIds.has(id)).length, aligned_x_columns: xs.size, aligned_y_rows: ys.size, suggested_direction: hierarchical > relationships.length / 3 || ys.size < xs.size ? "top-to-bottom" : "left-to-right", requires_repair: overlaps > 0 };
}
