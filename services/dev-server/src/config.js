import path from "node:path";
import { fileURLToPath } from "node:url";

export const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
export const port = Number(process.env.PORT ?? 8080);
export const aiApiUrl = process.env.AI_API_URL ?? "https://api.openai.com/v1/responses";
export const aiApiKey = process.env.AI_API_KEY ?? "";
export const aiModel = process.env.AI_MODEL ?? "gpt-4o-mini";
