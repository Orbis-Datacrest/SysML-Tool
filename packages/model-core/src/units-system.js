const DIMENSION_KEYS = Object.freeze(["L", "M", "T", "I", "Theta", "N", "J"]);

const ZERO_DIMENSION = Object.freeze(Object.fromEntries(DIMENSION_KEYS.map((key) => [key, 0])));

function dimension(input = {}) {
  return Object.fromEntries(DIMENSION_KEYS.map((key) => [key, Number(input[key] ?? 0)]));
}

function sameDimension(left = ZERO_DIMENSION, right = ZERO_DIMENSION) {
  return DIMENSION_KEYS.every((key) => Number(left[key] ?? 0) === Number(right[key] ?? 0));
}

function dimensionKey(value = ZERO_DIMENSION) {
  return DIMENSION_KEYS.map((key) => `${key}:${Number(value[key] ?? 0)}`).join("|");
}

export const quantityKinds = Object.freeze({
  dimensionless: { name: "Dimensionless", dimension: dimension({}) },
  length: { name: "Length", dimension: dimension({ L: 1 }) },
  mass: { name: "Mass", dimension: dimension({ M: 1 }) },
  time: { name: "Time", dimension: dimension({ T: 1 }) },
  electricCurrent: { name: "Electric Current", dimension: dimension({ I: 1 }) },
  thermodynamicTemperature: { name: "Thermodynamic Temperature", dimension: dimension({ Theta: 1 }) },
  amountOfSubstance: { name: "Amount Of Substance", dimension: dimension({ N: 1 }) },
  luminousIntensity: { name: "Luminous Intensity", dimension: dimension({ J: 1 }) },
  area: { name: "Area", dimension: dimension({ L: 2 }) },
  volume: { name: "Volume", dimension: dimension({ L: 3 }) },
  velocity: { name: "Velocity", dimension: dimension({ L: 1, T: -1 }) },
  acceleration: { name: "Acceleration", dimension: dimension({ L: 1, T: -2 }) },
  force: { name: "Force", dimension: dimension({ L: 1, M: 1, T: -2 }) },
  pressure: { name: "Pressure", dimension: dimension({ L: -1, M: 1, T: -2 }) },
  energy: { name: "Energy", dimension: dimension({ L: 2, M: 1, T: -2 }) },
  power: { name: "Power", dimension: dimension({ L: 2, M: 1, T: -3 }) },
  frequency: { name: "Frequency", dimension: dimension({ T: -1 }) },
  electricCharge: { name: "Electric Charge", dimension: dimension({ T: 1, I: 1 }) },
  voltage: { name: "Voltage", dimension: dimension({ L: 2, M: 1, T: -3, I: -1 }) },
  capacitance: { name: "Capacitance", dimension: dimension({ L: -2, M: -1, T: 4, I: 2 }) },
  resistance: { name: "Resistance", dimension: dimension({ L: 2, M: 1, T: -3, I: -2 }) },
  conductance: { name: "Conductance", dimension: dimension({ L: -2, M: -1, T: 3, I: 2 }) },
  magneticFlux: { name: "Magnetic Flux", dimension: dimension({ L: 2, M: 1, T: -2, I: -1 }) },
  magneticFluxDensity: { name: "Magnetic Flux Density", dimension: dimension({ M: 1, T: -2, I: -1 }) },
  inductance: { name: "Inductance", dimension: dimension({ L: 2, M: 1, T: -2, I: -2 }) },
  density: { name: "Density", dimension: dimension({ L: -3, M: 1 }) },
  torque: { name: "Torque", dimension: dimension({ L: 2, M: 1, T: -2 }) },
  dataRate: { name: "Data Rate", dimension: dimension({ T: -1 }) }
});

const quantityKindByDimension = new Map(Object.entries(quantityKinds).map(([id, kind]) => [dimensionKey(kind.dimension), id]));

