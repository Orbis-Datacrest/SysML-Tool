import { pointAlongRoute, relationshipRoute, routeToPath } from "../../diagram-canvas/src/connector-routing.js";
import { circleKinds, compartmentDefinitionsFor, diamondKinds, ellipseKinds, noteKinds, packageKinds, roundedKinds } from "../../diagram-canvas/src/config/canvasConfig.js";
import { nodeLabel } from "../../diagram-canvas/src/editing/elementFactory.js";
import { parseProjectSnapshot, serializeProjectSnapshot } from "./projectFormat.js";

const xml = (value = "") => String(value).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&apos;" })[c]);
const pdfText = (value = "") => String(value).replace(/[^\x20-\x7e]/g, "?").replace(/[\\()]/g, "\\$&");
const defaults = { fillColor: "#d7eadb", borderColor: "#26351f", borderWidth: 1, textColor: "#102016", textSize: 13, fontFamily: "Arial" };

export function diagramBounds(diagram, padding = 32) {
  const nodes = diagram.elements ?? [];
  if (!nodes.length) return { x: 0, y: 0, width: 640, height: 480 };
  const routePoints = (diagram.relationships ?? []).flatMap((relationship) => relationshipRoute(relationship, nodes));
  const left = Math.min(...nodes.map((item) => item.x), ...routePoints.map((point) => point.x)) - padding;
  const top = Math.min(...nodes.map((item) => item.y), ...routePoints.map((point) => point.y)) - padding;
  const right = Math.max(...nodes.map((item) => item.x + item.width), ...routePoints.map((point) => point.x)) + padding;
  const bottom = Math.max(...nodes.map((item) => item.y + item.height), ...routePoints.map((point) => point.y)) + padding;
  return { x: left, y: top, width: Math.max(1, right - left), height: Math.max(1, bottom - top) };
}

const lineText = (x, y, value, attributes = "") => `<text x="${x}" y="${y}" ${attributes}>${xml(value)}</text>`;
const multiline = (x, y, value, lineHeight = 17, attributes = "") => String(value ?? "").split(/\r?\n/).map((line, index) => lineText(x, y + index * lineHeight, line, attributes)).join("");

