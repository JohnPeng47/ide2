import { describe, expect, it } from "vitest";
import { asciiSha256 } from "./asciiSha256";
import {
  SCHEMA_VERSION,
  type CodeEntityRecord,
  type PlanCodeEntityCompactionChange,
  type PlanModifiedDiagramChange,
  type PlanRecord,
  type WorkspaceSnapshot
} from "./domain";
import {
  planChangeCounts,
  projectPlanCompaction,
  projectPlanDiagram,
  projectPlanDiagramMappings,
  validatePlanRecord
} from "./plans";

const diagramAscii = "before target after";
const entity: CodeEntityRecord = {
  id: "entity-one",
  handle: "entity-one",
  label: "Entity one",
  category: "operation",
  summary: "One entity",
  sourceRanges: [{ id: "range-one", path: "src/one.ts", startLine: 1, endLine: 3 }]
};
const diagramChange: PlanModifiedDiagramChange = {
  id: "change-diagram",
  kind: "diagram-modified",
  mode: "partial",
  diagramSetId: "set-one",
  diagramId: "diagram-one",
  label: "Diagram one",
  baseDiagram: {
    schemaVersion: SCHEMA_VERSION,
    id: "diagram-one",
    diagramSetId: "set-one",
    viewKind: "diagram",
    handle: "diagram-one",
    name: "Diagram one",
    ascii: diagramAscii,
    representationKind: "diagram",
    codeEntityIds: [entity.id],
    origin: "materialized",
    derivedFromDiagramIds: [],
    createdAt: "2026-09-01T00:00:00.000Z"
  },
  baseAsciiSha256: asciiSha256(diagramAscii),
  patch: { start: 7, deletedText: "target", insertedText: "projected" },
  outputAscii: "before projected after"
};
const compactionChange: PlanCodeEntityCompactionChange = {
  id: "change-compaction",
  kind: "code-entity-compaction",
  diagramSetId: "set-one",
  codeEntityId: "entity-one",
  sourceRangeId: "range-one",
  label: "Entity one",
  baseEntity: entity,
  compactedSource: {
    level: "high",
    sections: [{ kind: "collapsed-comment", startLine: 1, endLine: 3, comment: "details" }]
  }
};
const plan: PlanRecord = {
  schemaVersion: SCHEMA_VERSION,
  id: "plan-one",
  projectId: "project-one",
  title: "Plan one",
  status: "active",
  markdown: "# Plan one",
  selection: {
    availability: "recorded",
    affectedCodeEntities: [{ id: entity.id, sourceRanges: ["src/one.ts:1-3"] }],
    diagramCandidates: [{ diagramId: "diagram-one", decision: "include", reason: "Affected" }],
    selectedDiagramIds: ["diagram-one"]
  },
  changes: [diagramChange, compactionChange],
  createdAt: "2026-09-01T00:00:00.000Z",
  updatedAt: "2026-09-01T00:00:00.000Z"
};
function workspace(): WorkspaceSnapshot {
  return {
    project: {
      schemaVersion: SCHEMA_VERSION,
      id: "project-one",
      name: "Project one",
      repositoryIdentity: "repo-one",
      canonicalRepoRoot: "/repo",
      domainProfileId: "source-code",
      corpus: { kind: "git-worktree", root: "/repo" },
      diagramSetIds: ["set-one"],
      createdAt: plan.createdAt,
      updatedAt: plan.updatedAt
    },
    diagramSets: [{
      schemaVersion: SCHEMA_VERSION,
      id: "set-one",
      projectId: "project-one",
      name: "Set one",
      initialPrompt: "Map it",
      sourceCheckoutRoot: "/repo",
      codeEntitiesSetId: "entities-one",
      featuredViewIds: {},
      diagramIds: ["diagram-one"],
      diagramComponentIds: [],
      generationBatchIds: [],
      agentRunIds: [],
      editSessionIds: [],
      readiness: "ready",
      createdAt: plan.createdAt,
      updatedAt: plan.updatedAt
    }],
    globalImports: {
      schemaVersion: SCHEMA_VERSION,
      diagramIds: [],
      diagramComponentIds: [],
      createdAt: plan.createdAt,
      updatedAt: plan.updatedAt
    },
    codeEntitySets: {
      "entities-one": {
        schemaVersion: SCHEMA_VERSION,
        id: "entities-one",
        diagramSetId: "set-one",
        revision: 1,
        status: "finalized",
        entities: [entity]
      }
    },
    importedCodeEntities: {},
    diagrams: {
      "diagram-one": {
        schemaVersion: SCHEMA_VERSION,
        id: "diagram-one",
        diagramSetId: "set-one",
        viewKind: "diagram",
        handle: "diagram-one",
        name: "Diagram one",
        ascii: diagramAscii,
        representationKind: "diagram",
        codeEntityIds: [entity.id],
        origin: "materialized",
        derivedFromDiagramIds: [],
        createdAt: plan.createdAt
      }
    },
    diagramComponents: {},
    codeEntityPromptConfigs: {},
    codeEntityPromptTemplates: {},
    generationPromptConfigs: {},
    systemPromptTemplates: {},
    generationBatches: {},
    diagramCandidateBatches: {},
    agentRuns: {},
    editSessions: {},
    codeEntityMaps: {}
  };
}

describe("Plan projections", () => {
  it("applies a diagram patch to a view copy without mutating the workspace", () => {
    const source = workspace();
    const before = JSON.stringify(source);
    const projection = projectPlanDiagram(source, plan, diagramChange);

    expect(projection).toMatchObject({ stale: false, diagram: { ascii: "before projected after" } });
    expect(JSON.stringify(source)).toBe(before);
  });

  it("marks a diagram change stale instead of applying it to a changed base", () => {
    const source = workspace();
    source.diagrams["diagram-one"].ascii = "new canonical value";

    expect(projectPlanDiagram(source, plan, diagramChange)).toMatchObject({
      stale: true,
      diagram: { ascii: "before projected after" }
    });
  });

  it("replaces only a cloned range compaction", () => {
    const source = workspace();
    const projection = projectPlanCompaction(source, compactionChange);

    expect(projection.stale).toBe(false);
    expect(projection.entity?.sourceRanges[0].compactedSource?.level).toBe("high");
    expect(source.codeEntitySets["entities-one"].entities[0].sourceRanges[0].compactedSource)
      .toBeUndefined();
  });

  it("validates records and reports category counts", () => {
    expect(validatePlanRecord(plan)).toEqual(plan);
    expect(planChangeCounts(plan)).toEqual({
      modifiedDiagrams: 1,
      addedDiagrams: 0,
      codeEntityCompactions: 1
    });
  });

  it("keeps unaffected evidence mappings aligned through a diagram patch", () => {
    const base = "before link\nreplace me\nafter target";
    const patch = {
      start: base.indexOf("replace me"),
      deletedText: "replace me",
      insertedText: "replacement\nextra"
    };
    const projected = projectPlanDiagramMappings(base, patch, [
      { id: "before", entityId: "one", sourceRangeIndex: 0, line: 1, startColumn: 8, endColumn: 11 },
      { id: "overlap", entityId: "two", sourceRangeIndex: 0, line: 2, startColumn: 1, endColumn: 7 },
      { id: "after", entityId: "three", sourceRangeIndex: 0, line: 3, startColumn: 7, endColumn: 12 }
    ]);

    expect(projected).toEqual([
      { id: "before", entityId: "one", sourceRangeIndex: 0, line: 1, startColumn: 8, endColumn: 11 },
      { id: "after", entityId: "three", sourceRangeIndex: 0, line: 4, startColumn: 7, endColumn: 12 }
    ]);
  });
});
