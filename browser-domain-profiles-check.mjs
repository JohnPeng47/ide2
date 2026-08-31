import { spawn } from "node:child_process";
import { createServer } from "node:net";
import { cp, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

async function loadBrowserHarness() {
  const candidates = [
    new URL("../../.agents/skills/front-end/browser-test.mjs", import.meta.url),
    new URL("../../../../.codex/skills/front-end/browser-test.mjs", import.meta.url)
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
  elementClip,
  evaluate,
  waitFor,
  waitForSelector,
  withHeadlessBrowser
} = await loadBrowserHarness();

const packageRoot = path.dirname(new URL(import.meta.url).pathname);

async function freePort() {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      const port = typeof address === "object" && address ? address.port : 0;
      server.close(() => resolve(port));
    });
  });
}

async function click(cdp, selector) {
  const clip = await elementClip(cdp, selector);
  const x = clip.x + clip.width / 2;
  const y = clip.y + clip.height / 2;
  await cdp.send("Input.dispatchMouseEvent", {
    type: "mousePressed", x, y, button: "left", clickCount: 1
  });
  await cdp.send("Input.dispatchMouseEvent", {
    type: "mouseReleased", x, y, button: "left", clickCount: 1
  });
}

const fixtureRoot = await mkdtemp(path.join(tmpdir(), "new-diagram-domain-browser-"));
const screenshotPath = path.join(fixtureRoot, "document-domain.png");
let serverProcess;

