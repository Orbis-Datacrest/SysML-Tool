import path from "node:path";
import { fileURLToPath } from "node:url";

export const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const configuredDataDir = process.env.DATA_DIR ?? ".data";

export const dataDir = path.isAbsolute(configuredDataDir) ? configuredDataDir : path.join(root, configuredDataDir);
export const dbPath = path.join(dataDir, process.env.SQLITE_DB_FILE ?? "sysml-studio.db");
export const port = Number(process.env.PORT ?? 8080);
export const accessTokenDays = Number(process.env.SESSION_DAYS ?? 7);
export const refreshTokenDays = Number(process.env.REFRESH_SESSION_DAYS ?? 30);
export const authWindowMs = Number(process.env.AUTH_RATE_LIMIT_WINDOW_MS ?? 15 * 60 * 1000);
export const authMaxAttempts = Number(process.env.AUTH_RATE_LIMIT_MAX ?? 10);
