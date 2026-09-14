import { createHash, randomUUID } from "node:crypto";
import {
  mkdir,
  readFile,
  rename,
  writeFile
} from "node:fs/promises";
import path from "node:path";
import { type ProjectProjectionRecord } from "../../../domain/core/diagrams/diagramProjection";
import { type SaveProjectDiagramInput } from "../../../domain/core/diagrams/projectDiagramCanvas";
import {
  SCHEMA_VERSION,
  type DiagramViewKind
} from "../../../domain/core/records/domain";
import type { ProjectRepresentationPromotionDraft, SaveProjectedTreeInput } from "../../../domain/core/representations/catalogCommands";
import * as rules from '../../../domain/core/representations/catalogRules';

import type {
  ProjectCorpusCompactionCatalogRecord,
  ProjectFileCompactionInput,
  ProjectFileCompactionRecord,
  ProjectRepresentationCatalogRecord,
  ProjectRepresentationRecord
} from "../../../domain/core/representations/projectCatalog";
export type { ProjectRepresentationPromotionDraft, SaveProjectedTreeInput } from "../../../domain/core/representations/catalogCommands";
export { ProjectDiagramConflict } from "../../../domain/core/representations/errors";

function nowIso(): string {
  return new Date().toISOString();
}

function stableId(prefix: string, ...parts: string[]): string {
  const digest = createHash("sha256").update(parts.join("\0")).digest("hex").slice(0, 32);
  return `${prefix}-${digest}`;
}

