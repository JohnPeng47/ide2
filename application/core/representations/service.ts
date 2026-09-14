import {
  type DiagramSetRecord,
  type DiagramViewKind,
  type WorkspaceSnapshot
} from "../../../domain/core/records/domain";
import type { ProjectFileCompactionInput } from "../../../domain/core/representations/projectCatalog";
import type { CoreContext } from '../context';
import { workspace } from '../workspace/service';

export async function projectRepresentations(context: CoreContext) {
  const project = await context.store.loadProject();
  return {
    project, catalog: project
      ? await context.store.projectCatalogs.loadRepresentationCatalog(project.id) : null
  };
}

export async function settledViewIdsForSession(context: CoreContext, set: DiagramSetRecord): Promise<Partial<Record<DiagramViewKind, string>>> {
  const project = await context.store.loadProject();
  if (!project) throw new Error("project corpus is not initialized");
  const catalog = await context.store.projectCatalogs.loadRepresentationCatalog(project.id);
  const result: Partial<Record<DiagramViewKind, string>> = {};
  const settled = Object.values(catalog.representations)
    .filter((representation) => representation.status === "settled")
    .sort((left, right) => left.updatedAt.localeCompare(right.updatedAt));
  for (const representation of settled) {
    const revision = catalog.revisions[representation.currentRevisionId];
    if (revision?.provenance?.diagramSetId === set.id) {
      result[representation.viewKind] = revision.provenance.artifactId;
    }
  }
  for (const [viewKind, representationId] of Object.entries(catalog.activeByKind)) {
    const representation = representationId ? catalog.representations[representationId] : undefined;
    const revision = representation
      ? catalog.revisions[representation.currentRevisionId]
      : undefined;
    if (representation?.status === "settled" && revision?.provenance?.diagramSetId === set.id) {
      result[viewKind as DiagramViewKind] = revision.provenance.artifactId;
    }
  }
  return result;
}

export async function upsertProjectFileCompaction(context: CoreContext, input: ProjectFileCompactionInput): Promise<WorkspaceSnapshot> {
  const project = await context.store.loadProject();
  if (!project) throw new Error("project corpus is not initialized");
  if (input.makeActive !== false) {
    const documentLines = await context.corpus.readDocumentLines(project.corpus, input.path);
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
  await context.store.projectCatalogs.upsertFileCompaction(project.id, input);
  return workspace(context);
}
