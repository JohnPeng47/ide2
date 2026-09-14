import { createHash, randomUUID } from "node:crypto";
import {
  mkdir,
  readFile,
  readdir,
  rename,
  writeFile
} from "node:fs/promises";
import path from "node:path";
import { applyPlanPatch, validatePlanRecord } from "../../../domain/core/plans/plans";
import {
  SCHEMA_VERSION,
  type PlanDiagramSelection,
  type PlanRecord
} from "../../../domain/core/records/domain";
import type { PersistenceContext } from './context';
import { planChangePath, planChangeRoot, planManifestPath, planMarkdownPath, planRoot, planSelectionPath, plansRoot } from './paths';
import { loadProject } from './projects';
import { PersistedCompactionArtifact, PersistedModifiedDiagramChange, PersistedPlanChangeReference, PersistedPlanManifest, readJson, writeJsonAtomic } from './shared';

export async function loadPlan(context: PersistenceContext, planId: string): Promise<PlanRecord> {
  const manifest = await readJson<PersistedPlanManifest>(planManifestPath(context, planId));
  if (manifest.markdownPath !== "plan.md") {
    throw new Error(`unsupported Plan Markdown path: ${manifest.markdownPath}`);
  }
  if (manifest.selectionPath !== "selection.json") {
    throw new Error(`unsupported Plan selection path: ${String(manifest.selectionPath)}`);
  }
  const selectionArtifact = await readJson<PlanDiagramSelection & { schemaVersion: number }>(
    planSelectionPath(context, planId)
  );
  const { schemaVersion: _selectionSchemaVersion, ...selection } = selectionArtifact;
  const changes = await Promise.all(manifest.changes.map(async (reference) => {
    const expectedPath = `changes/${reference.id}/change.json`;
    if (reference.path !== expectedPath) {
      throw new Error(`unsupported Plan change path: ${reference.path}`);
    }
    const stored = await readJson<Record<string, unknown>>(
      planChangePath(context, planId, reference.id, "change.json")
    );
    if (stored.id !== reference.id || stored.kind !== reference.kind) {
      throw new Error(`Plan change reference does not match ${reference.path}`);
    }
    if (reference.kind === "diagram-modified") {
      if (stored.basePath !== "base.txt" || stored.outputPath !== "output.txt") {
        throw new Error(`modified Plan change ${reference.id} has unsupported artifact paths`);
      }
      if (stored.semanticDiffPath !== undefined && stored.semanticDiffPath !== "semantic-diff.json") {
        throw new Error(`modified Plan change ${reference.id} has an unsupported semantic diff path`);
      }
      const baseAscii = await readFile(planChangePath(context, planId, reference.id, "base.txt"), "utf8");
      const outputAscii = await readFile(planChangePath(context, planId, reference.id, "output.txt"), "utf8");
      const semanticDiff = stored.semanticDiffPath === "semantic-diff.json"
        ? await readJson<Record<string, unknown>>(
          planChangePath(context, planId, reference.id, "semantic-diff.json")
        )
        : undefined;
      const {
        schemaVersion: _schemaVersion,
        basePath: _basePath,
        outputPath: _outputPath,
        semanticDiffPath: _semanticDiffPath,
        baseDiagram,
        ...change
      } = stored;
      if (!baseDiagram || typeof baseDiagram !== "object" || Array.isArray(baseDiagram)) {
        throw new Error(`modified Plan change ${reference.id} has no base Diagram metadata`);
      }
      return {
        ...change,
        baseDiagram: { ...baseDiagram, ascii: baseAscii },
        outputAscii,
        ...(semanticDiff ? { semanticDiff } : {})
      };
    }
    if (reference.kind === "diagram-added") {
      if (stored.outputPath !== "output.txt"
        || !stored.draft
        || typeof stored.draft !== "object"
        || Array.isArray(stored.draft)) {
        throw new Error(`added Plan change ${reference.id} has an invalid output artifact`);
      }
      const ascii = await readFile(planChangePath(context, planId, reference.id, "output.txt"), "utf8");
      const { schemaVersion: _schemaVersion, outputPath: _outputPath, draft, ...change } = stored;
      return { ...change, draft: { ...draft, ascii } };
    }
    if (stored.basePath !== "base.json" || stored.outputPath !== "output.json") {
      throw new Error(`compaction Plan change ${reference.id} has unsupported artifact paths`);
    }
    const base = await readJson<PersistedCompactionArtifact>(
      planChangePath(context, planId, reference.id, "base.json")
    );
    const output = await readJson<PersistedCompactionArtifact>(
      planChangePath(context, planId, reference.id, "output.json")
    );
    if (!output.compactedSource) {
      throw new Error(`compaction Plan change ${reference.id} has no output`);
    }
    const {
      schemaVersion: _schemaVersion,
      basePath: _basePath,
      outputPath: _outputPath,
      ...change
    } = stored;
    return {
      ...change,
      ...(base.compactedSource ? { baseCompactedSource: base.compactedSource } : {}),
      compactedSource: output.compactedSource
    };
  }));
  const plan = validatePlanRecord({
    ...manifest,
    markdown: await readFile(planMarkdownPath(context, planId), "utf8"),
    selection,
    changes
  });
  assertPlanArtifacts(context, plan);
  return plan;
}

export async function loadPlans(context: PersistenceContext): Promise<PlanRecord[]> {
  const entries = await readdir(plansRoot(context), { withFileTypes: true }).catch((error) => {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  });
  const ids = entries.filter((entry) => entry.isDirectory()).map((entry) => entry.name).sort();
  return Promise.all(ids.map((id) => loadPlan(context, id)));
}

