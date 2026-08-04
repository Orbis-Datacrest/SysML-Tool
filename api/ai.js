import { requestAiProposal } from "../services/dev-server/src/aiProvider.js";

export const maxDuration = 60;

export async function POST(request) {
  const apiKey = process.env.AI_API_KEY ?? "";
  if (!apiKey) return Response.json({ error: "AI is not configured. Add AI_API_KEY in the Vercel project environment variables." }, { status: 503 });
  try {
    const body = await request.json();
    if (!body?.context || typeof body.context !== "object") return Response.json({ error: "A valid AI modeling context is required." }, { status: 400 });
    const proposal = await requestAiProposal({
      apiUrl: process.env.AI_API_URL ?? "https://api.openai.com/v1/responses",
      apiKey,
      model: process.env.AI_MODEL ?? "gpt-4o-mini",
      context: body.context,
      signal: request.signal
    });
    return Response.json({ proposal });
  } catch (error) {
    const status = error.name === "AbortError" ? 504 : 502;
    return Response.json({ error: error.name === "AbortError" ? "AI request timed out." : error.message }, { status });
  }
}

export function GET() {
  return Response.json({ error: "Method not allowed" }, { status: 405, headers: { allow: "POST" } });
}
