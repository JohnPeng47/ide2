import { readFile } from "node:fs/promises";
import path from "node:path";
import { ProjectCatalogStore, type SaveProjectedTreeInput } from "../server/core/projectCatalogStore";

// Explicit paths keep imports independent of whichever project a dev server uses.
const [storeDirectory, artifactFile] = process.argv.slice(2);
if (!storeDirectory || !artifactFile) {
  throw new Error("Usage: tsx scripts/import-projection.ts <project-store-directory> <generated-projection.json>");
}
const storeRoot = path.resolve(storeDirectory);
const project = JSON.parse(await readFile(path.join(storeRoot, "project.json"), "utf8"));
const input: SaveProjectedTreeInput = JSON.parse(await readFile(path.resolve(artifactFile), "utf8"));
const result = await new ProjectCatalogStore(storeRoot).saveProjectedTree(project.id, input);
console.log(JSON.stringify({ representationId: result.representation.id, projectionId: result.projection.id,
  name: result.representation.name, links: result.projection.links.length }, null, 2));
