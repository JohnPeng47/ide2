import react from "@vitejs/plugin-react";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";
import { diagramApi } from "./src/server/app/vitePlugin";

const ROOT = fileURLToPath(new URL(".", import.meta.url));
const DEFAULT_PROJECT_ROOT = path.resolve(ROOT, "../..");
const PROJECT_ROOT = path.resolve(process.env.NEW_DIAGRAM_PROJECT_ROOT || DEFAULT_PROJECT_ROOT);
const HTTP_ENABLED = (globalThis as Record<symbol, unknown>)[Symbol.for('new-diagram.http-enabled')] === true;
const DIAGRAMS_DIRECTORY = process.env.NEW_DIAGRAMS_DIR || ".diagrams";
const STORAGE_ROOT = path.resolve(PROJECT_ROOT, DIAGRAMS_DIRECTORY);
const PREVIEW_ALLOWED_HOSTS = (process.env.NEW_DIAGRAM_ALLOWED_HOSTS || "")
  .split(",")
  .map((host) => host.trim())
  .filter(Boolean);

export default defineConfig({
  root: ROOT,
  optimizeDeps: {
    entries: ["index.html"]
  },
  server: {
    watch: {
      // These are application data, not source modules. Atomic record writes must
      // not trigger directory rescans or hot reloads of the saving application.
      ignored: (candidate: string) => /[/\\]\.diagrams[^/\\]*(?:[/\\]|$)/.test(candidate)
        || candidate === STORAGE_ROOT || candidate.startsWith(STORAGE_ROOT + path.sep)
    }
  },
  plugins: [
    react(),
    diagramApi(
      PROJECT_ROOT,
      DIAGRAMS_DIRECTORY,
      undefined,
      ROOT,
      {
        httpEnabled: HTTP_ENABLED,
        piEnabled: (globalThis as Record<symbol, unknown>)[Symbol.for('new-diagram.pi-enabled')] === true,
        lspEnabled: (globalThis as Record<symbol, unknown>)[Symbol.for('new-diagram.lsp-enabled')] === true
      }
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
