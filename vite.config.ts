import path from "node:path";
import { fileURLToPath } from "node:url";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import { diagramApi } from "./server/http";

const ROOT = fileURLToPath(new URL(".", import.meta.url));
const DEFAULT_PROJECT_ROOT = path.resolve(ROOT, "../..");

export default defineConfig({
  root: ROOT,
  plugins: [
    react(),
    diagramApi(path.resolve(process.env.NEW_DIAGRAM_PROJECT_ROOT || DEFAULT_PROJECT_ROOT))
  ],
  build: {
    outDir: "dist",
    emptyOutDir: true
  }
});