export async function savePlan(context: PersistenceContext, input: PlanRecord): Promise<PlanRecord> {
  const plan = validatePlanRecord(input);
  assertPlanArtifacts(context, plan);
  const project = await loadProject(context);
  if (!project || project.id !== plan.projectId) throw new Error("Plan belongs to another project");
  const { markdown, selection, changes, ...record } = plan;
  const references: PersistedPlanChangeReference[] = [];
  await mkdir(planRoot(context, plan.id), { recursive: true });
  const markdownTemp = path.join(
    planRoot(context, plan.id),
    `.plan.md.${process.pid}.${randomUUID()}.tmp`
  );
  await writeFile(markdownTemp, markdown, "utf8");
  await rename(markdownTemp, planMarkdownPath(context, plan.id));
  await writeJsonAtomic(planSelectionPath(context, plan.id), {
    schemaVersion: SCHEMA_VERSION,
    ...selection
  });
  for (const change of changes) {
    const root = planChangeRoot(context, plan.id, change.id);
    await mkdir(root, { recursive: true });
    const reference: PersistedPlanChangeReference = {
      id: change.id,
      kind: change.kind,
      ...(change.kind === "diagram-modified" ? { mode: change.mode } : {}),
      path: `changes/${change.id}/change.json`
    };
    references.push(reference);
    if (change.kind === "diagram-modified") {
      const {
        baseDiagram,
        outputAscii,
        semanticDiff,
        ...metadata
      } = change;
      const { ascii: _baseAscii, ...baseDiagramMetadata } = baseDiagram;
      await writeFile(path.join(root, "base.txt"), baseDiagram.ascii, "utf8");
      await writeFile(path.join(root, "output.txt"), outputAscii, "utf8");
      if (semanticDiff) {
        await writeJsonAtomic(path.join(root, "semantic-diff.json"), {
          schemaVersion: SCHEMA_VERSION,
          ...semanticDiff
        });
      }
      const persisted: PersistedModifiedDiagramChange = {
        schemaVersion: SCHEMA_VERSION,
        ...metadata,
        baseDiagram: baseDiagramMetadata,
        basePath: "base.txt",
        outputPath: "output.txt",
        ...(semanticDiff ? { semanticDiffPath: "semantic-diff.json" } : {})
      };
      await writeJsonAtomic(path.join(root, "change.json"), persisted);
      continue;
    }
    if (change.kind === "diagram-added") {
      const { ascii, ...draft } = change.draft;
      await writeFile(path.join(root, "output.txt"), ascii, "utf8");
      await writeJsonAtomic(path.join(root, "change.json"), {
        schemaVersion: SCHEMA_VERSION,
        id: change.id,
        kind: change.kind,
        label: change.label,
        draft,
        outputPath: "output.txt",
        ...(change.generation ? { generation: change.generation } : {})
      });
      continue;
    }
    const { baseCompactedSource, compactedSource, ...metadata } = change;
    await writeJsonAtomic(path.join(root, "base.json"), {
      schemaVersion: SCHEMA_VERSION,
      compactedSource: baseCompactedSource ?? null
    });
    await writeJsonAtomic(path.join(root, "output.json"), {
      schemaVersion: SCHEMA_VERSION,
      compactedSource
    });
    await writeJsonAtomic(path.join(root, "change.json"), {
      schemaVersion: SCHEMA_VERSION,
      ...metadata,
      basePath: "base.json",
      outputPath: "output.json"
    });
  }
  const manifest: PersistedPlanManifest = {
    ...record,
    markdownPath: "plan.md",
    selectionPath: "selection.json",
    changes: references
  };
  await writeJsonAtomic(planManifestPath(context, plan.id), manifest);
  return plan;
}

export function assertPlanArtifacts(context: PersistenceContext, plan: PlanRecord): void {
  for (const change of plan.changes) {
    if (change.kind === "diagram-modified") {
      if (change.baseDiagram.id !== change.diagramId
        || change.baseDiagram.diagramSetId !== change.diagramSetId) {
        throw new Error(`modified Plan change ${change.id} base Diagram identity does not match`);
      }
      if (createHash("sha256").update(change.baseDiagram.ascii).digest("hex")
        !== change.baseAsciiSha256) {
        throw new Error(`modified Plan change ${change.id} base hash does not match its snapshot`);
      }
      if (applyPlanPatch(change.baseDiagram.ascii, change.patch) !== change.outputAscii) {
        throw new Error(`modified Plan change ${change.id} output does not match its patch`);
      }
      if (change.mode === "complete"
        && (change.patch.start !== 0 || change.patch.deletedText !== change.baseDiagram.ascii)) {
        throw new Error(`complete Plan change ${change.id} must replace the entire base Diagram`);
      }
      continue;
    }
    if (change.kind !== "code-entity-compaction") continue;
    if (change.baseEntity.id !== change.codeEntityId) {
      throw new Error(`compaction Plan change ${change.id} base CodeEntity identity does not match`);
    }
    const range = change.baseEntity.sourceRanges.find(
      (candidate) => candidate.id === change.sourceRangeId
    );
    if (!range || JSON.stringify(range.compactedSource) !== JSON.stringify(change.baseCompactedSource)) {
      throw new Error(`compaction Plan change ${change.id} base snapshot does not match`);
    }
  }
}
