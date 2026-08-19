import { execFile, execFileSync, spawn } from "node:child_process";
import { createServer } from "node:net";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import {
  captureScreenshot,
  elementClip,
  evaluate,
  waitFor,
  waitForSelector,
  withHeadlessBrowser
} from "../../.agents/skills/front-end/browser-test.mjs";

const PACKAGE_ROOT = path.dirname(new URL(import.meta.url).pathname);
const execFileAsync = promisify(execFile);

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

async function pointerClick(cdp, selector) {
  const clip = await elementClip(cdp, selector);
  const x = clip.x + clip.width / 2;
  const y = clip.y + clip.height / 2;
  await cdp.send("Input.dispatchMouseEvent", { type: "mousePressed", x, y, button: "left", clickCount: 1 });
  await cdp.send("Input.dispatchMouseEvent", { type: "mouseReleased", x, y, button: "left", clickCount: 1 });
}

async function replaceText(cdp, selector, value) {
  await pointerClick(cdp, selector);
  await cdp.send("Input.dispatchKeyEvent", {
    type: "rawKeyDown",
    key: "Control",
    code: "ControlLeft",
    windowsVirtualKeyCode: 17
  });
  await cdp.send("Input.dispatchKeyEvent", {
    type: "rawKeyDown",
    key: "a",
    code: "KeyA",
    windowsVirtualKeyCode: 65,
    modifiers: 2
  });
  await cdp.send("Input.dispatchKeyEvent", {
    type: "keyUp",
    key: "a",
    code: "KeyA",
    windowsVirtualKeyCode: 65,
    modifiers: 2
  });
  await cdp.send("Input.dispatchKeyEvent", {
    type: "keyUp",
    key: "Control",
    code: "ControlLeft",
    windowsVirtualKeyCode: 17
  });
  await cdp.send("Input.insertText", { text: value });
}

async function dragDivider(cdp) {
  const clip = await elementClip(cdp, ".split-pane__divider");
  const x = clip.x + clip.width / 2;
  const y = clip.y + clip.height / 2;
  await cdp.send("Input.dispatchMouseEvent", { type: "mousePressed", x, y, button: "left", buttons: 1, clickCount: 1 });
  await cdp.send("Input.dispatchMouseEvent", { type: "mouseMoved", x: x - 120, y, button: "left", buttons: 1 });
  await cdp.send("Input.dispatchMouseEvent", { type: "mouseReleased", x: x - 120, y, button: "left", buttons: 0, clickCount: 1 });
}

