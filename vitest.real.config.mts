import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

/**
 * REAL MODEL tests: these call a live Ollama server (OLLAMA_BASE_URL / OLLAMA_MODEL).
 * They are slow, depend on the installed model, and are never part of `npm test`.
 */
export default defineConfig({
  resolve: { alias: { "@": fileURLToPath(new URL(".", import.meta.url)) } },
  test: {
    environment: "node",
    include: ["tests/real/**/*.test.ts"],
    testTimeout: 360_000,
    hookTimeout: 360_000,
    fileParallelism: false,
  },
});
