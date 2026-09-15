import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  // Avoid Next/PostCSS while unit-testing pure pose math.
  css: { postcss: { plugins: [] } },
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
});
