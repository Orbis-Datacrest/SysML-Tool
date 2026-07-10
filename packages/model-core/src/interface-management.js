export const interfaceCategories = Object.freeze(["electrical", "mechanical", "software"]);
export const interfaceConnectionKinds = Object.freeze(["connector", "item-flow"]);
export const portKinds = Object.freeze(["port", "proxy-port", "full-port"]);

function semanticOf(item) {
  return item?.semantic ?? item?.properties ?? {};
}

function asArray(value) {
  if (value === undefined || value === null || value === "") return [];
  return Array.isArray(value) ? value : [value];
}

function toNumber(value) {
  if (value === undefined || value === null || value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function rangeOf(value, fallbackUnit) {
  if (value === undefined || value === null || value === "") return null;
  if (typeof value === "number") return { min: value, max: value, unit: fallbackUnit };
  if (typeof value === "object") {
    const nominal = toNumber(value.nominal ?? value.value);
    return {
      min: toNumber(value.min) ?? nominal,
      max: toNumber(value.max) ?? nominal,
      unit: value.unit ?? fallbackUnit
    };
  }
  const number = toNumber(value);
  return number === null ? null : { min: number, max: number, unit: fallbackUnit };
}

function rangesOverlap(left, right) {
  if (!left || !right) return true;
  if (left.unit && right.unit && left.unit !== right.unit) return false;
  if (left.min === null || left.max === null || right.min === null || right.max === null) return true;
  return Math.max(left.min, right.min) <= Math.min(left.max, right.max);
}

function capacityCovers(provider, consumer) {
  const providerValue = toNumber(provider);
  const consumerValue = toNumber(consumer);
  if (providerValue === null || consumerValue === null) return true;
  return providerValue >= consumerValue;
}

function overlap(left, right) {
  const leftValues = asArray(left).map(String).filter(Boolean);
  const rightValues = asArray(right).map(String).filter(Boolean);
  if (!leftValues.length || !rightValues.length) return true;
  return leftValues.some((value) => rightValues.includes(value));
}

function interfaceName(item) {
  return semanticOf(item).interfaceId ?? semanticOf(item).interfaceType ?? item?.name ?? item?.id;
}

export function createInterfaceDefinition(input = {}) {
  const id = input.id ?? `interface_${Math.random().toString(36).slice(2, 10)}`;
  const category = input.category ?? input.interfaceKind ?? "software";
  return {
    id,
    kind: input.kind ?? "interface-block",
    name: input.name ?? id,
    owner_id: input.owner_id ?? null,
    package_id: input.package_id ?? null,
    semantic: {
      interfaceId: input.interfaceId ?? id,
      interfaceKind: category,
      signals: asArray(input.signals),
      commands: asArray(input.commands),
      protocols: asArray(input.protocols),
      pins: asArray(input.pins),
      connector: input.connector ?? "",
      pinAssignments: input.pinAssignments ?? {},
      voltage: input.voltage ?? null,
      current: input.current ?? null,
      frequency: input.frequency ?? null,
      bandwidth: input.bandwidth ?? null,
      units: input.units ?? {},
      compatibleWith: asArray(input.compatibleWith)
    },
    stereotypes: [...(input.stereotypes ?? ["interfaceBlock"])]
  };
}

export function createInterfaceLibrary(items = []) {
  const definitions = items.map(createInterfaceDefinition);
  return {
    definitions,
    byId: new Map(definitions.map((item) => [item.id, item])),
    byInterfaceId: new Map(definitions.map((item) => [String(interfaceName(item)), item]))
  };
}

export function interfaceLibraryFromRepository(repository) {
  return createInterfaceLibrary((repository?.elements ?? []).filter((element) =>
    ["interface", "interface-block"].includes(element.kind) || interfaceCategories.includes(semanticOf(element).interfaceKind)
  ));
}

export function resolveInterface(portOrInterface, repositoryOrLibrary) {
  if (!portOrInterface) return null;
  if (["interface", "interface-block"].includes(portOrInterface.kind)) return portOrInterface;
  const semantic = semanticOf(portOrInterface);
  const lookup = semantic.interfaceId ?? semantic.interfaceType ?? semantic.type;
  if (!lookup) return null;
  const library = repositoryOrLibrary?.definitions ? repositoryOrLibrary : interfaceLibraryFromRepository(repositoryOrLibrary);
  return library.byId.get(lookup) ?? library.byInterfaceId.get(String(lookup)) ?? null;
}

export function validateInterfaceCompatibility(sourceInterface, targetInterface) {
  const diagnostics = [];
  if (!sourceInterface || !targetInterface) return { compatible: true, diagnostics };
  const source = semanticOf(sourceInterface);
  const target = semanticOf(targetInterface);
  const sourceKind = source.interfaceKind ?? source.category ?? "software";
  const targetKind = target.interfaceKind ?? target.category ?? "software";
  const sourceCompatible = asArray(source.compatibleWith);
  const targetCompatible = asArray(target.compatibleWith);
  const explicitlyCompatible = sourceCompatible.includes(targetInterface.id) || sourceCompatible.includes(interfaceName(targetInterface))
    || targetCompatible.includes(sourceInterface.id) || targetCompatible.includes(interfaceName(sourceInterface));

  if (sourceKind !== targetKind && !explicitlyCompatible) diagnostics.push(`Interface categories differ: ${sourceKind} cannot connect to ${targetKind}.`);
  if (!overlap(source.protocols, target.protocols)) diagnostics.push("Interfaces do not share a protocol.");
  if (!overlap(source.signals, target.signals)) diagnostics.push("Interfaces do not share compatible signals.");
  if (!overlap(source.commands, target.commands)) diagnostics.push("Interfaces do not share compatible commands.");
  if (!rangesOverlap(rangeOf(source.voltage, source.units?.voltage ?? "V"), rangeOf(target.voltage, target.units?.voltage ?? "V"))) diagnostics.push("Voltage ranges are incompatible.");
  if (!rangesOverlap(rangeOf(source.current, source.units?.current ?? "A"), rangeOf(target.current, target.units?.current ?? "A"))) diagnostics.push("Current ranges are incompatible.");
  if (!rangesOverlap(rangeOf(source.frequency, source.units?.frequency ?? "Hz"), rangeOf(target.frequency, target.units?.frequency ?? "Hz"))) diagnostics.push("Frequency ranges are incompatible.");
  if (!capacityCovers(source.bandwidth, target.bandwidth) && !capacityCovers(target.bandwidth, source.bandwidth)) diagnostics.push("Bandwidth capacities are incompatible.");
  if (source.connector && target.connector && source.connector !== target.connector && !explicitlyCompatible) diagnostics.push("Mechanical connector types are incompatible.");

  const sourcePins = asArray(source.pins);
  const targetPins = asArray(target.pins);
  if (sourcePins.length && targetPins.length && sourcePins.length !== targetPins.length) diagnostics.push("Connector pin counts differ.");

  return { compatible: diagnostics.length === 0, diagnostics };
}

export function validateInterfaceConnection(relationship, repository) {
  const elements = repository?.elements ?? [];
  const byId = new Map(elements.map((element) => [element.id, element]));
  const source = byId.get(relationship.source_id);
  const target = byId.get(relationship.target_id);
  const diagnostics = [];
  if (!source) diagnostics.push(`Missing source ${relationship.source_id}.`);
  if (!target) diagnostics.push(`Missing target ${relationship.target_id}.`);
  if (diagnostics.length) return { status: "invalid", diagnostics, compatible: false };
  if (!interfaceConnectionKinds.includes(relationship.kind) || !portKinds.includes(source.kind) || !portKinds.includes(target.kind)) return { status: "unchecked", diagnostics: [], compatible: true };

  const sourceInterface = resolveInterface(source, repository);
  const targetInterface = resolveInterface(target, repository);
  if (!sourceInterface) diagnostics.push(`${source.name || source.id} does not reference a reusable interface definition.`);
  if (!targetInterface) diagnostics.push(`${target.name || target.id} does not reference a reusable interface definition.`);
  const compatibility = validateInterfaceCompatibility(sourceInterface, targetInterface);
  diagnostics.push(...compatibility.diagnostics);
  return { status: diagnostics.length ? "invalid" : "valid", diagnostics, compatible: diagnostics.length === 0 };
}
