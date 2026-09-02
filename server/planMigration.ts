import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { asciiSha256 } from "../src/asciiSha256";
import {
  SCHEMA_VERSION,
  assertSafeId,
  type PlanChange,
  type PlanCodeEntityCompactionChange,
  type PlanRecord,
  type TextPatch
} from "../src/domain";
import { applyPlanPatch, unavailablePlanSelection } from "../src/plans";
import { DiagramStore } from "./store";

interface LegacyPlanManifest {
  schemaVersion: typeof SCHEMA_VERSION;
  id: string;
  projectId: string;
  title: string;
  status: PlanRecord["status"];
  markdownPath: "plan.md";
  changes: Array<Record<string, unknown>>;
  createdAt: string;
  updatedAt: string;
}

export interface PlanMigrationResult {
  migratedPlanIds: string[];
  skippedPlanIds: string[];
}

function legacyManifest(value: unknown, expectedId: string): LegacyPlanManifest {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`legacy Plan ${expectedId} manifest is invalid`);
  }
  const record = value as Record<string, unknown>;
  if (record.schemaVersion !== SCHEMA_VERSION
    || record.id !== expectedId
    || record.markdownPath !== "plan.md"
    || !Array.isArray(record.changes)) {
    throw new Error(`legacy Plan ${expectedId} manifest is invalid`);
  }
  return record as unknown as LegacyPlanManifest;
}

function sameValue(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

async function migrateChange(
  store: DiagramStore,
  value: Record<string, unknown>
): Promise<PlanChange> {
  const id = String(value.id ?? "");
  assertSafeId(id, "legacy Plan change id");
  if (value.kind === "diagram-modified") {
    const diagramSetId = String(value.diagramSetId ?? "");
    const diagramId = String(value.diagramId ?? "");
    const baseDiagram = await store.loadDiagram(diagramSetId, diagramId);
    const baseAsciiSha256 = String(value.baseAsciiSha256 ?? "");
    if (asciiSha256(baseDiagram.ascii) !== baseAsciiSha256) {
      throw new Error(
        `cannot migrate Plan change ${id}: canonical Diagram no longer matches its base hash`
      );
    }
    const patch = value.patch as TextPatch;
    if (!patch
      || !Number.isInteger(patch.start)
      || typeof patch.deletedText !== "string"
      || typeof patch.insertedText !== "string") {
      throw new Error(`cannot migrate Plan change ${id}: text patch is invalid`);
    }
    const outputAscii = applyPlanPatch(baseDiagram.ascii, patch);
    const complete = patch.start === 0 && patch.deletedText === baseDiagram.ascii;
    return {
      id,
      kind: "diagram-modified",
      mode: complete ? "complete" : "partial",
      diagramSetId,
      diagramId,
      label: String(value.label ?? baseDiagram.name),
      baseDiagram,
      baseAsciiSha256,
      patch,
      outputAscii,
      ...(value.semanticDiff === undefined
        ? {}
        : { semanticDiff: value.semanticDiff as NonNullable<Extract<PlanChange, { kind: "diagram-modified" }>["semanticDiff"]> }),
      generation: {
        availability: "unavailable",
        contextDiagramIds: []
      }
    };
  }
  if (value.kind === "diagram-added") {
    if (!value.draft || typeof value.draft !== "object" || Array.isArray(value.draft)) {
      throw new Error(`cannot migrate Plan change ${id}: added Diagram draft is invalid`);
    }
    return {
      id,
      kind: "diagram-added",
      label: String(value.label ?? id),
      draft: value.draft as Extract<PlanChange, { kind: "diagram-added" }>["draft"],
      generation: {
        availability: "unavailable",
        contextDiagramIds: []
      }
    };
  }
  if (value.kind === "code-entity-compaction") {
    const diagramSetId = String(value.diagramSetId ?? "");
    const codeEntityId = String(value.codeEntityId ?? "");
    const sourceRangeId = String(value.sourceRangeId ?? "");
    const local = await store.loadCodeEntities(diagramSetId).catch(() => null);
    const baseEntity = local?.entities.find((entity) => entity.id === codeEntityId)
      ?? await store.loadImportedCodeEntity(codeEntityId).catch(() => undefined);
    if (!baseEntity) throw new Error(`cannot migrate Plan change ${id}: CodeEntity is unavailable`);
    const range = baseEntity.sourceRanges.find((candidate) => candidate.id === sourceRangeId);
    if (!range || !sameValue(range.compactedSource, value.baseCompactedSource)) {
      throw new Error(`cannot migrate Plan change ${id}: CodeEntity compaction base changed`);
    }
    return {
      id,
      kind: "code-entity-compaction",
      diagramSetId,
      codeEntityId,
      sourceRangeId,
      label: String(value.label ?? baseEntity.label),
      baseEntity,
      ...(value.baseCompactedSource === undefined
        ? {}
        : { baseCompactedSource: value.baseCompactedSource as PlanCodeEntityCompactionChange["baseCompactedSource"] }),
      compactedSource: value.compactedSource as PlanCodeEntityCompactionChange["compactedSource"]
    };
  }
  throw new Error(`cannot migrate Plan change ${id}: unsupported kind ${String(value.kind)}`);
}

/** One-time converter. Runtime Plan loading intentionally does not accept legacy inline manifests. */
export async function migrateLegacyPlanBundles(store: DiagramStore): Promise<PlanMigrationResult> {
  const plansRoot = path.join(store.storeRoot, "plans");
  const entries = await readdir(plansRoot, { withFileTypes: true }).catch((error) => {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  });
  const result: PlanMigrationResult = { migratedPlanIds: [], skippedPlanIds: [] };
  for (const entry of entries.filter((candidate) => candidate.isDirectory())) {
    assertSafeId(entry.name, "Plan directory id");
    const root = path.join(plansRoot, entry.name);
    const manifestPath = path.join(root, "plan.json");
    const rawText = await readFile(manifestPath, "utf8");
    const raw = JSON.parse(rawText) as Record<string, unknown>;
    if (raw.selectionPath === "selection.json") {
      result.skippedPlanIds.push(entry.name);
      continue;
    }
    const legacy = legacyManifest(raw, entry.name);
    const changes = await Promise.all(legacy.changes.map((change) => migrateChange(store, change)));
    const migratedAt = new Date().toISOString();
    const plan: PlanRecord = {
      schemaVersion: SCHEMA_VERSION,
      id: legacy.id,
      projectId: legacy.projectId,
      title: legacy.title,
      status: legacy.status,
      markdown: await readFile(path.join(root, legacy.markdownPath), "utf8"),
      selection: unavailablePlanSelection(),
      changes,
      migration: {
        sourceFormat: "legacy-inline-plan",
        migratedAt,
        missingMetadata: ["diagram-selection", "generation-prompt", "generation-context"]
      },
      createdAt: legacy.createdAt,
      updatedAt: legacy.updatedAt
    };

    // Preserve the exact source manifest. savePlan replaces plan.json only after all bundle
    // artifacts have been written and validated, so a failed conversion remains loadable by
    // the old implementation.
    await mkdir(root, { recursive: true });
    await writeFile(path.join(root, "legacy-plan.json"), rawText, "utf8");
    await store.savePlan(plan);
    await store.loadPlan(plan.id);
    result.migratedPlanIds.push(plan.id);
  }
  return result;
}
