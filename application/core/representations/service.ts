import type { ProjectFileCompactionInput } from "../../../domain/core/representations/projectCatalog";
import type { CoreContext } from '../context';
import { resolveDiagramSource } from '../source/diagramSource';

export async function projectRepresentations(context: CoreContext) {
  const project = await context.store.loadProject();
  return {
    project, catalog: project
      ? await context.store.projectCatalogs.loadRepresentationCatalog(project.id) : null
  };
}

export async function upsertProjectFileCompaction(context: CoreContext, input: ProjectFileCompactionInput) {
  const project = await context.store.loadProject();
  if (!project) throw new Error("project corpus is not initialized");
  const source = await resolveDiagramSource(context.store, {projectId: project.id, sourceId: input.sourceId}, context.corpus);
  input = { ...input, sourceId: source.binding().sourceId };
  if (input.makeActive !== false) {
    const documentLines = (await source.readText(input.path)).split(/\r?\n/);
    // Source coordinates count the final newline as the terminator of the last
    // source line, not as an additional empty line.
    const liveLines = documentLines.at(-1) === "" ? documentLines.slice(0, -1) : documentLines;
    const captured = liveLines.slice(input.startLine - 1, input.endLine);
    if (JSON.stringify(captured) !== JSON.stringify(input.originalLines)) {
      throw new Error(`active compaction snapshot is stale for ${input.path}`);
    }
    if (input.startLine === 1 && input.originalLines.length === input.endLine
      && liveLines.length !== input.endLine) {
      throw new Error(`active full-file compaction does not cover current ${input.path}`);
    }
  }
  return context.store.projectCatalogs.upsertFileCompaction(project.id, input);
}