export const siUnits = Object.freeze({
  "1": { symbol: "1", name: "one", quantityKind: "dimensionless", factor: 1, offset: 0 },
  m: { symbol: "m", name: "metre", quantityKind: "length", factor: 1, offset: 0 },
  mm: { symbol: "mm", name: "millimetre", quantityKind: "length", factor: 0.001, offset: 0 },
  cm: { symbol: "cm", name: "centimetre", quantityKind: "length", factor: 0.01, offset: 0 },
  km: { symbol: "km", name: "kilometre", quantityKind: "length", factor: 1000, offset: 0 },
  kg: { symbol: "kg", name: "kilogram", quantityKind: "mass", factor: 1, offset: 0 },
  g: { symbol: "g", name: "gram", quantityKind: "mass", factor: 0.001, offset: 0 },
  s: { symbol: "s", name: "second", quantityKind: "time", factor: 1, offset: 0 },
  ms: { symbol: "ms", name: "millisecond", quantityKind: "time", factor: 0.001, offset: 0 },
  min: { symbol: "min", name: "minute", quantityKind: "time", factor: 60, offset: 0 },
  h: { symbol: "h", name: "hour", quantityKind: "time", factor: 3600, offset: 0 },
  A: { symbol: "A", name: "ampere", quantityKind: "electricCurrent", factor: 1, offset: 0 },
  K: { symbol: "K", name: "kelvin", quantityKind: "thermodynamicTemperature", factor: 1, offset: 0 },
  "°C": { symbol: "°C", name: "degree Celsius", quantityKind: "thermodynamicTemperature", factor: 1, offset: 273.15 },
  mol: { symbol: "mol", name: "mole", quantityKind: "amountOfSubstance", factor: 1, offset: 0 },
  cd: { symbol: "cd", name: "candela", quantityKind: "luminousIntensity", factor: 1, offset: 0 },
  rad: { symbol: "rad", name: "radian", quantityKind: "dimensionless", factor: 1, offset: 0 },
  sr: { symbol: "sr", name: "steradian", quantityKind: "dimensionless", factor: 1, offset: 0 },
  Hz: { symbol: "Hz", name: "hertz", quantityKind: "frequency", factor: 1, offset: 0 },
  N: { symbol: "N", name: "newton", quantityKind: "force", factor: 1, offset: 0 },
  Pa: { symbol: "Pa", name: "pascal", quantityKind: "pressure", factor: 1, offset: 0 },
  J: { symbol: "J", name: "joule", quantityKind: "energy", factor: 1, offset: 0 },
  W: { symbol: "W", name: "watt", quantityKind: "power", factor: 1, offset: 0 },
  C: { symbol: "C", name: "coulomb", quantityKind: "electricCharge", factor: 1, offset: 0 },
  V: { symbol: "V", name: "volt", quantityKind: "voltage", factor: 1, offset: 0 },
  F: { symbol: "F", name: "farad", quantityKind: "capacitance", factor: 1, offset: 0 },
  ohm: { symbol: "ohm", name: "ohm", quantityKind: "resistance", factor: 1, offset: 0 },
  S: { symbol: "S", name: "siemens", quantityKind: "conductance", factor: 1, offset: 0 },
  Wb: { symbol: "Wb", name: "weber", quantityKind: "magneticFlux", factor: 1, offset: 0 },
  T: { symbol: "T", name: "tesla", quantityKind: "magneticFluxDensity", factor: 1, offset: 0 },
  H: { symbol: "H", name: "henry", quantityKind: "inductance", factor: 1, offset: 0 },
  L: { symbol: "L", name: "litre", quantityKind: "volume", factor: 0.001, offset: 0 },
  "m/s": { symbol: "m/s", name: "metres per second", quantityKind: "velocity", factor: 1, offset: 0 },
  "m/s²": { symbol: "m/s²", name: "metres per second squared", quantityKind: "acceleration", factor: 1, offset: 0 },
  "kg/m³": { symbol: "kg/m³", name: "kilograms per cubic metre", quantityKind: "density", factor: 1, offset: 0 },
  "N·m": { symbol: "N·m", name: "newton metre", quantityKind: "torque", factor: 1, offset: 0 },
  bps: { symbol: "bps", name: "bits per second", quantityKind: "dataRate", factor: 1, offset: 0 },
  kbps: { symbol: "kbps", name: "kilobits per second", quantityKind: "dataRate", factor: 1000, offset: 0 },
  Mbps: { symbol: "Mbps", name: "megabits per second", quantityKind: "dataRate", factor: 1000000, offset: 0 },
  Gbps: { symbol: "Gbps", name: "gigabits per second", quantityKind: "dataRate", factor: 1000000000, offset: 0 }
});

function semanticOf(item) {
  return item?.semantic ?? item?.properties ?? {};
}

