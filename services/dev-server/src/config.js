import path from "node:path";
import { fileURLToPath } from "node:url";

export const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
export const port = Number(process.env.PORT ?? 8080);
export const aiApiUrl = process.env.AI_API_URL ?? "";
export const aiApiKey = process.env.AI_API_KEY ?? "";
