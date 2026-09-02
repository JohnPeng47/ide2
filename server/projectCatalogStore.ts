import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  SCHEMA_VERSION,
  assertSafeId,
  assertSourceRange,
  type DiagramViewKind
} from "../src/domain";
import type {
  ProjectCorpusCompactionCatalogRecord,
  ProjectFileCompactionInput,
  ProjectFileCompactionRecord,
  ProjectRepresentationCatalogRecord,
  ProjectRepresentationEvidenceRecord,
  ProjectRepresentationMappingRecord,
  ProjectRepresentationRecord,
  ProjectRepresentationRevisionRecord
} from "../src/projectCatalog";

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

export interface ProjectRepresentationPromotionDraft {
  projectId: string;
  representationId?: string;
  handle: string;
  name: string;
  viewKind: DiagramViewKind;
  representationKind: "tree" | "diagram";
  ascii: string;
  asciiSha256: string;
  evidence: Record<string, ProjectRepresentationEvidenceRecord>;
  mappings: ProjectRepresentationMappingRecord[];
  provenance: {
    diagramSetId: string;
    artifactId: string;
  };
  makeActive: boolean;
}

export class ProjectCatalogStore {
  constructor(readonly storeRoot: string) {}

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
    const profile = input.profile ?? { id: "multilevel-lifecycle", version: 1 };
    assertSafeId(profile.id, "compaction profile id");
    if (!Number.isInteger(profile.version) || profile.version < 1) {
      throw new Error("compaction profile version must be a positive integer");
    }
    assertSourceRange({
      path: input.path,
      startLine: input.startLine,
      endLine: input.endLine,
      originalLines: input.originalLines,
      compactedSource: input.compactedSource
    });
    const expectedLineCount = input.endLine - input.startLine + 1;
    if (input.originalLines.length !== expectedLineCount) {
      throw new Error(`compaction source snapshot length does not match ${input.path}`);
    }
    const sourceSha256 = createHash("sha256")
      .update(input.originalLines.join("\n"))
      .digest("hex");
    const id = stableId(
      "compaction",
      projectId,
      input.path,
      sourceSha256,
      profile.id,
      String(profile.version)
    );
    const catalog = await this.loadCompactionCatalog(projectId);
    const existing = catalog.compactions[id];
    const timestamp = nowIso();
    const proposed: ProjectFileCompactionRecord = {
      schemaVersion: SCHEMA_VERSION,
      id,
      projectId,
      path: input.path,
      ...(input.sourceRevision ? { sourceRevision: input.sourceRevision } : {}),
      sourceSha256,
      startLine: input.startLine,
      endLine: input.endLine,
      originalLines: [...input.originalLines],
      compactedSource: input.compactedSource,
      profile,
      ...(input.provenance ? { provenance: input.provenance } : {}),
      createdAt: existing?.createdAt ?? timestamp,
      updatedAt: existing?.updatedAt ?? timestamp
    };
    if (existing) {
      const comparableExisting = { ...existing, updatedAt: undefined };
      const comparableInput = { ...proposed, updatedAt: undefined };
      if (JSON.stringify(comparableExisting) !== JSON.stringify(comparableInput)) {
        throw new Error(`conflicting Project compaction: ${id}`);
      }
    }
    const compaction = existing ?? proposed;
    const activeByPath = { ...catalog.activeByPath };
    if (input.makeActive !== false) activeByPath[input.path] = id;
    const next: ProjectCorpusCompactionCatalogRecord = {
      ...catalog,
      activeByPath,
      compactions: { ...catalog.compactions, [id]: compaction },
      updatedAt: timestamp
    };
    await this.saveCompactionCatalog(next);
    return { catalog: next, compaction };
  }

  async loadRepresentationCatalog(projectId: string): Promise<ProjectRepresentationCatalogRecord> {
    const stored = await readJsonIfExists<ProjectRepresentationCatalogRecord>(
      this.representationCatalogPath()
    );
    if (!stored) return emptyRepresentationCatalog(projectId);
    if (stored.projectId !== projectId) {
      throw new Error("representation catalog belongs to another Project");
    }
    return stored;
  }

  async saveRepresentationCatalog(catalog: ProjectRepresentationCatalogRecord): Promise<void> {
    await writeJsonAtomic(this.representationCatalogPath(), catalog);
  }

  async promoteRepresentation(
    draft: ProjectRepresentationPromotionDraft
  ): Promise<{ catalog: ProjectRepresentationCatalogRecord; representation: ProjectRepresentationRecord }> {
    const catalog = await this.loadRepresentationCatalog(draft.projectId);
    const representationId = draft.representationId ?? stableId(
      "representation",
      draft.projectId,
      draft.viewKind,
      draft.provenance.diagramSetId,
      draft.provenance.artifactId
    );
    assertSafeId(representationId, "Representation id");
    const current = catalog.representations[representationId];
    if (current && (current.viewKind !== draft.viewKind
      || current.representationKind !== draft.representationKind)) {
      throw new Error("Representation kind cannot change between revisions");
    }
    const existingRevision = current?.revisionIds
      .map((id) => catalog.revisions[id])
      .find((revision) => revision?.asciiSha256 === draft.asciiSha256);
    const revisionNumber = existingRevision?.revision ?? (current?.revisionIds.length ?? 0) + 1;
    const revisionId = existingRevision?.id ?? stableId(
      "representation-revision",
      representationId,
      draft.asciiSha256
    );
    const timestamp = nowIso();
    const revision: ProjectRepresentationRevisionRecord = existingRevision ?? {
      schemaVersion: SCHEMA_VERSION,
      id: revisionId,
      projectId: draft.projectId,
      representationId,
      revision: revisionNumber,
      ascii: draft.ascii,
      asciiSha256: draft.asciiSha256,
      representationKind: draft.representationKind,
      evidence: draft.evidence,
      mappings: draft.mappings,
      provenance: draft.provenance,
      createdAt: timestamp
    };
    const representation: ProjectRepresentationRecord = {
      schemaVersion: SCHEMA_VERSION,
      id: representationId,
      projectId: draft.projectId,
      handle: draft.handle,
      name: draft.name,
      viewKind: draft.viewKind,
      representationKind: draft.representationKind,
      status: "settled",
      currentRevisionId: revisionId,
      revisionIds: current?.revisionIds.includes(revisionId)
        ? current.revisionIds
        : [...(current?.revisionIds ?? []), revisionId],
      createdAt: current?.createdAt ?? timestamp,
      updatedAt: timestamp
    };
    const activeByKind = { ...catalog.activeByKind };
    if (draft.makeActive) activeByKind[draft.viewKind] = representationId;
    const next: ProjectRepresentationCatalogRecord = {
      ...catalog,
      activeByKind,
      representations: { ...catalog.representations, [representationId]: representation },
      revisions: { ...catalog.revisions, [revisionId]: revision },
      updatedAt: timestamp
    };
    await this.saveRepresentationCatalog(next);
    return { catalog: next, representation };
  }

  async clearActiveRepresentation(
    projectId: string,
    viewKind: DiagramViewKind,
    expectedRepresentationId?: string
  ): Promise<ProjectRepresentationCatalogRecord> {
    const catalog = await this.loadRepresentationCatalog(projectId);
    if (expectedRepresentationId
      && catalog.activeByKind[viewKind] !== expectedRepresentationId) return catalog;
    const activeByKind = { ...catalog.activeByKind };
    delete activeByKind[viewKind];
    const next = { ...catalog, activeByKind, updatedAt: nowIso() };
    await this.saveRepresentationCatalog(next);
    return next;
  }

  async archiveRepresentation(
    projectId: string,
    representationId: string
  ): Promise<ProjectRepresentationCatalogRecord> {
    const catalog = await this.loadRepresentationCatalog(projectId);
    const representation = catalog.representations[representationId];
    if (!representation) throw new Error(`unknown Project representation: ${representationId}`);
    if (representation.status === "archived") return catalog;
    const activeByKind = { ...catalog.activeByKind };
    for (const [viewKind, activeId] of Object.entries(activeByKind)) {
      if (activeId === representationId) delete activeByKind[viewKind as DiagramViewKind];
    }
    const timestamp = nowIso();
    const next: ProjectRepresentationCatalogRecord = {
      ...catalog,
      activeByKind,
      representations: {
        ...catalog.representations,
        [representationId]: { ...representation, status: "archived", updatedAt: timestamp }
      },
      updatedAt: timestamp
    };
    await this.saveRepresentationCatalog(next);
    return next;
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
