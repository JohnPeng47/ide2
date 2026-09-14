import { describe, expect, it } from "vitest";
import { focusIdentityKey } from "../callGraphFocus";
import { qualifiedCodeEntityPromptAlias, type CodeEntityRecord } from "../../records/domain";
import { filterCallGraphTree, parseCallGraphTree } from "../callGraphTree";

const origin = {
  projectId: "project-a",
  diagramSetId: "set-a",
  codeEntitiesSetId: "entities-a"
};

function entity(id: string, handle: string): CodeEntityRecord {
  return {
    id,
    origin,
    handle,
    label: handle,
    category: "operation",
    summary: handle,
    sourceRanges: []
  };
}

const alpha = entity("entity-11111111-1111-4111-8111-111111111111", "alpha");
const beta = entity("entity-22222222-2222-4222-8222-222222222222", "beta");
const gamma = entity("entity-33333333-3333-4333-8333-333333333333", "gamma");

describe("call graph tree", () => {
  it("parses inline and immediately-following legacy annotations", () => {
    const roots = parseCallGraphTree([
      "root [entity-alpha]",
      "+--> before",
      "+--> beta()",
      "|   [entity-beta]",
      "|   `--> internal",
      "`--> after"
    ].join("\n"), [alpha, beta]);

    expect(roots).toEqual([{
      id: "call-graph-line-1",
      label: "root",
      codeEntity: { kind: "code-entity", targetId: alpha.id, origin },
      children: [
        { id: "call-graph-line-2", label: "before", children: [] },
        {
          id: "call-graph-line-3",
          label: "beta()",
          codeEntity: { kind: "code-entity", targetId: beta.id, origin },
          children: [{ id: "call-graph-line-5", label: "internal", children: [] }]
        },
        { id: "call-graph-line-6", label: "after", children: [] }
      ]
    }]);
  });

  it("accepts exact global IDs and rejects undeclared or ambiguous legacy aliases", () => {
    expect(parseCallGraphTree(
      `root [${alpha.id}]`,
      [alpha]
    )[0].codeEntity?.targetId).toBe(alpha.id);
    expect(() => parseCallGraphTree("root [entity-missing]", [alpha]))
      .toThrow(/undeclared CodeEntity/);

    const duplicate = { ...beta, handle: alpha.handle };
    expect(() => parseCallGraphTree("root [entity-alpha]", [alpha, duplicate]))
      .toThrow(/ambiguous/);
    expect(parseCallGraphTree(
      `root [${qualifiedCodeEntityPromptAlias(alpha)}]`,
      [alpha, duplicate]
    )[0].codeEntity?.targetId).toBe(alpha.id);
  });

  it("keeps minimal ancestry and full matched subtrees while dropping siblings", () => {
    const roots = parseCallGraphTree([
      "root",
      "+--> before [entity-alpha]",
      "+--> shared",
      "|   +--> beta [entity-beta]",
      "|   |   `--> beta internal",
      "|   +--> unrelated",
      "|   `--> gamma [entity-gamma]",
      "`--> after [entity-alpha]"
    ].join("\n"), [alpha, beta, gamma]);
    const selected = new Set([
      focusIdentityKey({ kind: "code-entity", targetId: beta.id, origin }),
      focusIdentityKey({ kind: "code-entity", targetId: gamma.id, origin })
    ]);

    expect(filterCallGraphTree(roots, selected)).toEqual([{
      id: "call-graph-line-1",
      label: "root",
      children: [{
        id: "call-graph-line-3",
        label: "shared",
        children: [
          {
            id: "call-graph-line-4",
            label: "beta",
            codeEntity: { kind: "code-entity", targetId: beta.id, origin },
            children: [{ id: "call-graph-line-5", label: "beta internal", children: [] }]
          },
          {
            id: "call-graph-line-7",
            label: "gamma",
            codeEntity: { kind: "code-entity", targetId: gamma.id, origin },
            children: []
          }
        ]
      }]
    }]);
  });

  it("retains every occurrence of the selected entity", () => {
    const roots = parseCallGraphTree([
      "one [entity-alpha]",
      "two [entity-alpha]"
    ].join("\n"), [alpha]);
    const selected = new Set([
      focusIdentityKey({ kind: "code-entity", targetId: alpha.id, origin })
    ]);
    expect(filterCallGraphTree(roots, selected).map((node) => node.label)).toEqual(["one", "two"]);
  });
});
