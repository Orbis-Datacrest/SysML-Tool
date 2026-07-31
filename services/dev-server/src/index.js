import http from "node:http";
import { aiApiKey, aiApiUrl, port, root } from "./config.js";
import { serveStaticFile } from "./http/staticFiles.js";

async function readBody(req, limit = 2 * 1024 * 1024) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > limit) throw new Error("AI request is too large.");
    chunks.push(chunk);
  }
  return Buffer.concat(chunks).toString("utf8");
}

async function proxyAi(req, res) {
  if (!aiApiUrl) {
    res.writeHead(503, { "content-type": "application/json" });
    res.end(JSON.stringify({ error: "AI is not configured. Set AI_API_URL before starting Model Studio." }));
    return;
  }
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 60_000);
  try {
    const response = await fetch(aiApiUrl, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...(aiApiKey ? { authorization: `Bearer ${aiApiKey}` } : {})
      },
      body: await readBody(req),
      signal: controller.signal
    });
    const payload = await response.text();
    res.writeHead(response.status, { "content-type": response.headers.get("content-type") ?? "application/json" });
    res.end(payload);
  } catch (error) {
    res.writeHead(error.name === "AbortError" ? 504 : 502, { "content-type": "application/json" });
    res.end(JSON.stringify({ error: error.name === "AbortError" ? "AI request timed out." : `AI API unavailable: ${error.message}` }));
  } finally {
    clearTimeout(timeout);
  }
}

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://${req.headers.host ?? "localhost"}`);
    if (url.pathname === "/api/ai") {
      if (req.method !== "POST") {
        res.writeHead(405, { allow: "POST" });
        res.end("Method not allowed");
        return;
      }
      await proxyAi(req, res);
      return;
    }
    if (!["GET", "HEAD"].includes(req.method)) {
      res.writeHead(405, { allow: "GET, HEAD" });
      res.end("Method not allowed");
      return;
    }
    await serveStaticFile({ root, res, pathname: decodeURIComponent(url.pathname) });
  } catch {
    res.writeHead(400);
    res.end("Bad request");
  }
});

server.listen(port, () => {
  console.log(`Model Studio is available at http://localhost:${port}`);
});