function unitFromCustomElement(element) {
  const semantic = semanticOf(element);
  const symbol = semantic.symbol ?? semantic.unitSymbol ?? element.name ?? element.id;
  const quantityKind = semantic.quantityKind ?? semantic.kind ?? semantic.quantity_kind;
  const customDimension = semantic.dimension ? dimension(semantic.dimension) : null;
  return {
    symbol,
    name: semantic.name ?? element.name ?? symbol,
    quantityKind,
    dimension: customDimension ?? quantityKinds[quantityKind]?.dimension,
    factor: Number(semantic.factor ?? semantic.conversionFactor ?? 1),
    offset: Number(semantic.offset ?? 0),
    custom: true
  };
}

export function createUnitRegistry(repositoryOrUnits = {}) {
  const units = new Map(Object.entries(siUnits).map(([symbol, unit]) => [symbol, { ...unit, dimension: quantityKinds[unit.quantityKind].dimension }]));
  const quantityKindMap = new Map(Object.entries(quantityKinds).map(([id, kind]) => [id, { id, ...kind }]));
  const customUnits = Array.isArray(repositoryOrUnits) ? repositoryOrUnits : repositoryOrUnits.units ?? repositoryOrUnits.elements ?? [];

  for (const item of customUnits) {
    if (item.kind === "quantity-kind") {
      const semantic = semanticOf(item);
      const id = semantic.quantityKind ?? semantic.symbol ?? item.id;
      quantityKindMap.set(id, { id, name: item.name ?? id, dimension: dimension(semantic.dimension ?? {}) });
    }
  }
  for (const item of customUnits) {
    if (item.kind !== "unit" && !semanticOf(item).unitSymbol) continue;
    const unit = unitFromCustomElement(item);
    if (!unit.dimension && quantityKindMap.has(unit.quantityKind)) unit.dimension = quantityKindMap.get(unit.quantityKind).dimension;
    units.set(unit.symbol, unit);
    units.set(item.id, unit);
  }
  return { units, quantityKinds: quantityKindMap };
}

export function resolveUnit(unitOrQuantity, registry = createUnitRegistry()) {
  if (!unitOrQuantity) return null;
  if (typeof unitOrQuantity === "object" && unitOrQuantity.symbol) return unitOrQuantity;
  return registry.units.get(String(unitOrQuantity)) ?? null;
}

export function unitsCompatible(leftUnit, rightUnit, registry = createUnitRegistry()) {
  const left = resolveUnit(leftUnit, registry);
  const right = resolveUnit(rightUnit, registry);
  if (!left || !right) return false;
  return sameDimension(left.dimension, right.dimension);
}

export function convertValue(value, fromUnit, toUnit, registry = createUnitRegistry()) {
  const from = resolveUnit(fromUnit, registry);
  const to = resolveUnit(toUnit, registry);
  const numeric = Number(value);
  if (!from || !to) throw new Error(`Unknown unit conversion: ${fromUnit} to ${toUnit}`);
  if (!sameDimension(from.dimension, to.dimension)) throw new Error(`Incompatible unit conversion: ${from.symbol} to ${to.symbol}`);
  if (!Number.isFinite(numeric)) throw new Error(`Value is not numeric: ${value}`);
  const base = (numeric + Number(from.offset ?? 0)) * Number(from.factor ?? 1);
  return base / Number(to.factor ?? 1) - Number(to.offset ?? 0);
}

export function normalizeQuantity(input, registry = createUnitRegistry()) {
  if (input === undefined || input === null || input === "") return null;
  if (typeof input === "number") return { value: input, unit: null, quantityKind: null };
  if (typeof input === "object") {
    const unit = resolveUnit(input.unit, registry);
    const quantityKind = input.quantityKind ?? unit?.quantityKind ?? quantityKindByDimension.get(dimensionKey(unit?.dimension));
    return {
      value: input.value ?? input.default ?? input.nominal ?? null,
      min: input.min ?? null,
      max: input.max ?? null,
      default: input.default ?? input.value ?? input.nominal ?? null,
      unit: unit?.symbol ?? input.unit ?? null,
      quantityKind,
      dimension: input.dimension ? dimension(input.dimension) : unit?.dimension ?? quantityKinds[quantityKind]?.dimension ?? null
    };
  }
  const match = String(input).trim().match(/^(-?\d+(?:\.\d+)?)\s*([^\d\s]+)?$/);
  if (!match) return null;
  const unit = resolveUnit(match[2], registry);
  return { value: Number(match[1]), unit: unit?.symbol ?? match[2] ?? null, quantityKind: unit?.quantityKind ?? null, dimension: unit?.dimension ?? null };
}

