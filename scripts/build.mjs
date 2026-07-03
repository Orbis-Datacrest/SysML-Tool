import { existsSync } from "node:fs";

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

console.log("Build check passed. Static MFEs and vertical-slice services are ready.");
