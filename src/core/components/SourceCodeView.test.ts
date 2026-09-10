import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { SourceRange } from "../domain";
import { contentLanguageName, formatCollapsedCallGraph, SourceCodeView } from "./SourceCodeView";

describe("formatCollapsedCallGraph", () => {
  it("renders a multiline ASCII graph as a source comment block", () => {
    expect(formatCollapsedCallGraph({
      kind: "collapsed-comment",
      startLine: 12,
      endLine: 18,
      comment: [
        "collectEntities(request)",
        "  |",
        "  +--> model()",
        "  \\--[failure]--> throw"
      ].join("\n"),
      nodes: [
        { graphLine: 1, startLine: 12, endLine: 18 },
        { graphLine: 3, startLine: 14, endLine: 15 },
        { graphLine: 4, startLine: 16, endLine: 18 }
      ]
    })).toBe([
      "// [Lines 12-18 | 7 lines compacted]",
      "//",
      "// collectEntities(request)",
      "//   |",
      "//   +--> model()",
      "//   \\--[failure]--> throw"
    ].join("\n"));
  });

  it("normalizes newlines and trims only empty edge lines", () => {
    expect(formatCollapsedCallGraph({
      kind: "collapsed-comment",
      startLine: 2,
      endLine: 3,
      comment: "\r\nroot\r\n  \\--> result\r\n"
    })).toContain("// root\n//   \\--> result");
  });
});

describe("SourceCodeView presentations", () => {
  const preview = {
    path: "notes/transcript.md",
    startLine: 10,
    lines: ["first line", "second line", "third line"]
  };
  const range = {
    id: "range-a",
    path: preview.path,
    startLine: 10,
    endLine: 12,
    compactedSource: {
      sections: [{
        kind: "collapsed-comment",
        startLine: 10,
        endLine: 12,
        comment: "root\n  `-- child"
      }]
    }
  } as SourceRange;

  it("renders source code with syntax highlighting, no wrap, and compaction enabled", () => {
    const presentation = {
      syntaxHighlighting: "code" as const,
      markdownRendering: "source" as const,
      wrap: false,
      sourceCompaction: true
    };
    const markup = renderToStaticMarkup(createElement(SourceCodeView, {
      preview,
      range,
      compacted: true,
      presentation
    }));

    expect(contentLanguageName(preview.path, presentation)).toBe("Markdown");
    expect(markup).toContain('data-presentation="code"');
    expect(markup).toContain('data-wrap="false"');
    expect(markup).toContain("source-fold-placeholder");
  });

  it("renders document content as wrapping plain text without code compaction", () => {
    const presentation = {
      syntaxHighlighting: "plain" as const,
      markdownRendering: "terminal" as const,
      wrap: true,
      sourceCompaction: false
    };
    const markup = renderToStaticMarkup(createElement(SourceCodeView, {
      preview,
      range,
      compacted: true,
      presentation
    }));

    expect(contentLanguageName(preview.path, presentation)).toBe("Plain text");
    expect(markup).toContain('data-presentation="plain"');
    expect(markup).toContain('data-wrap="true"');
    expect(markup).toContain("first line");
    expect(markup).toContain("third line");
    expect(markup).not.toContain("source-fold-placeholder");
    expect(markup).not.toContain('aria-busy="true"');
  });
});
