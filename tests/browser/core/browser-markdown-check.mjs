import { createServer } from "node:http";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir, homedir } from "node:os";
import path from "node:path";
import { renderTerminalMarkdownDocument } from "../../../src/shared/markdown/render";

async function loadBrowserHarness() {
  const candidates = [
    new URL(`file://${path.join(homedir(), ".codex/skills/front-end/browser-test.mjs")}`),
    new URL("../../../../../.agents/skills/front-end/browser-test.mjs", import.meta.url),
    new URL("../../../../../../../.codex/skills/front-end/browser-test.mjs", import.meta.url)
  ];
  for (const candidate of candidates) {
    try {
      return await import(candidate.href);
    } catch (error) {
      if (error?.code !== "ERR_MODULE_NOT_FOUND") throw error;
    }
  }
  throw new Error("front-end browser test harness was not found");
}

const {
  captureScreenshot,
  evaluate,
  waitForSelector,
  withHeadlessBrowser
} = await loadBrowserHarness();

const markdown = [
  "# Terminal Markdown",
  "",
  "The renderer uses `terminal cells` and keeps the complete pane width.",
  "",
  "## Overview",
  "",
  "| Previous idea | Better approach |",
  "|---|---|",
  "| Boxed tables | Terminal separators |",
  "| Narrow reader canvas | Pane-width content |",
  "",
  "### Code",
  "",
  "```typescript",
  "export function ready(value: boolean): string {",
  "  return value ? \"ready\" : \"waiting\";",
  "}",
  "```",
  "",
  "- Compact list item",
  "  - Nested item"
].join("\n");

const document = await renderTerminalMarkdownDocument(markdown, "docs/terminal.md");
const fixtureRoot = await mkdtemp(path.join(tmpdir(), "new-diagram-markdown-browser-"));
const wideScreenshot = path.join(fixtureRoot, "terminal-markdown-wide.png");
const narrowScreenshot = path.join(fixtureRoot, "terminal-markdown-narrow.png");
const server = createServer((_request, response) => {
  response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
  response.end(document);
});

try {
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("browser fixture server has no TCP port");
  const url = `http://127.0.0.1:${address.port}/`;

  await withHeadlessBrowser({ url, width: 1440, height: 900 }, async ({ cdp }) => {
    await cdp.send("Page.enable");
    await cdp.send("Runtime.enable");
    await waitForSelector(cdp, ".terminal-code-block .shiki span");
    const state = await evaluate(cdp, `(() => {
      const body = getComputedStyle(document.body);
      const article = document.querySelector('.terminal-markdown');
      const inlineCode = document.querySelector('p code');
      const codeBlock = document.querySelector('.terminal-code-block pre');
      const heading = document.querySelector('h2');
      const tableCell = document.querySelector('tbody td');
      return {
        title: document.querySelector('h1')?.textContent,
        heading: heading?.textContent,
        articleWidth: article?.getBoundingClientRect().width,
        viewportWidth: innerWidth,
        bodyPaddingLeft: body.paddingLeft,
        bodyDisplay: body.display,
        inlineCodeBorder: getComputedStyle(inlineCode).borderTopWidth,
        codeBorder: getComputedStyle(codeBlock).borderTopWidth,
        codeBackground: getComputedStyle(codeBlock).backgroundColor,
        bodyBackground: body.backgroundColor,
        tableVerticalBorder: getComputedStyle(tableCell).borderRightWidth,
        tocCount: document.querySelectorAll('.terminal-toc').length,
        codeSpans: document.querySelectorAll('.terminal-code-block .shiki span').length
      };
    })()`);
    if (state.title !== "# Terminal Markdown"
      || state.heading !== "## Overview"
      || state.bodyDisplay !== "block"
      || state.inlineCodeBorder !== "0px"
      || state.codeBorder !== "0px"
      || state.codeBackground !== "rgba(0, 0, 0, 0)"
      || state.tableVerticalBorder !== "0px"
      || state.tocCount !== 0
      || state.codeSpans < 3
      || state.articleWidth < state.viewportWidth - 100) {
      throw new Error(`wide terminal Markdown state was incorrect: ${JSON.stringify(state)}`);
    }
    await captureScreenshot(cdp, { output: wideScreenshot });
  });

  await withHeadlessBrowser({ url, width: 430, height: 900 }, async ({ cdp }) => {
    await cdp.send("Page.enable");
    await cdp.send("Runtime.enable");
    await waitForSelector(cdp, ".terminal-markdown");
    const state = await evaluate(cdp, `(() => ({
      viewportWidth: innerWidth,
      documentWidth: document.documentElement.scrollWidth,
      articleWidth: document.querySelector('.terminal-markdown')?.getBoundingClientRect().width,
      tocCount: document.querySelectorAll('.terminal-toc').length,
      brokenWords: [...document.querySelectorAll('h1, h2, h3')].some((element) => (
        getComputedStyle(element).overflowWrap === 'anywhere'
      ))
    }))()`);
    if (state.documentWidth !== state.viewportWidth
      || state.articleWidth < state.viewportWidth - 100
      || state.tocCount !== 0
      || state.brokenWords) {
      throw new Error(`narrow terminal Markdown state was incorrect: ${JSON.stringify(state)}`);
    }
    await captureScreenshot(cdp, { output: narrowScreenshot });
  });

  console.log(JSON.stringify({
    event: "markdown-browser-check",
    wideScreenshot,
    narrowScreenshot
  }));
} finally {
  await new Promise((resolve) => server.close(resolve));
  if (process.env.KEEP_BROWSER_ARTIFACTS !== "1") {
    await rm(fixtureRoot, { recursive: true, force: true });
  }
}
