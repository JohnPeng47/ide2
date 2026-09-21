import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // Vendored repositories have their own runners and dependencies.
    include: ["{src,application,infrastructure,domain,packages,tests/architecture}/**/*.test.{ts,tsx}"],
    exclude: ["**/node_modules/**", "**/dist/**"]
  }
});
