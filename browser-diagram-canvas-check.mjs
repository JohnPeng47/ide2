import { execFileSync, spawn } from "node:child_process";
import { createServer } from "node:net";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
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

async function pointerClick(cdp, selector) {
  const clip = await elementClip(cdp, selector);
  const x = clip.x + clip.width / 2;
  const y = clip.y + clip.height / 2;
  await cdp.send("Input.dispatchMouseEvent", {
    type: "mousePressed", x, y, button: "left", buttons: 1, clickCount: 1
  });
  await cdp.send("Input.dispatchMouseEvent", {
    type: "mouseReleased", x, y, button: "left", buttons: 0, clickCount: 1
  });
}

async function drag(cdp, start, end, modifiers = 0) {
  await cdp.send("Input.dispatchMouseEvent", {
    type: "mousePressed",
    x: start.x,
    y: start.y,
    button: "left",
    buttons: 1,
    clickCount: 1,
    modifiers
  });
  await cdp.send("Input.dispatchMouseEvent", {
    type: "mouseMoved",
    x: end.x,
    y: end.y,
    button: "left",
    buttons: 1,
    modifiers
  });
  await cdp.send("Input.dispatchMouseEvent", {
    type: "mouseReleased",
    x: end.x,
    y: end.y,
    button: "left",
    buttons: 0,
    clickCount: 1,
    modifiers
  });
}

