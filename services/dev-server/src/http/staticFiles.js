import { createReadStream, existsSync } from "node:fs";
import path from "node:path";

function contentType(file) {
  if (file.endsWith(".html")) return "text/html";
  if (file.endsWith(".css")) return "text/css";
  if (file.endsWith(".js")) return "text/javascript";
  if (file.endsWith(".json")) return "application/json";
  return "application/octet-stream";
}

export async function serveStaticFile({ root, res, pathname }) {
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
