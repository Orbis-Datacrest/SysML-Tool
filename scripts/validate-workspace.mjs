import { existsSync } from "node:fs";

const dirs = [
  "apps/shell",
  "apps/project-explorer",
  "apps/diagram-canvas",
  "apps/ai-advisor",
  "apps/import-export",
  "services/auth-service",
  "services/tenant-service",
  "services/project-service",
  "services/diagram-service",
  "services/ai-advisor-service",
  "services/export-service",
  "packages/shared-types",
  "packages/ui",
  "packages/model-core",
  "infra",
  "samples",
  "scripts"
];

for (const dir of dirs) {
  if (!existsSync(dir)) {
    console.error(`Missing ${dir}`);
    process.exit(1);
  }
}

console.log("Workspace structure is valid.");