async function asciiPoint(cdp, line, column) {
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

async function canvasMatrix(cdp) {
  return evaluate(cdp, `(() => {
    const surface = document.querySelector('.diagram-canvas__surface');
    if (!surface) throw new Error('diagram canvas surface was unavailable');
    const matrix = new DOMMatrixReadOnly(getComputedStyle(surface).transform);
    return { scale: matrix.a, x: matrix.e, y: matrix.f };
  })()`);
}

const fixtureRoot = await mkdtemp(path.join(tmpdir(), "new-diagram-canvas-"));
const screenshotPath = process.env.CANVAS_SCREENSHOT_OUTPUT
  ? path.resolve(process.env.CANVAS_SCREENSHOT_OUTPUT)
  : path.join(fixtureRoot, "diagram-canvas.png");
let serverProcess;
try {
  await writeFile(
    path.join(fixtureRoot, "fixture.ts"),
    "export function updateWorkspace() {\n  return 'ready';\n}\n",
    "utf8"
  );
  execFileSync("git", ["init", "-q", fixtureRoot]);
  execFileSync("git", ["-C", fixtureRoot, "add", "fixture.ts"]);
  execFileSync("git", [
    "-C", fixtureRoot,
    "-c", "user.name=Test",
    "-c", "user.email=test@example.com",
    "commit", "-qm", "fixture"
  ]);

  const ascii = [
    "                         DRAGGABLE DIAGRAM CANVAS",
    "",
    "         updateWorkspace",
    "                |",
    "                v",
    "       +------------------+",
    "       | source evidence  |",
    "       +------------------+",
    "                |",
    "                v",
    "       +------------------+",
    "       | representation   |",
    "       +------------------+",
    "",
    "  Drag the open canvas to pan this deliberately wide diagram.",
    "  Ctrl/Cmd-wheel zooms around the pointer without changing evidence links.",
    "",
    "------------------------------------------------------------------------------------------"
  ].join("\n");

  const port = await freePort();
  const url = `http://127.0.0.1:${port}/`;
  serverProcess = spawn("npm", ["run", "preview", "--", "--port", String(port), "--strictPort"], {
    cwd: PACKAGE_ROOT,
    env: { ...process.env, NEW_DIAGRAM_PROJECT_ROOT: fixtureRoot },
    stdio: "ignore"
  });
  await waitFor(async () => {
    const response = await fetch(url).catch(() => null);
    return Boolean(response?.ok);
  }, { timeoutMs: 10000, message: "preview server did not start" });

  const created = await fetch(new URL("/api/diagram-sets", url), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      creationMode: "materialized",
      path: fixtureRoot,
      name: "Draggable canvas fixture",
      codeEntities: [{
        key: "update-workspace",
        handle: "update-workspace",
        label: "updateWorkspace",
        category: "operation",
        summary: "Updates the workspace fixture.",
        sourceRanges: [{
          key: "implementation",
          path: "fixture.ts",
          startLine: 1,
          endLine: 3
        }]
      }],
      diagrams: [{
        key: "canvas",
        name: "Draggable canvas fixture",
        ascii,
        codeEntityKeys: ["update-workspace"],
        mappings: [{
          entityKey: "update-workspace",
          sourceRangeKey: "implementation",
          line: 3,
          startColumn: 10,
          endColumn: 24
        }]
      }]
    })
  });
  if (!created.ok) throw new Error(`fixture creation failed: ${created.status} ${await created.text()}`);

  await withHeadlessBrowser({ url, width: 1440, height: 900 }, async ({ cdp }) => {
    await cdp.send("Page.enable");
    await waitForSelector(cdp, ".diagram-canvas .ascii-grid");
    const defaultCanvasState = await evaluate(cdp, `({
      enabled: document.querySelector('.diagram-canvas')?.classList.contains('is-enabled'),
      pressed: document.querySelector('.canvas-mode-toggle')?.getAttribute('aria-pressed'),
      controls: Boolean(document.querySelector('.diagram-canvas__controls'))
    })`);
    if (defaultCanvasState.enabled || defaultCanvasState.pressed !== "false" || defaultCanvasState.controls) {
      throw new Error(`canvas mode was not off by default: ${JSON.stringify(defaultCanvasState)}`);
    }
    await pointerClick(cdp, ".canvas-mode-toggle");
    await waitForSelector(cdp, ".diagram-canvas.is-enabled .ascii-grid");
    if (!await evaluate(cdp,
      "document.querySelector('.canvas-mode-toggle')?.getAttribute('aria-pressed') === 'true'"
    )) throw new Error("canvas toggle did not report its enabled state");
    await waitFor(async () => Number(await evaluate(cdp,
      "document.querySelector('.ascii-grid')?.dataset.cellWidth ?? 0"
    )) > 0, { message: "ASCII grid did not finish measuring" });

    const canvasClip = await elementClip(cdp, ".diagram-canvas.is-enabled");
    await evaluate(cdp, `(() => {
      const line = document.querySelector('[data-ascii-line="15"]');
      if (!line) throw new Error('ASCII line for native-selection setup was unavailable');
      const range = document.createRange();
      range.selectNodeContents(line);
      const selection = window.getSelection();
      selection?.removeAllRanges();
      selection?.addRange(range);
    })()`);
    if (!await evaluate(cdp, "Boolean(window.getSelection()?.toString())")) {
      throw new Error("native ASCII text selection setup failed");
    }
    await drag(cdp,
      { x: canvasClip.x + 12, y: canvasClip.y + 12 },
      { x: canvasClip.x + 12, y: canvasClip.y + 12 }
    );
    if (await evaluate(cdp, "Boolean(window.getSelection()?.toString())")) {
      throw new Error("ordinary canvas press did not clear native ASCII text selection");
    }

    const transformBeforePan = await evaluate(cdp,
      "document.querySelector('.diagram-canvas__surface').style.transform"
    );
    await drag(cdp,
      { x: canvasClip.x + 12, y: canvasClip.y + 12 },
      { x: canvasClip.x + 132, y: canvasClip.y + 72 }
    );
    const transformAfterPan = await evaluate(cdp,
      "document.querySelector('.diagram-canvas__surface').style.transform"
    );
    if (transformAfterPan === transformBeforePan) throw new Error("pointer drag did not pan the diagram");

    const pageZoomBefore = await evaluate(cdp, `({
      devicePixelRatio: window.devicePixelRatio,
      innerWidth: window.innerWidth,
      visualScale: window.visualViewport?.scale ?? 1
    })`);
    await cdp.send("Input.dispatchMouseEvent", {
      type: "mouseWheel",
      x: canvasClip.x + canvasClip.width / 2,
      y: canvasClip.y + canvasClip.height / 2,
      deltaX: 0,
      deltaY: -180,
      modifiers: 2
    });
    await waitFor(async () => await evaluate(cdp,
      "document.querySelector('[aria-label=\"Diagram zoom\"]')?.textContent !== '100%'"
    ), { message: "Ctrl-wheel did not zoom the diagram" });
    await evaluate(cdp, "new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))");
    const pageZoomAfter = await evaluate(cdp, `({
      devicePixelRatio: window.devicePixelRatio,
      innerWidth: window.innerWidth,
      visualScale: window.visualViewport?.scale ?? 1
    })`);
    if (JSON.stringify(pageZoomAfter) !== JSON.stringify(pageZoomBefore)) {
      throw new Error(`Ctrl-wheel changed page zoom: ${JSON.stringify({ pageZoomBefore, pageZoomAfter })}`);
    }

    await pointerClick(cdp, "#diagrams-tab");
    await pointerClick(cdp, ".mapped-element");
    await waitFor(async () => await evaluate(cdp,
      "document.querySelector('#code-entities-tab')?.getAttribute('aria-selected') === 'true'"
    ), { message: "mapped entity click no longer opened Code Entities" });

    const transformBeforeSelection = await canvasMatrix(cdp);
    await drag(cdp, await asciiPoint(cdp, 3, 10), await asciiPoint(cdp, 3, 24), 2);
    await waitForSelector(cdp, ".ref-buffer-item");
    const transformAfterSelection = await canvasMatrix(cdp);
    if (Math.abs(transformAfterSelection.scale - transformBeforeSelection.scale) > 0.001
      || Math.abs(transformAfterSelection.x - transformBeforeSelection.x) > 0.5) {
      throw new Error("Ctrl-drag panned instead of selecting mapped references");
    }

    await captureScreenshot(cdp, { output: screenshotPath });
    await pointerClick(cdp, ".diagram-canvas__controls button");
    await waitFor(async () => await evaluate(cdp,
      "document.querySelector('[aria-label=\"Diagram zoom\"]')?.textContent === '100%'"
    ), { message: "center control did not reset the zoom" });
  });

  process.stdout.write(`${JSON.stringify({
    event: "diagram-canvas-browser-check",
    status: "passed",
    screenshot: screenshotPath
  })}\n`);
} finally {
  if (serverProcess?.exitCode === null) serverProcess.kill();
  await rm(fixtureRoot, { recursive: true, force: true });
}
