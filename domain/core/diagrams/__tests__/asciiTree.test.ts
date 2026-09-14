import { describe, expect, it } from "vitest";
import {
  asciiTreeLineage,
  asciiTreeSubtree,
  hiddenAsciiTreeLines,
  parseAsciiTree
} from "../asciiTree";

const ascii = [
  "title",
  "+--> alpha",
  "|    +--> beta",
  "|    |    `--> gamma",
  "|    `--> delta",
  "`--> omega"
].join("\n");

describe("ASCII tree", () => {
  it("tracks node ancestry and descendants", () => {
    const nodes = parseAsciiTree(ascii);
    expect(nodes.map(({ line, parentLine, text }) => ({ line, parentLine, text }))).toEqual([
      { line: 2, parentLine: undefined, text: "alpha" },
      { line: 3, parentLine: 2, text: "beta" },
      { line: 4, parentLine: 3, text: "gamma" },
      { line: 5, parentLine: 2, text: "delta" },
      { line: 6, parentLine: undefined, text: "omega" }
    ]);
    expect(asciiTreeLineage(ascii, 4).map((node) => node.text)).toEqual([
      "alpha", "beta", "gamma"
    ]);
  });

  it("hides only a collapsed node's subtree", () => {
    expect([...hiddenAsciiTreeLines(ascii, new Set([3]))]).toEqual([4]);
    expect([...hiddenAsciiTreeLines(ascii, new Set([2]))]).toEqual([3, 4, 5]);
  });

  it("returns a structural subtree in display order", () => {
    expect(asciiTreeSubtree(ascii, 3).map((node) => node.text)).toEqual(["beta", "gamma"]);
    expect(asciiTreeSubtree(ascii, 99)).toEqual([]);
  });

  it("reports the exact text column when a branch uses extra spacing", () => {
    expect(parseAsciiTree("+-->   spaced")[0]).toMatchObject({ text: "spaced", textColumn: 8 });
  });

  it("recognizes conventional plain roots and all supported branch endings", () => {
    const nodes = parseAsciiTree("root\n|\n+-- first\n|   `-- nested\n\\-- last");
    expect(nodes.map(({ line, parentLine, textColumn, text }) => ({ line, parentLine, textColumn, text })))
      .toEqual([
        { line: 1, parentLine: undefined, textColumn: 1, text: "root" },
        { line: 3, parentLine: 1, textColumn: 5, text: "first" },
        { line: 4, parentLine: 3, textColumn: 9, text: "nested" },
        { line: 5, parentLine: 1, textColumn: 5, text: "last" }
      ]);
  });

  it("keeps adjacent conventional trees separate and ignores prose headings", () => {
    const nodes = parseAsciiTree("heading\n\nfirst\n\\-- child\nsecond\n\\-- child");
    expect(nodes.map((node) => [node.line, node.parentLine])).toEqual([
      [3, undefined], [4, 3], [5, undefined], [6, 5]
    ]);
  });
});
