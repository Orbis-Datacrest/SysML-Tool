import { cpSync, existsSync, mkdirSync, rmSync } from "node:fs";

const required = [
  "apps/shell/public/index.html",
  "services/dev-server/src/index.js",
  "packages/shared-types/src/index.ts",
  "packages/model-core/src/index.js",
  "infra/docker-compose.yml"
];

const missing = required.filter((path) => !existsSync(path));
if (missing.length) {
  console.error(`Missing required files:\n${missing.join("\n")}`);
  process.exit(1);
}

const output = "public";
rmSync(output, { recursive: true, force: true });
mkdirSync(output, { recursive: true });
cpSync("apps/shell/public/index.html", `${output}/index.html`);
cpSync("apps", `${output}/apps`, { recursive: true, filter: (source) => !source.includes("/test/") && !source.endsWith("/test") && !source.endsWith("package.json") });
cpSync("packages", `${output}/packages`, { recursive: true, filter: (source) => !source.includes("/test/") && !source.endsWith("/test") && !source.endsWith("package.json") });
mkdirSync(`${output}/services/ai-advisor-service`, { recursive: true });
cpSync("services/ai-advisor-service/src", `${output}/services/ai-advisor-service/src`, { recursive: true });

console.log("Build passed. Static application emitted to public/ for Vercel and other static hosts.");
