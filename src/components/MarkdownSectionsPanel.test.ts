import { describe, expect, it } from "vitest";
import type { PaneJumpHistoryEntry } from "../panes/navigation";
import type { TerminalMarkdownSection } from "../terminalMarkdown/toc";
import { buildMarkdownSectionTree, mapJumpHistoryToSections } from "./MarkdownSectionsPanel";

describe("buildMarkdownSectionTree", () => {
  it("nests Markdown headings by level", () => {
    const tree = buildMarkdownSectionTree([
      { id: "a", label: "A", level: 2, startLine: 2, endLine: 8 },
      { id: "a-1", label: "A.1", level: 3, startLine: 4, endLine: 6 },
      { id: "a-1-i", label: "A.1.i", level: 4, startLine: 5, endLine: 6 },
      { id: "b", label: "B", level: 2, startLine: 9, endLine: 10 }
    ]);

    expect(tree.map((node) => node.section.id)).toEqual(["a", "b"]);
    expect(tree[0].children[0].section.id).toBe("a-1");
    expect(tree[0].children[0].children[0].section.id).toBe("a-1-i");
  });
});

describe("mapJumpHistoryToSections", () => {
  const sections: TerminalMarkdownSection[] = [
    { id: "a", label: "A", level: 2, startLine: 2, endLine: 8 },
    { id: "a-1", label: "A.1", level: 3, startLine: 4, endLine: 6 },
    { id: "b", label: "B", level: 2, startLine: 9, endLine: 12 }
  ];

  const jump = (jumpId: number, path: string, line: number): PaneJumpHistoryEntry => ({
    jumpId,
    jumpedAt: jumpId,
    key: `jump-${jumpId}`,
    kind: "source-location",
    paneId: "context",
    tabId: "code-entities",
    label: `Jump ${jumpId}`,
    payload: { path, line }
  });

  it("marks the deepest section containing each current-document jump", () => {
    expect(mapJumpHistoryToSections("README.md", sections, [
      jump(3, "README.md", 5),
      jump(2, "README.md", 10),
      jump(1, "other.md", 3)
    ])).toMatchObject([
      { rank: 1, sectionId: "a-1", entry: { jumpId: 3 } },
      { rank: 2, sectionId: "b", entry: { jumpId: 2 } }
    ]);
  });

  it("ignores jumps outside a section or without source coordinates", () => {
    const missingLocation = { ...jump(1, "README.md", 1), payload: { entityId: "x" } };
    expect(mapJumpHistoryToSections("README.md", sections, [
      jump(3, "README.md", 20),
      missingLocation
    ])).toEqual([]);
  });
});
