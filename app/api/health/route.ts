import { checkHealth } from "@/lib/ollama";

export const dynamic = "force-dynamic";

/** Real model health check: asks the Ollama server (server-side) whether the configured model is installed. */
export async function GET(): Promise<Response> {
  const health = await checkHealth();
  return Response.json(health, { headers: { "Cache-Control": "no-store" } });
}
