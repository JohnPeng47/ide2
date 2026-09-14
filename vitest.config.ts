import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // Vendored repositories have their own runners and dependencies.
    include: ["{src,server,domain,tools/experiments,packages,tests/architecture}/**/*.test.{ts,tsx}"],
    exclude: ["**/node_modules/**", "**/dist/**"]
  }
});
