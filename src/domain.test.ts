import { describe, expect, it } from "vitest";
import { assertSourceRange, CodeEntity } from "./domain";

const graph = [
  "collectEntities(request)",
  "  |",
  "  +--> model()",
  "  \\--> entities"
].join("\n");

describe("compacted source call graphs", () => {
  it("keeps multiline graph structure in CodeEntity prompt context", () => {
    const prompt = new CodeEntity({
      id: "entity-collector",
      handle: "collector",
      label: "Collector",
      category: "operation",
      summary: "Collects source-backed entities.",
      sourceRanges: [{
        path: "server/agentRuntime.ts",
        startLine: 127,
        endLine: 229,
        compactedSource: {
          level: "medium",
          sections: [{
            kind: "collapsed-comment",
            startLine: 131,
            endLine: 228,
            comment: graph,
            nodes: [
              { graphLine: 1, startLine: 131, endLine: 228 },
              { graphLine: 3, startLine: 140, endLine: 145 },
              { graphLine: 4, startLine: 220, endLine: 228 }
            ]
          }]
        }
      }]
    }).prompt_str();

    expect(prompt).toContain("collapse lines 131-228 as call graph:");
    expect(prompt).toContain("      collectEntities(request)\n        |\n        +--> model()");
    expect(prompt).toContain("graph line 3 -> source lines 140-145");
  });

  it("rejects non-ASCII graph characters", () => {
    expect(() => assertSourceRange({
      path: "src/worker.ts",
      startLine: 1,
      endLine: 3,
      compactedSource: {
        level: "high",
        sections: [{
          kind: "collapsed-comment",
          startLine: 1,
          endLine: 3,
          comment: "worker\n  └──> result"
        }]
      }
    })).toThrow("must contain only 7-bit ASCII");
  });

  it("rejects node mappings outside their collapsed block", () => {
    expect(() => assertSourceRange({
      path: "src/worker.ts",
      startLine: 1,
      endLine: 10,
      compactedSource: {
        level: "medium",
        sections: [{
          kind: "collapsed-comment",
          startLine: 3,
          endLine: 8,
          comment: "worker\n  \\--> result",
          nodes: [{ graphLine: 2, startLine: 2, endLine: 8 }]
        }]
      }
    })).toThrow("node range is invalid");
  });
});
