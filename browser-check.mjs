import { execFile, execFileSync, spawn } from "node:child_process";
import { createServer } from "node:net";
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
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
  await waitFor(async () => await evaluate(cdp, `document.activeElement?.matches(${JSON.stringify(selector)})`), {
    message: `${selector} did not receive focus before text replacement`
  });
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

async function selectLastOption(cdp, selector) {
  await pointerClick(cdp, selector);
  if (!await evaluate(cdp, `document.activeElement?.matches(${JSON.stringify(selector)})`)) {
    await evaluate(cdp, `document.querySelector(${JSON.stringify(selector)}).focus()`);
  }
  await waitFor(async () => await evaluate(cdp, `document.activeElement?.matches(${JSON.stringify(selector)})`), {
    message: `${selector} did not receive focus`
  });
  await cdp.send("Input.dispatchKeyEvent", {
    type: "rawKeyDown", key: "Escape", code: "Escape", windowsVirtualKeyCode: 27
  });
  await cdp.send("Input.dispatchKeyEvent", {
    type: "keyUp", key: "Escape", code: "Escape", windowsVirtualKeyCode: 27
  });
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
}

async function selectOptionAt(cdp, selector, index) {
  await pointerClick(cdp, selector);
  if (!await evaluate(cdp, `document.activeElement?.matches(${JSON.stringify(selector)})`)) {
    await evaluate(cdp, `document.querySelector(${JSON.stringify(selector)}).focus()`);
  }
  const key = async (name, code, windowsVirtualKeyCode) => {
    await cdp.send("Input.dispatchKeyEvent", {
      type: "rawKeyDown", key: name, code, windowsVirtualKeyCode
    });
    await cdp.send("Input.dispatchKeyEvent", {
      type: "keyUp", key: name, code, windowsVirtualKeyCode
    });
  };
  await key("Escape", "Escape", 27);
  await key("Home", "Home", 36);
  for (let optionIndex = 0; optionIndex < index; optionIndex += 1) {
    await key("ArrowDown", "ArrowDown", 40);
  }
  await key("Enter", "Enter", 13);
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

async function dragDivider(cdp, selector = ".split-pane__divider") {
  const clip = await elementClip(cdp, selector);
  const x = clip.x + clip.width / 2;
  const y = clip.y + clip.height / 2;
  await cdp.send("Input.dispatchMouseEvent", { type: "mousePressed", x, y, button: "left", buttons: 1, clickCount: 1 });
  await cdp.send("Input.dispatchMouseEvent", { type: "mouseMoved", x: x - 120, y, button: "left", buttons: 1 });
  await cdp.send("Input.dispatchMouseEvent", { type: "mouseReleased", x: x - 120, y, button: "left", buttons: 0, clickCount: 1 });
}

async function asciiGridPoint(cdp, line, column) {
  const point = await evaluate(cdp, `(() => {
    const grid = document.querySelector('.ascii-grid');
    const bounds = grid?.getBoundingClientRect();
    const cellWidth = Number(grid?.dataset.cellWidth);
    const lineHeight = Number(grid?.dataset.lineHeight);
    if (!bounds || !(cellWidth > 0) || !(lineHeight > 0)) return null;
    return {
      x: bounds.left + (${column} - 0.5) * cellWidth,
      y: bounds.top + (${line} - 0.5) * lineHeight
    };
  })()`);
  if (!point) throw new Error("ASCII grid cell metrics were unavailable");
  return point;
}

async function dragAsciiBetween(cdp, start, end, beforeRelease = async () => {}, modifiers = 0) {
  const { x: x1, y: y1 } = await asciiGridPoint(cdp, start.line, start.column);
  const { x: x2, y: y2 } = await asciiGridPoint(cdp, end.line, end.column);
  await cdp.send("Input.dispatchMouseEvent", {
    type: "mousePressed", x: x1, y: y1, button: "left", buttons: 1, clickCount: 1, modifiers
  });
  await cdp.send("Input.dispatchMouseEvent", {
    type: "mouseMoved", x: x2, y: y2, button: "left", buttons: 1, modifiers
  });
  await beforeRelease();
  await cdp.send("Input.dispatchMouseEvent", {
    type: "mouseReleased", x: x2, y: y2, button: "left", buttons: 0, clickCount: 1, modifiers
  });
}

async function clickAsciiCell(cdp, line, column) {
  const { x, y } = await asciiGridPoint(cdp, line, column);
  await cdp.send("Input.dispatchMouseEvent", { type: "mousePressed", x, y, button: "left", clickCount: 1 });
  await cdp.send("Input.dispatchMouseEvent", { type: "mouseReleased", x, y, button: "left", clickCount: 1 });
}

async function pressEscape(cdp) {
  await cdp.send("Input.dispatchKeyEvent", {
    type: "rawKeyDown", key: "Escape", code: "Escape", windowsVirtualKeyCode: 27
  });
  await cdp.send("Input.dispatchKeyEvent", {
    type: "keyUp", key: "Escape", code: "Escape", windowsVirtualKeyCode: 27
  });
}

async function pressKey(cdp, key, code, windowsVirtualKeyCode) {
  await cdp.send("Input.dispatchKeyEvent", {
    type: "rawKeyDown", key, code, windowsVirtualKeyCode
  });
  await cdp.send("Input.dispatchKeyEvent", {
    type: "keyUp", key, code, windowsVirtualKeyCode
  });
}

const fixtureRoot = await mkdtemp(path.join(tmpdir(), "new-diagram-browser-"));
const screenshotPath = path.join(fixtureRoot, "studio.png");
const sourceScreenshotPath = path.join(fixtureRoot, "compacted-source.png");
const importScreenshotPath = path.join(fixtureRoot, "import-dialog.png");
const generationScreenshotPath = path.join(fixtureRoot, "generation-model.png");
const derivativeScreenshotPath = path.join(fixtureRoot, "derivative-references.png");
const promptSettingsScreenshotPath = path.join(fixtureRoot, "system-prompt-settings.png");
const codeEntityPromptSettingsScreenshotPath = path.join(fixtureRoot, "code-entity-prompt-settings.png");
const mappingScreenshotPath = path.join(fixtureRoot, "code-entity-mapping.png");
const selectRectScreenshotPath = path.join(fixtureRoot, "select-rect.png");
const setPickerScreenshotPath = path.join(fixtureRoot, "diagram-set-picker.png");
const starredDiagramScreenshotPath = path.join(fixtureRoot, "starred-diagram.png");
const fileExplorerScreenshotPath = path.join(fixtureRoot, "file-explorer.png");
let archivedArtifactPath = "";
let archivedComponentArtifactPath = "";
let importedArtifactPath = "";
let importedComponentArtifactPath = "";
let deletedSetId = "";
let serverProcess;
try {
  execFileSync("git", ["init", "-q", fixtureRoot]);
  await writeFile(
    path.join(fixtureRoot, "fixture.ts"),
    [
      "export function updateWorkspace() {",
      "  workspace.status = 'collecting';",
      "  workspace.status = 'ready';",
      "}",
      ...Array.from(
        { length: 80 },
        (_, index) => `export const unrelatedLine${String(index + 1).padStart(3, "0")} = ${index + 1};`
      ),
      ""
    ].join("\n"),
    "utf8"
  );
  await mkdir(path.join(fixtureRoot, "src", "nested"), { recursive: true });
  await writeFile(path.join(fixtureRoot, "src", "nested", "related.ts"), "export const related = true;\n", "utf8");
  await Promise.all(Array.from({ length: 36 }, (_, index) => writeFile(
    path.join(fixtureRoot, `explorer-${String(index + 1).padStart(2, "0")}.txt`),
    `${index + 1}\n`,
    "utf8"
  )));
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

  const promptTemplateListing = await execFileAsync("npm", [
    "run", "diagram", "--", "prompt-templates", "--server", url
  ], { cwd: PACKAGE_ROOT, encoding: "utf8" });
  if (!promptTemplateListing.stdout.includes('"event":"prompt-templates"')
    || !promptTemplateListing.stdout.includes('"id":"default"')
    || !promptTemplateListing.stdout.includes('"id":"compact"')) {
    throw new Error(`CLI prompt-template discovery was incomplete: ${promptTemplateListing.stdout}`);
  }
  const invalidTemplateResponse = await fetch(new URL("/api/diagram-sets", url), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      path: fixtureRoot,
      name: "Must not be created",
      prompt: "Invalid template test",
      promptTemplateId: "missing-template"
    })
  });
  const invalidTemplateError = await invalidTemplateResponse.json();
  const untouchedWorkspace = await fetch(new URL("/api/workspace", url)).then((response) => response.json());
  if (invalidTemplateResponse.status !== 400
    || !invalidTemplateError.error?.includes("available templates")
    || untouchedWorkspace.diagramSets.length !== 0) {
    throw new Error(`invalid template created partial state: ${JSON.stringify({
      status: invalidTemplateResponse.status,
      error: invalidTemplateError,
      diagramSets: untouchedWorkspace.diagramSets
    })}`);
  }

  await withHeadlessBrowser({ url, width: 1440, height: 900 }, async ({ cdp }) => {
    await cdp.send("Page.enable");
    await cdp.send("Runtime.enable");
    await cdp.send("Emulation.setDeviceMetricsOverride", {
      width: 1440,
      height: 900,
      deviceScaleFactor: 1,
      mobile: false
    });
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
      || !collectionResult.stdout.includes(`"serverUrl":"${url.slice(0, -1)}"`)
      || !collectionResult.stdout.includes(`"event":"ready"`)
      || !collectionResult.stdout.includes(`"promptTemplateId":"default"`)
      || !collectionResult.stdout.includes(`"promptTemplateVersion":1`)
      || !collectionResult.stdout.includes(`"generationPromptConfigId":"prompt-`)
      || !collectionResult.stdout.includes(`"codeEntityPromptTemplateId":"default-code-entities"`)
      || !collectionResult.stdout.includes(`"codeEntityPromptTemplateVersion":1`)
      || !collectionResult.stdout.includes(`"codeEntityPromptConfigId":"prompt-`)) {
      throw new Error("CLI did not print the studio server address");
    }
    await waitForSelector(cdp, ".diagram-panel", { timeoutMs: 10000 });
    const initialDiagramCount = await evaluate(cdp, `(async () => {
      const workspace = await fetch('/api/workspace').then((response) => response.json());
      return workspace.diagramSets[0].diagramIds.length;
    })()`);
    if (initialDiagramCount !== 3) {
      throw new Error(`initialization generated ${initialDiagramCount} diagrams instead of 3`);
    }
    await waitForSelector(cdp, ".file-explorer");
    const fileExplorerLayout = await evaluate(cdp, `(() => {
      const files = document.querySelector('[data-pane-id="files"]')?.getBoundingClientRect();
      const primary = document.querySelector('[data-pane-id="primary"]')?.getBoundingClientRect();
      const context = document.querySelector('[data-pane-id="context"]')?.getBoundingClientRect();
      return {
        filesLeft: files?.left,
        filesRight: files?.right,
        primaryLeft: primary?.left,
        primaryRight: primary?.right,
        contextLeft: context?.left,
        filesTabInContext: Boolean(document.querySelector('[data-pane-id="context"] #files-tab'))
      };
    })()`);
    if (!(fileExplorerLayout.filesRight <= fileExplorerLayout.primaryLeft
      && fileExplorerLayout.primaryRight <= fileExplorerLayout.contextLeft)
      || fileExplorerLayout.filesTabInContext) {
      throw new Error(`file explorer was not a standalone left panel: ${JSON.stringify(fileExplorerLayout)}`);
    }
    await waitFor(async () => (
      await evaluate(cdp, `document.querySelectorAll('.file-tree-row').length`)
    ) === 38, { message: "default file explorer did not show the complete repository root" });
    const initialFileExplorerState = await evaluate(cdp, `(() => {
      const activeMode = document.querySelector('.file-explorer__mode-bar button.is-active');
      const paths = Array.from(document.querySelectorAll('.file-tree-row'), (row) => row.dataset.path);
      const scroller = document.querySelector('.file-tree-scroller');
      const bounds = scroller.getBoundingClientRect();
      const style = getComputedStyle(scroller);
      const top = bounds.top + parseFloat(style.paddingTop);
      const bottom = bounds.bottom - parseFloat(style.paddingBottom);
      const fullyVisible = Array.from(document.querySelectorAll('.file-tree-row')).filter((row) => {
        const rowBounds = row.getBoundingClientRect();
        return rowBounds.top >= top - 0.5 && rowBounds.bottom <= bottom + 0.5;
      }).length;
      return {
        activeMode: activeMode?.textContent.trim() ?? '',
        paths,
        fullyVisible,
        scrollHeight: scroller.scrollHeight,
        clientHeight: scroller.clientHeight
      };
    })()`);
    if (initialFileExplorerState.activeMode !== "ALL FILES"
      || initialFileExplorerState.paths.includes(".git")
      || initialFileExplorerState.paths.includes(".diagrams")
      || initialFileExplorerState.fullyVisible !== 34
      || initialFileExplorerState.scrollHeight <= initialFileExplorerState.clientHeight) {
      throw new Error(`file explorer default or density was incorrect: ${JSON.stringify(initialFileExplorerState)}`);
    }
    await pointerClick(cdp, '.file-tree-row[data-path="src"]');
    await waitForSelector(cdp, '.file-tree-row[data-path="src/nested"]');
    await pressKey(cdp, "ArrowLeft", "ArrowLeft", 37);
    await waitFor(async () => (
      await evaluate(cdp, `document.querySelector('.file-tree-row[data-path="src"]').getAttribute('aria-expanded')`)
    ) === "false", { message: "ArrowLeft did not collapse the repository directory" });
    await pressKey(cdp, "ArrowRight", "ArrowRight", 39);
    await waitForSelector(cdp, '.file-tree-row[data-path="src/nested"]');
    await pressKey(cdp, "ArrowRight", "ArrowRight", 39);
    await waitFor(async () => (
      await evaluate(cdp, `document.activeElement?.dataset.path`)
    ) === "src/nested", { message: "ArrowRight did not move focus into the expanded directory" });
    await pointerClick(cdp, ".file-explorer__mode-bar button:nth-child(2)");
    await waitFor(async () => await evaluate(cdp, `(() => {
      const rows = Array.from(document.querySelectorAll('.file-tree-row'));
      return document.querySelector('.file-explorer__mode-bar button:nth-child(2)').getAttribute('aria-pressed') === 'true'
        && rows.length === 1
        && rows[0].dataset.path === 'fixture.ts';
    })()`), { message: "CodeEntity filter did not reduce the live tree to fixture.ts" });
    await captureScreenshot(cdp, { output: fileExplorerScreenshotPath });
    await pointerClick(cdp, ".file-explorer__mode-bar button:nth-child(1)");
    await waitFor(async () => await evaluate(cdp, `(
      document.querySelector('.file-tree-row[data-path="src"]')?.getAttribute('aria-expanded') === 'true'
      && Boolean(document.querySelector('.file-tree-row[data-path="src/nested"]'))
    )`), { message: "ALL FILES expansion state was not restored after filtering" });
    await pointerClick(cdp, ".screen-tabs button:nth-child(2)");
    try {
      await waitForSelector(cdp, "#diagram-prompt");
    } catch (error) {
      const state = await evaluate(cdp, `({
        text: document.body.innerText.slice(0, 2000),
        error: document.querySelector('[role="alert"]')?.textContent ?? ''
      })`);
      throw new Error(`${error.message}: ${JSON.stringify(state)}`);
    }

    const rootDividerSelector = '[data-split-id="studio-root"] > .split-pane__divider';
    const splitBefore = await evaluate(cdp, `Number(document.querySelector(${JSON.stringify('[data-split-id="studio-root"] > .split-pane__divider')}).getAttribute('aria-valuenow'))`);
    await dragDivider(cdp, rootDividerSelector);
    await waitFor(async () => {
      const current = await evaluate(cdp, `Number(document.querySelector(${JSON.stringify('[data-split-id="studio-root"] > .split-pane__divider')}).getAttribute('aria-valuenow'))`);
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
    await selectLastOption(cdp, "#generation-model");
    await waitFor(async () => (
      await evaluate(cdp, `document.querySelector('#generation-model').value`)
    ) === "gpt-5.6-sol", { message: "generation model dropdown did not select GPT-5.6 Sol" });
    await selectLastOption(cdp, "#generation-prompt-profile");
    await waitFor(async () => (
      await evaluate(cdp, `document.querySelector('#generation-prompt-profile').value`)
    ) === "compact", { message: "generation prompt profile did not select Compact" });
    await pointerClick(cdp, ".settings-menu-shell > button");
    await waitForSelector(cdp, ".settings-menu [role=menuitem]");
    await pointerClick(cdp, ".settings-menu [role=menuitem]");
    await waitForSelector(cdp, ".prompt-settings-dialog");
    const compactTemplate = await evaluate(cdp, `document.querySelector(
      '.prompt-template-editor textarea'
    ).value`);
    await replaceText(
      cdp,
      ".prompt-template-editor textarea",
      `${compactTemplate} Browser-persisted-template.`
    );
    await captureScreenshot(cdp, { output: promptSettingsScreenshotPath });
    await pointerClick(cdp, '.prompt-settings-dialog button[type="submit"]');
    await waitFor(async () => (
      await evaluate(cdp, `document.querySelector('.prompt-settings-dialog footer > span').textContent`)
    ).includes("v2"), { message: "system prompt template did not save revision two" });
    const savedTemplate = await evaluate(cdp, `(async () => {
      const workspace = await fetch('/api/workspace').then((response) => response.json());
      return workspace.systemPromptTemplates.compact;
    })()`);
    if (savedTemplate?.version !== 2
      || !savedTemplate?.prompts?.diagram?.includes("Browser-persisted-template.")) {
      throw new Error(`edited prompt template was not persisted: ${JSON.stringify(savedTemplate)}`);
    }
    await pointerClick(cdp, '[aria-label="Prompt family"] button:nth-child(2)');
    await waitFor(async () => await evaluate(cdp, `(() => {
      const editor = document.querySelector('.prompt-template-editor textarea');
      return document.querySelectorAll('.prompt-template-list > button').length === 1
        && editor?.value.includes('A useful CodeEntity');
    })()`), { message: "CodeEntity identification criteria did not appear in prompt settings" });
    await pointerClick(cdp, '[aria-label="CodeEntity prompt"] button:nth-child(2)');
    await waitFor(async () => (
      await evaluate(cdp, `document.querySelector('.prompt-template-editor textarea').value`)
    ).includes("// [Lines 388-405 | 18 lines compacted]"), {
      message: "CodeEntity compaction example did not appear in prompt settings"
    });
    const compactionTemplate = await evaluate(cdp, `document.querySelector(
      '.prompt-template-editor textarea'
    ).value`);
    await replaceText(
      cdp,
      ".prompt-template-editor textarea",
      `${compactionTemplate}\nBrowser-code-entity-template.`
    );
    await captureScreenshot(cdp, { output: codeEntityPromptSettingsScreenshotPath });
    await pointerClick(cdp, '.prompt-settings-dialog button[type="submit"]');
    await waitFor(async () => (
      await evaluate(cdp, `document.querySelector('.prompt-settings-dialog footer > span').textContent`)
    ).includes("v2"), { message: "CodeEntity prompt template did not save revision two" });
    const savedCodeEntityTemplate = await evaluate(cdp, `(async () => {
      const workspace = await fetch('/api/workspace').then((response) => response.json());
      return workspace.codeEntityPromptTemplates['default-code-entities'];
    })()`);
    if (savedCodeEntityTemplate?.version !== 2
      || !savedCodeEntityTemplate?.prompts?.['code-entity-compaction']
        ?.includes("Browser-code-entity-template.")) {
      throw new Error(
        `edited CodeEntity prompt template was not persisted: ${JSON.stringify(savedCodeEntityTemplate)}`
      );
    }
    await pointerClick(cdp, '[aria-label="Prompt family"] button:nth-child(1)');
    await waitFor(async () => await evaluate(cdp, `
      document.querySelectorAll('.prompt-template-list > button').length === 4
    `), { message: "diagram prompt templates did not return after family switch" });
    await pointerClick(cdp, ".prompt-template-list > button:nth-child(2)");
    await waitFor(async () => (
      await evaluate(cdp, `document.querySelector('.prompt-template-fields input').value`)
    ) === "Structure first", { message: "built-in prompt template did not become active" });
    const promptDeleteConfirmation = new Promise((resolve) => {
      const unsubscribe = cdp.on("Page.javascriptDialogOpening", (details) => {
        unsubscribe();
        resolve(details);
      });
    });
    const promptDeleteClick = pointerClick(cdp, ".prompt-template-side-actions .is-danger");
    const promptDeleteDetails = await promptDeleteConfirmation;
    if (!promptDeleteDetails.message.includes("Delete prompt template “Structure first”?")) {
      throw new Error(`prompt delete confirmation was incomplete: ${promptDeleteDetails.message}`);
    }
    await cdp.send("Page.handleJavaScriptDialog", { accept: true });
    await promptDeleteClick;
    await waitFor(async () => await evaluate(cdp, `(async () => {
      const workspace = await fetch('/api/workspace').then((response) => response.json());
      return !workspace.systemPromptTemplates['structure-first']
        && document.querySelectorAll('.prompt-template-list > button').length === 3;
    })()`), { message: "deleted built-in prompt template remained available" });
    await cdp.send("Page.reload", { ignoreCache: true });
    await waitForSelector(cdp, ".diagram-panel", { timeoutMs: 10000 });
    await pointerClick(cdp, ".screen-tabs button:nth-child(2)");
    await waitForSelector(cdp, "#generation-prompt-profile");
    await selectLastOption(cdp, "#generation-model");
    await selectLastOption(cdp, "#generation-prompt-profile");
    await pointerClick(cdp, "#diagram-prompt");
    await cdp.send("Input.insertText", { text: "Show @" });
    await waitForSelector(cdp, ".mention-menu [role=option]");
    await pointerClick(cdp, ".mention-menu [role=option]");
    await captureScreenshot(cdp, { output: generationScreenshotPath });

    await pointerClick(cdp, ".generate-action");
    await waitForSelector(cdp, ".diagram-panel", { timeoutMs: 10000 });
    const generatedPromptConfig = await evaluate(cdp, `(async () => {
      const workspace = await fetch('/api/workspace').then((response) => response.json());
      const set = workspace.diagramSets[0];
      const batch = workspace.generationBatches[set.generationBatchIds.at(-1)];
      return workspace.generationPromptConfigs[batch?.promptConfigId] ?? null;
    })()`);
    if (generatedPromptConfig?.modelId !== "gpt-5.6-sol"
      || generatedPromptConfig?.systemPrompt?.profileId !== "compact"
      || generatedPromptConfig?.systemPrompt?.profileVersion !== 2
      || !generatedPromptConfig?.systemPrompt?.rendered.includes("Browser-persisted-template.")) {
      throw new Error(`generation prompt config was incomplete: ${JSON.stringify(generatedPromptConfig)}`);
    }
    const oldStripExists = await evaluate(cdp, `Boolean(document.querySelector('.diagram-tabs'))`);
    if (oldStripExists) throw new Error("horizontal diagram strip is still rendered");
    const asciiBeforeMapping = await evaluate(cdp, `document.querySelector('.ascii-stage pre').textContent`);
    if (await evaluate(cdp, `document.querySelector('.select-refs').disabled`)) {
      throw new Error("unmapped diagram hid the reason reference selection was unavailable");
    }
    await pointerClick(cdp, ".select-refs");
    await waitFor(async () => (
      await evaluate(cdp, `document.querySelector('.ref-selection-status')?.textContent`)
    ) === "map code entities first", { message: "unmapped reference selection did not explain the required mapping" });
    await pointerClick(cdp, ".map-code-entities");
    await waitForSelector(cdp, ".mapped-element", { timeoutMs: 10000 });
    const characterNodeCount = await evaluate(cdp, `document.querySelectorAll('.ascii-char').length`);
    if (characterNodeCount !== 0) {
      throw new Error(`ASCII grid rendered ${characterNodeCount} per-character nodes`);
    }
    const asciiAfterMapping = await evaluate(cdp, `document.querySelector('.ascii-stage pre').textContent`);
    if (asciiAfterMapping !== asciiBeforeMapping) {
      throw new Error("mapping changed the diagram's ASCII text content");
    }
    const mappedEntityId = await evaluate(cdp, `document.querySelector('.mapped-element').dataset.entityId`);
    const mappedTitle = await evaluate(cdp, `document.querySelector('.mapped-element').title`);
    if (!mappedTitle.includes("Workspace Store") || !mappedTitle.includes("fixture.ts:1-4")) {
      throw new Error(`mapped hover summary was incomplete: ${mappedTitle}`);
    }
    const mappedBounds = await evaluate(cdp, `(() => {
      const mapping = document.querySelector('.mapped-element').dataset;
      return {
        line: Number(mapping.line),
        startColumn: Number(mapping.startColumn),
        endColumn: Number(mapping.endColumn)
      };
    })()`);
    await evaluate(cdp, `(async () => {
      await navigator.clipboard.writeText('selection-sentinel');
      window.__selectedReferenceEnvelope = null;
      window.addEventListener('new-diagram:reference-buffer', (event) => {
        window.__selectedReferenceEnvelope = event.detail;
      }, { once: true });
    })()`);
    await pointerClick(cdp, ".select-refs");
    await waitForSelector(cdp, ".ascii-selector--select-refs");
    await waitForSelector(cdp, '.ref-buffer-tray[data-ref-buffer-count="0"]');
    const cancelStart = await asciiGridPoint(cdp, mappedBounds.line, mappedBounds.startColumn);
    const cancelEnd = await asciiGridPoint(cdp, mappedBounds.line, mappedBounds.endColumn);
    await cdp.send("Input.dispatchMouseEvent", {
      type: "mousePressed", x: cancelStart.x, y: cancelStart.y, button: "left", buttons: 1, clickCount: 1
    });
    await cdp.send("Input.dispatchMouseEvent", {
      type: "mouseMoved", x: cancelEnd.x, y: cancelEnd.y, button: "left", buttons: 1
    });
    await waitForSelector(cdp, ".rect-selection-window");
    await waitForSelector(cdp, '.ref-buffer-tray[data-ref-buffer-preview-count="1"] .ref-buffer-item.is-preview');
    await pressEscape(cdp);
    await waitFor(async () => !await evaluate(cdp, `Boolean(document.querySelector('.rect-selection-window'))`), {
      message: "Escape did not cancel the active selection rectangle"
    });
    if (!await evaluate(cdp, `(() => {
      const tray = document.querySelector('.ref-buffer-tray');
      return tray?.dataset.refBufferCount === '0'
        && tray?.dataset.refBufferPreviewCount === '0'
        && !tray.querySelector('.ref-buffer-item');
    })()`)) {
      throw new Error("cancelling the active rectangle added a reference to the buffer");
    }
    await cdp.send("Input.dispatchMouseEvent", {
      type: "mouseReleased", x: cancelEnd.x, y: cancelEnd.y, button: "left", buttons: 0, clickCount: 1
    });
    await waitForSelector(cdp, ".ascii-selector--select-refs");
    await pressEscape(cdp);
    await waitForSelector(cdp, ".ascii-selector--read");
    await waitFor(async () => !await evaluate(cdp, `Boolean(document.querySelector('.ref-buffer-tray'))`), {
      message: "empty reference buffer remained visible after leaving selection mode"
    });
    if (await evaluate(cdp, `document.querySelector('.select-refs').getAttribute('aria-pressed')`) !== "false") {
      throw new Error("Escape did not cancel reference selection mode");
    }
    await pointerClick(cdp, ".select-refs");
    await waitForSelector(cdp, ".ascii-selector--select-refs");
    await dragAsciiBetween(
      cdp,
      { line: mappedBounds.line, column: mappedBounds.startColumn },
      { line: mappedBounds.line, column: mappedBounds.endColumn },
      async () => {
        await waitForSelector(cdp, ".rect-selection-window");
        await waitForSelector(cdp, ".mapped-element.is-selection-preview");
        await waitForSelector(cdp, '.ref-buffer-tray[data-ref-buffer-preview-count="1"] .ref-buffer-item.is-preview');
        const overlayText = await evaluate(cdp, `document.querySelector(
          '.rect-selection-overlay__ref'
        )?.textContent ?? ''`);
        if (overlayText !== "fixture.ts") {
          throw new Error(`selection overlay showed ${JSON.stringify(overlayText)} instead of fixture.ts`);
        }
        await captureScreenshot(cdp, { output: selectRectScreenshotPath });
      }
    );
    await waitForSelector(cdp, '.ref-buffer-tray[data-ref-buffer-count="1"]');
    if (await evaluate(cdp, `Boolean(document.querySelector('.rect-selection-window'))`)) {
      throw new Error("selection rectangle remained after pointer release");
    }
    if (!await evaluate(cdp, `document.querySelector('.mapped-element').classList.contains('is-buffered-ref')`)) {
      throw new Error("buffered mapping did not retain its committed highlight");
    }
    const clipboardAfterSelection = await evaluate(cdp, `navigator.clipboard.readText()`);
    if (clipboardAfterSelection !== "selection-sentinel") {
      throw new Error(`rectangle selection unexpectedly wrote ${clipboardAfterSelection} to the clipboard`);
    }
    await pointerClick(cdp, ".ref-buffer-actions button:nth-child(1)");
    await waitFor(async () => (
      await evaluate(cdp, `navigator.clipboard.readText()`)
    ) === "fixture.ts:1-4", { message: "copy paths did not use the source-location representation" });
    await pointerClick(cdp, ".ref-buffer-actions button:nth-child(3)");
    await waitFor(async () => await evaluate(cdp, `(() => {
      const envelope = window.__selectedReferenceEnvelope;
      const reference = envelope?.references?.[0];
      return envelope?.schemaVersion === 2
        && envelope.references?.length === 1
        && reference.kind === 'code-entity'
        && reference.targetId === ${JSON.stringify(mappedEntityId)}
        && typeof reference.sourceRangeId === 'string'
        && reference.sourceRangeId.length > 0
        && typeof reference.origin?.projectId === 'string'
        && typeof reference.origin?.diagramSetId === 'string'
        && typeof reference.origin?.codeEntitiesSetId === 'string';
    })()`), { message: "internal reference envelope did not preserve the selected identity" });
    await pointerClick(cdp, ".ref-buffer-actions button:nth-child(4)");
    await waitFor(async () => await evaluate(cdp, `(() => {
      const tray = document.querySelector('.ref-buffer-tray');
      return tray?.dataset.refBufferCount === '0' && !tray.querySelector('.ref-buffer-item');
    })()`), {
      message: "clear did not empty the reference buffer"
    });
    await pointerClick(cdp, ".select-refs");
    await waitForSelector(cdp, ".ascii-selector--read");
    await waitFor(async () => !await evaluate(cdp, `Boolean(document.querySelector('.ref-buffer-tray'))`), {
      message: "empty reference buffer remained visible after explicit selection mode"
    });
    await dragAsciiBetween(
      cdp,
      { line: mappedBounds.line, column: mappedBounds.startColumn },
      { line: mappedBounds.line, column: mappedBounds.endColumn },
      async () => {
        await waitForSelector(cdp, ".rect-selection-window");
      },
      2
    );
    await waitForSelector(cdp, '.ref-buffer-tray[data-ref-buffer-count="1"]');
    await pointerClick(cdp, ".ref-buffer-actions button:nth-child(4)");
    await waitFor(async () => !await evaluate(cdp, `Boolean(document.querySelector('.ref-buffer-tray'))`), {
      message: "clear did not empty the reference buffer after Ctrl-drag"
    });
    await pointerHover(cdp, ".mapped-element");
    await pointerClick(cdp, ".mapped-element");
    await waitForSelector(cdp, ".source-workspace.is-revealed", { timeoutMs: 10000 });
    await waitForSelector(cdp, ".source-code-viewer", { timeoutMs: 10000 });
    const revealedEntityId = await evaluate(cdp, `document.querySelector('.source-workspace').dataset.activeEntityId`);
    if (revealedEntityId !== mappedEntityId) {
      throw new Error(`mapped entity ${mappedEntityId} revealed ${revealedEntityId}`);
    }
    const entityTabSelected = await evaluate(cdp, `document.querySelector('#code-entities-tab').getAttribute('aria-selected')`);
    if (entityTabSelected !== "true") throw new Error("mapped element did not open the Code Entities tab");
    const sourceLayout = await evaluate(cdp, `(() => {
      const root = document.querySelector('.entities-panel').getBoundingClientRect();
      const source = document.querySelector('.source-workspace').getBoundingClientRect();
      return {
        sourceRatio: source.height / root.height,
        sourceWidthRatio: source.width / root.width,
        hasContext: Boolean(document.querySelector('.entity-context')),
        hasDivider: Boolean(document.querySelector('.entity-context-divider')),
        hasOriginalToggle: Boolean(document.querySelector('.source-original-toggle'))
      };
    })()`);
    if (sourceLayout.sourceRatio < 0.99
      || sourceLayout.sourceWidthRatio < 0.99
      || sourceLayout.hasContext
      || sourceLayout.hasDivider
      || sourceLayout.hasOriginalToggle) {
      throw new Error(`artifact source workspace was not source-only: ${JSON.stringify(sourceLayout)}`);
    }
    await waitFor(async () => (
      await evaluate(cdp, `document.querySelectorAll('.source-code-viewer[data-highlighted="true"] .source-token').length`)
    ) > 0, { message: "Shiki did not render syntax-highlighted tokens" });
    const fullSourceState = await evaluate(cdp, `({
      text: document.querySelector('.source-code-content').textContent,
      selectedLines: document.querySelectorAll('.source-code-line[data-selected="true"]').length,
      renderedLines: document.querySelectorAll('.source-code-line').length,
      foldedSections: document.querySelectorAll('.source-fold-placeholder').length,
      compactedNodes: document.querySelectorAll('.source-call-graph-node').length
    })`);
    if (!fullSourceState.text.includes("unrelatedLine080")
      || !fullSourceState.text.includes("2 lines compacted")
      || fullSourceState.selectedLines !== 2
      || fullSourceState.renderedLines !== 83
      || fullSourceState.foldedSections !== 1
      || fullSourceState.compactedNodes !== 3) {
      throw new Error(`full source file did not retain its compacted range: ${JSON.stringify(fullSourceState)}`);
    }
    const sourceBeforeTyping = await evaluate(cdp, `document.querySelector('.source-code-content').textContent`);
    await pointerClick(cdp, ".source-code-content");
    await cdp.send("Input.insertText", { text: "MUTATION" });
    const sourceAfterTyping = await evaluate(cdp, `document.querySelector('.source-code-content').textContent`);
    if (sourceAfterTyping !== sourceBeforeTyping) throw new Error("read-only source viewer accepted source edits");
    await captureScreenshot(cdp, { output: mappingScreenshotPath });
    await captureScreenshot(cdp, { output: sourceScreenshotPath });

    await pointerClick(cdp, "#diagrams-tab");
    await waitForSelector(cdp, ".diagram-lineage-panel");
    await waitFor(async () => (
      await evaluate(cdp, `document.querySelectorAll('.diagram-tree-diagram').length`)
    ) === 6, { timeoutMs: 10000, message: "lineage tree did not render six diagrams" });
    await pointerClick(cdp, "[data-generation-batch-id] .diagram-tree-toggle");
    await waitFor(async () => (
      await evaluate(cdp, `document.querySelectorAll('.diagram-tree-diagram').length`)
    ) === 3, { message: "root generation did not collapse" });
    const rootCollapsedLabel = await evaluate(cdp, `document.querySelector(
      '[data-generation-batch-id] .diagram-tree-toggle'
    ).textContent`);
    if (rootCollapsedLabel !== "[+3]") throw new Error(`root collapse count was ${rootCollapsedLabel}`);
    await pointerClick(cdp, "[data-generation-batch-id] .diagram-tree-toggle");
    await waitFor(async () => (
      await evaluate(cdp, `document.querySelectorAll('.diagram-tree-diagram').length`)
    ) === 6, { message: "root generation did not expand" });
    const bridgeTexts = await evaluate(cdp, `Array.from(
      document.querySelectorAll('.diagram-tree-bridge'),
      (node) => node.textContent
    )`);
    if (bridgeTexts.length < 4 || bridgeTexts.some((value) => !/^[| ]+$/.test(value))) {
      throw new Error(`lineage bridges were not ASCII pipes: ${JSON.stringify(bridgeTexts)}`);
    }
    const selection = await evaluate(cdp, `(() => {
      const generation = Array.from(document.querySelectorAll('[data-generation-batch-id]')).at(-1);
      const node = generation?.closest('.diagram-tree-branch')
        ?.querySelector('.diagram-tree-diagram:not(.is-current)');
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
    await pointerClick(cdp, ".diagram-star-toggle");
    try {
      await waitFor(async () => await evaluate(cdp, `(async () => {
        const workspace = await fetch('/api/workspace').then((response) => response.json());
        const activeSet = workspace.diagramSets.find((set) => set.diagramIds.includes('${selection.id}'));
        return document.querySelector('.diagram-star-toggle')?.getAttribute('aria-pressed') === 'true'
          && document.querySelector('[data-diagram-id="${selection.id}"] .diagram-tree-star')?.textContent.trim() === '★'
          && activeSet?.featuredViewIds?.diagram === '${selection.id}';
      })()`), { message: "chosen diagram state did not reach the header, lineage, and persistence" });
    } catch (error) {
      const state = await evaluate(cdp, `(async () => {
        const workspace = await fetch('/api/workspace').then((response) => response.json());
        const activeSet = workspace.diagramSets.find((set) => set.diagramIds.includes('${selection.id}'));
        const star = document.querySelector('.diagram-star-toggle');
        const bounds = star?.getBoundingClientRect();
        const hit = bounds ? document.elementFromPoint(bounds.left + bounds.width / 2, bounds.top + bounds.height / 2) : null;
        return {
          headerPressed: star?.getAttribute('aria-pressed'),
          lineageStar: document.querySelector('[data-diagram-id="${selection.id}"] .diagram-tree-star')?.textContent.trim(),
          persistedId: activeSet?.featuredViewIds?.diagram,
          expectedId: '${selection.id}',
          starBounds: bounds && { left: bounds.left, top: bounds.top, width: bounds.width, height: bounds.height },
          hitClass: hit?.className,
          hitTag: hit?.tagName
        };
      })()`);
      throw new Error(`${error.message}: ${JSON.stringify(state)}`);
    }
    await captureScreenshot(cdp, { output: starredDiagramScreenshotPath });
    await pointerHover(cdp, `[data-diagram-id="${selection.id}"]`);
    await pointerClick(cdp, `[data-diagram-id="${selection.id}"] .diagram-tree-prompt`);
    await waitForSelector(cdp, ".prompt-config-dialog");
    const inspectedPrompt = await evaluate(cdp, `document.querySelector('.prompt-config-dialog').textContent`);
    if (!inspectedPrompt.includes("Immutable prompt config")
      || !inspectedPrompt.includes("Rendered system prompt")) {
      throw new Error("lineage prompt inspection did not expose the persisted config");
    }
    await pointerClick(cdp, ".prompt-config-dialog > header button");
    await waitFor(async () => await evaluate(cdp, `!document.querySelector('.prompt-config-dialog')`), {
      message: "prompt inspection dialog did not close"
    });

    await pointerClick(cdp, ".diagram-actions .capture-component");
    await waitForSelector(cdp, ".ascii-selector");
    await dragAsciiBetween(
      cdp,
      { line: 1, column: 1 },
      { line: 3, column: 20 }
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
    await pointerClick(cdp, ".diagram-actions .capture-component");
    await waitForSelector(cdp, ".ascii-selector");
    await dragAsciiBetween(
      cdp,
      { line: 1, column: 1 },
      { line: 2, column: 10 }
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
    await waitForSelector(cdp, '.prompt-reference-controls input[type="checkbox"]');
    const derivativePromptState = await evaluate(cdp, `({
      instruction: document.querySelector('#diagram-prompt').value,
      model: document.querySelector('#generation-model').value,
      profile: document.querySelector('#generation-prompt-profile').value,
      output: document.querySelector('.output-kind [aria-checked="true"]').textContent.trim(),
      reference: document.querySelector('.prompt-reference-controls code').textContent,
      included: document.querySelector('.prompt-reference-controls input').checked
    })`);
    if (!derivativePromptState.instruction.startsWith("---- PREVIOUS PROMPT ----")
      || !derivativePromptState.instruction.includes("-------------------------")
      || !derivativePromptState.instruction.includes(stableHandle)
      || !derivativePromptState.instruction.includes("@entity/")
      || derivativePromptState.reference !== stableHandle
      || !derivativePromptState.included
      || derivativePromptState.model !== "gpt-5.6-sol"
      || derivativePromptState.profile !== "compact"
      || derivativePromptState.output !== "Diagram") {
      throw new Error(`derivative prompt was not rehydrated: ${JSON.stringify(derivativePromptState)}`);
    }
    await pointerClick(cdp, '.prompt-reference-controls input[type="checkbox"]');
    await waitFor(async () => await evaluate(cdp, `(() => {
      const root = document.querySelector('.prompt-reference-controls');
      return !root.querySelector('input').checked
        && root.querySelector('em').textContent.trim() === 'omitted'
        && Boolean(root.querySelector('.prompt-reference-warning'));
    })()`), { message: "diagram reference toggle did not omit the derivative source" });
    await pointerClick(cdp, '[aria-label="Use one fewer agent"]');
    await pointerClick(cdp, '.output-kind [role="radio"]:last-child');
    await selectOptionAt(cdp, "#generation-model", 0);
    await selectOptionAt(cdp, "#generation-prompt-profile", 0);
    await pointerClick(cdp, "#code-entities-tab");
    await waitForSelector(cdp, ".entity-context__toggle input");
    await pointerClick(cdp, ".entity-context__toggle input");
    await waitFor(async () => await evaluate(cdp, `(() => ({
      count: document.querySelector('.counter output').textContent,
      output: document.querySelector('.output-kind [aria-checked="true"]').textContent.trim(),
      model: document.querySelector('#generation-model').value,
      profile: document.querySelector('#generation-prompt-profile').value,
      entityIncluded: document.querySelector('.entity-context__toggle input').checked
    }))()` ).then((state) => state.count === "2"
      && state.output === "DiagramComponent"
      && state.model === "gpt-5.6-terra"
      && state.profile === "default"
      && !state.entityIncluded), { message: "generation controls did not settle before persistence" });
    await pointerClick(cdp, "#diagram-prompt");
    await controlKey(cdp, "End", "End", 35);
    await cdp.send("Input.insertText", { text: "D" });
    const savedDerivativePrompt = `${derivativePromptState.instruction}D`;
    await waitFor(async () => await evaluate(cdp, `(() => {
      const entry = Object.entries(localStorage).find(([key]) => (
        key.startsWith('new-diagram:generation-draft:') && key.endsWith(':diagram:${selection.id}')
      ));
      if (!entry) return false;
      const draft = JSON.parse(entry[1]);
      return draft.prompt === ${JSON.stringify(savedDerivativePrompt)}
        && draft.selectedCodeEntityIds.length === 0
        && draft.excludedReferenceKeys.includes('diagram:${selection.id}')
        && draft.count === 2
        && draft.targetKind === 'diagram-component'
        && draft.modelId === 'gpt-5.6-terra'
        && draft.promptProfileId === 'default';
    })()`), { message: "complete derivative generation state was not saved" });
    await pointerClick(cdp, ".generation-back");
    await waitFor(async () => (
      await evaluate(cdp, `document.querySelector('.diagram-panel .pane-header h2').textContent`)
    ) === renamedDiagram, { message: "derivative back button did not return to its source diagram" });
    await cdp.send("Page.reload", { ignoreCache: true });
    await waitForSelector(cdp, ".diagram-panel");
    await pointerClick(cdp, "#diagrams-tab");
    await waitForSelector(cdp, `[data-diagram-id="${selection.id}"]`);
    await pointerClick(cdp, `[data-diagram-id="${selection.id}"]`);
    await waitFor(async () => (
      await evaluate(cdp, `document.querySelector('.diagram-panel .pane-header h2').textContent`)
    ) === renamedDiagram, { message: "source diagram did not reopen after reload" });
    const restoredStarredState = await evaluate(cdp, `({
      pressed: document.querySelector('.diagram-star-toggle')?.getAttribute('aria-pressed'),
      marker: document.querySelector('[data-diagram-id="${selection.id}"] .diagram-tree-star')?.textContent.trim()
    })`);
    if (restoredStarredState.pressed !== "true" || restoredStarredState.marker !== "★") {
      throw new Error(`chosen diagram state did not survive reload: ${JSON.stringify(restoredStarredState)}`);
    }
    await pointerClick(cdp, ".diagram-actions .create-derivative");
    await waitForSelector(cdp, "#diagram-prompt");
    await waitForSelector(cdp, '.prompt-reference-controls input[type="checkbox"]');
    const restoredGenerationState = await evaluate(cdp, `(() => {
      const references = document.querySelector('.prompt-reference-controls');
      return {
        prompt: document.querySelector('#diagram-prompt').value,
        referenceIncluded: references.querySelector('input').checked,
        referenceStatus: references.querySelector('em').textContent.trim(),
        warning: Boolean(references.querySelector('.prompt-reference-warning')),
        count: document.querySelector('.counter output').textContent,
        output: document.querySelector('.output-kind [aria-checked="true"]').textContent.trim(),
        model: document.querySelector('#generation-model').value,
        profile: document.querySelector('#generation-prompt-profile').value
      };
    })()`);
    if (restoredGenerationState.prompt !== savedDerivativePrompt
      || restoredGenerationState.referenceIncluded
      || restoredGenerationState.referenceStatus !== "omitted"
      || !restoredGenerationState.warning
      || restoredGenerationState.count !== "2"
      || restoredGenerationState.output !== "DiagramComponent"
      || restoredGenerationState.model !== "gpt-5.6-terra"
      || restoredGenerationState.profile !== "default") {
      throw new Error(`generation controls did not restore after reload: ${JSON.stringify(restoredGenerationState)}`);
    }
    await pointerClick(cdp, "#code-entities-tab");
    await waitForSelector(cdp, ".entity-context__toggle input");
    if (await evaluate(cdp, `document.querySelector('.entity-context__toggle input').checked`)) {
      throw new Error("CodeEntity inclusion checkbox did not restore after reload");
    }
    await captureScreenshot(cdp, { output: derivativeScreenshotPath });
    await evaluate(cdp, `document.querySelector('.entity-context__toggle input').focus()`);
    await cdp.send("Input.dispatchKeyEvent", {
      type: "rawKeyDown", key: " ", code: "Space", windowsVirtualKeyCode: 32
    });
    await cdp.send("Input.dispatchKeyEvent", {
      type: "keyUp", key: " ", code: "Space", windowsVirtualKeyCode: 32
    });
    await waitFor(async () => await evaluate(
      cdp,
      `document.querySelector('.entity-context__toggle input').checked`
    ), { message: "CodeEntity inclusion checkbox did not reset after persistence check" });
    await replaceText(cdp, "#diagram-prompt", derivativePromptState.instruction);
    await pointerClick(cdp, '.prompt-reference-controls input[type="checkbox"]');
    await pointerClick(cdp, '[aria-label="Use one more agent"]');
    await pointerClick(cdp, '.output-kind [role="radio"]:first-of-type');
    await selectOptionAt(cdp, "#generation-model", 1);
    await selectOptionAt(cdp, "#generation-prompt-profile", 3);
    try {
      await waitFor(async () => await evaluate(cdp, `(() => {
        const root = document.querySelector('.prompt-reference-controls');
        return document.querySelector('#diagram-prompt').value === ${JSON.stringify(derivativePromptState.instruction)}
          && root.querySelector('input').checked
          && root.querySelector('em').textContent.trim() === 'included'
          && !root.querySelector('.prompt-reference-warning')
          && document.querySelector('.counter output').textContent === '3'
          && document.querySelector('.output-kind [aria-checked="true"]').textContent.trim() === 'Diagram'
          && document.querySelector('#generation-model').value === 'gpt-5.6-sol'
          && document.querySelector('#generation-prompt-profile').value === 'compact'
          && document.querySelector('.entity-context__toggle input').checked;
      })()`), { message: "generation controls did not reset after persistence check" });
    } catch (error) {
      const resetState = await evaluate(cdp, `(() => {
        const root = document.querySelector('.prompt-reference-controls');
        return {
          prompt: document.querySelector('#diagram-prompt').value,
          referenceIncluded: root.querySelector('input').checked,
          referenceStatus: root.querySelector('em').textContent.trim(),
          warning: Boolean(root.querySelector('.prompt-reference-warning')),
          count: document.querySelector('.counter output').textContent,
          output: document.querySelector('.output-kind [aria-checked="true"]').textContent.trim(),
          model: document.querySelector('#generation-model').value,
          profile: document.querySelector('#generation-prompt-profile').value,
          entityIncluded: document.querySelector('.entity-context__toggle input').checked
        };
      })()`);
      throw new Error(`${error.message}: ${JSON.stringify(resetState)}`);
    }
    await pointerClick(cdp, "#diagram-prompt");
    await controlKey(cdp, "End", "End", 35);
    await cdp.send("Input.insertText", { text: "Tighten derivative flow." });
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
    const derivativeConfig = await evaluate(cdp, `(async () => {
      const workspace = await fetch('/api/workspace').then((response) => response.json());
      const set = workspace.diagramSets[0];
      const batch = workspace.generationBatches[set.generationBatchIds.at(-1)];
      return workspace.generationPromptConfigs[batch.promptConfigId];
    })()`);
    if (derivativeConfig?.derivation?.sourceArtifactId !== selection.id
      || derivativeConfig?.derivation?.promptCorrection !== "Tighten derivative flow."
      || derivativeConfig?.references?.find((reference) => reference.kind === "diagram")?.targetId !== selection.id
      || derivativeConfig?.omittedReferences?.length) {
      throw new Error(`derivative reference decision was not persisted: ${JSON.stringify(derivativeConfig)}`);
    }
    await pointerClick(cdp, "#diagrams-tab");
    await waitFor(async () => (
      await evaluate(cdp, `document.querySelectorAll('.diagram-tree-diagram').length`)
    ) === 7, { timeoutMs: 10000, message: "derivative did not appear in lineage tree" });
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
    if (lineageShape.visibleGenerations !== 2 || lineageShape.directChildDiagrams !== 1) {
      throw new Error(`derivative lineage was not compact: ${JSON.stringify(lineageShape)}`);
    }
    const renamedInTree = await evaluate(cdp, `document.querySelector(
      '[data-diagram-id="${selection.id}"] .diagram-tree-description'
    )?.textContent`);
    if (renamedInTree !== renamedDiagram) throw new Error("lineage tree lost the renamed diagram name");
    await pointerClick(cdp, `[data-diagram-id="${selection.id}"] .diagram-tree-toggle`);
    await waitFor(async () => (
      await evaluate(cdp, `document.querySelectorAll('.diagram-tree-diagram').length`)
    ) === 6, { message: "diagram descendants did not collapse" });
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
    ) === 7, { message: "diagram descendants did not expand" });

    await pointerClick(cdp, `[data-diagram-id="${selection.id}"]`);
    await waitFor(async () => (
      await evaluate(cdp, `document.querySelector('.diagram-panel .pane-header h2').textContent`)
    ) === renamedDiagram, { message: "diagram did not settle before edit mode" });
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
    await clickAsciiCell(cdp, 1, 2);
    await waitFor(async () => (
      await evaluate(cdp, `document.querySelector('#edit-prompt').value`)
    ) === "@` ", { message: "marker reference was not inserted into the LLM prompt" });
    const markedAscii = await evaluate(cdp, `document.querySelector('.ascii-editor').value`);
    if (markedAscii !== "[`rowser edit]") {
      throw new Error(`marker did not replace exactly one character: ${markedAscii}`);
    }
    await selectLastOption(cdp, "#edit-model");
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
      ) === 8, { message: "saving the edit did not publish a new diagram" });
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
      throw new Error(`diagram edit session was incomplete: ${JSON.stringify({ ...diagramEditState, sourceAsciiBeforeEdit })}`);
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
        starredDiagramId: set?.featuredViewIds?.diagram ?? '',
        visibleDiagrams: document.querySelectorAll('.diagram-tree-diagram').length
      };
    })()`);
    if (!archiveState.archivedAt || !archiveState.setId || archiveState.starredDiagramId
      || archiveState.visibleDiagrams !== 7) {
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
    await pointerClick(cdp, ".mention-menu [role=option]");
    await waitFor(async () => await evaluate(cdp, `!document.querySelector('.mention-menu')`), {
      message: "diagram mention menu did not close after selection"
    });

    await pointerClick(cdp, '.output-kind [role="radio"]:last-child');
    await waitFor(async () => (
      await evaluate(cdp, `document.querySelector('.output-kind [role="radio"]:last-child').getAttribute('aria-checked')`)
    ) === "true", { message: "component output kind did not become active" });
    await replaceText(cdp, "#diagram-prompt", "Vary @component/");
    await waitFor(async () => (
      await evaluate(cdp, `document.querySelector('#diagram-prompt').value`)
    ) === "Vary @component/", { message: "component prompt text did not settle" });
    try {
      await waitForSelector(cdp, ".mention-menu [role=option]");
    } catch (error) {
      const state = await evaluate(cdp, `(async () => {
        const workspace = await fetch('/api/workspace').then((response) => response.json());
        return {
          prompt: document.querySelector('#diagram-prompt')?.value ?? '',
          components: Object.values(workspace.diagramComponents).map((component) => ({
            handle: component.handle,
            archivedAt: component.archivedAt ?? ''
          })),
          error: document.querySelector('[role="alert"]')?.textContent ?? ''
        };
      })()`);
      throw new Error(`${error.message}: ${JSON.stringify(state)}`);
    }
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
    await evaluate(cdp, `document.querySelector(
      '[data-component-id="${capturedComponentId}"] .diagram-tree-archive'
    ).scrollIntoView({ block: 'center' })`);
    await pointerClick(
      cdp,
      `[data-component-id="${capturedComponentId}"] .diagram-tree-archive`
    );
    try {
      await waitFor(async () => (
        await evaluate(cdp, `(
          !document.querySelector('[data-component-id="${capturedComponentId}"]')
          || Boolean(document.querySelector('.diagram-tree-error'))
        )`)
      ), { message: "DiagramComponent archive request did not settle" });
    } catch (error) {
      const state = await evaluate(cdp, `(async () => {
        const workspace = await fetch('/api/workspace').then((response) => response.json());
        return {
          archivedAt: workspace.diagramComponents['${capturedComponentId}']?.archivedAt ?? '',
          rowCount: document.querySelectorAll('[data-component-id="${capturedComponentId}"]').length,
          disabled: document.querySelector('[data-component-id="${capturedComponentId}"] .diagram-tree-archive')?.disabled,
          alert: document.querySelector('.diagram-tree-error')?.textContent ?? ''
        };
      })()`);
      throw new Error(`${error.message}: ${JSON.stringify(state)}`);
    }
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
        && document.querySelectorAll('.diagram-tree-diagram').length === 7
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
      && document.querySelectorAll('.diagram-tree-diagram').length === 8
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
        ascii: document.querySelector('.ascii-stage pre')?.textContent ?? '',
        importsBranches: document.querySelectorAll('[data-imports-branch]').length,
        groupedUnderImports: Boolean(diagram?.id && document.querySelector(
          '[data-imports-branch] [data-diagram-id="' + diagram.id + '"]'
        ))
      };
    })()`);
    if (!importedDiagramState.id || !importedDiagramState.setId
      || importedDiagramState.origin !== "imported"
      || importedDiagramState.viewOrigin !== "IMPORTED"
      || importedDiagramState.importsBranches !== 1
      || !importedDiagramState.groupedUnderImports
      || !importedDiagramState.ascii.includes("| imported |")) {
      throw new Error(`imported Diagram view was incomplete: ${JSON.stringify(importedDiagramState)}`);
    }
    importedArtifactPath = path.join(
      fixtureRoot,
      ".diagrams",
      "imports",
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
      "imports",
      "diagram-components",
      `${importedComponentState.id}.json`
    );

    await cdp.send("Page.reload", { ignoreCache: true });
    await waitForSelector(cdp, "[role=separator]");
    await pointerClick(cdp, "#diagrams-tab");
    await waitFor(async () => await evaluate(cdp, `(
      document.querySelectorAll('.diagram-tree-diagram').length === 8
      && document.querySelectorAll('.diagram-tree-component').length === 4
      && document.querySelectorAll('[data-imports-branch]').length === 1
      && document.querySelector('[data-imports-branch] [data-diagram-id="${importedDiagramState.id}"]')
      && Array.from(document.querySelectorAll('.diagram-tree-component em')).some(
        (node) => node.textContent === 'GLOBAL'
      )
    )`), { message: "imported artifacts were not persisted across reload" });

    const disposableCollection = await execFileAsync("npm", [
      "run", "diagram", "--", "create",
      "--path", fixtureRoot,
      "--name", "Delete browser fixture",
      "--prompt", "Temporary Diagram Set",
      "--prompt-template", "compact",
      "--server", url
    ], {
      cwd: PACKAGE_ROOT,
      env: { ...process.env, NEW_DIAGRAM_AGENT: "fake" },
      encoding: "utf8"
    });
    if (!disposableCollection.stdout.includes('"promptTemplateId":"compact"')
      || !disposableCollection.stdout.includes('"promptTemplateVersion":2')) {
      throw new Error(`CLI did not report the selected persisted template: ${disposableCollection.stdout}`);
    }
    await cdp.send("Page.reload", { ignoreCache: true });
    await waitForSelector(cdp, ".diagram-panel", { timeoutMs: 10000 });
    deletedSetId = await evaluate(cdp, `(async () => {
      const workspace = await fetch('/api/workspace').then((response) => response.json());
      return workspace.diagramSets.at(-1)?.id ?? '';
    })()`);
    const selectedInitialPrompt = await evaluate(cdp, `(async () => {
      const workspace = await fetch('/api/workspace').then((response) => response.json());
      const set = workspace.diagramSets.find((candidate) => candidate.id === ${JSON.stringify(deletedSetId)});
      const batch = workspace.generationBatches[set?.generationBatchIds.at(-1)];
      return workspace.generationPromptConfigs[batch?.promptConfigId]?.systemPrompt ?? null;
    })()`);
    if (selectedInitialPrompt?.profileId !== "compact"
      || selectedInitialPrompt?.profileVersion !== 2
      || !selectedInitialPrompt?.rendered?.includes("Browser-persisted-template.")) {
      throw new Error(`initial generation ignored CLI template selection: ${JSON.stringify(selectedInitialPrompt)}`);
    }
    await pointerClick(cdp, "#diagrams-tab");
    await waitFor(async () => await evaluate(cdp, `Boolean(
      document.querySelector('[data-imports-branch] [data-diagram-id="${importedDiagramState.id}"]')
    )`), { message: "global import was not visible from the second Diagram Set" });
    await pointerClick(cdp, ".set-picker__trigger");
    await waitFor(async () => (
      await evaluate(cdp, `document.querySelectorAll('.set-picker__option').length`)
    ) === 2, { message: "Diagram Set picker did not render both sets" });
    const deleteLabels = await evaluate(cdp, `Array.from(
      document.querySelectorAll('.set-picker__delete'),
      (button) => button.textContent
    )`);
    if (deleteLabels.some((label) => label !== "[x]")) {
      throw new Error(`Diagram Set delete controls were incomplete: ${JSON.stringify(deleteLabels)}`);
    }
    await captureScreenshot(cdp, { output: setPickerScreenshotPath });
    const confirmation = new Promise((resolve) => {
      const unsubscribe = cdp.on("Page.javascriptDialogOpening", (details) => {
        unsubscribe();
        resolve(details);
      });
    });
    const deleteClick = pointerClick(cdp, ".set-picker__option.is-active .set-picker__delete");
    const confirmationDetails = await confirmation;
    if (!confirmationDetails.message.includes("moved to .diagrams/trash")) {
      throw new Error(`delete confirmation omitted recovery details: ${confirmationDetails.message}`);
    }
    await cdp.send("Page.handleJavaScriptDialog", { accept: true });
    await deleteClick;
    await waitFor(async () => await evaluate(cdp, `(async () => {
      const workspace = await fetch('/api/workspace').then((response) => response.json());
      return Array.isArray(workspace.diagramSets)
        && workspace.diagramSets.length === 1
        && !workspace.diagramSets.some((set) => set.id === ${JSON.stringify(deletedSetId)});
    })()`), { timeoutMs: 10000, message: "deleted Diagram Set remained in the project index" });
    await cdp.send("Page.reload", { ignoreCache: true });
    await waitForSelector(cdp, ".diagram-panel", { timeoutMs: 10000 });
    const survivingSetCount = await evaluate(cdp, `(async () => (
      await fetch('/api/workspace').then((response) => response.json())
    ).diagramSets.length)()`);
    if (survivingSetCount !== 1) throw new Error("Diagram Set deletion did not survive reload");
  });

  const screenshot = await readFile(screenshotPath);
  if (screenshot.length < 1000) throw new Error("browser screenshot was unexpectedly small");
  const sourceScreenshot = await readFile(sourceScreenshotPath);
  if (sourceScreenshot.length < 1000) throw new Error("source preview screenshot was unexpectedly small");
  const importScreenshot = await readFile(importScreenshotPath);
  if (importScreenshot.length < 1000) throw new Error("import dialog screenshot was unexpectedly small");
  const generationScreenshot = await readFile(generationScreenshotPath);
  if (generationScreenshot.length < 1000) throw new Error("generation model screenshot was unexpectedly small");
  const promptSettingsScreenshot = await readFile(promptSettingsScreenshotPath);
  if (promptSettingsScreenshot.length < 1000) throw new Error("system prompt settings screenshot was unexpectedly small");
  const codeEntityPromptSettingsScreenshot = await readFile(codeEntityPromptSettingsScreenshotPath);
  if (codeEntityPromptSettingsScreenshot.length < 1000) {
    throw new Error("CodeEntity prompt settings screenshot was unexpectedly small");
  }
  const mappingScreenshot = await readFile(mappingScreenshotPath);
  if (mappingScreenshot.length < 1000) throw new Error("code-entity mapping screenshot was unexpectedly small");
  const selectRectScreenshot = await readFile(selectRectScreenshotPath);
  if (selectRectScreenshot.length < 1000) throw new Error("rectangle selection screenshot was unexpectedly small");
  const setPickerScreenshot = await readFile(setPickerScreenshotPath);
  if (setPickerScreenshot.length < 1000) throw new Error("Diagram Set picker screenshot was unexpectedly small");
  const starredDiagramScreenshot = await readFile(starredDiagramScreenshotPath);
  if (starredDiagramScreenshot.length < 1000) {
    throw new Error("starred diagram screenshot was unexpectedly small");
  }
  const fileExplorerScreenshot = await readFile(fileExplorerScreenshotPath);
  if (fileExplorerScreenshot.length < 1000) {
    throw new Error("file explorer screenshot was unexpectedly small");
  }
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
  const trashEntries = await readdir(path.join(fixtureRoot, ".diagrams", "trash", "diagram-sets"));
  const deletedEntry = trashEntries.find((entry) => entry.startsWith(`${deletedSetId}-`));
  if (!deletedEntry) throw new Error("deleted Diagram Set was not moved to recoverable trash");
  const trashedSet = JSON.parse(await readFile(path.join(
    fixtureRoot,
    ".diagrams",
    "trash",
    "diagram-sets",
    deletedEntry,
    "diagram-set.json"
  ), "utf8"));
  if (trashedSet.id !== deletedSetId) throw new Error("trashed Diagram Set contents were incomplete");
  process.stdout.write("browser check passed: source -> components -> archives -> imports -> set delete -> reload\n");
} finally {
  if (serverProcess?.exitCode === null) serverProcess.kill("SIGTERM");
  await rm(fixtureRoot, { recursive: true, force: true });
}
