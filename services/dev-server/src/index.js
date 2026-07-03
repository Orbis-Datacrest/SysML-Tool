import http from "node:http";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { existsSync, createReadStream } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import crypto from "node:crypto";
import { applyPatch, createId, validateDiagram } from "../../../packages/model-core/src/index.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const dataDir = path.join(root, process.env.DATA_DIR ?? ".data");
const port = Number(process.env.PORT ?? 8080);

async function readJson(name, fallback) {
  const file = path.join(dataDir, `${name}.json`);
  if (!existsSync(file)) return fallback;
  return JSON.parse(await readFile(file, "utf8"));
}

async function writeJson(name, value) {
  await mkdir(dataDir, { recursive: true });
  await writeFile(path.join(dataDir, `${name}.json`), JSON.stringify(value, null, 2));
}

function now() {
  return new Date().toISOString();
}

function withTenant(entity, tenantId) {
  return entity && entity.tenant_id === tenantId;
}

async function seed() {
  await mkdir(dataDir, { recursive: true });
  const tenants = await readJson("tenants", []);
  if (tenants.length) return;
  const timestamp = now();
  const tenant = { id: "tenant_demo", tenant_id: "tenant_demo", name: "Demo Aerospace", created_at: timestamp, updated_at: timestamp };
  const project = {
    id: "project_demo",
    tenant_id: tenant.id,
    name: "Flight Control System",
    description: "Demo UML/SysML project",
    created_at: timestamp,
    updated_at: timestamp
  };
  const diagram = {
    id: "diagram_demo",
    tenant_id: tenant.id,
    project_id: project.id,
    type: "uml-class",
    name: "UML Class Diagram",
    version: 1,
    created_at: timestamp,
    updated_at: timestamp,
    metadata: { grid: 20 },
    elements: [
      { id: "class_controller", kind: "class", name: "FlightController", x: 120, y: 120, width: 180, height: 110, properties: { attributes: ["mode"], operations: ["stabilize()"] } },
      { id: "class_sensor", kind: "class", name: "SensorBus", x: 430, y: 150, width: 170, height: 100, properties: { attributes: ["samples"], operations: ["read()"] } }
    ],
    relationships: [
      { id: "rel_controller_sensor", kind: "association", source_id: "class_controller", target_id: "class_sensor", label: "reads", properties: {} }
    ]
  };
  await writeJson("tenants", [tenant]);
  await writeJson("projects", [project]);
  await writeJson("diagrams", [diagram]);
  await writeJson("events", []);
  await writeJson("aiKeys", []);
}

async function body(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const text = Buffer.concat(chunks).toString("utf8");
  return text ? JSON.parse(text) : {};
}

function send(res, status, payload, headers = {}) {
  res.writeHead(status, { "content-type": "application/json", ...headers });
  res.end(JSON.stringify(payload));
}

