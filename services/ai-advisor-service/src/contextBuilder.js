const cloneData = (value) => value === undefined ? undefined : JSON.parse(JSON.stringify(value));
const semanticElement = (item) => ({ id: item.id, kind: item.kind, name: item.name, variant: item.variant, properties: cloneData(item.properties ?? item.semantic ?? {}), stereotypes: cloneData(item.stereotypes ?? []) });
const semanticRelationship = (item) => ({ id: item.id, kind: item.kind, source_id: item.source_id, target_id: item.target_id, label: item.label ?? "", properties: cloneData(item.properties ?? item.semantic ?? {}), stereotypes: cloneData(item.stereotypes ?? []) });

const historyTurn = (item) => ({
  role: item?.role === "assistant" ? "assistant" : "user",
  text: String(item?.text ?? "").trim().slice(0, 2000)
});

export function buildAiContext({ task, prompt, diagram, selectedElementIds = [], repository = {}, validation = {}, history = [] }) {
  const selected = new Set(selectedElementIds.filter((id) => diagram.elements.some((item) => item.id === id)));
  return Object.freeze({
    task: task === "review" ? "review" : "generate",
    request: String(prompt ?? "").trim().slice(0, 6000),
    conversation_history: history.slice(-10).map(historyTurn),
    diagram: {
      id: diagram.id, type: diagram.type, name: diagram.name, version: diagram.version,
      elements: diagram.elements.slice(0, 500).map(semanticElement),
      relationships: diagram.relationships.slice(0, 750).map(semanticRelationship)
    },
    selection: diagram.elements.filter((item) => selected.has(item.id)).map(semanticElement),
    repository: {
      elements: (repository.elements ?? []).slice(0, 1000).map(semanticElement),
      relationships: (repository.relationships ?? []).slice(0, 1500).map(semanticRelationship)
    },
    deterministic_validation: cloneData(validation)
  });
}
