import {
  GENERATION_SEED,
  GENERATION_TEMPERATURE,
  getOllamaBaseUrl,
  getOllamaModel,
  getTimeoutMs,
  testingToolsEnabled,
} from "./config";
import type { ErrorCode, HealthResponse } from "./types";

/**
 * Server-side Ollama client using native fetch. The browser never talks to
 * Ollama directly, and none of these values are exposed to the client.
 */

export type ModelErrorCode = Extract<
  ErrorCode,
  "MODEL_UNAVAILABLE" | "MODEL_NOT_FOUND" | "MODEL_TIMEOUT" | "MODEL_BAD_RESPONSE"
>;

/**
 * A failure at the model boundary. `message` is internal detail for server logs
 * only; the API route maps `code` to a generic, user-safe message.
 */
export class ModelError extends Error {
  readonly code: ModelErrorCode;

  constructor(code: ModelErrorCode, internalDetail: string) {
    super(internalDetail);
    this.name = "ModelError";
    this.code = code;
  }
}

/** Deliberate failure used by the "Simulate API failure" testing tool. */
export function simulatedModelFailure(): ModelError {
  return new ModelError("MODEL_UNAVAILABLE", "Simulated API failure (testing tools).");
}

export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

function isAbortError(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "name" in error &&
    (error.name === "AbortError" || error.name === "TimeoutError")
  );
}

function describeNetworkError(error: unknown): string {
  if (error instanceof Error) {
    const cause = (error as Error & { cause?: { code?: string } }).cause;
    return cause?.code ? `${error.message} (${cause.code})` : error.message;
  }
  return "unknown network error";
}

/** Fetch with an AbortController deadline that also covers reading the body. */
async function fetchWithDeadline<T>(
  url: string,
  init: RequestInit,
  timeoutMs: number,
  readBody: (response: Response) => Promise<T>,
): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { ...init, signal: controller.signal, cache: "no-store" });
    return await readBody(response);
  } catch (error) {
    if (error instanceof ModelError) throw error;
    if (isAbortError(error)) {
      throw new ModelError("MODEL_TIMEOUT", `Ollama did not respond within ${timeoutMs} ms.`);
    }
    throw new ModelError("MODEL_UNAVAILABLE", `Could not reach Ollama: ${describeNetworkError(error)}`);
  } finally {
    clearTimeout(timer);
  }
}

async function readErrorText(response: Response): Promise<string> {
  try {
    return (await response.text()).slice(0, 300);
  } catch {
    return "";
  }
}

/**
 * Sends one non-streaming chat request to Ollama's /api/chat and returns the
 * assistant message content. Throws ModelError for every failure mode.
 */
export async function chat(
  messages: ChatMessage[],
  options: { format?: object } = {},
): Promise<string> {
  const model = getOllamaModel();
  const url = `${getOllamaBaseUrl()}/api/chat`;

  return fetchWithDeadline(
    url,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model,
        messages,
        stream: false,
        format: options.format,
        options: { temperature: GENERATION_TEMPERATURE, seed: GENERATION_SEED },
      }),
    },
    getTimeoutMs(),
    async (response) => {
      if (!response.ok) {
        const body = await readErrorText(response);
        if (response.status === 404 && /model/i.test(body)) {
          throw new ModelError("MODEL_NOT_FOUND", `Ollama reports model "${model}" is not installed.`);
        }
        throw new ModelError("MODEL_UNAVAILABLE", `Ollama responded with HTTP ${response.status}.`);
      }

      let data: unknown;
      try {
        data = await response.json();
      } catch {
        throw new ModelError("MODEL_BAD_RESPONSE", "Ollama returned a body that is not valid JSON.");
      }

      const content = (data as { message?: { content?: unknown } } | null)?.message?.content;
      if (typeof content !== "string" || content.trim() === "") {
        throw new ModelError("MODEL_BAD_RESPONSE", "Ollama response had no message content.");
      }
      return content;
    },
  );
}

const HEALTH_TIMEOUT_MS = 3_000;

function isInstalled(models: unknown, wanted: string): boolean {
  if (!Array.isArray(models)) return false;
  const candidates = new Set([wanted, wanted.includes(":") ? wanted : `${wanted}:latest`]);
  return models.some((entry) => {
    const record = entry as { name?: unknown; model?: unknown };
    return [record?.name, record?.model].some((n) => typeof n === "string" && candidates.has(n));
  });
}

/** Real health check: is the Ollama server reachable and is the configured model installed? */
export async function checkHealth(): Promise<HealthResponse> {
  const model = getOllamaModel();
  const base: Pick<HealthResponse, "model" | "testingTools"> = {
    model,
    testingTools: testingToolsEnabled(),
  };

  try {
    return await fetchWithDeadline(
      `${getOllamaBaseUrl()}/api/tags`,
      { method: "GET" },
      HEALTH_TIMEOUT_MS,
      async (response): Promise<HealthResponse> => {
        if (!response.ok) return { ...base, status: "unavailable", reason: "SERVER_ERROR" };
        const data = (await response.json()) as { models?: unknown };
        return isInstalled(data.models, model)
          ? { ...base, status: "connected" }
          : { ...base, status: "unavailable", reason: "MODEL_NOT_INSTALLED" };
      },
    );
  } catch {
    return { ...base, status: "unavailable", reason: "SERVER_UNREACHABLE" };
  }
}
