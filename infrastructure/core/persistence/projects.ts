import path from "node:path";
import type { RepositoryLocation } from "../../../application/core/corpus/location";
import {
  SCHEMA_VERSION,
  assertSafeId,
  type ProjectRecord
} from "../../../domain/core/records/domain";
import type { PersistenceContext } from './context';
import { projectPath } from './paths';
import { makeId, normalizedProject, nowIso, readJsonIfExists, writeJsonAtomic } from './shared';

export async function ensureProject(context: PersistenceContext, location: RepositoryLocation): Promise<ProjectRecord> {
  const existing = await readJsonIfExists<ProjectRecord>(projectPath(context));
  if (existing) return (await loadProject(context))!;
  const domainProfileId = location.domainProfileId ?? "source-code";
  const timestamp = nowIso();
  const project: ProjectRecord = {
    schemaVersion: SCHEMA_VERSION,
    id: makeId("project"),
    name: path.basename(location.checkoutRoot),
    defaultDomainProfileId: domainProfileId,
    sources: [],
    createdAt: timestamp,
    updatedAt: timestamp
  };
  await writeJsonAtomic(projectPath(context), project);
  return project;
}

/** Preserve source access for catalogs that previously relied on legacy set registration.
 * Read only source metadata; never change or delete the original records. */
export async function loadProject(context: PersistenceContext): Promise<ProjectRecord | null> {
  const project = await readJsonIfExists<ProjectRecord & { diagramSetIds?: string[] }>(projectPath(context));
  if (!project) return null;
  if (project.sources === undefined && project.diagramSetIds?.length) {
    const sources = new Map<string, import('../../../domain/core/diagrams/diagram').DiagramSourceBinding>();
    for (const id of project.diagramSetIds) {
      assertSafeId(id, 'legacy source registration id');
      const record = await readJsonIfExists<{ source?: import('../../../domain/core/diagrams/diagram').DiagramSourceBinding }>(
        path.join(context.storeRoot, 'diagram-sets', id, 'diagram-set.json'));
      if (!record?.source) continue;
      const previous = sources.get(record.source.sourceId);
      if (previous && (previous.corpus.root !== record.source.corpus.root || previous.corpus.kind !== record.source.corpus.kind || previous.repositoryIdentity !== record.source.repositoryIdentity)) {
        throw new Error('Conflicting legacy source identity');
      }
      sources.set(record.source.sourceId, record.source);
    }
    project.sources = [...sources.values()];
    await writeJsonAtomic(projectPath(context), project);
  }
  return normalizedProject(project);
}
