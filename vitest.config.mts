import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

/**
 * Default test run: fast, offline, deterministic. Everything that touches the
 * model uses a mocked HTTP boundary. Real-model tests live in tests/real and
 * run only via `npm run test:real` (see vitest.real.config.mts).
 */
export default defineConfig({
  resolve: { alias: { "@": fileURLToPath(new URL(".", import.meta.url)) } },
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
    exclude: ["tests/real/**", "node_modules/**"],
  },
});
