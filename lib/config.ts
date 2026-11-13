/**
 * Server-side configuration. Values are read at call time (not import time) so
 * tests can override them, and nothing here is ever sent to the browser.
 */

export const DEFAULT_OLLAMA_BASE_URL = "http://localhost:11434";
export const DEFAULT_OLLAMA_MODEL = "qwen2.5:3b";
export const DEFAULT_TIMEOUT_MS = 60_000;

/** Low temperature plus a fixed seed keeps answers consistent between runs. */
export const GENERATION_TEMPERATURE = 0.1;
export const GENERATION_SEED = 7;

export { MAX_QUESTION_LENGTH } from "./constants";

export function getOllamaBaseUrl(): string {
  const raw = process.env.OLLAMA_BASE_URL?.trim() || DEFAULT_OLLAMA_BASE_URL;
  return raw.replace(/\/+$/, "");
}

export function getOllamaModel(): string {
  return process.env.OLLAMA_MODEL?.trim() || DEFAULT_OLLAMA_MODEL;
}

export function getTimeoutMs(): number {
  const parsed = Number(process.env.OLLAMA_TIMEOUT_MS);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_TIMEOUT_MS;
}

/**
 * The "Simulate API failure" control is a developer tool. It is available in
 * development, and in production only when ENABLE_TESTING_TOOLS=true is set.
 */
export function testingToolsEnabled(): boolean {
  return (
    process.env.NODE_ENV !== "production" ||
    process.env.ENABLE_TESTING_TOOLS === "true"
  );
}
