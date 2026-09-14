import { describe, expect, it } from "vitest";
import type { DiagramHighlightRecord } from "../../records/domain";
import {
  HIGHLIGHT_RECORD_VERSION,
  highlightTreeViewLabel,
  isHighlightRecordV2,
  migrateDiagramHighlightRecord,
  migrateDiagramHighlightRecords,
  validateHighlightRecordV2,
  type HighlightRecordV2
} from "../highlights";
import { buildTreeRepresentationIndex, representationElementIdForMapping } from "../../representations/representationIndex";

const SHA = "a".repeat(64);

function treeHighlight(): HighlightRecordV2 {
  return {
    schemaVersion: HIGHLIGHT_RECORD_VERSION,
    id: "highlight-1",
    projectId: "project-1",
    diagramSetId: "set-1",
    artifactKind: "diagram",
    artifactId: "artifact-1",
    artifactName: "Interview map",
    artifactRevision: { artifactId: "artifact-1", asciiSha256: SHA },
    representationKind: "tree",
    representationElementId: "tree:artifact:0.0",
    elementText: "A detailed claim",
    evidence: { evidenceId: "evidence-1", sourceRangeId: "range-1", sourceRangeIndex: 0 },
    treeLineage: [
      { representationElementId: "tree:artifact:0", line: 1, text: "Topic" },
      { representationElementId: "tree:artifact:0.0", line: 2, text: "A detailed claim" }
    ],
    documentExcerpt: { path: "transcript.txt", startLine: 8, endLine: 9, lines: ["one", "two"] },
    createdAt: "2026-08-31T12:00:00.000Z"
  };
}

describe("HighlightRecordV2", () => {
  it("validates tree and diagram highlights", () => {
    const tree = treeHighlight();
    expect(validateHighlightRecordV2(tree)).toBe(tree);
    expect(isHighlightRecordV2(tree)).toBe(true);

    const { treeLineage: _lineage, ...common } = tree;
    const diagram: HighlightRecordV2 = {
      ...common,
      representationKind: "diagram",
      representationElementId: "diagram:artifact:mapping-1"
    };
    expect(isHighlightRecordV2(diagram)).toBe(true);
  });

  it("rejects revision, structural lineage, evidence, and excerpt inconsistencies", () => {
    const valid = treeHighlight();
    expect(() => validateHighlightRecordV2({
      ...valid,
      artifactRevision: { ...valid.artifactRevision, artifactId: "other" }
    })).toThrow(/artifactRevision\.artifactId/);
    expect(() => validateHighlightRecordV2({ ...valid, treeLineage: [] })).toThrow(/treeLineage/);
    expect(() => validateHighlightRecordV2({
      ...valid,
      evidence: { ...valid.evidence, sourceRangeIndex: -1 }
    })).toThrow(/sourceRangeIndex/);
    expect(() => validateHighlightRecordV2({
      ...valid,
      documentExcerpt: { ...valid.documentExcerpt!, lines: ["one"] }
    })).toThrow(/inclusive line range/);
    expect(isHighlightRecordV2({ ...valid, representationKind: "diagram" })).toBe(false);
  });

  it("builds a normalized, Unicode-safe, deterministically truncated label", () => {
    const highlight = { ...treeHighlight(), elementText: "  First\n\tsecond 🧠 third  " };
    expect(highlightTreeViewLabel(highlight, 16)).toBe("First second 🧠…");
    expect(highlightTreeViewLabel(highlight, 80)).toBe("First second 🧠 third");
    expect(() => highlightTreeViewLabel(highlight, 1)).toThrow(/at least 2/);
  });
});

describe("legacy highlight migration", () => {
  const ascii = "+--> Topic\n     `--> A detailed claim";
  const index = buildTreeRepresentationIndex({
    revision: { artifactId: "artifact-1", asciiSha256: SHA },
    ascii,
    codeEntityMap: {
      schemaVersion: 1,
      diagramSetId: "set-1",
      artifactKind: "diagram",
      artifactId: "artifact-1",
      asciiSha256: SHA,
      mappings: [{
        id: "mapping-1",
        entityId: "evidence-1",
        sourceRangeId: "range-1",
        sourceRangeIndex: 0,
        line: 2,
        startColumn: 11,
        endColumn: 26
      }],
      producedByRunId: "run-1",
      createdAt: "2026-08-31T12:00:00.000Z"
    }
  });
  const legacy: DiagramHighlightRecord = {
    schemaVersion: 1,
    id: "highlight-legacy",
    projectId: "project-1",
    diagramSetId: "set-1",
    artifactKind: "diagram",
    artifactId: "artifact-1",
    artifactName: "Interview map",
    mappingId: "mapping-1",
    entityId: "evidence-1",
    sourceRangeId: "range-1",
    sourceRangeIndex: 0,
    graphLine: 2,
    nodeText: "A detailed claim",
    lineage: [
      { graphLine: 1, text: "Topic" },
      { graphLine: 2, text: "A detailed claim" }
    ],
    transcript: { path: "transcript.txt", startLine: 8, endLine: 9, lines: ["one", "two"] },
    createdAt: "2026-08-31T12:00:00.000Z"
  };

  it("preserves legacy identity, evidence, lineage text, excerpt, and timestamp", () => {
    const migrated = migrateDiagramHighlightRecord(legacy, index);
    const elementId = representationElementIdForMapping(index, "mapping-1");
    expect(migrated).toMatchObject({
      schemaVersion: 2,
      id: legacy.id,
      projectId: legacy.projectId,
      diagramSetId: legacy.diagramSetId,
      artifactId: legacy.artifactId,
      representationKind: "tree",
      representationElementId: elementId,
      elementText: legacy.nodeText,
      evidence: { evidenceId: "evidence-1", sourceRangeId: "range-1", sourceRangeIndex: 0 },
      documentExcerpt: legacy.transcript,
      createdAt: legacy.createdAt
    });
    expect(migrated.representationKind === "tree" && migrated.treeLineage.map((node) => node.text))
      .toEqual(["Topic", "A detailed claim"]);
    expect(migrated.documentExcerpt?.lines).not.toBe(legacy.transcript.lines);
    expect(migrateDiagramHighlightRecords([legacy], () => index)).toEqual([migrated]);
  });

  it("refuses migration without the exact indexed mapping and revision", () => {
    expect(() => migrateDiagramHighlightRecord({ ...legacy, artifactId: "other" }, index))
      .toThrow(/artifact revision/);
    expect(() => migrateDiagramHighlightRecord({ ...legacy, mappingId: "missing" }, index))
      .toThrow(/not indexed/);
    expect(() => migrateDiagramHighlightRecord({ ...legacy, entityId: "other" }, index))
      .toThrow(/evidence link/);
  });
});