function svgNode(node) {
  const style = { ...defaults, ...(node.style ?? {}) };
  const { x, y, width: w, height: h } = node; const cx = x + w / 2; const cy = y + h / 2;
  const stroke = `fill="${style.fillColor}" stroke="${style.borderColor}" stroke-width="${style.borderWidth}"`;
  const centeredName = (baseline = cy + 5) => multiline(cx, baseline, node.name, style.textSize * 1.3, 'text-anchor="middle" font-weight="700"');
  let shape = ""; let content = "";
  if (node.kind === "actor") {
    const scale = Math.min(w / 100, Math.max(0.45, (h - 24) / 126));
    shape = `<g transform="translate(${cx - 50 * scale} ${y}) scale(${scale})" fill="none" stroke="${style.borderColor}" stroke-width="4"><circle cx="50" cy="20" r="17"/><path d="M50 37v50M18 51h64M50 87 19 123M50 87l31 36"/></g>`;
    content = centeredName(y + h - 3);
  } else if (diamondKinds.has(node.kind) || node.kind === "nary-association") {
    shape = `<path d="M${cx} ${y + 5} L${x + w - 8} ${cy} L${cx} ${y + h - 5} L${x + 8} ${cy} Z" ${stroke}/>`; content = centeredName();
  } else if (circleKinds.has(node.kind)) {
    const radius = Math.max(4, Math.min(w, h) / 2 - 5); shape = `<circle cx="${cx}" cy="${cy}" r="${radius}" ${stroke}/>${node.kind.startsWith("final") || node.kind === "activity-final" ? `<circle cx="${cx}" cy="${cy}" r="${Math.max(2, radius - 6)}" fill="${style.borderColor}"/>` : ""}`; content = node.name ? centeredName(y + h + style.textSize + 5) : "";
  } else if (["fork-join", "fork-node", "join-node"].includes(node.kind)) {
    shape = `<rect x="${x}" y="${cy - 4}" width="${w}" height="8" rx="2" fill="${style.borderColor}"/>`; content = node.name ? centeredName(y + h + style.textSize + 5) : "";
  } else if (ellipseKinds.has(node.kind)) {
    shape = `<ellipse cx="${cx}" cy="${cy}" rx="${w / 2}" ry="${h / 2}" ${stroke}/>`; content = centeredName();
  } else if (roundedKinds.has(node.kind)) {
    shape = `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="18" ${stroke}/>`; content = `${centeredName(cy)}${lineText(cx, cy + 18, nodeLabel(node.kind), 'text-anchor="middle" font-size="10"')}`;
  } else if (noteKinds.has(node.kind)) {
    shape = `<path d="M${x} ${y} H${x + w - 18} L${x + w} ${y + 18} V${y + h} H${x} Z M${x + w - 18} ${y} V${y + 18} H${x + w}" ${stroke}/>`; content = multiline(x + 10, y + 24, node.name, style.textSize * 1.35);
  } else if (packageKinds.has(node.kind)) {
    shape = `<path d="M${x} ${y + 14} H${x + w * .42} L${x + w * .5} ${y + 28} H${x + w} V${y + h} H${x} Z" ${stroke}/>`; content = `${centeredName(cy)}${lineText(cx, cy + 18, `«${nodeLabel(node.kind)}»`, 'text-anchor="middle" font-size="10"')}`;
  } else if (node.kind === "text-label" || node.kind.startsWith("symbol-")) {
    content = centeredName();
  } else {
    const radius = node.kind === "component" ? 2 : 3;
    shape = `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${radius}" ${stroke}/>`;
    if (node.kind === "component") shape += `<rect x="${x - 8}" y="${y + 20}" width="22" height="12" ${stroke}/><rect x="${x - 8}" y="${y + 42}" width="22" height="12" ${stroke}/>`;
    const definitions = node.kind === "requirement"
      ? [{ key: "requirementId", label: "id", value: node.properties?.requirementId ?? node.id }, { key: "text", label: "text", value: node.properties?.text ?? "" }, { key: "verification", label: "verification", value: [node.properties?.verificationMethod, node.properties?.verificationStatus].filter(Boolean).join(" / ") }, ...Object.entries(node.properties ?? {}).filter(([key, value]) => !["requirementId", "text"].includes(key) && Array.isArray(value) && value.length).map(([key, value]) => ({ key, label: key, value: value.join("\n") }))]
      : node.kind === "interface-block" || node.kind === "interface-definition"
        ? [{ label: "protocols", value: (node.properties?.protocols ?? []).join(", ") }, { label: "signals", value: (node.properties?.signals ?? []).join(", ") }, { label: "limits", value: [node.properties?.voltage ? `${node.properties.voltage} V` : "", node.properties?.current ? `${node.properties.current} A` : "", node.properties?.bandwidth ? `${node.properties.bandwidth} bps` : ""].filter(Boolean).join(" · ") }]
        : compartmentDefinitionsFor(node).map(({ key, label }) => ({ key, label, value: Array.isArray(node.properties?.[key]) ? node.properties[key].join("\n") : node.properties?.[key] ?? "" })).filter(({ key }) => !node.properties?.collapsedCompartments?.[key]);
    const titleHeight = Math.min(48, Math.max(36, h * .3));
    content = `${multiline(cx, y + 18, node.name, style.textSize * 1.25, 'text-anchor="middle" font-weight="800"')}${lineText(cx, y + 34, node.kind === "requirement" ? "«requirement»" : `«${nodeLabel(node.kind)}»`, 'text-anchor="middle" font-size="10"')}`;
    if (definitions.length) {
      const sectionHeight = (h - titleHeight) / definitions.length; shape += `<path d="M${x} ${y + titleHeight} H${x + w}" fill="none" stroke="${style.borderColor}" stroke-width="${style.borderWidth}"/>`;
      definitions.forEach(({ label, value }, index) => { const top = y + titleHeight + sectionHeight * index; if (index) shape += `<path d="M${x} ${top} H${x + w}" fill="none" stroke="${style.borderColor}" stroke-width="${style.borderWidth}"/>`; content += `${lineText(x + 8, top + 13, label, 'font-size="9" font-weight="700" text-transform="uppercase"')}${multiline(x + 8, top + 30, value, style.textSize * 1.35)}`; });
    }
  }
  const fontWeight = String(style.textStyle).includes("bold") ? 700 : 400; const fontStyle = String(style.textStyle).includes("italic") ? "italic" : "normal";
  return `<g font-family="${xml(style.fontFamily)}" font-size="${style.textSize}" font-weight="${fontWeight}" font-style="${fontStyle}" fill="${style.textColor}">${shape}${content}</g>`;
}