export function validateQuantity(value, schema = {}, registry = createUnitRegistry()) {
  const diagnostics = [];
  const quantity = normalizeQuantity(value ?? schema.default, registry);
  if (!quantity && schema.required) diagnostics.push("Quantity is required.");
  if (!quantity) return { valid: diagnostics.length === 0, diagnostics, quantity };
  const expectedKind = schema.quantityKind;
  const expectedUnit = resolveUnit(schema.unit, registry);
  if (quantity.unit && !resolveUnit(quantity.unit, registry)) diagnostics.push(`Unit ${quantity.unit} is not defined.`);
  if (expectedKind && quantity.quantityKind && expectedKind !== quantity.quantityKind) diagnostics.push(`Expected ${expectedKind}, received ${quantity.quantityKind}.`);
  if (expectedUnit && quantity.unit && !unitsCompatible(quantity.unit, expectedUnit.symbol, registry)) diagnostics.push(`Unit ${quantity.unit} is incompatible with ${expectedUnit.symbol}.`);
  const valueInSchemaUnit = expectedUnit && quantity.unit && unitsCompatible(quantity.unit, expectedUnit.symbol, registry)
    ? convertValue(quantity.value, quantity.unit, expectedUnit.symbol, registry)
    : Number(quantity.value);
  if (Number.isFinite(Number(schema.min)) && Number.isFinite(valueInSchemaUnit) && valueInSchemaUnit < Number(schema.min)) diagnostics.push(`Value ${valueInSchemaUnit} ${schema.unit ?? ""} is below minimum ${schema.min}.`);
  if (Number.isFinite(Number(schema.max)) && Number.isFinite(valueInSchemaUnit) && valueInSchemaUnit > Number(schema.max)) diagnostics.push(`Value ${valueInSchemaUnit} ${schema.unit ?? ""} exceeds maximum ${schema.max}.`);
  return { valid: diagnostics.length === 0, diagnostics, quantity: { ...quantity, normalizedValue: valueInSchemaUnit, normalizedUnit: expectedUnit?.symbol ?? quantity.unit } };
}

export function validateQuantityCompatibility(source, target, registry = createUnitRegistry()) {
  const left = normalizeQuantity(source, registry);
  const right = normalizeQuantity(target, registry);
  if (!left || !right) return { compatible: true, diagnostics: [] };
  if (left.quantityKind && right.quantityKind && left.quantityKind !== right.quantityKind && !sameDimension(left.dimension, right.dimension)) {
    return { compatible: false, diagnostics: [`${left.quantityKind} cannot connect to ${right.quantityKind}.`] };
  }
  if (left.unit && right.unit && !unitsCompatible(left.unit, right.unit, registry)) {
    return { compatible: false, diagnostics: [`${left.unit} cannot connect to ${right.unit}.`] };
  }
  return { compatible: true, diagnostics: [] };
}

export function calculateEngineeringValue(operation, left, right, outputUnit, registry = createUnitRegistry()) {
  const a = normalizeQuantity(left, registry);
  const b = normalizeQuantity(right, registry);
  if (!a) throw new Error("Left quantity is required");
  const leftValue = a.unit ? convertValue(a.value, a.unit, a.unit, registry) : Number(a.value);
  if (operation === "convert") return { value: convertValue(a.value, a.unit, outputUnit, registry), unit: outputUnit };
  if (!b) throw new Error("Right quantity is required");
  const rightValue = b.unit ? convertValue(b.value, b.unit, b.unit, registry) : Number(b.value);
  if (operation === "add" || operation === "subtract") {
    if (!validateQuantityCompatibility(a, b, registry).compatible) throw new Error("Cannot add or subtract incompatible quantities");
    const unit = outputUnit ?? a.unit;
    const normalizedRight = b.unit && unit ? convertValue(b.value, b.unit, unit, registry) : rightValue;
    return { value: operation === "add" ? leftValue + normalizedRight : leftValue - normalizedRight, unit };
  }
  if (operation === "multiply") return { value: leftValue * rightValue, unit: outputUnit ?? null };
  if (operation === "divide") return { value: leftValue / rightValue, unit: outputUnit ?? null };
  throw new Error(`Unsupported engineering calculation: ${operation}`);
}

export const supportedUnits = Object.freeze(Object.keys(siUnits));
