import { describe, expect, it } from "vitest";
import { parseTerminalMarkdownOutline, renderTerminalMarkdownDocument, renderTerminalMarkdownFragment } from "../render";

describe("terminal Markdown renderer", () => {
  it("renders chat fragments without a title and keeps model HTML and unsafe links inert", async () => {
    const html = await renderTerminalMarkdownFragment('**Wrapper** uses `aside`.\n\n- One\n- Two\n\n<script>alert(1)</script>\n\n[bad](javascript:alert(1))\n\n[Docs](https://example.com)');
    expect(html).toContain("<strong>Wrapper</strong>");
    expect(html).toContain("<code>aside</code>");
    expect(html).toMatch(/<ul\b[^>]*>/);
    expect(html).toContain("&lt;script&gt;");
    expect(html).not.toContain("<script>");
    expect(html).not.toContain('href="javascript:');
    expect(html).toContain('rel="noopener noreferrer"');
    expect(html).not.toContain("<!DOCTYPE");
    expect(html).toContain('data-source-start-line="1"');
  });
  it("renders compact terminal content with literal heading markers", async () => {
    const document = await renderTerminalMarkdownDocument([
      "# Article",
      "",
      "## Overview",
      "",
      "A paragraph with **evidence**.",
      "",
      "## Overview"
    ].join("\n"), "docs/article.md");

    expect(document).toContain('data-source-start-line="1" data-source-end-line="1"># Article</h1>');
    expect(document).toMatch(/<h2[^>]*id="overview"[^>]*>## Overview<\/h2>/);
    expect(document).toMatch(/<h2[^>]*id="overview-2"[^>]*>## Overview<\/h2>/);
    expect(document).toContain('data-source-start-line="3" data-source-end-line="3"');
    expect(document).toContain("<strong>evidence</strong>");
    expect(document).not.toContain("data-terminal-toc");
    expect(document).not.toContain("has-terminal-sidenotes");
  });

  it("escapes raw Markdown HTML while retaining only renderer-owned scripts", async () => {
    const document = await renderTerminalMarkdownDocument(
      "# <unsafe>\n\n## <script>alert(1)</script>",
      "README.md"
    );

    expect(document).toContain("<title>&lt;unsafe&gt;</title>");
    expect(document).toContain("&lt;script&gt;alert(1)&lt;/script&gt;");
    expect(document).not.toContain("<script>alert(1)</script>");
  });

  it("leaves footer notation in the ordinary terminal document flow", async () => {
    const document = await renderTerminalMarkdownDocument([
      "# Article",
      "",
      "The baseline(1)[footer] remains active.",
      "",
      "# Sidenotes",
      "[1] A **supporting note**."
    ].join("\n"), "docs/article.md");

    expect(document).toContain("The baseline(1)[footer] remains active.");
    expect(document).toContain("# Sidenotes");
    expect(document).toContain("[1] A <strong>supporting note</strong>.");
    expect(document).not.toContain("data-sidenote-ref");
  });

  it("syntax-highlights recognized fenced blocks and falls back for unknown languages", async () => {
    const highlighted = await renderTerminalMarkdownDocument(
      "# Code\n\n```typescript\nconst ready: boolean = true;\n```",
      "docs/code.md"
    );
    const fallback = await renderTerminalMarkdownDocument(
      "# Code\n\n```unknown-language\nconst unsafe = '<tag>';\n```",
      "docs/code.md"
    );

    expect(highlighted).toContain('class="terminal-code-block"');
    expect(highlighted).toContain('class="shiki catppuccin-mocha"');
    expect(highlighted).toMatch(/<span style="color:/);
    expect(fallback).toContain('class="language-unknown-language"');
    expect(fallback).toContain("&lt;tag&gt;");
  });

  it("requires a level-one title", async () => {
    await expect(renderTerminalMarkdownDocument("No title", "README.md"))
      .rejects.toThrow(/must start with a level-one title/);
  });

  it("extracts source-backed section ranges for explorer navigation", () => {
    const outline = parseTerminalMarkdownOutline([
      "# Guide",
      "",
      "## First",
      "body",
      "### Child",
      "child body",
      "## Second",
      "tail"
    ].join("\n"));

    expect(outline).toEqual({
      title: "Guide",
      sections: [
        { id: "first", label: "First", level: 2, startLine: 3, endLine: 6 },
        { id: "child", label: "Child", level: 3, startLine: 5, endLine: 6 },
        { id: "second", label: "Second", level: 2, startLine: 7, endLine: 8 }
      ]
    });
  });
});