try {
  await cp(path.join(packageRoot, ".diagrams"), path.join(fixtureRoot, ".diagrams"), {
    recursive: true
  });
  const projectPath = path.join(fixtureRoot, ".diagrams", "project.json");
  const project = JSON.parse(await readFile(projectPath, "utf8"));
  project.canonicalRepoRoot = fixtureRoot;
  project.repositoryIdentity = `filesystem-documents:${fixtureRoot}`;
  project.domainProfileId = "document";
  project.corpus = { kind: "filesystem-documents", root: fixtureRoot };
  project.diagramSetIds = ["set-brendan-foody-20vc"];
  await writeFile(projectPath, `${JSON.stringify(project, null, 2)}\n`, "utf8");

  for (const setId of project.diagramSetIds) {
    const setPath = path.join(fixtureRoot, ".diagrams", "diagram-sets", setId, "diagram-set.json");
    const set = JSON.parse(await readFile(setPath, "utf8"));
    set.sourceCheckoutRoot = fixtureRoot;
    await writeFile(setPath, `${JSON.stringify(set, null, 2)}\n`, "utf8");
  }

  const port = await freePort();
  const url = `http://127.0.0.1:${port}/`;
  serverProcess = spawn("npm", [
    "run", "preview", "--", "--port", String(port), "--strictPort"
  ], {
    cwd: packageRoot,
    env: {
      ...process.env,
      NEW_DIAGRAM_PROJECT_ROOT: fixtureRoot,
      NEW_DIAGRAM_DOMAIN: "document"
    },
    stdio: "ignore"
  });
  await waitFor(async () => Boolean((await fetch(url).catch(() => null))?.ok), {
    timeoutMs: 10000,
    message: "document profile preview did not start"
  });

  await withHeadlessBrowser({ url, width: 1440, height: 900 }, async ({ cdp }) => {
    await cdp.send("Page.enable");
    await cdp.send("Runtime.enable");
    const pageErrors = [];
    const removeExceptionListener = cdp.on("Runtime.exceptionThrown", ({ exceptionDetails }) => {
      pageErrors.push(exceptionDetails.exception?.description ?? exceptionDetails.text);
    });

    await waitForSelector(cdp, ".diagram-panel");
    await waitForSelector(cdp, ".mapped-element");
    await waitForSelector(cdp, ".tree-node-collapse");
    await waitForSelector(cdp, ".mapped-highlight-toggle");
    const explorerTabs = await evaluate(cdp, `[...document.querySelectorAll(
      '[data-pane-id="files"] [role="tab"]'
    )].map((tab) => ({ id: tab.id, label: tab.textContent.trim() }))`);
    if (JSON.stringify(explorerTabs) !== JSON.stringify([
      { id: "files-tab", label: "Diagram Files" },
      { id: "markdown-sections-tab", label: "Sections" },
      { id: "highlights-tab", label: "Highlights" }
    ])) {
      throw new Error(`document explorer tabs were incorrect: ${JSON.stringify(explorerTabs)}`);
    }

    const stableIds = await evaluate(cdp, `({
      collapse: document.querySelector('.tree-node-collapse')?.dataset.representationElementId,
      mapped: document.querySelector('.mapped-element-wrap')?.dataset.representationElementId
    })`);
    if (!stableIds.collapse?.startsWith("tree:") || !stableIds.mapped?.startsWith("tree:")) {
      throw new Error(`tree controls did not resolve stable structural IDs: ${JSON.stringify(stableIds)}`);
    }

    await waitFor(async () => Number(await evaluate(cdp, `
      document.querySelector('.ascii-grid')?.dataset.cellWidth ?? 0
    `)) > 0, { message: "ASCII cell metrics were not measured" });
    const representationLayout = await evaluate(cdp, `(() => {
      const pre = document.querySelector('.ascii-grid');
      const preBounds = pre.getBoundingClientRect();
      const cellWidth = Number(pre.dataset.cellWidth);
      const mapped = [...pre.querySelectorAll('.mapped-element')];
      const controls = [...document.querySelectorAll('.representation-control-gutter button')];
      return {
        containsInjectedMarker: pre.textContent.includes('[(**)]'),
        containsInjectedHighlight: pre.textContent.includes('[☆]') || pre.textContent.includes('[★]'),
        mappedWidthsMatchText: mapped.every((element) => (
          Math.abs(element.getBoundingClientRect().width - element.textContent.length * cellWidth) < 1.5
        )),
        controlsOutsideAscii: controls.every((element) => (
          element.getBoundingClientRect().right <= preBounds.left + 0.5
        ))
      };
    })()`);
    if (representationLayout.containsInjectedMarker
      || representationLayout.containsInjectedHighlight
      || !representationLayout.mappedWidthsMatchText
      || !representationLayout.controlsOutsideAscii) {
      throw new Error(`representation controls changed ASCII geometry: ${JSON.stringify(representationLayout)}`);
    }

    const linesBeforeCollapse = await evaluate(cdp, `document.querySelectorAll('.ascii-line').length`);
    await click(cdp, ".tree-node-collapse");
    await waitFor(async () => (
      await evaluate(cdp, `document.querySelectorAll('.ascii-line').length`)
    ) < linesBeforeCollapse, { message: "tree did not collapse through its structural element" });
    await click(cdp, ".tree-node-collapse");
    await waitFor(async () => (
      await evaluate(cdp, `document.querySelectorAll('.ascii-line').length`)
    ) === linesBeforeCollapse, { message: "tree did not expand through its structural element" });

    await click(cdp, ".mapped-element");
    await waitForSelector(cdp, '.source-code-viewer[data-presentation="plain"][data-wrap="true"]');
    const documentView = await evaluate(cdp, `({
      language: document.querySelector('.source-code-viewer').dataset.language,
      label: document.querySelector('.source-code-viewer').getAttribute('aria-label'),
      selectedLines: document.querySelectorAll('.source-code-line[data-selected="true"]').length
    })`);
    if (documentView.language !== "Plain text"
      || documentView.label !== "Read-only plain text document"
      || documentView.selectedLines < 1) {
      throw new Error(`document presentation was incorrect: ${JSON.stringify(documentView)}`);
    }

    await click(cdp, ".mapped-highlight-toggle");
    await waitFor(async () => await evaluate(cdp, `
      document.querySelector('.mapped-highlight-toggle')?.getAttribute('aria-pressed') === 'true'
    `), { message: "document highlight was not persisted" });
    await click(cdp, "#highlights-tab");
    await waitForSelector(cdp, ".highlight-tree-row.is-highlight");
    await captureScreenshot(cdp, { output: screenshotPath });

    await cdp.send("Page.reload", { ignoreCache: true });
    await waitForSelector(cdp, ".highlight-tree-row.is-highlight");
    if (pageErrors.length) throw new Error(`browser page errors: ${JSON.stringify(pageErrors)}`);
    removeExceptionListener();
  });

  const markdownSetId = "set-f66b6cb5-b157-49c3-ba9c-e5f31b3729a7";
  await cp(path.join(packageRoot, "MARKDOWN.md"), path.join(fixtureRoot, "MARKDOWN.md"));
  project.diagramSetIds = [markdownSetId];
  await writeFile(projectPath, `${JSON.stringify(project, null, 2)}\n`, "utf8");
  const markdownSetPath = path.join(
    fixtureRoot,
    ".diagrams",
    "diagram-sets",
    markdownSetId,
    "diagram-set.json"
  );
  const markdownSet = JSON.parse(await readFile(markdownSetPath, "utf8"));
  markdownSet.sourceCheckoutRoot = fixtureRoot;
  await writeFile(markdownSetPath, `${JSON.stringify(markdownSet, null, 2)}\n`, "utf8");

  await withHeadlessBrowser({ url, width: 1440, height: 900 }, async ({ cdp }) => {
    await cdp.send("Page.enable");
    await cdp.send("Runtime.enable");
    const pageErrors = [];
    const removeExceptionListener = cdp.on("Runtime.exceptionThrown", ({ exceptionDetails }) => {
      pageErrors.push(exceptionDetails.exception?.description ?? exceptionDetails.text);
    });

    await waitForSelector(cdp, ".diagram-panel");
    await click(cdp, ".mapped-element");
    await waitForSelector(cdp, ".terminal-markdown-frame");
    await click(cdp, "#markdown-sections-tab");
    await waitForSelector(cdp, ".markdown-section-row .markdown-section-label");
    const sectionCount = await evaluate(cdp, `document.querySelectorAll(
      '.markdown-section-row .markdown-section-label'
    ).length`);
    if (sectionCount < 1) throw new Error("terminal Markdown outline did not populate the Sections tab");

    await click(cdp, ".markdown-section-row .markdown-section-label");
    await waitFor(async () => await evaluate(cdp, `
      document.querySelector('#code-entities-tab')?.getAttribute('aria-selected') === 'true'
    `), { message: "section jump did not activate the evidence pane" });
    await click(cdp, "#markdown-sections-tab");
    await waitForSelector(cdp, ".markdown-section-jump");
    const jumpLabel = await evaluate(cdp, `document.querySelector('.markdown-section-jump')?.textContent`);
    if (jumpLabel?.trim() !== "[J1]") {
      throw new Error(`section jump history was incorrect: ${JSON.stringify(jumpLabel)}`);
    }
    if (pageErrors.length) throw new Error(`Markdown browser page errors: ${JSON.stringify(pageErrors)}`);
    removeExceptionListener();
  });

  const screenshot = await stat(screenshotPath);
  if (screenshot.size < 1000) throw new Error("document profile screenshot was empty");
  process.stdout.write("document profile browser check passed\n");
} finally {
  if (serverProcess) {
    serverProcess.kill("SIGTERM");
    await new Promise((resolve) => serverProcess.once("exit", resolve));
  }
  await rm(fixtureRoot, { recursive: true, force: true });
}