const fixtureRoot = await mkdtemp(path.join(tmpdir(), "new-diagram-browser-"));
const screenshotPath = path.join(fixtureRoot, "studio.png");
let archivedArtifactPath = "";
let serverProcess;
try {
  execFileSync("git", ["init", "-q", fixtureRoot]);
  await writeFile(path.join(fixtureRoot, "fixture.ts"), "export const workspace = { status: 'ready' };\n", "utf8");
  execFileSync("git", ["-C", fixtureRoot, "add", "fixture.ts"]);
  execFileSync("git", ["-C", fixtureRoot, "-c", "user.name=Test", "-c", "user.email=test@example.com", "commit", "-qm", "fixture"]);
  const port = await freePort();
  const url = `http://127.0.0.1:${port}/`;
  serverProcess = spawn("npm", ["run", "preview", "--", "--port", String(port), "--strictPort"], {
    cwd: PACKAGE_ROOT,
    env: {
      ...process.env,
      NEW_DIAGRAM_AGENT: "fake",
      NEW_DIAGRAM_FAKE_COLLECTION_DELAY_MS: "2000",
      NEW_DIAGRAM_PROJECT_ROOT: fixtureRoot
    },
    stdio: "ignore"
  });
  await waitFor(async () => {
    const response = await fetch(url).catch(() => null);
    return Boolean(response?.ok);
  }, { timeoutMs: 10000, message: "preview server did not start" });

  await withHeadlessBrowser({ url, width: 1440, height: 900 }, async ({ cdp }) => {
    await cdp.send("Page.enable");
    await cdp.send("Runtime.enable");
    await waitForSelector(cdp, ".empty-workspace");
    const collection = execFileAsync("npm", [
      "run", "diagram", "--", "create",
      "--path", fixtureRoot,
      "--name", "Browser fixture",
      "--prompt", "Show workspace state",
      "--server", url
    ], {
      cwd: PACKAGE_ROOT,
      env: { ...process.env, NEW_DIAGRAM_AGENT: "fake" },
      encoding: "utf8"
    });
    await waitForSelector(cdp, ".waiting-state");
    await waitFor(async () => (
      await evaluate(cdp, `document.querySelector('.waiting-state p').textContent`)
    ).includes("reading fixture source"), {
      timeoutMs: 5000,
      message: "dashboard did not render persisted collection progress"
    });
    const collectionResult = await collection;
    if (!collectionResult.stdout.includes(`"event":"server"`)
      || !collectionResult.stdout.includes(`"serverUrl":"${url.slice(0, -1)}"`)) {
      throw new Error("CLI did not print the studio server address");
    }
    await waitForSelector(cdp, ".approval-callout");
    await pointerClick(cdp, ".approval-callout .button--primary");
    await waitForSelector(cdp, "#diagram-prompt");

    const splitBefore = await evaluate(cdp, `Number(document.querySelector('[role="separator"]').getAttribute('aria-valuenow'))`);
    await dragDivider(cdp);
    await waitFor(async () => {
      const current = await evaluate(cdp, `Number(document.querySelector('[role="separator"]').getAttribute('aria-valuenow'))`);
      return current < splitBefore;
    }, { message: "divider drag did not resize the panes" });

    await pointerClick(cdp, "#diagram-prompt");
    await cdp.send("Input.insertText", { text: "Show @" });
    await waitForSelector(cdp, ".mention-menu [role=option]");
    await pointerClick(cdp, ".mention-menu [role=option]");
    const prompt = await evaluate(cdp, `document.querySelector('#diagram-prompt').value`);
    if (!prompt.includes("@entity/")) throw new Error("mention selection did not insert a typed entity reference");
    const count = await evaluate(cdp, `document.querySelector('.counter output').textContent`);
    if (count !== "3") throw new Error(`expected default count 3, got ${count}`);

    await pointerClick(cdp, ".generate-action");
    await waitForSelector(cdp, ".diagram-panel", { timeoutMs: 10000 });
    const oldStripExists = await evaluate(cdp, `Boolean(document.querySelector('.diagram-tabs'))`);
    if (oldStripExists) throw new Error("horizontal diagram strip is still rendered");
    await pointerClick(cdp, ".source-link");
    await waitForSelector(cdp, ".source-preview");

    await pointerClick(cdp, "#diagrams-tab");
    await waitForSelector(cdp, ".diagram-lineage-panel");
    await waitFor(async () => (
      await evaluate(cdp, `document.querySelectorAll('.diagram-tree-diagram').length`)
    ) === 3, { timeoutMs: 10000, message: "lineage tree did not render three diagrams" });
    await pointerClick(cdp, "[data-generation-batch-id] .diagram-tree-toggle");
    await waitFor(async () => (
      await evaluate(cdp, `document.querySelectorAll('.diagram-tree-diagram').length`)
    ) === 0, { message: "root generation did not collapse" });
    const rootCollapsedLabel = await evaluate(cdp, `document.querySelector(
      '[data-generation-batch-id] .diagram-tree-toggle'
    ).textContent`);
    if (rootCollapsedLabel !== "[+3]") throw new Error(`root collapse count was ${rootCollapsedLabel}`);
    await pointerClick(cdp, "[data-generation-batch-id] .diagram-tree-toggle");
    await waitFor(async () => (
      await evaluate(cdp, `document.querySelectorAll('.diagram-tree-diagram').length`)
    ) === 3, { message: "root generation did not expand" });
    const bridgeTexts = await evaluate(cdp, `Array.from(
      document.querySelectorAll('.diagram-tree-bridge'),
      (node) => node.textContent
    )`);
    if (bridgeTexts.length < 4 || bridgeTexts.some((value) => !/^[| ]+$/.test(value))) {
      throw new Error(`lineage bridges were not ASCII pipes: ${JSON.stringify(bridgeTexts)}`);
    }
    const selection = await evaluate(cdp, `(() => {
      const node = document.querySelector('.diagram-tree-diagram:not(.is-current)');
      return {
        id: node?.dataset.diagramId ?? '',
        name: node?.querySelector('.diagram-tree-description')?.textContent ?? ''
      };
    })()`);
    if (!selection.id || !selection.name) throw new Error("lineage tree did not offer another diagram");
    await pointerClick(cdp, `[data-diagram-id="${selection.id}"]`);
    await waitFor(async () => (
      await evaluate(cdp, `document.querySelector('.diagram-panel .pane-header h2').textContent`)
    ) === selection.name, { message: "lineage selection did not change the active diagram" });
    const stableHandle = await evaluate(cdp, `document.querySelector('.diagram-meta code').textContent`);
    const renamedDiagram = "Renamed browser diagram";
    await pointerClick(cdp, `[data-diagram-id="${selection.id}"] .diagram-tree-rename`);
    await waitForSelector(cdp, `[data-diagram-id="${selection.id}"] input`);
    await replaceText(cdp, `[data-diagram-id="${selection.id}"] input`, renamedDiagram);
    const renameInput = await evaluate(cdp, `document.querySelector(
      '[data-diagram-id="${selection.id}"] input'
    ).value`);
    if (renameInput !== renamedDiagram) {
      throw new Error(`rename input contained ${JSON.stringify(renameInput)}`);
    }
    await pointerClick(cdp, `[data-diagram-id="${selection.id}"] .diagram-tree-save`);
    await waitFor(async () => await evaluate(cdp, `(
      !document.querySelector('[data-diagram-id="${selection.id}"] input')
      || Boolean(document.querySelector('.diagram-tree-error'))
    )`), { message: "rename request did not settle" });
    const renameResult = await evaluate(cdp, `({
      heading: document.querySelector('.diagram-panel .pane-header h2').textContent,
      error: document.querySelector('.diagram-tree-error')?.textContent ?? ''
    })`);
    if (renameResult.heading !== renamedDiagram) {
      throw new Error(`renamed diagram did not update the active view: ${renameResult.error || renameResult.heading}`);
    }
    const handleAfterRename = await evaluate(cdp, `document.querySelector('.diagram-meta code').textContent`);
    if (handleAfterRename !== stableHandle) throw new Error("diagram rename changed its stable @ handle");

    await pointerClick(cdp, ".diagram-panel .pane-header .button");
    await waitForSelector(cdp, "#diagram-prompt");
    await pointerClick(cdp, '[aria-label="Use one fewer agent"]');
    await waitFor(async () => (
      await evaluate(cdp, `document.querySelector('.counter output').textContent`)
    ) === "2", { message: "agent count did not decrement to two" });
    await pointerClick(cdp, '[aria-label="Use one fewer agent"]');
    await waitFor(async () => (
      await evaluate(cdp, `document.querySelector('.counter output').textContent`)
    ) === "1", { message: "agent count did not decrement to one" });
    await pointerClick(cdp, ".generate-action");
    await waitForSelector(cdp, ".diagram-panel", { timeoutMs: 10000 });
    await pointerClick(cdp, "#diagrams-tab");
    await waitFor(async () => (
      await evaluate(cdp, `document.querySelectorAll('.diagram-tree-diagram').length`)
    ) === 4, { timeoutMs: 10000, message: "derivative did not appear in lineage tree" });
    const lineageShape = await evaluate(cdp, `(() => {
      const selected = document.querySelector('[data-diagram-id="${selection.id}"]');
      const branch = selected?.closest('.diagram-tree-branch');
      return {
        visibleGenerations: document.querySelectorAll('[data-generation-batch-id]').length,
        directChildDiagrams: branch
          ? branch.querySelectorAll(':scope > .diagram-tree-branch > .diagram-tree-diagram').length
          : 0
      };
    })()`);
    if (lineageShape.visibleGenerations !== 1 || lineageShape.directChildDiagrams !== 1) {
      throw new Error(`derivative lineage was not compact: ${JSON.stringify(lineageShape)}`);
    }
    const renamedInTree = await evaluate(cdp, `document.querySelector(
      '[data-diagram-id="${selection.id}"] .diagram-tree-description'
    )?.textContent`);
    if (renamedInTree !== renamedDiagram) throw new Error("lineage tree lost the renamed diagram name");
    await pointerClick(cdp, `[data-diagram-id="${selection.id}"] .diagram-tree-toggle`);
    await waitFor(async () => (
      await evaluate(cdp, `document.querySelectorAll('.diagram-tree-diagram').length`)
    ) === 3, { message: "diagram descendants did not collapse" });
    const diagramCollapsedLabel = await evaluate(cdp, `document.querySelector(
      '[data-diagram-id="${selection.id}"] .diagram-tree-toggle'
    ).textContent`);
    if (diagramCollapsedLabel !== "[+1]") {
      throw new Error(`diagram collapse count was ${diagramCollapsedLabel}`);
    }
    await captureScreenshot(cdp, { output: screenshotPath });
    await pointerClick(cdp, `[data-diagram-id="${selection.id}"] .diagram-tree-toggle`);
    await waitFor(async () => (
      await evaluate(cdp, `document.querySelectorAll('.diagram-tree-diagram').length`)
    ) === 4, { message: "diagram descendants did not expand" });

    await pointerClick(cdp, `[data-diagram-id="${selection.id}"] .diagram-tree-archive`);
    await waitFor(async () => (
      await evaluate(cdp, `!document.querySelector('[data-diagram-id="${selection.id}"]')`)
    ), { message: "archived diagram remained in the lineage" });
    const archiveState = await evaluate(cdp, `(async () => {
      const workspace = await fetch('/api/workspace').then((response) => response.json());
      const diagram = workspace.diagrams['${selection.id}'];
      const set = workspace.diagramSets.find((candidate) => candidate.diagramIds.includes('${selection.id}'));
      return {
        archivedAt: diagram?.archivedAt ?? '',
        setId: set?.id ?? '',
        visibleDiagrams: document.querySelectorAll('.diagram-tree-diagram').length
      };
    })()`);
    if (!archiveState.archivedAt || !archiveState.setId || archiveState.visibleDiagrams !== 3) {
      throw new Error(`archive state was incomplete: ${JSON.stringify(archiveState)}`);
    }
    archivedArtifactPath = path.join(
      fixtureRoot,
      ".diagrams",
      "diagram-sets",
      archiveState.setId,
      "diagrams",
      `${selection.id}.json`
    );

    await pointerClick(cdp, ".screen-tabs button:nth-child(2)");
    await waitForSelector(cdp, "#diagram-prompt");
    await replaceText(cdp, "#diagram-prompt", "@diagram/");
    await waitForSelector(cdp, ".mention-menu [role=option]");
    const diagramMentions = await evaluate(cdp, `Array.from(document.querySelectorAll(
      '.mention-menu [role=option] code'
    ), (node) => node.textContent)`);
    if (diagramMentions.includes(stableHandle)) {
      throw new Error("archived diagram remained available as a prompt mention");
    }

    const persisted = await evaluate(cdp, `localStorage.getItem('new-diagram:split-percent')`);
    await cdp.send("Page.reload", { ignoreCache: true });
    await waitForSelector(cdp, "[role=separator]");
    const restored = await evaluate(cdp, `localStorage.getItem('new-diagram:split-percent')`);
    if (persisted !== restored) throw new Error("split preference was not retained across reload");
    await pointerClick(cdp, "#diagrams-tab");
    await waitFor(async () => (
      await evaluate(cdp, `(
        !document.querySelector('[data-diagram-id="${selection.id}"]')
        && document.querySelectorAll('.diagram-tree-diagram').length === 3
      )`)
    ), { message: "diagram archival was not persisted across reload" });
  });

  const screenshot = await readFile(screenshotPath);
  if (screenshot.length < 1000) throw new Error("browser screenshot was unexpectedly small");
  const archivedArtifact = JSON.parse(await readFile(archivedArtifactPath, "utf8"));
  if (!archivedArtifact.archivedAt) throw new Error("archived diagram artifact was removed or unmarked");
  process.stdout.write("browser check passed: generation -> collapse counts -> compact derivative -> archive retention -> reload\n");
} finally {
  if (serverProcess?.exitCode === null) serverProcess.kill("SIGTERM");
  await rm(fixtureRoot, { recursive: true, force: true });
}
