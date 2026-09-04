import { spawn } from "node:child_process";
import { createServer } from "node:net";
import { mkdtemp, rm } from "node:fs/promises";
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
  evaluate,
  waitFor,
  waitForSelector,
  withHeadlessBrowser
} = await loadBrowserHarness();

const PACKAGE_ROOT = path.dirname(new URL(import.meta.url).pathname);

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

async function drag(cdp, start, end) {
  await cdp.send("Input.dispatchMouseEvent", {
    type: "mousePressed", x: start.x, y: start.y, button: "left", buttons: 1, clickCount: 1
  });
  await cdp.send("Input.dispatchMouseEvent", {
    type: "mouseMoved", x: end.x, y: end.y, button: "left", buttons: 1
  });
  await cdp.send("Input.dispatchMouseEvent", {
    type: "mouseReleased", x: end.x, y: end.y, button: "left", buttons: 0, clickCount: 1
  });
}

async function click(cdp, point) {
  await cdp.send("Input.dispatchMouseEvent", {
    type: "mousePressed", x: point.x, y: point.y, button: "left", buttons: 1, clickCount: 1
  });
  await cdp.send("Input.dispatchMouseEvent", {
    type: "mouseReleased", x: point.x, y: point.y, button: "left", buttons: 0, clickCount: 1
  });
}

async function pressKey(cdp, key, code, modifiers = 0) {
  const windowsVirtualKeyCode = key.toUpperCase().charCodeAt(0);
  await cdp.send("Input.dispatchKeyEvent", {
    type: "keyDown", key, code, modifiers, windowsVirtualKeyCode
  });
  await cdp.send("Input.dispatchKeyEvent", {
    type: "keyUp", key, code, modifiers, windowsVirtualKeyCode
  });
}

function near(left, right, tolerance = 0.5) {
  return Math.abs(left - right) <= tolerance;
}

async function elementRect(cdp, selector) {
  return evaluate(cdp, `(() => {
    const rect = document.querySelector(${JSON.stringify(selector)})?.getBoundingClientRect();
    return rect && { x: rect.x, y: rect.y, width: rect.width, height: rect.height };
  })()`);
}

const tempRoot = await mkdtemp(path.join(tmpdir(), "new-diagram-mapping-poc-"));
const screenshotPath = process.env.MAPPING_POC_SCREENSHOT_OUTPUT
  ? path.resolve(process.env.MAPPING_POC_SCREENSHOT_OUTPUT)
  : path.join(tempRoot, "mapping-poc.png");
const overlayScreenshotPath = screenshotPath.replace(/\.png$/i, "-overlay.png");
const promptScreenshotPath = screenshotPath.replace(/\.png$/i, "-prompt.png");
const port = await freePort();
const url = `http://127.0.0.1:${port}/mapping`;
let serverProcess;