export function toSvg(diagram) {
  const bounds = diagramBounds(diagram);
  const relationships = (diagram.relationships ?? []).map((relationship) => {
    const points = relationshipRoute(relationship, diagram.elements ?? []);
    const position = pointAlongRoute(points); const style = { color: "#526173", width: 2, ...(relationship.style ?? {}) };
    const labels = [relationship.label, relationship.roleLabel, relationship.multiplicity].filter(Boolean).join("  ");
    const decoration = { generalization: "triangle", realization: "triangle", composition: "diamond-filled", aggregation: "diamond", dependency: "arrow", satisfy: "arrow", verify: "arrow", trace: "arrow", refine: "arrow", "derive-reqt": "arrow", "directional-association": "arrow", "control-flow": "arrow", "object-flow": "arrow", transition: "arrow", "item-flow": "arrow" }[relationship.kind];
    return `<g><path d="${routeToPath(points)}" fill="none" stroke="${style.color}" stroke-width="${style.width}" stroke-linejoin="round" stroke-linecap="round" ${["dependency", "realization", "satisfy", "verify", "trace", "refine", "derive-reqt"].includes(relationship.kind) ? 'stroke-dasharray="7 6"' : ""} ${decoration ? `marker-end="url(#export-${decoration})"` : ""}/>${labels ? `<text x="${position.x}" y="${position.y - 7}" text-anchor="middle" font-family="Arial" font-size="12" fill="${style.color}" paint-order="stroke" stroke="#fff" stroke-width="4">${xml(labels)}</text>` : ""}</g>`;
  }).join("");
  const markers = `<defs><marker id="export-arrow" viewBox="0 0 12 12" markerWidth="12" markerHeight="12" refX="10" refY="6" orient="auto" markerUnits="userSpaceOnUse"><path d="M2 1L10 6L2 11" fill="none" stroke="context-stroke" stroke-width="1.5"/></marker><marker id="export-triangle" viewBox="0 0 14 14" markerWidth="14" markerHeight="14" refX="12" refY="7" orient="auto" markerUnits="userSpaceOnUse"><path d="M1.5 1.5L12 7L1.5 12.5Z" fill="#fff" stroke="context-stroke" stroke-width="1.5"/></marker><marker id="export-diamond" viewBox="0 0 16 12" markerWidth="16" markerHeight="12" refX="15" refY="6" orient="auto" markerUnits="userSpaceOnUse"><path d="M1 6L8 1L15 6L8 11Z" fill="#fff" stroke="context-stroke"/></marker><marker id="export-diamond-filled" viewBox="0 0 16 12" markerWidth="16" markerHeight="12" refX="15" refY="6" orient="auto" markerUnits="userSpaceOnUse"><path d="M1 6L8 1L15 6L8 11Z" fill="context-stroke" stroke="context-stroke"/></marker></defs>`;
  return `<?xml version="1.0" encoding="UTF-8"?><svg xmlns="http://www.w3.org/2000/svg" width="${bounds.width}" height="${bounds.height}" viewBox="${bounds.x} ${bounds.y} ${bounds.width} ${bounds.height}"><rect x="${bounds.x}" y="${bounds.y}" width="${bounds.width}" height="${bounds.height}" fill="#ffffff"/>${markers}${relationships}${(diagram.elements ?? []).map(svgNode).join("")}</svg>`;
}

export function toPlantUml(diagram) {
  const safeId = (id) => `n_${String(id).replace(/[^a-zA-Z0-9_]/g, "_")}`;
  const lines = ["@startuml", "skinparam linetype ortho", "skinparam shadowing false"];
  for (const node of diagram.elements ?? []) {
    const keyword = node.kind === "requirement" ? "class" : (["class", "interface", "component", "package", "actor", "usecase"].includes(node.kind) ? node.kind : "class");
    lines.push(`${keyword} "${String(node.name).replace(/"/g, "\\\"")}" as ${safeId(node.id)} <<${node.kind}>>`);
  }
  for (const rel of diagram.relationships ?? []) {
    const arrow = rel.kind === "generalization" ? "--|>" : rel.kind === "composition" ? "*--" : rel.kind === "aggregation" ? "o--" : rel.kind === "dependency" ? "..>" : "-->";
    const left = rel.sourceMultiplicity ? ` "${rel.sourceMultiplicity}"` : ""; const right = rel.multiplicity ? ` "${rel.multiplicity}"` : "";
    const label = [rel.label, rel.roleLabel].filter(Boolean).join(" / ");
    lines.push(`${safeId(rel.source_id)}${left} ${arrow}${right} ${safeId(rel.target_id)}${label ? ` : ${label}` : ""}`);
  }
  lines.push("@enduml"); return lines.join("\n");
}