async function readJsonIfExists<T>(filePath: string): Promise<T | null> {
  try {
    const parsed = JSON.parse(await readFile(filePath, "utf8")) as T & { schemaVersion?: number };
    if (parsed.schemaVersion !== SCHEMA_VERSION) throw new Error(`unsupported schema in ${filePath}`);
    return parsed;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
}

async function writeJsonAtomic(filePath: string, value: unknown): Promise<void> {
  await mkdir(path.dirname(filePath), { recursive: true });
  const tempPath = path.join(
    path.dirname(filePath),
    `.${path.basename(filePath)}.${process.pid}.${randomUUID()}.tmp`
  );
  await writeFile(tempPath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  await rename(tempPath, filePath);
}

function emptyCompactionCatalog(projectId: string): ProjectCorpusCompactionCatalogRecord {
  const timestamp = nowIso();
  return {
    schemaVersion: SCHEMA_VERSION,
    projectId,
    activeByPath: {},
    compactions: {},
    createdAt: timestamp,
    updatedAt: timestamp
  };
}

function emptyRepresentationCatalog(projectId: string): ProjectRepresentationCatalogRecord {
  const timestamp = nowIso();
  return {
    schemaVersion: SCHEMA_VERSION,
    projectId,
    activeByKind: {},
    representations: {},
    revisions: {},
    createdAt: timestamp,
    updatedAt: timestamp
  };
}

export class ProjectCatalogStore {
  constructor(readonly storeRoot: string) { }

  private representationWrite: Promise<unknown> = Promise.resolve();
  private serialize<T>(write: () => Promise<T>): Promise<T> {
    const result = this.representationWrite.then(write);
    this.representationWrite = result.catch(() => undefined);
    return result;
  }

  saveProjection(projectId: string, projection: ProjectProjectionRecord) {
    return this.serialize(async () => {
      const catalog = await this.loadRepresentationCatalog(projectId);
      const result = rules.saveProjection(catalog, projectId, projection, catalogEnvironment());
      if (result.catalog !== catalog) await this.saveRepresentationCatalog(result.catalog);
      return result;
    });
  }

  /** Persist the generated tree and its relationship in one catalog write. */
  saveProjectedTree(projectId: string, input: SaveProjectedTreeInput) {
    return this.serialize(async () => {
      const catalog = await this.loadRepresentationCatalog(projectId);
      const result = rules.saveProjectedTree(catalog, projectId, input, catalogEnvironment());
      if (result.catalog !== catalog) await this.saveRepresentationCatalog(result.catalog);
      return result;
    });
  }

  saveMappingDiagram(projectId: string, input: SaveProjectDiagramInput) {
    return this.serialize(async () => {
      const catalog = await this.loadRepresentationCatalog(projectId);
      const result = rules.saveMappingDiagram(catalog, projectId, input, catalogEnvironment());
      if (result.catalog !== catalog) await this.saveRepresentationCatalog(result.catalog);
      return result;
    });
  }

  private compactionCatalogPath(): string {
    return path.join(this.storeRoot, "corpus", "compactions.json");
  }

  private representationCatalogPath(): string {
    return path.join(this.storeRoot, "representations", "catalog.json");
  }

  async loadCompactionCatalog(projectId: string): Promise<ProjectCorpusCompactionCatalogRecord> {
    const stored = await readJsonIfExists<ProjectCorpusCompactionCatalogRecord>(
      this.compactionCatalogPath()
    );
    if (!stored) return emptyCompactionCatalog(projectId);
    if (stored.projectId !== projectId) throw new Error("compaction catalog belongs to another Project");
    return stored;
  }

  async saveCompactionCatalog(catalog: ProjectCorpusCompactionCatalogRecord): Promise<void> {
    await writeJsonAtomic(this.compactionCatalogPath(), catalog);
  }

  async upsertFileCompaction(
    projectId: string,
    input: ProjectFileCompactionInput
  ): Promise<{ catalog: ProjectCorpusCompactionCatalogRecord; compaction: ProjectFileCompactionRecord }> {
    const catalog = await this.loadCompactionCatalog(projectId);
    const result = rules.upsertFileCompaction(catalog, projectId, input, catalogEnvironment());
    if (result.catalog !== catalog) await this.saveCompactionCatalog(result.catalog);
    return result;
  }

  async loadRepresentationCatalog(projectId: string): Promise<ProjectRepresentationCatalogRecord> {
    const stored = await readJsonIfExists<ProjectRepresentationCatalogRecord>(
      this.representationCatalogPath()
    );
    if (!stored) return emptyRepresentationCatalog(projectId);
    if (stored.projectId !== projectId) {
      throw new Error("representation catalog belongs to another Project");
    }
    return {
      ...stored, revisions: Object.fromEntries(Object.entries(stored.revisions).map(([id, revision]) => [id,
        { ...revision, content: revision.content ?? { kind: "ascii" as const, ascii: revision.ascii } }
      ]))
    };
  }

  async saveRepresentationCatalog(catalog: ProjectRepresentationCatalogRecord): Promise<void> {
    await writeJsonAtomic(this.representationCatalogPath(), catalog);
  }

  promoteRepresentation(draft: ProjectRepresentationPromotionDraft) {
    return this.serialize(() => this.promoteRepresentationUnlocked(draft));
  }

  private async promoteRepresentationUnlocked(
    draft: ProjectRepresentationPromotionDraft
  ): Promise<{ catalog: ProjectRepresentationCatalogRecord; representation: ProjectRepresentationRecord }> {
    const catalog = await this.loadRepresentationCatalog(draft.projectId);
    const result = rules.promoteRepresentation(catalog, draft, catalogEnvironment());
    if (result.catalog !== catalog) await this.saveRepresentationCatalog(result.catalog);
    return result;
  }

  clearActiveRepresentation(projectId: string, viewKind: DiagramViewKind, expectedRepresentationId?: string) {
    return this.serialize(() => this.clearActiveRepresentationUnlocked(projectId, viewKind, expectedRepresentationId));
  }

  private async clearActiveRepresentationUnlocked(
    projectId: string,
    viewKind: DiagramViewKind,
    expectedRepresentationId?: string
  ): Promise<ProjectRepresentationCatalogRecord> {
    const catalog = await this.loadRepresentationCatalog(projectId);
    const result = rules.clearActiveRepresentation(catalog, projectId, viewKind, expectedRepresentationId, catalogEnvironment());
    if (result !== catalog) await this.saveRepresentationCatalog(result);
    return result;
  }

  archiveRepresentation(projectId: string, representationId: string) {
    return this.serialize(() => this.archiveRepresentationUnlocked(projectId, representationId));
  }

  private async archiveRepresentationUnlocked(
    projectId: string,
    representationId: string
  ): Promise<ProjectRepresentationCatalogRecord> {
    const catalog = await this.loadRepresentationCatalog(projectId);
    const result = rules.archiveRepresentation(catalog, projectId, representationId, catalogEnvironment());
    if (result !== catalog) await this.saveRepresentationCatalog(result);
    return result;
  }

  representationForSource(
    catalog: ProjectRepresentationCatalogRecord,
    diagramSetId: string,
    artifactId: string
  ): ProjectRepresentationRecord | undefined {
    const revision = Object.values(catalog.revisions).find((candidate) => (
      candidate.provenance?.diagramSetId === diagramSetId
      && candidate.provenance.artifactId === artifactId
    ));
    return revision ? catalog.representations[revision.representationId] : undefined;
  }
}

function catalogEnvironment(): rules.CatalogEnvironment {
  return {
    timestamp: nowIso(), representationId: `representation-${randomUUID()}`, revisionId: `representation-revision-${randomUUID()}`,
    hash: value => createHash('sha256').update(value).digest('hex'), stableId
  };
}