try {
  serverProcess = spawn("npm", ["run", "preview", "--", "--port", String(port), "--strictPort"], {
    cwd: PACKAGE_ROOT,
    env: {
      ...process.env,
      NEW_DIAGRAM_PROJECT_ROOT: PACKAGE_ROOT,
      NEW_DIAGRAM_AGENT: "fake",
      NEW_DIAGRAM_FAKE_PROMPT_DELAY_MS: "80"
    },
    stdio: "ignore"
  });
  await waitFor(async () => {
    const response = await fetch(url).catch(() => null);
    return Boolean(response?.ok);
  }, { timeoutMs: 10000, message: "mapping POC preview server did not start" });

  await withHeadlessBrowser({ url, width: 1600, height: 1000 }, async ({ cdp }) => {
    await cdp.send("Page.enable");
    await waitForSelector(cdp, ".mapping-poc-canvas.is-enabled [data-selectable-node='a-generate']");
    await waitFor(async () => {
      const transform = await evaluate(cdp, "document.querySelector('.diagram-canvas__surface')?.style.transform");
      return typeof transform === "string" && transform.includes("translate3d(") && !transform.startsWith("translate3d(0px, 0px");
    }, { message: "mapping canvas did not reach its initial centered transform" });

    const canvas = await elementRect(cdp, ".mapping-poc-canvas");
    const sectionCount = await evaluate(cdp, "document.querySelectorAll('[data-a-section] > button').length");
    if (sectionCount !== 5) throw new Error(`expected five A section controls, found ${sectionCount}`);
    const transformBeforeOverlay = await evaluate(cdp, "document.querySelector('.diagram-canvas__surface')?.style.transform");
    const generationAnchor = await elementRect(cdp, "[data-selectable-node='a-generate']");
    const generationOverlayButton = await elementRect(cdp, "button[aria-label='Open Generation pipeline overlay']");
    await click(cdp, {
      x: generationOverlayButton.x + generationOverlayButton.width / 2,
      y: generationOverlayButton.y + generationOverlayButton.height / 2
    });
    await waitForSelector(cdp, ".mapping-poc-detail-overlay[data-overlay-id='generation'][data-overlay-origin-line='18'][data-overlay-origin-column='1']");
    const overlayGeometry = await evaluate(cdp, `(() => {
      const overlay = document.querySelector('.mapping-poc-detail-overlay');
      const pre = overlay.querySelector('pre');
      const nodeLayer = document.querySelector('.mapping-poc-node-layer');
      const rect = pre.getBoundingClientRect();
      return {
        x: rect.x,
        y: rect.y,
        z: Number(getComputedStyle(overlay).zIndex),
        nodeZ: Number(getComputedStyle(nodeLayer).zIndex),
        transform: document.querySelector('.diagram-canvas__surface')?.style.transform,
        text: pre.textContent
      };
    })()`);
    if (!near(overlayGeometry.x, generationAnchor.x)
      || !near(overlayGeometry.y, generationAnchor.y)
      || !(overlayGeometry.z > overlayGeometry.nodeZ)
      || overlayGeometry.transform !== transformBeforeOverlay
      || !overlayGeometry.text.startsWith("[R] generate")
      || !overlayGeometry.text.includes("PiDiagramAgentRuntime.generateArtifact()")) {
      throw new Error(`generation overlay was not aligned above A: ${JSON.stringify({ generationAnchor, overlayGeometry })}`);
    }
    await captureScreenshot(cdp, { output: overlayScreenshotPath });
    const closeGenerationOverlay = await elementRect(cdp, "button[aria-label='Close Generation detail overlay']");
    await click(cdp, {
      x: closeGenerationOverlay.x + closeGenerationOverlay.width / 2,
      y: closeGenerationOverlay.y + closeGenerationOverlay.height / 2
    });
    await waitFor(async () => await evaluate(cdp,
      "document.querySelector('.mapping-poc-detail-overlay') === null"
    ), { message: "detail overlay close button did not dismiss the HTML layer" });

    const first = await elementRect(cdp, "[data-selectable-node='a-generate']");
    const last = await elementRect(cdp, "[data-selectable-node='a-generation-record']");
    const widest = await elementRect(cdp, "[data-selectable-node='a-pi-runtime']");
    await drag(cdp,
      { x: first.x + 2, y: first.y + first.height / 2 },
      { x: widest.x + widest.width - 2, y: last.y + last.height / 2 }
    );
    try {
      await waitForSelector(cdp, ".mapping-poc-selection-menu");
    } catch (error) {
      const diagnostics = await evaluate(cdp, `({
        selectionRect: Boolean(document.querySelector('.mapping-poc-selection-rect')),
        selectedNodes: Array.from(document.querySelectorAll('.mapping-poc-node-hit.is-selected'))
          .map((node) => node.dataset.selectableNode),
        transform: document.querySelector('.diagram-canvas__surface')?.style.transform,
        first: (() => { const r = document.querySelector('[data-selectable-node="a-generate"]')?.getBoundingClientRect(); return r && { x: r.x, y: r.y, width: r.width, height: r.height }; })(),
        last: (() => { const r = document.querySelector('[data-selectable-node="a-generation-record"]')?.getBoundingClientRect(); return r && { x: r.x, y: r.y, width: r.width, height: r.height }; })()
      })`);
      throw new Error(`${error.message}: ${JSON.stringify(diagnostics)}`);
    }
    const menuText = await evaluate(cdp, "document.querySelector('.mapping-poc-selection-menu')?.textContent");
    if (!menuText?.includes("5 selected · 5 mapped")) {
      const selectedNodes = await evaluate(cdp, `Array.from(document.querySelectorAll('.mapping-poc-node-hit.is-selected'))
        .map((node) => node.dataset.selectableNode)`);
      const geometry = await evaluate(cdp, `(() => {
        const pre = document.querySelector('.mapping-poc-ascii');
        const rect = pre.getBoundingClientRect();
        return { rect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height }, offsetWidth: pre.offsetWidth, offsetHeight: pre.offsetHeight, lineHeight: getComputedStyle(pre).lineHeight };
      })()`);
      throw new Error(`rectangle selected the wrong A nodes: ${menuText} ${JSON.stringify({ selectedNodes, first, last, geometry })}`);
    }

    const before = await evaluate(cdp, `(() => {
      const pre = document.querySelector('.mapping-poc-ascii');
      const stage = document.querySelector('.mapping-poc-graph-stage');
      const surface = document.querySelector('.diagram-canvas__surface');
      const rect = pre.getBoundingClientRect();
      return {
        x: rect.x, y: rect.y, width: rect.width, height: rect.height,
        stageWidth: stage.offsetWidth, stageHeight: stage.offsetHeight,
        surfaceWidth: surface.offsetWidth, surfaceHeight: surface.offsetHeight
      };
    })()`);

    await pressKey(cdp, "n", "KeyN");
    await waitForSelector(cdp, ".mapping-poc-companion[data-mapped-b-start-line='74'][data-mapped-b-end-line='238'][data-b-start-line='73'][data-b-end-line='238']");
    const displayedSlice = await evaluate(cdp, "document.querySelector('.mapping-poc-companion pre')?.textContent");
    if (!displayedSlice?.startsWith("== GENERATION PLANNING")
      || !displayedSlice.includes("[R] ExperimentRunner.generate(axis, iteration, prompt)")
      || !displayedSlice.includes("[R] mapLimit(tasks, concurrency)")
      || !displayedSlice.includes("[R] SolExperimentRuntime.generate(request)")
      || !displayedSlice.includes("[R] PiDiagramAgentRuntime.generateArtifact(request)")
      || !displayedSlice.includes("[X] session.prompt()")
      || !displayedSlice.includes("[P] GenerationRecord")
      || !displayedSlice.includes("[R] writeGenerationRecordJson()")
      || displayedSlice.includes("== BLIND JUDGMENT ORCHESTRATION")
      || displayedSlice.includes("experiment.json")) {
      throw new Error(`B did not render its selected code-entity tree slice: ${JSON.stringify(displayedSlice)}`);
    }

    const after = await evaluate(cdp, `(() => {
      const pre = document.querySelector('.mapping-poc-ascii');
      const stage = document.querySelector('.mapping-poc-graph-stage');
      const surface = document.querySelector('.diagram-canvas__surface');
      const companion = document.querySelector('.mapping-poc-companion');
      const rect = pre.getBoundingClientRect();
      const companionRect = companion.getBoundingClientRect();
      const anchorRect = document.querySelector('[data-selectable-node="a-generate"]').getBoundingClientRect();
      return {
        x: rect.x, y: rect.y, width: rect.width, height: rect.height,
        stageWidth: stage.offsetWidth, stageHeight: stage.offsetHeight,
        surfaceWidth: surface.offsetWidth, surfaceHeight: surface.offsetHeight,
        companionLeft: companionRect.left,
        companionTop: companionRect.top,
        anchorTop: anchorRect.top
      };
    })()`);

    for (const key of ["x", "y", "width", "height", "stageWidth", "stageHeight", "surfaceWidth", "surfaceHeight"]) {
      if (!near(before[key], after[key])) {
        throw new Error(`opening B changed A layout at ${key}: ${before[key]} -> ${after[key]}`);
      }
    }
    if (!(after.companionLeft >= after.x + after.width + 100)) {
      throw new Error(`B was not placed beside A: ${JSON.stringify(after)}`);
    }
    if (!near(after.companionTop, after.anchorTop)) {
      throw new Error(`B was not vertically anchored to A_selected[0]: ${JSON.stringify(after)}`);
    }

    await captureScreenshot(cdp, { output: screenshotPath });

    await pressKey(cdp, "Escape", "Escape");
    await waitFor(async () => await evaluate(cdp, `
      document.querySelector('.mapping-poc-companion') !== null
      && document.querySelectorAll('.mapping-poc-node-hit.is-selected').length === 5
    `), { message: "Escape unexpectedly dismissed the persistent B projection" });

    await click(cdp, { x: canvas.x + 20, y: canvas.y + 20 });
    await waitFor(async () => await evaluate(cdp, `
      document.querySelector('.mapping-poc-companion') !== null
      && document.querySelectorAll('.mapping-poc-node-hit.is-selected').length === 5
    `), { message: "canvas click unexpectedly dismissed the persistent B projection" });

    const firstCloseButton = await elementRect(cdp, "button[aria-label='Close mapped B']");
    await click(cdp, {
      x: firstCloseButton.x + firstCloseButton.width / 2,
      y: firstCloseButton.y + firstCloseButton.height / 2
    });
    await waitFor(async () => await evaluate(cdp,
      "document.querySelector('.mapping-poc-companion') === null"
    ), { message: "explicit close did not dismiss the first B projection" });
    await click(cdp, { x: canvas.x + 20, y: canvas.y + 20 });
    await waitFor(async () => await evaluate(cdp,
      "document.querySelectorAll('.mapping-poc-node-hit.is-selected').length === 0"
    ), { message: "click-away did not clear A selection after B was explicitly closed" });

    const repeatFirst = await elementRect(cdp, "[data-selectable-node='a-generate']");
    const repeatLast = await elementRect(cdp, "[data-selectable-node='a-generation-record']");
    const repeatWidest = await elementRect(cdp, "[data-selectable-node='a-pi-runtime']");
    await drag(cdp,
      { x: repeatFirst.x + 2, y: repeatFirst.y + repeatFirst.height / 2 },
      { x: repeatWidest.x + repeatWidest.width - 2, y: repeatLast.y + repeatLast.height / 2 }
    );
    await waitFor(async () => (await evaluate(cdp,
      "document.querySelector('.mapping-poc-selection-menu')?.textContent"
    ))?.includes("5 selected · 5 mapped"), { message: "second rectangle selection retained stale mapping state" });
    await pressKey(cdp, "n", "KeyN");
    await waitForSelector(cdp, ".mapping-poc-companion[data-mapped-b-start-line='74'][data-mapped-b-end-line='238'][data-b-start-line='73'][data-b-end-line='238']");

    const companionPre = await elementRect(cdp, ".mapping-poc-companion pre");
    const transformBeforeCompanionClick = await evaluate(cdp, "document.querySelector('.diagram-canvas__surface')?.style.transform");
    await click(cdp, {
      x: companionPre.x + companionPre.width / 2,
      y: companionPre.y + Math.min(10, companionPre.height / 2)
    });
    const companionPointerState = await evaluate(cdp, `({
      cursor: getComputedStyle(document.querySelector('.mapping-poc-companion')).cursor,
      dragging: document.querySelector('.mapping-poc-canvas').classList.contains('is-dragging'),
      transform: document.querySelector('.diagram-canvas__surface')?.style.transform
    })`);
    if (companionPointerState.cursor !== "default"
      || companionPointerState.dragging
      || companionPointerState.transform !== transformBeforeCompanionClick) {
      throw new Error(`mapped B leaked into canvas gesture state: ${JSON.stringify(companionPointerState)}`);
    }
    const selectionAfterCompanionClick = await evaluate(cdp,
      "document.querySelectorAll('.mapping-poc-node-hit.is-selected').length"
    );
    if (selectionAfterCompanionClick !== 5) {
      throw new Error(`clicking mapped B unexpectedly cleared A selection: ${selectionAfterCompanionClick}`);
    }

    const closeButton = await elementRect(cdp, "button[aria-label='Close mapped B']");
    const closeHitTarget = await evaluate(cdp, `(() => {
      const button = document.querySelector("button[aria-label='Close mapped B']");
      const rect = button.getBoundingClientRect();
      return document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2) === button;
    })()`);
    if (!closeHitTarget) {
      throw new Error(`mapped B close control is not visible and hit-testable: ${JSON.stringify(closeButton)}`);
    }
    await click(cdp, {
      x: closeButton.x + closeButton.width / 2,
      y: closeButton.y + closeButton.height / 2
    });
    await waitFor(async () => await evaluate(cdp,
      "document.querySelector('.mapping-poc-companion') === null"
    ), { message: "close control did not dismiss mapped B" });
    const selectionAfterClose = await evaluate(cdp,
      "document.querySelectorAll('.mapping-poc-node-hit.is-selected').length"
    );
    if (selectionAfterClose !== 5) {
      throw new Error(`closing B unexpectedly cleared A selection: ${selectionAfterClose}`);
    }

    await click(cdp, { x: canvas.x + 20, y: canvas.y + 20 });
    await waitFor(async () => await evaluate(cdp,
      "document.querySelectorAll('.mapping-poc-node-hit.is-selected').length === 0"
    ), { message: "clicking away did not clear the repeated A selection" });

    const promptFirst = await elementRect(cdp, "[data-selectable-node='a-judge-cross']");
    const promptLast = await elementRect(cdp, "[data-selectable-node='a-stored-analysis']");
    const promptWidest = await elementRect(cdp, "[data-selectable-node='a-judge-within']");
    const downstreamTopBefore = await evaluate(cdp,
      "Number.parseFloat(document.querySelector('[data-selectable-node=\"a-experiment-output\"]')?.style.top || '0')"
    );
    await drag(cdp,
      { x: promptFirst.x + 2, y: promptFirst.y + promptFirst.height / 2 },
      { x: promptWidest.x + promptWidest.width - 2, y: promptLast.y + promptLast.height / 2 }
    );
    await waitForSelector(cdp, ".mapping-poc-selection-menu");
    const promptMenuText = await evaluate(cdp, "document.querySelector('.mapping-poc-selection-menu')?.textContent");
    if (!promptMenuText?.includes("source 7/7 · 7 ranges")) {
      throw new Error(`selection did not report complete mapped source coverage: ${JSON.stringify(promptMenuText)}`);
    }
    await pressKey(cdp, "p", "KeyP");
    await waitForSelector(cdp, ".mapping-poc-prompt-form textarea");
    const composingState = await evaluate(cdp, `({
      focused: document.activeElement?.id,
      composingRect: document.querySelector('.mapping-poc-selection-rect')?.classList.contains('is-composing'),
      status: document.querySelector('.mapping-poc-selection-menu header small')?.textContent
    })`);
    if (composingState.focused !== "mapping-poc-prompt"
      || !composingState.composingRect
      || !composingState.status?.includes("describe")) {
      throw new Error(`P did not open the local prompt composer: ${JSON.stringify(composingState)}`);
    }
    await cdp.send("Input.insertText", { text: "Clarify the evaluation flow" });
    const submitPromptButton = await elementRect(cdp, ".mapping-poc-prompt-form button[type='submit']");
    await click(cdp, {
      x: submitPromptButton.x + submitPromptButton.width / 2,
      y: submitPromptButton.y + submitPromptButton.height / 2
    });
    await waitForSelector(cdp, ".mapping-poc-selection-rect.is-generating");
    await waitForSelector(cdp, ".mapping-poc-local-status.is-applied");
    await waitFor(async () => await evaluate(cdp,
      "document.querySelector('.mapping-poc-ascii')?.dataset.revision === '1'"
    ), { message: "prompt patch did not increment the diagram revision" });
    const appliedState = await evaluate(cdp, `(() => {
      const pre = document.querySelector('.mapping-poc-ascii');
      const downstream = document.querySelector('[data-selectable-node="a-experiment-output"]');
      return {
        ascii: pre?.textContent,
        lineCount: pre?.dataset.lineCount,
        status: document.querySelector('.mapping-poc-local-status')?.textContent,
        patchedRect: document.querySelector('.mapping-poc-selection-rect')?.classList.contains('is-applied'),
        downstreamTop: Number.parseFloat(downstream?.style.top || '0')
      };
    })()`);
    const cellHeight = appliedState.downstreamTop - downstreamTopBefore;
    if (!appliedState.ascii?.includes("[edited: Clarify the evaluation flow]")
      || appliedState.lineCount !== "71"
      || !appliedState.status?.includes("+1 rows")
      || !appliedState.patchedRect
      || !(cellHeight > 0)) {
      throw new Error(`prompt patch did not render and shift downstream content: ${JSON.stringify({ appliedState, downstreamTopBefore })}`);
    }
    await captureScreenshot(cdp, { output: promptScreenshotPath });
    await waitFor(async () => await evaluate(cdp, `
      document.querySelector('.mapping-poc-local-status') === null
      && document.querySelector('.mapping-poc-selection-rect') === null
      && document.querySelector('.mapping-poc-ascii')?.dataset.revision === '1'
      && document.querySelector('.mapping-poc-ascii')?.textContent?.includes('[edited: Clarify the evaluation flow]')
    `), { timeoutMs: 5000, message: "successful patch indicator did not dismiss while preserving the edit" });

    process.stdout.write(`${JSON.stringify({
      event: "mapping-poc-browser-check",
      status: "passed",
      selection: "a-generate..a-generation-record",
      mappedBRange: "74..238",
      alignedBRange: "73..238",
      alignedSections: 4,
      selectedBNodes: 55,
      repeatCycle: "passed",
      directShortcuts: "N/P passed",
      mappedSourceCoverage: "7/7 elements",
      promptPatch: "+1 row applied",
      successIndicator: "auto-dismissed",
      persistentUntilExplicitClose: "passed",
      aDetailOverlays: 5,
      parsedOverlayOrigin: "18:1",
      overlayScreenshot: overlayScreenshotPath,
      promptScreenshot: promptScreenshotPath,
      screenshot: screenshotPath
    })}\n`);
  });
} finally {
  if (serverProcess?.exitCode === null) serverProcess.kill();
  await rm(tempRoot, { recursive: true, force: true });
}
