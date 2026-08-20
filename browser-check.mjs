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

async function pointerHover(cdp, selector) {
  const clip = await elementClip(cdp, selector);
  await cdp.send("Input.dispatchMouseEvent", {
    type: "mouseMoved",
    x: clip.x + clip.width / 2,
    y: clip.y + clip.height / 2
  });
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

async function controlKey(cdp, key, code, windowsVirtualKeyCode) {
  await cdp.send("Input.dispatchKeyEvent", {
    type: "rawKeyDown", key: "Control", code: "ControlLeft", windowsVirtualKeyCode: 17
  });
  await cdp.send("Input.dispatchKeyEvent", {
    type: "rawKeyDown", key, code, windowsVirtualKeyCode, modifiers: 2
  });
  await cdp.send("Input.dispatchKeyEvent", {
    type: "keyUp", key, code, windowsVirtualKeyCode, modifiers: 2
  });
  await cdp.send("Input.dispatchKeyEvent", {
    type: "keyUp", key: "Control", code: "ControlLeft", windowsVirtualKeyCode: 17
  });
}

async function dragDivider(cdp) {
  const clip = await elementClip(cdp, ".split-pane__divider");
  const x = clip.x + clip.width / 2;
  const y = clip.y + clip.height / 2;
  await cdp.send("Input.dispatchMouseEvent", { type: "mousePressed", x, y, button: "left", buttons: 1, clickCount: 1 });
  await cdp.send("Input.dispatchMouseEvent", { type: "mouseMoved", x: x - 120, y, button: "left", buttons: 1 });
  await cdp.send("Input.dispatchMouseEvent", { type: "mouseReleased", x: x - 120, y, button: "left", buttons: 0, clickCount: 1 });
}

async function dragBetween(cdp, startSelector, endSelector) {
  const start = await elementClip(cdp, startSelector);
  const end = await elementClip(cdp, endSelector);
  const x1 = start.x + start.width / 2;
  const y1 = start.y + start.height / 2;
  const x2 = end.x + end.width / 2;
  const y2 = end.y + end.height / 2;
  await cdp.send("Input.dispatchMouseEvent", {
    type: "mousePressed", x: x1, y: y1, button: "left", buttons: 1, clickCount: 1
  });
  await cdp.send("Input.dispatchMouseEvent", {
    type: "mouseMoved", x: x2, y: y2, button: "left", buttons: 1
  });
  await cdp.send("Input.dispatchMouseEvent", {
    type: "mouseReleased", x: x2, y: y2, button: "left", buttons: 0, clickCount: 1
  });
}

const fixtureRoot = await mkdtemp(path.join(tmpdir(), "new-diagram-browser-"));
const screenshotPath = path.join(fixtureRoot, "studio.png");
const sourceScreenshotPath = path.join(fixtureRoot, "compacted-source.png");
const importScreenshotPath = path.join(fixtureRoot, "import-dialog.png");
let archivedArtifactPath = "";
let archivedComponentArtifactPath = "";
let importedArtifactPath = "";
let importedComponentArtifactPath = "";
let serverProcess;
try {
  execFileSync("git", ["init", "-q", fixtureRoot]);
  await writeFile(
    path.join(fixtureRoot, "fixture.ts"),
    [
      "export const workspace = { status: 'ready' };",
      "workspace.status = 'collecting';",
      "workspace.status = 'ready';",
      "export default workspace;",
      ""
    ].join("\n"),
    "utf8"
  );
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
    await cdp.send("Browser.grantPermissions", {
      origin: url,
      permissions: ["clipboardReadWrite", "clipboardSanitizedWrite"]
    });
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
    try {
      await waitForSelector(cdp, "#diagram-prompt");
    } catch (error) {
      const state = await evaluate(cdp, `({
        text: document.body.innerText.slice(0, 2000),
        error: document.querySelector('[role="alert"]')?.textContent ?? ''
      })`);
      throw new Error(`${error.message}: ${JSON.stringify(state)}`);
    }

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
    await pointerClick(cdp, "#code-entities-tab");
    await pointerClick(cdp, ".source-link");
    await waitForSelector(cdp, ".source-preview");
    await waitForSelector(cdp, ".source-collapse:not([open])");
    const compactedText = await evaluate(cdp, `document.querySelector('.source-collapse summary code').textContent`);
    if (!compactedText.includes("// Lines 2-3:")) {
      throw new Error(`collapsed source did not render inline comment notation: ${compactedText}`);
    }
    await pointerClick(cdp, ".source-collapse summary");
    await waitForSelector(cdp, ".source-collapse[open] .source-collapse__lines");
    const revealedText = await evaluate(cdp, `document.querySelector('.source-collapse__lines').textContent`);
    if (!revealedText.includes("workspace.status = 'collecting';")) {
      throw new Error("collapsed source did not reveal its original lines");
    }
    await pointerClick(cdp, ".source-original-toggle");
    await waitFor(async () => (
      await evaluate(cdp, `document.querySelector('.source-preview').textContent`)
    ).includes("workspace.status = 'ready';"), {
      message: "peek original did not reveal the complete source range"
    });
    await captureScreenshot(cdp, { output: sourceScreenshotPath });

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

    await pointerClick(cdp, ".diagram-actions .button:first-child");
    await waitForSelector(cdp, ".ascii-selector");
    await dragBetween(
      cdp,
      '.ascii-char[data-line="1"][data-column="1"]',
      '.ascii-char[data-line="3"][data-column="20"]'
    );
    await waitFor(async () => (
      await evaluate(cdp, `document.querySelectorAll('.diagram-tree-component').length`)
    ) === 1, { timeoutMs: 10000, message: "captured component did not appear in the lineage tree" });
    const capturedComponent = await evaluate(cdp, `(() => {
      const component = document.querySelector('.diagram-tree-component');
      const copy = component?.querySelector('.diagram-tree-copy');
      return {
        reference: copy?.dataset.reference ?? '',
        origin: component?.querySelector('em')?.textContent ?? '',
        selectorOpen: Boolean(document.querySelector('.ascii-selector')),
        visibleHandle: Boolean(component?.querySelector('code')),
        copyOpacity: copy ? getComputedStyle(copy).opacity : ''
      };
    })()`);
    if (!capturedComponent.reference.startsWith("@component/")
      || capturedComponent.origin !== "CAPTURED"
      || capturedComponent.selectorOpen
      || capturedComponent.visibleHandle
      || capturedComponent.copyOpacity !== "0") {
      throw new Error(`captured component UI was incomplete: ${JSON.stringify(capturedComponent)}`);
    }

    const capturedComponentId = await evaluate(cdp, `document.querySelector(
      '.diagram-tree-component'
    ).dataset.componentId`);
    await pointerHover(cdp, `[data-component-id="${capturedComponentId}"]`);
    await waitFor(async () => (
      await evaluate(cdp, `getComputedStyle(document.querySelector(
        '[data-component-id="${capturedComponentId}"] .diagram-tree-copy'
      )).opacity`)
    ) === "1", { message: "component copy action did not appear on hover" });
    await pointerClick(cdp, `[data-component-id="${capturedComponentId}"] .diagram-tree-copy`);
    await waitFor(async () => (
      await evaluate(cdp, `document.querySelector(
        '[data-component-id="${capturedComponentId}"] .diagram-tree-copy'
      ).textContent`)
    ) === "copied", { message: "component copy action did not report success" });
    const copiedReference = await evaluate(cdp, `navigator.clipboard.readText()`);
    if (copiedReference !== capturedComponent.reference) {
      throw new Error(`component copy wrote ${copiedReference} instead of ${capturedComponent.reference}`);
    }
    await pointerClick(cdp, `[data-component-id="${capturedComponentId}"] .diagram-tree-component__open`);
    await waitFor(async () => (
      await evaluate(cdp, `document.querySelector('.diagram-panel .eyebrow').textContent.trim()`)
    ) === "DIAGRAM COMPONENT VIEW", { message: "component click did not open the component view" });
    const openedComponentToken = await evaluate(cdp, `document.querySelector('.diagram-meta code').textContent`);
    if (openedComponentToken !== capturedComponent.reference) {
      throw new Error(`component view opened ${openedComponentToken} instead of ${capturedComponent.reference}`);
    }
    await pointerClick(cdp, ".diagram-actions .button:first-child");
    await waitForSelector(cdp, ".ascii-selector");
    await dragBetween(
      cdp,
      '.ascii-char[data-line="1"][data-column="1"]',
      '.ascii-char[data-line="2"][data-column="10"]'
    );
    await waitFor(async () => (
      await evaluate(cdp, `document.querySelectorAll('.diagram-tree-component').length`)
    ) === 2, { timeoutMs: 10000, message: "recursive component capture did not appear" });
    const recursiveShape = await evaluate(cdp, `(() => {
      const parent = document.querySelector('[data-component-id="${capturedComponentId}"]');
      const parentBranch = parent?.closest('.diagram-tree-branch');
      const child = parentBranch?.querySelector(
        ':scope > .diagram-tree-branch > .diagram-tree-component'
      );
      return {
        childId: child?.dataset.componentId ?? '',
        current: child?.classList.contains('is-current') ?? false,
        viewToken: document.querySelector('.diagram-meta code')?.textContent ?? ''
      };
    })()`);
    if (!recursiveShape.childId || !recursiveShape.current
      || !recursiveShape.viewToken.startsWith("@component/")) {
      throw new Error(`recursive component selection was incomplete: ${JSON.stringify(recursiveShape)}`);
    }

    await pointerClick(cdp, `[data-diagram-id="${selection.id}"]`);
    await waitFor(async () => (
      await evaluate(cdp, `document.querySelector('.diagram-panel .pane-header h2').textContent`)
    ) === renamedDiagram, { message: "diagram did not reopen after recursive component selection" });

    await pointerClick(cdp, ".diagram-actions .create-derivative");
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

    await pointerClick(cdp, `[data-diagram-id="${selection.id}"]`);
    const sourceAsciiBeforeEdit = await evaluate(cdp, `document.querySelector('.ascii-stage pre').textContent`);
    await pointerClick(cdp, ".edit-mode-toggle");
    await waitForSelector(cdp, "#operations-tab.is-active");
    await waitForSelector(cdp, ".ascii-editor");
    await replaceText(cdp, ".ascii-editor", "[browser edit]");
    await pointerClick(cdp, ".marker-tool");
    await waitFor(async () => (
      await evaluate(cdp, `document.querySelectorAll('.operation-buffer li.is-applied').length`)
    ) === 1, { message: "manual edit was not added to the operation buffer" });
    await waitForSelector(cdp, ".ascii-selector.is-marking");
    await pointerClick(cdp, '.ascii-char[data-line="1"][data-column="2"]');
    await waitFor(async () => (
      await evaluate(cdp, `document.querySelector('#edit-prompt').value`)
    ) === "@` ", { message: "marker reference was not inserted into the LLM prompt" });
    const markedAscii = await evaluate(cdp, `document.querySelector('.ascii-editor').value`);
    if (markedAscii !== "[`rowser edit]") {
      throw new Error(`marker did not replace exactly one character: ${markedAscii}`);
    }
    await pointerClick(cdp, "#edit-model");
    await cdp.send("Input.dispatchKeyEvent", {
      type: "rawKeyDown", key: "End", code: "End", windowsVirtualKeyCode: 35
    });
    await cdp.send("Input.dispatchKeyEvent", {
      type: "keyUp", key: "End", code: "End", windowsVirtualKeyCode: 35
    });
    await cdp.send("Input.dispatchKeyEvent", {
      type: "rawKeyDown", key: "Enter", code: "Enter", windowsVirtualKeyCode: 13
    });
    await cdp.send("Input.dispatchKeyEvent", {
      type: "keyUp", key: "Enter", code: "Enter", windowsVirtualKeyCode: 13
    });
    await waitFor(async () => (
      await evaluate(cdp, `document.querySelector('#edit-model').value`)
    ) === "gpt-5.6-sol", { message: "edit model dropdown did not select GPT-5.6 Sol" });
    await replaceText(cdp, "#edit-prompt", "Make compact near @`");
    await pointerClick(cdp, ".edit-submit");
    await waitFor(async () => (
      await evaluate(cdp, `document.querySelector('.ascii-editor')?.value ?? ''`)
    ).includes("[edited: Make compact near @`]"), {
      timeoutMs: 10000,
      message: "LLM edit did not update the working copy"
    });
    await pointerClick(cdp, ".ascii-editor");
    await controlKey(cdp, "z", "KeyZ", 90);
    await waitFor(async () => (
      await evaluate(cdp, `document.querySelector('#operations-tab').textContent`)
    ).includes("· 2"), { message: "Ctrl-Z did not undo the LLM operation" });
    await controlKey(cdp, "y", "KeyY", 89);
    await waitFor(async () => (
      await evaluate(cdp, `document.querySelector('#operations-tab').textContent`)
    ).includes("· 3"), { message: "Ctrl-Y did not redo the LLM operation" });
    await waitForSelector(cdp, ".edit-session-actions .button--primary:not(:disabled)");
    await pointerClick(cdp, ".edit-session-actions .button--primary");
    try {
      await waitFor(async () => (
        await evaluate(cdp, `document.querySelectorAll('.diagram-tree-diagram').length`)
      ) === 5, { message: "saving the edit did not publish a new diagram" });
    } catch (error) {
      const state = await evaluate(cdp, `(async () => ({
        count: document.querySelectorAll('.diagram-tree-diagram').length,
        error: document.querySelector('[role="alert"]')?.textContent ?? '',
        sessions: Object.values((await fetch('/api/workspace').then((response) => response.json())).editSessions)
      }))()`);
      throw new Error(`${error.message}: ${JSON.stringify(state)}`);
    }
    const diagramEditState = await evaluate(cdp, `(async () => {
      const workspace = await fetch('/api/workspace').then((response) => response.json());
      const session = Object.values(workspace.editSessions).find(
        (candidate) => candidate.sourceArtifactId === '${selection.id}' && candidate.status === 'committed'
      );
      return {
        sourceAscii: workspace.diagrams['${selection.id}'].ascii,
        outputOrigin: workspace.diagrams[session?.outputArtifactId]?.origin ?? '',
        operationCount: session?.operations.length ?? 0,
        editModel: session?.operations.at(-1)?.modelId ?? '',
        heading: document.querySelector('.diagram-panel .pane-header h2')?.textContent ?? ''
      };
    })()`);
    if (diagramEditState.sourceAscii !== sourceAsciiBeforeEdit
      || diagramEditState.outputOrigin !== "edited"
      || diagramEditState.operationCount !== 3
      || diagramEditState.editModel !== "gpt-5.6-sol"
      || !diagramEditState.heading.endsWith(" Edit")) {
      throw new Error(`diagram edit session was incomplete: ${JSON.stringify(diagramEditState)}`);
    }

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
    if (!archiveState.archivedAt || !archiveState.setId || archiveState.visibleDiagrams !== 4) {
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

    await pointerClick(cdp, '.output-kind [role="radio"]:last-child');
    await replaceText(cdp, "#diagram-prompt", "Vary @component/");
    await waitForSelector(cdp, ".mention-menu [role=option]");
    const componentMention = await evaluate(cdp, `document.querySelector(
      '.mention-menu [role=option] code'
    )?.textContent ?? ''`);
    if (!componentMention.startsWith("@component/")) {
      throw new Error(`component mention was unavailable: ${componentMention}`);
    }
    await pointerClick(cdp, ".mention-menu [role=option]");
    await pointerClick(cdp, ".generate-action");
    await waitFor(async () => (
      await evaluate(cdp, `document.querySelectorAll('.diagram-tree-component').length`)
    ) === 3, { timeoutMs: 10000, message: "generated component did not appear in component lineage" });
    const generatedOrigins = await evaluate(cdp, `Array.from(
      document.querySelectorAll('.diagram-tree-component em'),
      (node) => node.textContent
    )`);
    if (!generatedOrigins.includes("GENERATED")) {
      throw new Error(`component output mode did not create a generated component: ${generatedOrigins}`);
    }
    const componentViewState = await evaluate(cdp, `({
      heading: document.querySelector('.diagram-panel .eyebrow')?.textContent.trim() ?? '',
      currentComponents: document.querySelectorAll('.diagram-tree-component.is-current').length,
      archiveButtons: document.querySelectorAll('.diagram-tree-component .diagram-tree-archive').length,
      copyButtons: document.querySelectorAll('.diagram-tree-component .diagram-tree-copy').length,
      visibleHandles: document.querySelectorAll('.diagram-tree-component code').length
    })`);
    if (componentViewState.heading !== "DIAGRAM COMPONENT VIEW"
      || componentViewState.currentComponents !== 1
      || componentViewState.archiveButtons !== 3
      || componentViewState.copyButtons !== 3
      || componentViewState.visibleHandles !== 0) {
      throw new Error(`generated component view was incomplete: ${JSON.stringify(componentViewState)}`);
    }
    await pointerClick(cdp, ".edit-mode-toggle");
    await waitForSelector(cdp, ".ascii-editor");
    await replaceText(cdp, ".ascii-editor", "[component edit]");
    await pointerClick(cdp, "#operations-tab");
    await waitForSelector(cdp, ".edit-session-actions .button--primary:not(:disabled)");
    await pointerClick(cdp, ".edit-session-actions .button--primary");
    await waitFor(async () => (
      await evaluate(cdp, `document.querySelectorAll('.diagram-tree-component').length`)
    ) === 4, { message: "saving the edit did not publish a new DiagramComponent" });
    const editedComponentState = await evaluate(cdp, `({
      heading: document.querySelector('.diagram-panel .pane-header h2')?.textContent ?? '',
      origin: Array.from(document.querySelectorAll('.diagram-tree-component'))
        .find((node) => node.classList.contains('is-current'))?.querySelector('em')?.textContent ?? ''
    })`);
    if (!editedComponentState.heading.endsWith(" Edit") || editedComponentState.origin !== "EDITED") {
      throw new Error(`DiagramComponent edit was incomplete: ${JSON.stringify(editedComponentState)}`);
    }
    await pointerClick(
      cdp,
      `[data-component-id="${capturedComponentId}"] .diagram-tree-archive`
    );
    await waitFor(async () => (
      await evaluate(cdp, `(
        !document.querySelector('[data-component-id="${capturedComponentId}"]')
        || Boolean(document.querySelector('.diagram-tree-error'))
      )`)
    ), { message: "DiagramComponent archive request did not settle" });
    const componentArchiveError = await evaluate(cdp, `document.querySelector(
      '.diagram-tree-error'
    )?.textContent ?? ''`);
    if (componentArchiveError) {
      throw new Error(`DiagramComponent archive failed in the UI: ${componentArchiveError}`);
    }
    const componentArchiveState = await evaluate(cdp, `(async () => {
      const workspace = await fetch('/api/workspace').then((response) => response.json());
      const component = workspace.diagramComponents['${capturedComponentId}'];
      const set = workspace.diagramSets.find(
        (candidate) => candidate.diagramComponentIds.includes('${capturedComponentId}')
      );
      return {
        archivedAt: component?.archivedAt ?? '',
        setId: set?.id ?? '',
        visibleComponents: document.querySelectorAll('.diagram-tree-component').length
      };
    })()`);
    if (!componentArchiveState.archivedAt || !componentArchiveState.setId
      || componentArchiveState.visibleComponents !== 3) {
      throw new Error(`component archive state was incomplete: ${JSON.stringify(componentArchiveState)}`);
    }
    archivedComponentArtifactPath = path.join(
      fixtureRoot,
      ".diagrams",
      "diagram-sets",
      componentArchiveState.setId,
      "diagram-components",
      `${capturedComponentId}.json`
    );

    const persisted = await evaluate(cdp, `localStorage.getItem('new-diagram:split-percent')`);
    await cdp.send("Page.reload", { ignoreCache: true });
    await waitForSelector(cdp, "[role=separator]");
    const restored = await evaluate(cdp, `localStorage.getItem('new-diagram:split-percent')`);
    if (persisted !== restored) throw new Error("split preference was not retained across reload");
    await pointerClick(cdp, "#diagrams-tab");
    await waitFor(async () => (
      await evaluate(cdp, `(
        !document.querySelector('[data-diagram-id="${selection.id}"]')
        && !document.querySelector('[data-component-id="${capturedComponentId}"]')
        && document.querySelectorAll('.diagram-tree-diagram').length === 4
        && document.querySelectorAll('.diagram-tree-component').length === 3
      )`)
    ), { message: "diagram archival was not persisted across reload" });

    await pointerClick(cdp, ".header-import");
    await waitForSelector(cdp, ".import-dialog");
    await replaceText(cdp, ".import-name input", "Imported browser diagram");
    await replaceText(cdp, ".import-ascii textarea", "+----------+\n| imported |\n+----------+");
    await captureScreenshot(cdp, { output: importScreenshotPath });
    await pointerClick(cdp, '.import-dialog button[type="submit"]');
    await waitFor(async () => await evaluate(cdp, `(
      !document.querySelector('.import-dialog')
      && document.querySelectorAll('.diagram-tree-diagram').length === 5
    )`), { message: "imported Diagram did not appear in the lineage" });
    const importedDiagramState = await evaluate(cdp, `(async () => {
      const workspace = await fetch('/api/workspace').then((response) => response.json());
      const diagram = Object.values(workspace.diagrams).find(
        (candidate) => candidate.name === 'Imported browser diagram'
      );
      return {
        id: diagram?.id ?? '',
        setId: diagram?.diagramSetId ?? '',
        origin: diagram?.origin ?? '',
        viewOrigin: document.querySelector('.diagram-meta span:last-child')?.textContent ?? '',
        ascii: document.querySelector('.ascii-stage pre')?.textContent ?? ''
      };
    })()`);
    if (!importedDiagramState.id || !importedDiagramState.setId
      || importedDiagramState.origin !== "imported"
      || importedDiagramState.viewOrigin !== "IMPORTED"
      || !importedDiagramState.ascii.includes("| imported |")) {
      throw new Error(`imported Diagram view was incomplete: ${JSON.stringify(importedDiagramState)}`);
    }
    importedArtifactPath = path.join(
      fixtureRoot,
      ".diagrams",
      "diagram-sets",
      importedDiagramState.setId,
      "diagrams",
      `${importedDiagramState.id}.json`
    );

    await pointerClick(cdp, ".header-import");
    await waitForSelector(cdp, ".import-dialog");
    await pointerClick(cdp, '.import-kind [role="radio"]:last-child');
    await replaceText(cdp, ".import-name input", "Imported browser component");
    await replaceText(cdp, ".import-ascii textarea", "dynamics -- updates --> Pursuer");
    await pointerClick(cdp, '.import-dialog button[type="submit"]');
    await waitFor(async () => await evaluate(cdp, `(
      !document.querySelector('.import-dialog')
      && document.querySelectorAll('.diagram-tree-component').length === 4
    )`), { message: "imported DiagramComponent did not appear in the lineage" });
    const importedComponentState = await evaluate(cdp, `(async () => {
      const workspace = await fetch('/api/workspace').then((response) => response.json());
      const component = Object.values(workspace.diagramComponents).find(
        (candidate) => candidate.name === 'Imported browser component'
      );
      return {
        id: component?.id ?? '',
        setId: component?.diagramSetId ?? '',
        origin: component?.origin ?? '',
        viewOrigin: document.querySelector('.diagram-meta span:last-child')?.textContent ?? '',
        heading: document.querySelector('.diagram-panel .eyebrow')?.textContent.trim() ?? ''
      };
    })()`);
    if (!importedComponentState.id || !importedComponentState.setId
      || importedComponentState.origin !== "imported"
      || importedComponentState.viewOrigin !== "IMPORTED"
      || importedComponentState.heading !== "DIAGRAM COMPONENT VIEW") {
      throw new Error(`imported DiagramComponent view was incomplete: ${JSON.stringify(importedComponentState)}`);
    }
    importedComponentArtifactPath = path.join(
      fixtureRoot,
      ".diagrams",
      "diagram-sets",
      importedComponentState.setId,
      "diagram-components",
      `${importedComponentState.id}.json`
    );

    await cdp.send("Page.reload", { ignoreCache: true });
    await waitForSelector(cdp, "[role=separator]");
    await pointerClick(cdp, "#diagrams-tab");
    await waitFor(async () => await evaluate(cdp, `(
      document.querySelectorAll('.diagram-tree-diagram').length === 5
      && document.querySelectorAll('.diagram-tree-component').length === 4
      && Array.from(document.querySelectorAll('.diagram-tree-component em')).some(
        (node) => node.textContent === 'IMPORTED'
      )
    )`), { message: "imported artifacts were not persisted across reload" });
  });

  const screenshot = await readFile(screenshotPath);
  if (screenshot.length < 1000) throw new Error("browser screenshot was unexpectedly small");
  const sourceScreenshot = await readFile(sourceScreenshotPath);
  if (sourceScreenshot.length < 1000) throw new Error("source preview screenshot was unexpectedly small");
  const importScreenshot = await readFile(importScreenshotPath);
  if (importScreenshot.length < 1000) throw new Error("import dialog screenshot was unexpectedly small");
  const archivedArtifact = JSON.parse(await readFile(archivedArtifactPath, "utf8"));
  if (!archivedArtifact.archivedAt) throw new Error("archived diagram artifact was removed or unmarked");
  const archivedComponentArtifact = JSON.parse(await readFile(archivedComponentArtifactPath, "utf8"));
  if (!archivedComponentArtifact.archivedAt) {
    throw new Error("archived DiagramComponent artifact was removed or unmarked");
  }
  const importedArtifact = JSON.parse(await readFile(importedArtifactPath, "utf8"));
  if (importedArtifact.origin !== "imported") throw new Error("imported Diagram was not persisted");
  const importedComponentArtifact = JSON.parse(await readFile(importedComponentArtifactPath, "utf8"));
  if (importedComponentArtifact.origin !== "imported") {
    throw new Error("imported DiagramComponent was not persisted");
  }
  process.stdout.write("browser check passed: source -> components -> archives -> imports -> reload\n");
} finally {
  if (serverProcess?.exitCode === null) serverProcess.kill("SIGTERM");
  await rm(fixtureRoot, { recursive: true, force: true });
}