export function requirementsRows(diagram) {
  return (diagram.elements ?? []).filter((item) => item.kind === "requirement").map((item) => ({
    id: item.properties?.requirementId ?? item.id, name: item.name, text: item.properties?.text ?? "", owner: item.properties?.owner ?? "",
    verificationMethod: item.properties?.verificationMethod ?? "", approvalStatus: item.properties?.approvalStatus ?? "", risk: item.properties?.risk ?? "", priority: item.properties?.priority ?? ""
  }));
}

export function toRequirementsCsv(diagram) {
  const rows = requirementsRows(diagram); const headers = ["id", "name", "text", "owner", "verificationMethod", "approvalStatus", "risk", "priority"];
  const quote = (value) => `"${String(value ?? "").replace(/"/g, '""')}"`;
  return `\uFEFF${[headers, ...rows.map((row) => headers.map((header) => row[header]))].map((row) => row.map(quote).join(",")).join("\r\n")}`;
}

function crc32(bytes) { let crc = -1; for (const byte of bytes) { crc ^= byte; for (let i = 0; i < 8; i += 1) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1)); } return (crc ^ -1) >>> 0; }
const u16 = (n) => [n & 255, (n >>> 8) & 255]; const u32 = (n) => [...u16(n), ...u16(n >>> 16)];
function zip(files) {
  const encoder = new TextEncoder(); const body = []; const directory = [];
  for (const [name, contents] of files) {
    const filename = encoder.encode(name); const data = encoder.encode(contents); const crc = crc32(data); const offset = body.length;
    body.push(...u32(0x04034b50), ...u16(20), ...u16(0), ...u16(0), ...u16(0), ...u16(0), ...u32(crc), ...u32(data.length), ...u32(data.length), ...u16(filename.length), ...u16(0), ...filename, ...data);
    directory.push(...u32(0x02014b50), ...u16(20), ...u16(20), ...u16(0), ...u16(0), ...u16(0), ...u16(0), ...u32(crc), ...u32(data.length), ...u32(data.length), ...u16(filename.length), ...u16(0), ...u16(0), ...u16(0), ...u16(0), ...u32(0), ...u32(offset), ...filename);
  }
  const start = body.length; return new Uint8Array([...body, ...directory, ...u32(0x06054b50), ...u16(0), ...u16(0), ...u16(files.length), ...u16(files.length), ...u32(directory.length), ...u32(start), ...u16(0)]);
}

export function toRequirementsXlsx(diagram) {
  const headers = ["ID", "Name", "Text", "Owner", "Verification Method", "Approval Status", "Risk", "Priority"];
  const data = requirementsRows(diagram).map(Object.values); const cell = (value, column, row) => `<c r="${column}${row}" t="inlineStr"><is><t>${xml(value)}</t></is></c>`;
  const column = (index) => String.fromCharCode(65 + index);
  const sheet = `<?xml version="1.0"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>${[headers, ...data].map((row, ri) => `<row r="${ri + 1}">${row.map((value, ci) => cell(value, column(ci), ri + 1)).join("")}</row>`).join("")}</sheetData></worksheet>`;
  return zip([["[Content_Types].xml", `<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/></Types>`], ["_rels/.rels", `<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`], ["xl/workbook.xml", `<?xml version="1.0"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Requirements" sheetId="1" r:id="rId1"/></sheets></workbook>`], ["xl/_rels/workbook.xml.rels", `<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/></Relationships>`], ["xl/worksheets/sheet1.xml", sheet]]);
}

