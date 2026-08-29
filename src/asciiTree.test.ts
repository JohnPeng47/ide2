import { describe, expect, it } from "vitest";
import { asciiTreeLineage, hiddenAsciiTreeLines, parseAsciiTree } from "./asciiTree";

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
});
