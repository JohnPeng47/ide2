import { expect, it } from "vitest";
import { assertSourceRange } from "../domain";

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
