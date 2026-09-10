import { createHash, randomUUID } from "node:crypto";
import {
  mkdir,
  readFile,
  rename,
  writeFile
} from "node:fs/promises";
import path from "node:path";
import type { CompactionProjectionInput } from "../../src/core/compactionProjection";
import { buildProjectionTree, validateProjection, type ProjectProjectionRecord } from "../../src/core/diagramProjection";
import {
  SCHEMA_VERSION,
  assertSafeId,
  assertSourceRange,
  type DiagramViewKind
} from "../../src/core/domain";
import type {
  ProjectCorpusCompactionCatalogRecord,
  ProjectFileCompactionInput,
  ProjectFileCompactionRecord,
  ProjectRepresentationCatalogRecord,
  ProjectRepresentationEvidenceRecord,
  ProjectRepresentationMappingRecord,
  ProjectRepresentationRecord,
  ProjectRepresentationRevisionRecord
} from "../../src/core/projectCatalog";
import { projectCanvasSnapshot, sceneFromRevision, type SaveProjectDiagramInput } from "../../src/core/projectDiagramCanvas";

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
  expectedRevisionId?: string;
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

/** Generated once; line addresses are resolved to revision-scoped tree IDs on import. */
export interface SaveProjectedTreeInput {
  sourceRepresentationId: string;
  sourceRevisionId: string;
  name: string;
  ascii: string;
  links: { sourceEvidenceIds: string[]; targetLines: number[] }[];
  compactionProjection?: CompactionProjectionInput;
  /** Explicit regeneration appends a revision to an existing projected tree. */
  targetRepresentationId?: string;
  expectedTargetRevisionId?: string;
}

export class ProjectCatalogStore {
  constructor(readonly storeRoot: string) {}

  private representationWrite: Promise<unknown> = Promise.resolve();
  private serialize<T>(write: () => Promise<T>): Promise<T> {
    const result = this.representationWrite.then(write);
    this.representationWrite = result.catch(() => undefined);
    return result;
  }

  saveProjection(projectId: string, projection: ProjectProjectionRecord) {
    return this.serialize(async () => {
      const catalog = await this.loadRepresentationCatalog(projectId);
      validateProjection(projection, catalog);
      const existing = catalog.projections?.[projection.id];
      if (existing && JSON.stringify(existing) !== JSON.stringify(projection)) {
        throw new Error("Projection is immutable; save a new projection for changed links");
      }
      const next = { ...catalog, projections: { ...catalog.projections, [projection.id]: projection }, updatedAt: nowIso() };
      await this.saveRepresentationCatalog(next);
      return { catalog: next, projection };
    });
  }

