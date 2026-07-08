import { pointAlongRoute, relationshipRoute, routeToPath } from "../../diagram-canvas/src/connector-routing.js";

const xml = (value = "") => String(value).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&apos;" })[c]);
const pdfText = (value = "") => String(value).replace(/[^\x20-\x7e]/g, "?").replace(/[\\()]/g, "\\$&");
const defaults = { fillColor: "#d7eadb", borderColor: "#26351f", borderWidth: 1, textColor: "#102016", textSize: 13, fontFamily: "Arial" };

export function diagramBounds(diagram, padding = 32) {
  const nodes = diagram.elements ?? [];
  if (!nodes.length) return { x: 0, y: 0, width: 640, height: 480 };
  const left = Math.min(...nodes.map((item) => item.x)) - padding;
  const top = Math.min(...nodes.map((item) => item.y)) - padding;
  const right = Math.max(...nodes.map((item) => item.x + item.width)) + padding;
  const bottom = Math.max(...nodes.map((item) => item.y + item.height)) + padding;
  return { x: left, y: top, width: Math.max(1, right - left), height: Math.max(1, bottom - top) };
}

function svgNode(node) {
  const style = { ...defaults, ...(node.style ?? {}) };
  const stereotype = (node.stereotypes ?? []).length ? `«${node.stereotypes.join(", ")}»` : `«${node.kind}»`;
  const lines = Object.entries(node.properties ?? {}).filter(([, value]) => Array.isArray(value) && value.length).flatMap(([name, values]) => [name[0].toUpperCase() + name.slice(1), ...values.map(String)]);
  let y = node.y + 20;
  const text = [`<text x="${node.x + node.width / 2}" y="${y}" text-anchor="middle" font-weight="700">${xml(node.name)}</text>`, `<text x="${node.x + node.width / 2}" y="${y + 16}" text-anchor="middle" font-size="10">${xml(stereotype)}</text>`];
  if (lines.length) {
    y += 34; text.push(`<path d="M ${node.x} ${y} H ${node.x + node.width}" fill="none" stroke="${style.borderColor}" stroke-width="${style.borderWidth}"/>`);
    for (const line of lines) { y += 16; if (y < node.y + node.height - 4) text.push(`<text x="${node.x + 8}" y="${y}">${xml(line)}</text>`); }
  }
  const radius = ["activity", "action", "state", "use-case"].includes(node.kind) ? 14 : 2;
  return `<g font-family="${xml(style.fontFamily)}" font-size="${style.textSize}" fill="${style.textColor}"><rect x="${node.x}" y="${node.y}" width="${node.width}" height="${node.height}" rx="${radius}" fill="${style.fillColor}" stroke="${style.borderColor}" stroke-width="${style.borderWidth}"/>${text.join("")}</g>`;
}

export function toSvg(diagram) {
  const bounds = diagramBounds(diagram);
  const relationships = (diagram.relationships ?? []).map((relationship) => {
    const points = relationshipRoute(relationship, diagram.elements ?? []);
    const position = pointAlongRoute(points); const style = { color: "#526173", width: 2, ...(relationship.style ?? {}) };
    const labels = [relationship.label, relationship.roleLabel, relationship.multiplicity].filter(Boolean).join("  ");
    return `<g><path d="${routeToPath(points)}" fill="none" stroke="${style.color}" stroke-width="${style.width}" stroke-linejoin="round" stroke-linecap="round" ${["dependency", "realization", "satisfy", "verify", "trace", "refine"].includes(relationship.kind) ? 'stroke-dasharray="7 6"' : ""}/>${labels ? `<text x="${position.x}" y="${position.y - 7}" text-anchor="middle" font-family="Arial" font-size="12" fill="${style.color}" paint-order="stroke" stroke="#fff" stroke-width="4">${xml(labels)}</text>` : ""}</g>`;
  }).join("");
  return `<?xml version="1.0" encoding="UTF-8"?><svg xmlns="http://www.w3.org/2000/svg" width="${bounds.width}" height="${bounds.height}" viewBox="${bounds.x} ${bounds.y} ${bounds.width} ${bounds.height}"><rect x="${bounds.x}" y="${bounds.y}" width="${bounds.width}" height="${bounds.height}" fill="#ffffff"/>${relationships}${(diagram.elements ?? []).map(svgNode).join("")}</svg>`;
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
  for (const rel of diagram.relationships ?? []) { const points = relationshipRoute(rel, diagram.elements ?? []); const style = { color: "#526173", width: 2, ...(rel.style ?? {}) }; if (!points.length) continue; commands.push(`${color(style.color)} RG ${style.width * scale} w ${tx(points[0].x)} ${ty(points[0].y)} m ${points.slice(1).map((p) => `${tx(p.x)} ${ty(p.y)} l`).join(" ")} S`); }
  for (const node of diagram.elements ?? []) { const style = { ...defaults, ...(node.style ?? {}) }; commands.push(`${color(style.fillColor)} rg ${color(style.borderColor)} RG ${style.borderWidth * scale} w ${tx(node.x)} ${ty(node.y + node.height)} ${node.width * scale} ${node.height * scale} re B`, `BT /F1 ${style.textSize * scale} Tf ${color(style.textColor)} rg ${tx(node.x + 8)} ${ty(node.y + 20)} Td (${pdfText(node.name)}) Tj ET`); }
  const stream = commands.join("\n"); const objects = ["<</Type/Catalog/Pages 2 0 R>>", "<</Type/Pages/Count 1/Kids[3 0 R]>>", `<</Type/Page/Parent 2 0 R/MediaBox[0 0 ${width} ${height}]/Resources<</Font<</F1 5 0 R>>>>/Contents 4 0 R>>`, `<</Length ${stream.length}>>stream\n${stream}\nendstream`, "<</Type/Font/Subtype/Type1/BaseFont/Helvetica>>"];
  let output = "%PDF-1.4\n"; const offsets = [0]; objects.forEach((object, index) => { offsets.push(output.length); output += `${index + 1} 0 obj\n${object}\nendobj\n`; }); const xref = output.length; output += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets.slice(1).map((offset) => `${String(offset).padStart(10, "0")} 00000 n `).join("\n")}\ntrailer<</Size ${objects.length + 1}/Root 1 0 R>>\nstartxref\n${xref}\n%%EOF`;
  return new TextEncoder().encode(output);
}

export const exporters = new Map([
  ["svg", { extension: "svg", mime: "image/svg+xml", serialize: toSvg }], ["plantuml", { extension: "puml", mime: "text/plain", serialize: toPlantUml }],
  ["json", { extension: "json", mime: "application/json", serialize: (diagram, context) => JSON.stringify({ schemaVersion: 2, project: context.project, diagram }, null, 2) }],
  ["csv", { extension: "csv", mime: "text/csv;charset=utf-8", serialize: toRequirementsCsv }], ["xlsx", { extension: "xlsx", mime: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", serialize: toRequirementsXlsx }],
  ["pdf", { extension: "pdf", mime: "application/pdf", serialize: toVectorPdf }]
]);

export const importers = new Map([["json", { parse: (text) => { const value = JSON.parse(text); return value.diagram ?? value; } }]]);