export function toVectorPdf(diagram) {
  const bounds = diagramBounds(diagram); const scale = Math.min(1, 760 / bounds.width, 540 / bounds.height); const width = bounds.width * scale + 36; const height = bounds.height * scale + 36;
  const tx = (x) => 18 + (x - bounds.x) * scale; const ty = (y) => height - 18 - (y - bounds.y) * scale; const commands = ["1 1 1 rg 0 0 " + width + " " + height + " re f"];
  const color = (hex) => { const value = String(hex).replace("#", ""); return [0, 2, 4].map((i) => parseInt(value.slice(i, i + 2), 16) / 255).map((n) => n.toFixed(3)).join(" "); };
  for (const rel of diagram.relationships ?? []) {
    const points = relationshipRoute(rel, diagram.elements ?? []); const style = { color: "#526173", width: 2, ...(rel.style ?? {}) }; if (!points.length) continue;
    commands.push(`${color(style.color)} RG ${style.width * scale} w ${tx(points[0].x)} ${ty(points[0].y)} m ${points.slice(1).map((p) => `${tx(p.x)} ${ty(p.y)} l`).join(" ")} S`);
    const label = [rel.label, rel.roleLabel, rel.multiplicity].filter(Boolean).join("  "); const labelPoint = pointAlongRoute(points, rel.labelPosition ?? .5);
    if (label) commands.push(`BT /F1 ${12 * scale} Tf ${color(style.color)} rg ${tx(labelPoint.x - label.length * 3)} ${ty(labelPoint.y - 7)} Td (${pdfText(label)}) Tj ET`);
  }
  for (const node of diagram.elements ?? []) {
    const style = { ...defaults, ...(node.style ?? {}) }; const textSize = style.textSize * scale; const textColor = color(style.textColor);
    commands.push(`${color(style.fillColor)} rg ${color(style.borderColor)} RG ${style.borderWidth * scale} w ${tx(node.x)} ${ty(node.y + node.height)} ${node.width * scale} ${node.height * scale} re B`, `BT /F2 ${textSize} Tf ${textColor} rg ${tx(node.x + 8)} ${ty(node.y + 20)} Td (${pdfText(node.name)}) Tj ET`);
    const stereotype = node.kind === "requirement" ? "<<requirement>>" : `<<${nodeLabel(node.kind)}>>`;
    commands.push(`BT /F1 ${10 * scale} Tf ${textColor} rg ${tx(node.x + 8)} ${ty(node.y + 36)} Td (${pdfText(stereotype)}) Tj ET`);
    const sections = compartmentDefinitionsFor(node).map(({ key, label }) => ({ label, value: node.properties?.[key] })).filter(({ value }) => Array.isArray(value) ? value.length : String(value ?? "").length);
    if (node.kind === "requirement") sections.unshift({ label: "text", value: node.properties?.text ?? "" }, { label: "id", value: node.properties?.requirementId ?? node.id });
    let offset = 54;
    for (const section of sections) {
      commands.push(`${color(style.borderColor)} RG ${tx(node.x)} ${ty(node.y + offset - 8)} m ${tx(node.x + node.width)} ${ty(node.y + offset - 8)} l S`, `BT /F2 ${9 * scale} Tf ${textColor} rg ${tx(node.x + 8)} ${ty(node.y + offset)} Td (${pdfText(section.label)}) Tj ET`);
      const values = (Array.isArray(section.value) ? section.value : String(section.value).split(/\r?\n/));
      for (const value of values) { offset += 15; if (offset > node.height - 5) break; commands.push(`BT /F1 ${textSize} Tf ${textColor} rg ${tx(node.x + 8)} ${ty(node.y + offset)} Td (${pdfText(value)}) Tj ET`); }
      offset += 8; if (offset > node.height - 5) break;
    }
  }
  const stream = commands.join("\n"); const objects = ["<</Type/Catalog/Pages 2 0 R>>", "<</Type/Pages/Count 1/Kids[3 0 R]>>", `<</Type/Page/Parent 2 0 R/MediaBox[0 0 ${width} ${height}]/Resources<</Font<</F1 5 0 R/F2 6 0 R>>>>/Contents 4 0 R>>`, `<</Length ${stream.length}>>stream\n${stream}\nendstream`, "<</Type/Font/Subtype/Type1/BaseFont/Helvetica>>", "<</Type/Font/Subtype/Type1/BaseFont/Helvetica-Bold>>"];
  let output = "%PDF-1.4\n"; const offsets = [0]; objects.forEach((object, index) => { offsets.push(output.length); output += `${index + 1} 0 obj\n${object}\nendobj\n`; }); const xref = output.length; output += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets.slice(1).map((offset) => `${String(offset).padStart(10, "0")} 00000 n `).join("\n")}\ntrailer<</Size ${objects.length + 1}/Root 1 0 R>>\nstartxref\n${xref}\n%%EOF`;
  return new TextEncoder().encode(output);
}

export const exporters = new Map([
  ["svg", { extension: "svg", mime: "image/svg+xml", serialize: toSvg }], ["plantuml", { extension: "puml", mime: "text/plain", serialize: toPlantUml }],
  ["json", { extension: "json", mime: "application/json", serialize: serializeProjectSnapshot }],
  ["csv", { extension: "csv", mime: "text/csv;charset=utf-8", serialize: toRequirementsCsv }], ["xlsx", { extension: "xlsx", mime: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", serialize: toRequirementsXlsx }],
  ["pdf", { extension: "pdf", mime: "application/pdf", serialize: toVectorPdf }]
]);

export const importers = new Map([["json", { parse: parseProjectSnapshot }]]);