  /** Persist the generated tree and its relationship in one catalog write. */
  saveProjectedTree(projectId: string, input: SaveProjectedTreeInput) {
    return this.serialize(async () => {
      if (!input || typeof input.name !== "string" || !input.name.trim() || input.name.length > 120
        || typeof input.ascii !== "string" || !input.ascii.trim() || input.ascii.length > 20000
        || !Array.isArray(input.links) || !input.links.length || input.links.length > 2000) {
        throw new Error("A named ASCII tree and projection links are required");
      }
      const catalog = await this.loadRepresentationCatalog(projectId);
      const source = catalog.representations[input.sourceRepresentationId];
      const sourceRevision = catalog.revisions[input.sourceRevisionId];
      if (!source || source.status !== "settled" || source.currentRevisionId !== input.sourceRevisionId
        || sourceRevision?.representationId !== source.id) {
        throw new ProjectDiagramConflict("Source diagram changed or is unavailable; regenerate its projection");
      }
      const asciiSha256 = createHash("sha256").update(input.ascii).digest("hex");
      const mappingSignature = JSON.stringify(input.links);
      const targetId = input.targetRepresentationId ?? stableId("representation", source.id, sourceRevision.id, input.name.trim(), asciiSha256, mappingSignature);
      // Mapping changes also produce a new immutable revision, even when the ASCII is unchanged.
      const revisionId = stableId("representation-revision", targetId, asciiSha256, mappingSignature);
      const existingTarget = input.targetRepresentationId ? catalog.representations[input.targetRepresentationId] : undefined;
      if (input.targetRepresentationId && (!existingTarget || existingTarget.projectId !== projectId
        || existingTarget.status !== "settled" || existingTarget.representationKind !== "tree"
        || !Object.values(catalog.projections ?? {}).some((p) => p.sourceRepresentationId === source.id && p.targetRepresentationId === targetId)
        || (existingTarget.currentRevisionId !== input.expectedTargetRevisionId && existingTarget.currentRevisionId !== revisionId))) {
        throw new ProjectDiagramConflict("Call tree changed or is unavailable; regenerate against its current revision");
      }
      const timestamp = nowIso();
      const revision: ProjectRepresentationRevisionRecord = {
        schemaVersion: 1, id: revisionId, projectId, representationId: targetId,
        revision: existingTarget ? (catalog.revisions[existingTarget.currentRevisionId]?.revision ?? 0) + 1 : 1,
        ascii: input.ascii, asciiSha256, representationKind: "tree", content: { kind: "ascii", ascii: input.ascii },
        evidence: structuredClone(sourceRevision.evidence), mappings: [], createdAt: timestamp
      };
      const tree = buildProjectionTree(revision);
      const byLine = new Map(Object.values(tree.nodes).map((node) => [node.line, node]));
      const lines = input.ascii.split("\n");
      const links = input.links.map((link, linkIndex) => {
        if (!link || !Array.isArray(link.sourceEvidenceIds) || !link.sourceEvidenceIds.length
          || !Array.isArray(link.targetLines) || !link.targetLines.length) throw new Error("Invalid projection link");
        const targetNodeIds = link.targetLines.map((line) => {
          const node = byLine.get(line);
          if (!Number.isInteger(line) || !node) throw new Error(`Projection target row ${line} is not a tree node`);
          for (const evidenceId of link.sourceEvidenceIds) {
            const evidence = sourceRevision.evidence[evidenceId];
            if (!evidence) throw new Error(`Unknown projection source evidence: ${evidenceId}`);
            for (const range of evidence.sourceRanges) {
              const startColumn = lines[line - 1].lastIndexOf(node.text) + 1;
              revision.mappings.push({ id: `projection-map-${linkIndex}-${line}-${evidenceId}-${range.id}`,
                evidenceId, sourceRangeId: range.id, line, startColumn, endColumn: startColumn + node.text.length - 1 });
            }
          }
          return node.id;
        });
        return { sourceEvidenceIds: [...new Set(link.sourceEvidenceIds)], targetNodeIds: [...new Set(targetNodeIds)] };
      });
      const representation: ProjectRepresentationRecord = {
        schemaVersion: 1, id: targetId, projectId, handle: targetId, name: input.name.trim(),
        viewKind: "call-graph", representationKind: "tree", status: "settled", currentRevisionId: revisionId,
        revisionIds: [...new Set([...(existingTarget?.revisionIds ?? []), revisionId])],
        createdAt: existingTarget?.createdAt ?? timestamp, updatedAt: timestamp
      };
      const projection: ProjectProjectionRecord = {
        id: stableId("projection", sourceRevision.id, revisionId, JSON.stringify(links),
          ...(input.compactionProjection ? [JSON.stringify(input.compactionProjection)] : [])), projectId,
        name: input.name.trim(), sourceRepresentationId: source.id, sourceRevisionId: sourceRevision.id,
        targetRepresentationId: targetId, targetRevisionId: revisionId, match: "any", links
      };
      if (input.compactionProjection) {
        const { files, links: compactionLinks } = input.compactionProjection;
        if (!Array.isArray(files) || !Array.isArray(compactionLinks)) throw new Error("Invalid compaction projection");
        for (const file of files) {
          if (typeof file.ascii !== "string" || createHash("sha256").update(file.ascii).digest("hex") !== file.asciiSha256) {
            throw new Error("Compaction snapshot hash mismatch");
          }
        }
        projection.compactionProjection = { files: structuredClone(files), links: compactionLinks.map((link) => {
          const node = byLine.get(link.callTreeLine);
          if (!node) throw new Error(`Unknown call-tree row ${link.callTreeLine}`);
          return { callTreeNodeId: node.id, file: link.file, treeLines: link.treeLines };
        }) };
      }
      // Exact reimports are idempotent; never reset an independently edited target.
      if (catalog.projections?.[projection.id]) return { catalog, representation: catalog.representations[targetId], projection: catalog.projections[projection.id] };
      const next: ProjectRepresentationCatalogRecord = { ...catalog,
        representations: { ...catalog.representations, [targetId]: existingTarget ? representation : catalog.representations[targetId] ?? representation },
        revisions: { ...catalog.revisions, [revisionId]: catalog.revisions[revisionId] ?? revision },
        projections: { ...catalog.projections, [projection.id]: projection }, updatedAt: timestamp };
      validateProjection(projection, next);
      projectCanvasSnapshot(sceneFromRevision(revision), revision.evidence);
      await this.saveRepresentationCatalog(next);
      return { catalog: next, representation: next.representations[targetId], projection };
    });
  }