function encryptSecret(secret) {
  const master = crypto.createHash("sha256").update(process.env.API_KEY_ENCRYPTION_SECRET ?? "local-dev-secret").digest();
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", master, iv);
  const encrypted = Buffer.concat([cipher.update(secret, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${iv.toString("base64")}.${tag.toString("base64")}.${encrypted.toString("base64")}`;
}

async function recordEvent(diagram, patch, actor = "local-user", reason = "diagram update") {
  const events = await readJson("events", []);
  events.push({
    id: createId("event"),
    tenant_id: diagram.tenant_id,
    project_id: diagram.project_id,
    diagram_id: diagram.id,
    version: diagram.version,
    actor_id: actor,
    reason,
    created_at: now(),
    patch
  });
  await writeJson("events", events);
}

function makeAiPatch(diagram, prompt) {
  const lower = prompt.toLowerCase();
  const baseX = 120 + diagram.elements.length * 42;
  const baseY = 280 + diagram.elements.length * 18;
  if (lower.includes("requirement")) {
    return {
      summary: "Add a SysML-style requirement note and trace relationship for review.",
      operations: [
        {
          op: "addElement",
          element: { id: createId("req"), kind: "requirement", name: "Derived Requirement", x: baseX, y: baseY, width: 210, height: 120, properties: { text: prompt } }
        }
      ]
    };
  }
  const newClassId = createId("class");
  const firstClass = diagram.elements.find((element) => element.kind === "class" || element.kind === "block");
  const operations = [
    {
      op: "addElement",
      element: { id: newClassId, kind: "class", name: "AIRecommendedComponent", x: baseX, y: baseY, width: 210, height: 112, properties: { attributes: ["status"], operations: ["validate()"] } }
    }
  ];
  if (firstClass) {
    operations.push({
      op: "addRelationship",
      relationship: { id: createId("rel"), kind: "dependency", source_id: firstClass.id, target_id: newClassId, label: "uses", properties: { proposed_by: "ai" } }
    });
  }
  return { summary: "Add a recommended component and dependency based on the current canvas context.", operations };
}

async function api(req, res, pathname) {
  const tenantId = req.headers["x-tenant-id"] ?? "tenant_demo";
  if (pathname === "/api/bootstrap" && req.method === "GET") {
    const tenants = await readJson("tenants", []);
    const projects = (await readJson("projects", [])).filter((project) => withTenant(project, tenantId));
    const diagrams = (await readJson("diagrams", [])).filter((diagram) => withTenant(diagram, tenantId));
    return send(res, 200, { tenants, projects, diagrams });
  }
  if (pathname === "/api/tenants" && req.method === "POST") {
    const input = await body(req);
    const tenants = await readJson("tenants", []);
    const tenant = { id: createId("tenant"), tenant_id: createId("tenant"), name: input.name, created_at: now(), updated_at: now() };
    tenant.tenant_id = tenant.id;
    tenants.push(tenant);
    await writeJson("tenants", tenants);
    return send(res, 201, tenant);
  }
  if (pathname === "/api/projects" && req.method === "POST") {
    const input = await body(req);
    const projects = await readJson("projects", []);
    const project = { id: createId("project"), tenant_id: tenantId, name: input.name, description: input.description ?? "", created_at: now(), updated_at: now() };
    projects.push(project);
    await writeJson("projects", projects);
    return send(res, 201, project);
  }
  if (pathname === "/api/diagrams" && req.method === "POST") {
    const input = await body(req);
    const diagrams = await readJson("diagrams", []);
    const diagram = { id: createId("diagram"), tenant_id: tenantId, project_id: input.project_id, type: input.type, name: input.name, version: 1, created_at: now(), updated_at: now(), metadata: {}, elements: [], relationships: [] };
    diagrams.push(diagram);
    await writeJson("diagrams", diagrams);
    return send(res, 201, diagram);
  }
  const diagramMatch = pathname.match(/^\/api\/diagrams\/([^/]+)$/);
  if (diagramMatch && req.method === "PUT") {
    const input = await body(req);
    const diagrams = await readJson("diagrams", []);
    const index = diagrams.findIndex((diagram) => diagram.id === diagramMatch[1] && withTenant(diagram, tenantId));
    if (index < 0) return send(res, 404, { error: "Diagram not found" });
    const candidate = { ...input, tenant_id: tenantId, updated_at: now(), version: diagrams[index].version + 1 };
    const validation = validateDiagram(candidate);
    if (!validation.valid) return send(res, 422, validation);
    diagrams[index] = candidate;
    await writeJson("diagrams", diagrams);
    await recordEvent(candidate, { summary: "Saved full diagram state", operations: [] }, "local-user", "save");
    return send(res, 200, candidate);
  }
  if (pathname === "/api/ai/preview" && req.method === "POST") {
    const input = await body(req);
    const diagrams = await readJson("diagrams", []);
    const diagram = diagrams.find((item) => item.id === input.diagram_id && item.tenant_id === tenantId);
    if (!diagram) return send(res, 404, { error: "Diagram not found" });
    const patch = makeAiPatch(diagram, input.prompt ?? "");
    const preview = applyPatch(diagram, patch);
    const validation = validateDiagram(preview);
    return send(res, validation.valid ? 200 : 422, { patch, validation, preview });
  }
  if (pathname === "/api/ai/apply" && req.method === "POST") {
    const input = await body(req);
    const diagrams = await readJson("diagrams", []);
    const index = diagrams.findIndex((diagram) => diagram.id === input.diagram_id && diagram.tenant_id === tenantId);
    if (index < 0) return send(res, 404, { error: "Diagram not found" });
    const next = applyPatch(diagrams[index], input.patch);
    const validation = validateDiagram(next);
    if (!validation.valid) return send(res, 422, validation);
    diagrams[index] = next;
    await writeJson("diagrams", diagrams);
    await recordEvent(next, input.patch, "ai-advisor", input.patch.summary);
    return send(res, 200, next);
  }
  if (pathname === "/api/ai/keys" && req.method === "POST") {
    const input = await body(req);
    const keys = await readJson("aiKeys", []);
    const item = { id: createId("key"), tenant_id: tenantId, provider: input.provider, model: input.model, display_name: input.display_name, encrypted_api_key: encryptSecret(input.api_key), active: Boolean(input.active), created_at: now() };
    keys.push(item);
    await writeJson("aiKeys", keys);
    const { encrypted_api_key, ...safe } = item;
    return send(res, 201, safe);
  }
  const exportMatch = pathname.match(/^\/api\/diagrams\/([^/]+)\/export\/pdf$/);
  if (exportMatch && req.method === "GET") {
    const diagrams = await readJson("diagrams", []);
    const diagram = diagrams.find((item) => item.id === exportMatch[1] && item.tenant_id === tenantId);
    if (!diagram) return send(res, 404, { error: "Diagram not found" });
    const pdf = Buffer.from(`%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n2 0 obj<</Type/Pages/Count 1/Kids[3 0 R]>>endobj\n3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 612 792]/Contents 4 0 R>>endobj\n4 0 obj<</Length 72>>stream\nBT /F1 18 Tf 72 720 Td (${diagram.name} export - ${diagram.elements.length} elements) Tj ET\nendstream endobj\ntrailer<</Root 1 0 R>>\n%%EOF`);
    res.writeHead(200, { "content-type": "application/pdf", "content-disposition": `attachment; filename="${diagram.name}.pdf"` });
    return res.end(pdf);
  }
  return send(res, 404, { error: "Not found" });
}

function contentType(file) {
  if (file.endsWith(".html")) return "text/html";
  if (file.endsWith(".css")) return "text/css";
  if (file.endsWith(".js")) return "text/javascript";
  if (file.endsWith(".json")) return "application/json";
  return "application/octet-stream";
}

async function serveStatic(req, res, pathname) {
  const publicRoot = path.join(root, "apps/shell/public");
  const filePath = pathname === "/" ? path.join(publicRoot, "index.html") : path.join(root, pathname);
  const resolved = path.resolve(filePath);
  if (!resolved.startsWith(root) || !existsSync(resolved)) {
    res.writeHead(404);
    res.end("Not found");
    return;
  }
  res.writeHead(200, { "content-type": contentType(resolved) });
  createReadStream(resolved).pipe(res);
}

await seed();
http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://${req.headers.host}`);
    if (url.pathname.startsWith("/api/")) return await api(req, res, url.pathname);
    return await serveStatic(req, res, url.pathname);
  } catch (error) {
    send(res, 500, { error: error.message });
  }
}).listen(port, () => {
  console.log(`SysML/UML modeling tool running at http://localhost:${port}`);
});
