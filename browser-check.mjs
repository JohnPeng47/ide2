import { execFile, execFileSync, spawn } from "node:child_process";
import { createServer } from "node:net";
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
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
const generationScreenshotPath = path.join(fixtureRoot, "generation-model.png");
const promptSettingsScreenshotPath = path.join(fixtureRoot, "system-prompt-settings.png");
const mappingScreenshotPath = path.join(fixtureRoot, "code-entity-mapping.png");
const setPickerScreenshotPath = path.join(fixtureRoot, "diagram-set-picker.png");
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
      || !collectionResult.stdout.includes(`"generationPromptConfigId":"prompt-`)) {
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
    await pointerClick(cdp, ".map-code-entities");
    await waitForSelector(cdp, ".mapped-element", { timeoutMs: 10000 });
    const asciiAfterMapping = await evaluate(cdp, `document.querySelector('.ascii-stage pre').textContent`);
    if (asciiAfterMapping !== asciiBeforeMapping) {
      throw new Error("mapping changed the diagram's ASCII text content");
    }
    const mappedEntityId = await evaluate(cdp, `document.querySelector('.mapped-element').dataset.entityId`);
    const mappedTitle = await evaluate(cdp, `document.querySelector('.mapped-element').title`);
    if (!mappedTitle.includes("Workspace Store") || !mappedTitle.includes("fixture.ts:1-4")) {
      throw new Error(`mapped hover summary was incomplete: ${mappedTitle}`);
    }
    await pointerHover(cdp, ".mapped-element");
    await pointerClick(cdp, ".mapped-element");
    await waitForSelector(cdp, ".source-workspace.is-revealed", { timeoutMs: 10000 });
    await waitForSelector(cdp, ".source-code-viewer", { timeoutMs: 10000 });
    const revealedEntityId = await evaluate(cdp, `document.querySelector('.entity-context__body').dataset.activeEntityId`);
    if (revealedEntityId !== mappedEntityId) {
      throw new Error(`mapped entity ${mappedEntityId} revealed ${revealedEntityId}`);
    }
    const entityTabSelected = await evaluate(cdp, `document.querySelector('#code-entities-tab').getAttribute('aria-selected')`);
    if (entityTabSelected !== "true") throw new Error("mapped element did not open the Code Entities tab");
    await captureScreenshot(cdp, { output: mappingScreenshotPath });
    await pointerClick(cdp, "#code-entities-tab");
    await waitForSelector(cdp, ".source-fold-placeholder");
    const sourceLayout = await evaluate(cdp, `(() => {
      const root = document.querySelector('.entities-panel').getBoundingClientRect();
      const context = document.querySelector('.entity-context').getBoundingClientRect();
      const source = document.querySelector('.source-workspace').getBoundingClientRect();
      const divider = document.querySelector('.entity-context-divider');
      return {
        contextRatio: context.height / root.height,
        sourceRatio: source.height / root.height,
        sourceWidthRatio: source.width / root.width,
        splitValue: Number(divider.getAttribute('aria-valuenow'))
      };
    })()`);
    if (Math.abs(sourceLayout.contextRatio - 0.2) > 0.03
      || sourceLayout.sourceRatio < 0.75
      || sourceLayout.sourceWidthRatio < 0.99
      || sourceLayout.splitValue !== 20) {
      throw new Error(`source workspace did not render at full-width 20/80: ${JSON.stringify(sourceLayout)}`);
    }
    await waitFor(async () => (
      await evaluate(cdp, `document.querySelectorAll('.source-code-viewer[data-highlighted="true"] .source-token').length`)
    ) > 0, { message: "Shiki did not render syntax-highlighted tokens" });
    const compactedLines = await evaluate(cdp, `Array.from(document.querySelectorAll(
      '.source-call-graph-line > span:last-child, .source-call-graph-node > span:last-child'
    )).map((node) => node.textContent)`);
    const expectedCompactedLines = [
      "  // [Lines 2-3 | 2 lines compacted]",
      "  //",
      "  // workspace",
      "  //   |",
      "  //   +--> status = 'collecting'",
      "  //   \\--> status = 'ready'"
    ];
    if (JSON.stringify(compactedLines) !== JSON.stringify(expectedCompactedLines)) {
      throw new Error(`collapsed source did not render an ASCII call graph comment: ${JSON.stringify(compactedLines)}`);
    }
    const mappedNodeCount = await evaluate(cdp, `document.querySelectorAll('.source-call-graph-node').length`);
    if (mappedNodeCount !== 3) throw new Error(`collapsed call graph did not render three mapped nodes: ${mappedNodeCount}`);
    const compactedAlignment = await evaluate(cdp, `(() => {
      const wholeToggle = document.querySelector('.source-section-fold-toggle').getBoundingClientRect();
      const nodeToggle = document.querySelector('.source-call-graph-node-marker').getBoundingClientRect();
      const retained = document.querySelector('.source-code-line[data-line="1"] .source-line-text').getBoundingClientRect();
      const retainedLineNumberElement = document.querySelector('.source-code-line[data-line="1"] .source-line-number');
      const comment = document.querySelector('.source-call-graph-line > span:last-child').getBoundingClientRect();
      const foldGutterElement = document.querySelector('.source-fold-placeholder > .source-line-gutter');
      const foldGutter = foldGutterElement.getBoundingClientRect();
      const glyphRect = (root, pattern = /\\S/) => {
        const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
        for (let node = walker.nextNode(); node; node = walker.nextNode()) {
          const index = node.data.search(pattern);
          if (index < 0) continue;
          const range = document.createRange();
          range.setStart(node, index);
          range.setEnd(node, index + 1);
          return range.getBoundingClientRect();
        }
        return null;
      };
      const textRect = (root) => {
        const node = root.firstChild;
        const start = node.data.search(/\\S/);
        const end = node.data.search(/\\s*$/);
        const range = document.createRange();
        range.setStart(node, start);
        range.setEnd(node, end);
        return range.getBoundingClientRect();
      };
      const wholeGlyph = glyphRect(document.querySelector('.source-section-fold-toggle'));
      const lineNumberGlyph = glyphRect(retainedLineNumberElement);
      const nodeGlyph = glyphRect(document.querySelector('.source-call-graph-node-marker'));
      const nodeCommentGlyph = glyphRect(document.querySelector('.source-call-graph-node > span:last-child'));
      const wholeText = textRect(document.querySelector('.source-section-fold-toggle'));
      const lineNumberText = textRect(retainedLineNumberElement);
      const nodeText = textRect(document.querySelector('.source-call-graph-node-marker'));
      const nodeComment = document.querySelector('.source-call-graph-node > span:last-child').getBoundingClientRect();
      return {
        wholeLineNumberColumnDelta: wholeText.right - lineNumberText.right,
        nodeLineNumberColumnDelta: nodeText.right - lineNumberText.right,
        commentDelta: comment.left - retained.left,
        nodeVerticalDelta: nodeGlyph.top - nodeCommentGlyph.top,
        nodeCenterDelta: (nodeToggle.top + nodeToggle.height / 2) - (nodeComment.top + nodeComment.height / 2),
        wholeHeaderCenterDelta: (wholeToggle.top + wholeToggle.height / 2) - (comment.top + comment.height / 2),
        gutterHeaderHeightDelta: foldGutter.height - comment.height,
        gutterZIndex: Number(getComputedStyle(foldGutterElement).zIndex),
        graphGutterZIndex: Number(getComputedStyle(document.querySelector('.source-call-graph-line > span:first-child')).zIndex)
      };
    })()`);
    if (Math.abs(compactedAlignment.wholeLineNumberColumnDelta) > 0.5
      || Math.abs(compactedAlignment.nodeLineNumberColumnDelta) > 0.5
      || Math.abs(compactedAlignment.commentDelta) > 0.5
      || Math.abs(compactedAlignment.nodeVerticalDelta) > 0.5
      || Math.abs(compactedAlignment.nodeCenterDelta) > 0.5
      || Math.abs(compactedAlignment.wholeHeaderCenterDelta) > 0.5
      || Math.abs(compactedAlignment.gutterHeaderHeightDelta) > 0.5
      || compactedAlignment.gutterZIndex <= compactedAlignment.graphGutterZIndex) {
      throw new Error(`call graph controls or comments were misaligned: ${JSON.stringify(compactedAlignment)}`);
    }
    await captureScreenshot(cdp, { output: sourceScreenshotPath });
    await pointerClick(cdp, '.source-call-graph-node[data-graph-line="3"]');
    await waitForSelector(cdp, '.source-call-graph-node-source-line[data-line="2"]');
    const nodeSourceText = await evaluate(cdp, `document.querySelector('.source-call-graph-node-source').textContent`);
    if (!nodeSourceText.includes("workspace.status = 'collecting';")) {
      throw new Error(`mapped graph node did not reveal its source block: ${nodeSourceText}`);
    }
    const sourceColumnAlignment = await evaluate(cdp, `(() => {
      const retained = document.querySelector('.source-code-line[data-line="1"] .source-line-text').getBoundingClientRect();
      const expanded = document.querySelector('.source-call-graph-node-source-line[data-line="2"] code').getBoundingClientRect();
      return { retainedLeft: retained.left, expandedLeft: expanded.left, delta: expanded.left - retained.left };
    })()`);
    if (Math.abs(sourceColumnAlignment.delta) > 0.5) {
      throw new Error(`expanded graph-node source did not align with retained source: ${JSON.stringify(sourceColumnAlignment)}`);
    }
    if (!await evaluate(cdp, `Boolean(document.querySelector('.source-call-graph-node[data-graph-line="4"]'))`)) {
      throw new Error("expanding one graph node removed its independently compacted sibling");
    }
    await pointerClick(cdp, '.source-call-graph-node[data-graph-line="3"]');
    await waitFor(async () => !await evaluate(cdp, `Boolean(document.querySelector('.source-call-graph-node-source'))`), {
      message: "mapped graph node did not collapse independently"
    });
    const compactedCommentGlyphLeft = await evaluate(cdp, `(() => {
      const root = document.querySelector('.source-call-graph-line > span:last-child');
      const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
      for (let node = walker.nextNode(); node; node = walker.nextNode()) {
        const index = node.data.search(/\\S/);
        if (index < 0) continue;
        const range = document.createRange();
        range.setStart(node, index);
        range.setEnd(node, index + 1);
        return range.getBoundingClientRect().left;
      }
      return null;
    })()`);
    await pointerClick(cdp, ".source-section-fold-toggle");
    await waitFor(async () => !await evaluate(cdp, `Boolean(document.querySelector('.source-fold-placeholder'))`), {
      message: "source fold placeholder did not expand"
    });
    const revealedText = await evaluate(cdp, `document.querySelector('.source-code-content').textContent`);
    if (!revealedText.includes("workspace.status = 'collecting';")) {
      throw new Error("collapsed source did not reveal its original lines");
    }
    const revealedSourceGlyphLeft = await evaluate(cdp, `(() => {
      const root = document.querySelector('.source-code-line[data-line="2"] code');
      const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
      for (let node = walker.nextNode(); node; node = walker.nextNode()) {
        const index = node.data.search(/\\S/);
        if (index < 0) continue;
        const range = document.createRange();
        range.setStart(node, index);
        range.setEnd(node, index + 1);
        return range.getBoundingClientRect().left;
      }
      return null;
    })()`);
    if (compactedCommentGlyphLeft === null || revealedSourceGlyphLeft === null
      || Math.abs(compactedCommentGlyphLeft - revealedSourceGlyphLeft) > 0.5) {
      throw new Error(`compacted comment did not preserve source indentation: ${JSON.stringify({ compactedCommentGlyphLeft, revealedSourceGlyphLeft })}`);
    }
    await pointerClick(cdp, ".source-fold-toggle");
    await waitForSelector(cdp, ".source-fold-placeholder");
    await pointerClick(cdp, ".source-section-fold-toggle");
    await waitFor(async () => !await evaluate(cdp, `Boolean(document.querySelector('.source-fold-placeholder'))`), {
      message: "expanded source section did not support re-collapsing and reopening"
    });
    await pointerClick(cdp, ".source-original-toggle");
    await waitFor(async () => (
      await evaluate(cdp, `document.querySelector('.source-code-content').textContent`)
    ).includes("workspace.status = 'ready';"), {
      message: "peek original did not reveal the complete source range"
    });
    const sourceBeforeTyping = await evaluate(cdp, `document.querySelector('.source-code-content').textContent`);
    await pointerClick(cdp, ".source-code-content");
    await cdp.send("Input.insertText", { text: "MUTATION" });
    const sourceAfterTyping = await evaluate(cdp, `document.querySelector('.source-code-content').textContent`);
    if (sourceAfterTyping !== sourceBeforeTyping) throw new Error("read-only source viewer accepted source edits");
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
    const derivativePromptState = await evaluate(cdp, `({
      instruction: document.querySelector('#diagram-prompt').value,
      model: document.querySelector('#generation-model').value,
      profile: document.querySelector('#generation-prompt-profile').value,
      output: document.querySelector('.output-kind [aria-checked="true"]').textContent.trim()
    })`);
    if (!derivativePromptState.instruction.startsWith(stableHandle)
      || !derivativePromptState.instruction.includes("@entity/")
      || derivativePromptState.model !== "gpt-5.6-sol"
      || derivativePromptState.profile !== "compact"
      || derivativePromptState.output !== "Diagram") {
      throw new Error(`derivative prompt was not rehydrated: ${JSON.stringify(derivativePromptState)}`);
    }
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
    await pointerClick(cdp, '.ascii-char[data-line="1"][data-column="2"]');
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
        visibleDiagrams: document.querySelectorAll('.diagram-tree-diagram').length
      };
    })()`);
    if (!archiveState.archivedAt || !archiveState.setId || archiveState.visibleDiagrams !== 7) {
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
      document.querySelectorAll('.diagram-tree-diagram').length === 8
      && document.querySelectorAll('.diagram-tree-component').length === 4
      && document.querySelectorAll('[data-imports-branch]').length === 1
      && document.querySelector('[data-imports-branch] [data-diagram-id="${importedDiagramState.id}"]')
      && Array.from(document.querySelectorAll('.diagram-tree-component em')).some(
        (node) => node.textContent === 'IMPORTED'
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
  const mappingScreenshot = await readFile(mappingScreenshotPath);
  if (mappingScreenshot.length < 1000) throw new Error("code-entity mapping screenshot was unexpectedly small");
  const setPickerScreenshot = await readFile(setPickerScreenshotPath);
  if (setPickerScreenshot.length < 1000) throw new Error("Diagram Set picker screenshot was unexpectedly small");
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