  saveMappingDiagram(projectId: string, input: SaveProjectDiagramInput) {
    return this.serialize(async () => {
      if (input.projectId && input.projectId !== projectId) throw new Error("Diagram belongs to another Project");
      if (typeof input.name !== "string" || !input.name.trim() || input.name.length > 120) throw new Error("Diagram name must contain 1–120 characters");
      const catalog = await this.loadRepresentationCatalog(projectId);
      const current = input.representationId ? catalog.representations[input.representationId] : undefined;
      if (input.representationId && !current) throw new Error("Project diagram was not found");
      if (current && (current.status === "archived" || current.currentRevisionId !== input.expectedRevisionId)) {
        throw new ProjectDiagramConflict("This diagram has changed. Reload the page to open the latest revision before saving.");
      }
      const sourceId = current?.currentRevisionId ?? input.sourceRevisionId;
      const source = sourceId ? catalog.revisions[sourceId] : undefined;
      if (sourceId && !source) throw new Error("Source revision does not belong to this Project");
      const evidence = source?.evidence ?? {};
      const scene = structuredClone(input.scene);
      const { ascii, mappings } = projectCanvasSnapshot(scene, evidence);
      const timestamp = nowIso();
      const id = current?.id ?? `representation-${randomUUID()}`;
      const revisionId = `representation-revision-${randomUUID()}`;
      const revision: ProjectRepresentationRevisionRecord = {
        schemaVersion: 1, id: revisionId, projectId, representationId: id,
        revision: (current?.revisionIds.length ?? 0) + 1,
        ascii, asciiSha256: createHash("sha256").update(ascii).digest("hex"),
        content: { kind: "mapping-canvas", scene },
        representationKind: current?.representationKind ?? source?.representationKind ?? "diagram",
        evidence, mappings, ...(source?.provenance ? { provenance: source.provenance } : {}), createdAt: timestamp
      };
      const representation: ProjectRepresentationRecord = {
        schemaVersion: 1, id, projectId, handle: current?.handle ?? id, name: input.name.trim(),
        viewKind: current?.viewKind ?? "diagram", representationKind: revision.representationKind,
        status: "settled", currentRevisionId: revisionId, revisionIds: [...(current?.revisionIds ?? []), revisionId],
        createdAt: current?.createdAt ?? timestamp, updatedAt: timestamp
      };
      const next = { ...catalog, representations: { ...catalog.representations, [id]: representation },
        revisions: { ...catalog.revisions, [revisionId]: revision }, updatedAt: timestamp };
      await this.saveRepresentationCatalog(next);
      return { catalog: next, representation };
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
    return { ...stored, revisions: Object.fromEntries(Object.entries(stored.revisions).map(([id, revision]) => [id,
      { ...revision, content: revision.content ?? { kind: "ascii" as const, ascii: revision.ascii } }
    ])) };
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
    const representationId = draft.representationId ?? stableId(
      "representation",
      draft.projectId,
      draft.viewKind,
      draft.provenance.diagramSetId,
      draft.provenance.artifactId
    );
    assertSafeId(representationId, "Representation id");
    const current = catalog.representations[representationId];
    if (draft.expectedRevisionId !== undefined && current?.currentRevisionId !== draft.expectedRevisionId) {
      throw new ProjectDiagramConflict("This diagram has changed. Reload before updating its source mappings.");
    }
    if (current && (current.viewKind !== draft.viewKind
      || current.representationKind !== draft.representationKind)) {
      throw new Error("Representation kind cannot change between revisions");
    }
    const evidenceSignature = JSON.stringify(draft.evidence);
    const mappingSignature = JSON.stringify(draft.mappings);
    const existingRevision = current?.revisionIds
      .map((id) => catalog.revisions[id])
      .find((revision) => revision?.asciiSha256 === draft.asciiSha256
        && JSON.stringify(revision.evidence) === evidenceSignature
        && JSON.stringify(revision.mappings) === mappingSignature);
    const revisionNumber = existingRevision?.revision ?? (current?.revisionIds.length ?? 0) + 1;
    const revisionId = existingRevision?.id ?? stableId(
      "representation-revision",
      representationId,
      draft.asciiSha256,
      evidenceSignature,
      mappingSignature
    );
    const timestamp = nowIso();
    const revision: ProjectRepresentationRevisionRecord = existingRevision ?? {
      schemaVersion: SCHEMA_VERSION,
      id: revisionId,
      projectId: draft.projectId,
      representationId,
      revision: revisionNumber,
      ascii: draft.ascii,
      content: { kind: "ascii", ascii: draft.ascii },
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

  clearActiveRepresentation(projectId: string, viewKind: DiagramViewKind, expectedRepresentationId?: string) {
    return this.serialize(() => this.clearActiveRepresentationUnlocked(projectId, viewKind, expectedRepresentationId));
  }

  private async clearActiveRepresentationUnlocked(
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

  archiveRepresentation(projectId: string, representationId: string) {
    return this.serialize(() => this.archiveRepresentationUnlocked(projectId, representationId));
  }

  private async archiveRepresentationUnlocked(
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

export class ProjectDiagramConflict extends Error {}
