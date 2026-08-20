import path from "node:path";
import { fileURLToPath } from "node:url";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import { diagramApi } from "./server/http";

const ROOT = fileURLToPath(new URL(".", import.meta.url));
const DEFAULT_PROJECT_ROOT = path.resolve(ROOT, "../..");
const PROJECT_ROOT = path.resolve(process.env.NEW_DIAGRAM_PROJECT_ROOT || DEFAULT_PROJECT_ROOT);
const DIAGRAMS_DIRECTORY = process.env.NEW_DIAGRAMS_DIR || ".diagrams";

export default defineConfig({
  root: ROOT,
  plugins: [
    react(),
    diagramApi(PROJECT_ROOT, DIAGRAMS_DIRECTORY)
  ],
  build: {
    outDir: "dist",
    emptyOutDir: true
  }
});
