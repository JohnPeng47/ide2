import { describe, expect, it } from "vitest";
import { definePartialDiff } from "./partialDiff";

describe("definePartialDiff", () => {
  it("keeps region and modal geometry independent while padding ASCII rows", () => {
    const diff = definePartialDiff({
      id: "ownership",
      region: { startLine: 2, startColumn: 3, endLine: 4, endColumn: 8 },
      expandedAscii: "\nA -> B\n  C\n",
      padding: { columns: 4, lines: 1 }
    });

    expect(diff.region).toEqual({ startLine: 2, startColumn: 3, endLine: 4, endColumn: 8 });
    expect(diff.expandedAscii).toBe("A -> B\n  C   ");
    expect(diff.padding).toEqual({ columns: 4, lines: 1 });
  });

  it("rejects inverted regions and non-ASCII modal content", () => {
    expect(() => definePartialDiff({
      id: "inverted",
      region: { startLine: 4, startColumn: 2, endLine: 3, endColumn: 8 },
      expandedAscii: "valid"
    })).toThrow("must end at or after its origin");
    expect(() => definePartialDiff({
      id: "unicode",
      region: { startLine: 1, startColumn: 1, endLine: 1, endColumn: 1 },
      expandedAscii: "not ASCII →"
    })).toThrow("printable 7-bit ASCII");
  });
});
