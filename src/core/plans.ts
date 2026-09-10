import { asciiSha256 } from "./asciiSha256";
import {
  SCHEMA_VERSION,
  assertSafeId,
  isDiagramViewKind,
  type CodeEntityRecord,
  type CompactedSource,
  type DiagramElementMapping,
  type DiagramRecord,
  type PlanAddedDiagramChange,
  type PlanChange,
  type PlanCodeEntityCompactionChange,
  type PlanDiagramSelection,
  type PlanGenerationMetadata,
  type PlanModifiedDiagramChange,
  type PlanRecord,
  type TextPatch,
  type WorkspaceSnapshot
} from "./domain";
import { definePartialDiff } from "./partialDiff";

export interface PlanChangeCounts {
  modifiedDiagrams: number;
  addedDiagrams: number;
  codeEntityCompactions: number;
}

export interface PlanDiagramProjection {
  diagram?: DiagramRecord;
  stale: boolean;
  reason?: string;
}

export interface PlanCompactionProjection {
  entity?: CodeEntityRecord;
  sourceRangeIndex?: number;
  stale: boolean;
  reason?: string;
}

function lineStarts(source: string): number[] {
  const starts = [0];
  for (let index = 0; index < source.length; index += 1) {
    if (source[index] === "\n") starts.push(index + 1);
  }
  return starts;
}

function mappingOffsets(
  source: string,
  starts: readonly number[],
  mapping: DiagramElementMapping
): { start: number; end: number } | undefined {
  const lineStart = starts[mapping.line - 1];
  if (lineStart === undefined) return undefined;
  const lineEnd = source.indexOf("\n", lineStart);
  const contentEnd = lineEnd < 0 ? source.length : lineEnd;
  const start = lineStart + mapping.startColumn - 1;
  const end = lineStart + mapping.endColumn;
  return start >= lineStart && end > start && end <= contentEnd ? { start, end } : undefined;
}

function pointAtOffset(starts: readonly number[], offset: number): { line: number; column: number } {
  let low = 0;
  let high = starts.length - 1;
  while (low < high) {
    const middle = Math.ceil((low + high) / 2);
    if (starts[middle] <= offset) low = middle;
    else high = middle - 1;
  }
  return { line: low + 1, column: offset - starts[low] + 1 };
}

