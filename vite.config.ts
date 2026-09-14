import path from "node:path";
import { fileURLToPath } from "node:url";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import { diagramApi } from "./server/app/vitePlugin";

const ROOT = fileURLToPath(new URL(".", import.meta.url));
const DEFAULT_PROJECT_ROOT = path.resolve(ROOT, "../..");
const PROJECT_ROOT = path.resolve(process.env.NEW_DIAGRAM_PROJECT_ROOT || DEFAULT_PROJECT_ROOT);
const DIAGRAMS_DIRECTORY = process.env.NEW_DIAGRAMS_DIR || ".diagrams";
const EXPERIMENTS_ROOT = path.resolve(
  process.env.NEW_DIAGRAM_EXPERIMENTS_ROOT || path.join(PROJECT_ROOT, ".datasets")
);
const DATASET_COLLECTIONS_ROOT = path.resolve(
  process.env.NEW_DIAGRAM_COLLECTIONS_ROOT || path.join(EXPERIMENTS_ROOT, "diagram-collections")
);
const PREVIEW_ALLOWED_HOSTS = (process.env.NEW_DIAGRAM_ALLOWED_HOSTS || "")
  .split(",")
  .map((host) => host.trim())
  .filter(Boolean);

export default defineConfig({
  root: ROOT,
  plugins: [
    react(),
    diagramApi(
      PROJECT_ROOT,
      DIAGRAMS_DIRECTORY,
      EXPERIMENTS_ROOT,
      DATASET_COLLECTIONS_ROOT,
      undefined,
      ROOT,
      { lspEnabled: (globalThis as Record<symbol, unknown>)[Symbol.for('new-diagram.lsp-enabled')] === true }
    )
  ],
  build: {
    outDir: "dist",
    emptyOutDir: true
  },
  preview: PREVIEW_ALLOWED_HOSTS.length
    ? { allowedHosts: PREVIEW_ALLOWED_HOSTS }
    : undefined
});
