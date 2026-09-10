import { describe, expect, it } from "vitest";
import {
  buildProjectionTree,
  projectSelection,
  validateProjection,
  type ProjectProjectionRecord
} from "./diagramProjection";
import type { ProjectRepresentationCatalogRecord, ProjectRepresentationRecord, ProjectRepresentationRevisionRecord } from "./projectCatalog";

function fixture() {
  const source: ProjectRepresentationRevisionRecord = {
    schemaVersion: 1, id: "source-r1", projectId: "p", representationId: "source", revision: 1,
    ascii: "source", asciiSha256: "source-hash", representationKind: "diagram", mappings: [], createdAt: "now",
    evidence: Object.fromEntries(["a", "b", "c"].map((id) => [id, {
      id, handle: id, label: id, category: "operation", summary: id, sourceRanges: []
    }]))
  };
  const target: ProjectRepresentationRevisionRecord = {
    ...source, id: "target-r1", representationId: "target", representationKind: "tree", evidence: {},
    asciiSha256: "target-hash",
    ascii: "root\n+-- a\n|   +-- a1\n|   |   \\-- detail\n|   \\-- a2\n+-- b\n|   +-- b1\n|   \\-- b2\n\\-- unrelated"
  };
  const tree = buildProjectionTree(target);
  const node = (text: string) => Object.values(tree.nodes).find((entry) => entry.text === text)!.id;
  const representation = (revision: ProjectRepresentationRevisionRecord): ProjectRepresentationRecord => ({
    schemaVersion: 1, id: revision.representationId, projectId: "p", handle: revision.representationId,
    name: revision.representationId, viewKind: "diagram", representationKind: revision.representationKind,
    status: "settled", currentRevisionId: revision.id, revisionIds: [revision.id], createdAt: "now", updatedAt: "now"
  });
  const catalog: ProjectRepresentationCatalogRecord = {
    schemaVersion: 1, projectId: "p", activeByKind: {}, createdAt: "now", updatedAt: "now",
    representations: { source: representation(source), target: representation(target) },
    revisions: { [source.id]: source, [target.id]: target }
  };
  const projection: ProjectProjectionRecord = {
    id: "projection", projectId: "p", name: "Projection", sourceRepresentationId: "source", sourceRevisionId: source.id,
    targetRepresentationId: "target", targetRevisionId: target.id, match: "any",
    links: [
      { sourceEvidenceIds: ["b", "c"], targetNodeIds: [node("a1")] },
      { sourceEvidenceIds: ["c"], targetNodeIds: [node("b2")] }
    ]
  };
  return { source, target, tree, node, catalog, projection };
}