/** Keep unaffected evidence links aligned when a Plan projects one ASCII text patch. */
export function projectPlanDiagramMappings(
  baseAscii: string,
  patch: TextPatch,
  mappings: readonly DiagramElementMapping[]
): DiagramElementMapping[] {
  const baseStarts = lineStarts(baseAscii);
  const projectedAscii = applyPlanPatch(baseAscii, patch);
  const projectedStarts = lineStarts(projectedAscii);
  const deletedEnd = patch.start + patch.deletedText.length;
  const offsetDelta = patch.insertedText.length - patch.deletedText.length;
  return mappings.flatMap((mapping) => {
    const offsets = mappingOffsets(baseAscii, baseStarts, mapping);
    if (!offsets) return [];
    const projectedOffsets = offsets.end <= patch.start
      ? offsets
      : offsets.start >= deletedEnd
        ? { start: offsets.start + offsetDelta, end: offsets.end + offsetDelta }
        : undefined;
    if (!projectedOffsets) return [];
    const start = pointAtOffset(projectedStarts, projectedOffsets.start);
    const end = pointAtOffset(projectedStarts, projectedOffsets.end - 1);
    if (start.line !== end.line) return [];
    return [{
      ...mapping,
      line: start.line,
      startColumn: start.column,
      endColumn: end.column
    }];
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function requiredString(value: unknown, label: string): string {
  if (typeof value !== "string" || !value.trim()) throw new Error(`${label} is required`);
  return value;
}

function safeId(value: unknown, label: string): string {
  const id = requiredString(value, label);
  assertSafeId(id, label);
  return id;
}

function parseTextPatch(value: unknown, label: string): TextPatch {
  if (!isRecord(value)
    || !Number.isInteger(value.start)
    || Number(value.start) < 0
    || typeof value.deletedText !== "string"
    || typeof value.insertedText !== "string") {
    throw new Error(`${label} must contain start, deletedText, and insertedText`);
  }
  return {
    start: Number(value.start),
    deletedText: value.deletedText,
    insertedText: value.insertedText
  };
}

function parseCompactedSource(value: unknown, label: string): CompactedSource {
  if (!isRecord(value)
    || !["low", "medium", "high"].includes(String(value.level))
    || !Array.isArray(value.sections)) {
    throw new Error(`${label} is invalid`);
  }
  const sections = value.sections.map((section, index) => {
    if (!isRecord(section)
      || !["source", "collapsed-comment"].includes(String(section.kind))
      || !Number.isInteger(section.startLine)
      || !Number.isInteger(section.endLine)
      || Number(section.startLine) < 1
      || Number(section.endLine) < Number(section.startLine)) {
      throw new Error(`${label}.sections[${index}] is invalid`);
    }
    if (section.kind === "source") {
      return {
        kind: "source" as const,
        startLine: Number(section.startLine),
        endLine: Number(section.endLine)
      };
    }
    if (typeof section.comment !== "string") {
      throw new Error(`${label}.sections[${index}].comment is required`);
    }
    const nodes = section.nodes === undefined ? undefined : Array.isArray(section.nodes)
      ? section.nodes.map((node, nodeIndex) => {
        if (!isRecord(node)
          || !Number.isInteger(node.graphLine)
          || !Number.isInteger(node.startLine)
          || !Number.isInteger(node.endLine)
          || Number(node.graphLine) < 1
          || Number(node.startLine) < 1
          || Number(node.endLine) < Number(node.startLine)) {
          throw new Error(`${label}.sections[${index}].nodes[${nodeIndex}] is invalid`);
        }
        return {
          graphLine: Number(node.graphLine),
          startLine: Number(node.startLine),
          endLine: Number(node.endLine)
        };
      })
      : (() => { throw new Error(`${label}.sections[${index}].nodes must be an array`); })();
    return {
      kind: "collapsed-comment" as const,
      startLine: Number(section.startLine),
      endLine: Number(section.endLine),
      comment: section.comment,
      ...(nodes ? { nodes } : {})
    };
  });
  return { level: value.level as CompactedSource["level"], sections };
}

export function unavailablePlanSelection(): PlanDiagramSelection {
  return {
    availability: "unavailable",
    affectedCodeEntities: [],
    diagramCandidates: [],
    selectedDiagramIds: []
  };
}

function parseStringArray(value: unknown, label: string): string[] {
  if (!Array.isArray(value) || value.some((candidate) => typeof candidate !== "string")) {
    throw new Error(`${label} must be an array of strings`);
  }
  return [...value];
}

function parseSelection(value: unknown): PlanDiagramSelection {
  if (!isRecord(value)
    || (value.availability !== "recorded" && value.availability !== "unavailable")
    || !Array.isArray(value.affectedCodeEntities)
    || !Array.isArray(value.diagramCandidates)) {
    throw new Error("plan selection is invalid");
  }
  return {
    availability: value.availability,
    affectedCodeEntities: value.affectedCodeEntities.map((candidate, index) => {
      if (!isRecord(candidate)) throw new Error(`affected CodeEntity ${index + 1} is invalid`);
      return {
        id: safeId(candidate.id, `affected CodeEntity ${index + 1} id`),
        sourceRanges: parseStringArray(
          candidate.sourceRanges,
          `affected CodeEntity ${index + 1} sourceRanges`
        )
      };
    }),
    diagramCandidates: value.diagramCandidates.map((candidate, index) => {
      if (!isRecord(candidate)
        || (candidate.decision !== "include" && candidate.decision !== "exclude")) {
        throw new Error(`diagram candidate ${index + 1} is invalid`);
      }
      return {
        diagramId: safeId(candidate.diagramId, `diagram candidate ${index + 1} id`),
        decision: candidate.decision,
        reason: requiredString(candidate.reason, `diagram candidate ${index + 1} reason`)
      };
    }),
    selectedDiagramIds: parseStringArray(value.selectedDiagramIds, "selected diagram ids")
  };
}

function parseGeneration(value: unknown): PlanGenerationMetadata | undefined {
  if (value === undefined) return undefined;
  if (!isRecord(value)
    || (value.availability !== "recorded" && value.availability !== "unavailable")) {
    throw new Error("plan generation metadata is invalid");
  }
  return {
    availability: value.availability,
    ...(value.prompt === undefined ? {} : { prompt: requiredString(value.prompt, "generation prompt") }),
    contextDiagramIds: parseStringArray(value.contextDiagramIds, "generation context Diagram ids"),
    ...(value.agentRunId === undefined
      ? {}
      : { agentRunId: safeId(value.agentRunId, "generation AgentRun id") })
  };
}

function parseDiagramSnapshot(value: unknown): DiagramRecord {
  if (!isRecord(value)
    || value.schemaVersion !== SCHEMA_VERSION
    || !isDiagramViewKind(value.viewKind)
    || (value.representationKind !== undefined
      && value.representationKind !== "tree"
      && value.representationKind !== "diagram")) {
    throw new Error("modified diagram base snapshot is invalid");
  }
  const diagram = value as unknown as DiagramRecord;
  safeId(diagram.id, "base Diagram id");
  safeId(diagram.diagramSetId, "base DiagramSet id");
  requiredString(diagram.handle, "base Diagram handle");
  requiredString(diagram.name, "base Diagram name");
  if (typeof diagram.ascii !== "string") throw new Error("base Diagram ASCII is required");
  parseStringArray(diagram.codeEntityIds, "base Diagram CodeEntity ids");
  parseStringArray(diagram.derivedFromDiagramIds, "base Diagram lineage");
  return structuredClone(diagram);
}

function parseCodeEntitySnapshot(value: unknown): CodeEntityRecord {
  if (!isRecord(value) || !Array.isArray(value.sourceRanges)) {
    throw new Error("compaction base CodeEntity snapshot is invalid");
  }
  const entity = value as unknown as CodeEntityRecord;
  safeId(entity.id, "base CodeEntity id");
  requiredString(entity.handle, "base CodeEntity handle");
  requiredString(entity.label, "base CodeEntity label");
  requiredString(entity.summary, "base CodeEntity summary");
  return structuredClone(entity);
}

function parseMigration(value: unknown): PlanRecord["migration"] {
  if (!isRecord(value)
    || value.sourceFormat !== "legacy-inline-plan"
    || !Array.isArray(value.missingMetadata)
    || value.missingMetadata.some((item) => ![
      "diagram-selection",
      "generation-prompt",
      "generation-context"
    ].includes(String(item)))) {
    throw new Error("plan migration metadata is invalid");
  }
  return {
    sourceFormat: "legacy-inline-plan",
    migratedAt: requiredString(value.migratedAt, "plan migration timestamp"),
    missingMetadata: [...value.missingMetadata] as NonNullable<PlanRecord["migration"]>["missingMetadata"]
  };
}

function parseChange(value: unknown, index: number): PlanChange {
  if (!isRecord(value)) throw new Error(`plan change ${index + 1} must be an object`);
  const id = safeId(value.id, `plan change ${index + 1} id`);
  const label = requiredString(value.label, `plan change ${index + 1} label`);
  if (value.kind === "diagram-modified") {
    const generation = parseGeneration(value.generation);
    const semanticDiff = value.semanticDiff === undefined
      ? undefined
      : isRecord(value.semanticDiff) && isRecord(value.semanticDiff.region)
        ? definePartialDiff({
          id: requiredString(value.semanticDiff.id, "semantic diff id"),
          label: typeof value.semanticDiff.label === "string" ? value.semanticDiff.label : undefined,
          region: {
            startLine: Number(value.semanticDiff.region.startLine),
            startColumn: Number(value.semanticDiff.region.startColumn),
            endLine: Number(value.semanticDiff.region.endLine),
            endColumn: Number(value.semanticDiff.region.endColumn)
          },
          expandedAscii: requiredString(value.semanticDiff.expandedAscii, "semantic diff ASCII"),
          padding: isRecord(value.semanticDiff.padding) ? {
            columns: Number(value.semanticDiff.padding.columns),
            lines: Number(value.semanticDiff.padding.lines)
          } : undefined
        })
        : (() => { throw new Error("semantic diff is invalid"); })();
    return {
      id,
      kind: "diagram-modified",
      mode: value.mode === "partial" || value.mode === "complete"
        ? value.mode
        : (() => { throw new Error("modified diagram mode is invalid"); })(),
      diagramSetId: safeId(value.diagramSetId, "modified diagram DiagramSet id"),
      diagramId: safeId(value.diagramId, "modified diagram id"),
      label,
      baseDiagram: parseDiagramSnapshot(value.baseDiagram),
      baseAsciiSha256: requiredString(value.baseAsciiSha256, "modified diagram base hash"),
      patch: parseTextPatch(value.patch, "modified diagram patch"),
      outputAscii: requiredString(value.outputAscii, "modified diagram output ASCII"),
      ...(generation ? { generation } : {}),
      ...(semanticDiff ? { semanticDiff } : {})
    };
  }
  if (value.kind === "diagram-added") {
    const generation = parseGeneration(value.generation);
    if (!isRecord(value.draft) || !isDiagramViewKind(value.draft.viewKind)) {
      throw new Error("added diagram draft is invalid");
    }
    const representationKind = value.draft.representationKind;
    if (representationKind !== "tree" && representationKind !== "diagram") {
      throw new Error("added diagram representationKind is invalid");
    }
    const codeEntityIds = value.draft.codeEntityIds;
    if (!Array.isArray(codeEntityIds) || codeEntityIds.some((candidate) => typeof candidate !== "string")) {
      throw new Error("added diagram codeEntityIds must be strings");
    }
    return {
      id,
      kind: "diagram-added",
      label,
      draft: {
        diagramSetId: safeId(value.draft.diagramSetId, "added diagram DiagramSet id"),
        viewKind: value.draft.viewKind,
        representationKind,
        handle: safeId(value.draft.handle, "added diagram handle"),
        name: requiredString(value.draft.name, "added diagram name"),
        ascii: requiredString(value.draft.ascii, "added diagram ASCII"),
        codeEntityIds: [...codeEntityIds]
      },
      ...(generation ? { generation } : {})
    };
  }
  if (value.kind === "code-entity-compaction") {
    return {
      id,
      kind: "code-entity-compaction",
      diagramSetId: safeId(value.diagramSetId, "compaction DiagramSet id"),
      codeEntityId: safeId(value.codeEntityId, "compaction CodeEntity id"),
      sourceRangeId: safeId(value.sourceRangeId, "compaction source range id"),
      label,
      baseEntity: parseCodeEntitySnapshot(value.baseEntity),
      ...(value.baseCompactedSource === undefined
        ? {}
        : { baseCompactedSource: parseCompactedSource(value.baseCompactedSource, "base compaction") }),
      compactedSource: parseCompactedSource(value.compactedSource, "proposed compaction")
    };
  }
  throw new Error(`unsupported plan change kind: ${String(value.kind)}`);
}

export function validatePlanRecord(value: unknown): PlanRecord {
  if (!isRecord(value)) throw new Error("plan must be an object");
  if (value.schemaVersion !== SCHEMA_VERSION) throw new Error("unsupported plan schema");
  if (!Array.isArray(value.changes)) throw new Error("plan changes must be an array");
  if (!["draft", "active", "complete"].includes(String(value.status))) {
    throw new Error("plan status is invalid");
  }
  return {
    schemaVersion: SCHEMA_VERSION,
    id: safeId(value.id, "plan id"),
    projectId: safeId(value.projectId, "plan project id"),
    title: requiredString(value.title, "plan title"),
    status: value.status as PlanRecord["status"],
    markdown: requiredString(value.markdown, "plan markdown"),
    selection: parseSelection(value.selection),
    changes: value.changes.map(parseChange),
    ...(value.migration === undefined ? {} : { migration: parseMigration(value.migration) }),
    createdAt: requiredString(value.createdAt, "plan createdAt"),
    updatedAt: requiredString(value.updatedAt, "plan updatedAt")
  };
}

export function planChangeCounts(plan: PlanRecord): PlanChangeCounts {
  return {
    modifiedDiagrams: plan.changes.filter((change) => change.kind === "diagram-modified").length,
    addedDiagrams: plan.changes.filter((change) => change.kind === "diagram-added").length,
    codeEntityCompactions: plan.changes.filter(
      (change) => change.kind === "code-entity-compaction"
    ).length
  };
}

export function applyPlanPatch(value: string, patch: TextPatch): string {
  if (value.slice(patch.start, patch.start + patch.deletedText.length) !== patch.deletedText) {
    throw new Error("plan patch no longer matches its base diagram");
  }
  return `${value.slice(0, patch.start)}${patch.insertedText}${value.slice(
    patch.start + patch.deletedText.length
  )}`;
}

export function projectPlanDiagram(
  workspace: WorkspaceSnapshot,
  plan: PlanRecord,
  change: PlanModifiedDiagramChange | PlanAddedDiagramChange
): PlanDiagramProjection {
  if (change.kind === "diagram-added") {
    const draft = change.draft;
    return {
      stale: false,
      diagram: {
        schemaVersion: SCHEMA_VERSION,
        id: `plan-${plan.id}-${change.id}`,
        diagramSetId: draft.diagramSetId,
        viewKind: draft.viewKind,
        handle: draft.handle,
        name: draft.name,
        ascii: draft.ascii,
        representationKind: draft.representationKind,
        codeEntityIds: [...draft.codeEntityIds],
        origin: "materialized",
        derivedFromDiagramIds: [],
        createdAt: plan.updatedAt
      }
    };
  }
  const projected = { ...change.baseDiagram, ascii: change.outputAscii };
  const canonical = workspace.diagrams[change.diagramId];
  if (!canonical) {
    return {
      diagram: projected,
      stale: true,
      reason: "The base diagram is no longer available; showing the persisted Plan output."
    };
  }
  if (asciiSha256(canonical.ascii) !== change.baseAsciiSha256) {
    return {
      diagram: projected,
      stale: true,
      reason: "The base diagram changed after this Plan was recorded; showing the persisted Plan output."
    };
  }
  return { stale: false, diagram: projected };
}

function entityForChange(
  workspace: WorkspaceSnapshot,
  change: PlanCodeEntityCompactionChange
): CodeEntityRecord | undefined {
  const localSet = workspace.diagramSets.find((set) => set.id === change.diagramSetId);
  const localEntity = localSet
    ? workspace.codeEntitySets[localSet.codeEntitiesSetId]?.entities.find(
      (entity) => entity.id === change.codeEntityId
    )
    : undefined;
  return localEntity ?? workspace.importedCodeEntities[change.codeEntityId];
}

export function projectPlanCompaction(
  workspace: WorkspaceSnapshot,
  change: PlanCodeEntityCompactionChange
): PlanCompactionProjection {
  const canonical = entityForChange(workspace, change);
  const sourceRangeIndex = change.baseEntity.sourceRanges.findIndex(
    (range) => range.id === change.sourceRangeId
  );
  if (sourceRangeIndex < 0) {
    return {
      entity: { ...change.baseEntity },
      stale: true,
      reason: "The persisted source range snapshot is unavailable."
    };
  }
  const sourceRanges = change.baseEntity.sourceRanges.map((candidate, index) => index === sourceRangeIndex
    ? { ...candidate, compactedSource: change.compactedSource }
    : { ...candidate });
  const projected = { ...change.baseEntity, sourceRanges };
  if (!canonical) {
    return {
      entity: projected,
      sourceRangeIndex,
      stale: true,
      reason: "The CodeEntity is no longer available; showing the persisted Plan output."
    };
  }
  const canonicalRange = canonical.sourceRanges.find((range) => range.id === change.sourceRangeId);
  const stale = !canonicalRange
    || JSON.stringify(canonicalRange.compactedSource) !== JSON.stringify(change.baseCompactedSource);
  return {
    entity: projected,
    sourceRangeIndex,
    stale,
    ...(stale ? { reason: "The source compaction changed after this Plan was recorded; showing the persisted Plan output." } : {})
  };
}
