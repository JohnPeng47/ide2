import { describe, expect, it } from "vitest";
import { isMarkdownDocumentPath } from "./TerminalMarkdownView";

describe("isMarkdownDocumentPath", () => {
  it("detects Markdown anchors case-insensitively", () => {
    expect(isMarkdownDocumentPath("README.md")).toBe(true);
    expect(isMarkdownDocumentPath("docs/guide.MARKDOWN")).toBe(true);
  });

  it("does not route non-Markdown anchors to the terminal renderer", () => {
    expect(isMarkdownDocumentPath("src/markdown.ts")).toBe(false);
    expect(isMarkdownDocumentPath("notes.md.txt")).toBe(false);
  });
});