describe("deterministic diagram projections", () => {
  it("OR-matches evidence, includes descendants and only required ancestors, and redraws connectors", () => {
    const { target, projection, node, catalog } = fixture();
    expect(() => validateProjection(projection, catalog)).not.toThrow();
    const result = projectSelection(projection, target, ["a", "b", "c", "c"]);
    expect(result.ascii).toBe("root\n+-- a\n|   \\-- a1\n|       \\-- detail\n\\-- b\n    \\-- b2");
    expect(result.matchedSourceEvidenceIds).toEqual(["b", "c"]);
    expect(result.unmatchedSourceEvidenceIds).toEqual(["a"]);
    expect(result.targetNodeIds).toEqual([node("a1"), node("b2")]);
    expect(result.visibleNodeIds).toEqual(["root", "a", "a1", "detail", "b", "b2"].map(node));
    expect(result.projectedNodeIds).toEqual(["a1", "detail", "b2"].map(node));
    expect(result.rows).toEqual([1, 2, 3, 4, 6, 8].map((sourceLine, index) => ({
      sourceLine, nodeId: result.visibleNodeIds[index]
    })));
  });

  it("treats b alone as a match for the grouped link and c as matching both links", () => {
    const { projection, target, node } = fixture();
    expect(projectSelection(projection, target, ["b"]).targetNodeIds).toEqual([node("a1")]);
    expect(projectSelection(projection, target, ["c"]).targetNodeIds).toEqual([node("a1"), node("b2")]);
  });

  it("returns a genuinely empty view for empty or unmatched selections", () => {
    const { projection, target } = fixture();
    expect(projectSelection(projection, target, [])).toEqual({
      ascii: "", matchedSourceEvidenceIds: [], unmatchedSourceEvidenceIds: [], targetNodeIds: [], visibleNodeIds: [], projectedNodeIds: [], rows: []
    });
    expect(projectSelection(projection, target, ["a"])).toMatchObject({ ascii: "", unmatchedSourceEvidenceIds: ["a"] });
  });

  it("deduplicates overlapping target subtrees and preserves original sibling order", () => {
    const { projection, target, node } = fixture();
    projection.links = [{ sourceEvidenceIds: ["b"], targetNodeIds: [node("b2"), node("a"), node("a1"), node("a")] }];
    const result = projectSelection(projection, target, ["b"]);
    expect(result.targetNodeIds).toEqual([node("a"), node("a1"), node("b2")]);
    expect(result.rows.map((row) => row.sourceLine)).toEqual([1, 2, 3, 4, 5, 6, 8]);
  });

  it("distinguishes repeated branch text and scopes identity to both revision and ASCII hash", () => {
    const { target } = fixture();
    target.ascii = "root\n+-- repeated\n\\-- repeated";
    const nodes = Object.values(buildProjectionTree(target).nodes);
    expect(nodes[1].id).not.toBe(nodes[2].id);
    expect(nodes[1].parentId).toBe(nodes[0].id);
    expect(Object.keys(buildProjectionTree({ ...target, id: "target-r2" }).nodes)).not.toContain(nodes[1].id);
    expect(Object.keys(buildProjectionTree({ ...target, asciiSha256: "other-hash" }).nodes)).not.toContain(nodes[1].id);
  });

  it.each([
    ["wrong project", (f: ReturnType<typeof fixture>) => { f.projection.projectId = "other"; }],
    ["foreign source revision", (f: ReturnType<typeof fixture>) => { f.source.representationId = "other"; }],
    ["unowned target revision", (f: ReturnType<typeof fixture>) => { f.catalog.representations.target.revisionIds = []; }],
    ["non-tree target", (f: ReturnType<typeof fixture>) => { f.target.representationKind = "diagram"; }],
    ["missing evidence", (f: ReturnType<typeof fixture>) => { f.projection.links[0].sourceEvidenceIds = ["missing"]; }],
    ["missing target", (f: ReturnType<typeof fixture>) => { f.projection.links[0].targetNodeIds = ["missing"]; }],
    ["empty source IDs", (f: ReturnType<typeof fixture>) => { f.projection.links[0].sourceEvidenceIds = []; }],
    ["empty target IDs", (f: ReturnType<typeof fixture>) => { f.projection.links[0].targetNodeIds = []; }],
    ["no links", (f: ReturnType<typeof fixture>) => { f.projection.links = []; }]
  ])("rejects %s", (_label, mutate) => {
    const f = fixture();
    mutate(f);
    expect(() => validateProjection(f.projection, f.catalog)).toThrow();
  });

  it.each([null, [], { links: [null] }, { links: "invalid" }])("rejects malformed runtime input %j", (value) => {
    const { catalog, projection } = fixture();
    const malformed = value && !Array.isArray(value) ? { ...projection, ...value } : value;
    expect(() => validateProjection(malformed as unknown as ProjectProjectionRecord, catalog)).toThrow();
  });

  it("rejects inherited IDs, malformed ID arrays, and stale preview revisions", () => {
    const { projection, target, catalog } = fixture();
    projection.links[0].sourceEvidenceIds = ["toString"];
    expect(() => validateProjection(projection, catalog)).toThrow(/unknown source evidence/);
    projection.links[0].sourceEvidenceIds = [null as unknown as string];
    expect(() => validateProjection(projection, catalog)).toThrow(/nonempty string/);
    projection.links[0].sourceEvidenceIds = ["b"];
    expect(() => projectSelection(projection, { ...target, id: "other" }, ["b"])).toThrow(/pinned revision/);
  });

  it.each(["__proto__", "constructor", "prototype"])("rejects reserved identifier %s", (unsafeId) => {
    const { projection, catalog } = fixture();
    projection.id = unsafeId;
    expect(() => validateProjection(projection, catalog)).toThrow(/reserved identifier/);
  });
});
