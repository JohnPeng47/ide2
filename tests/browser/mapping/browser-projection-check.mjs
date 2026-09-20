import assert from "node:assert/strict";
import { spawn, execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtemp, mkdir, readFile, writeFile, rm } from "node:fs/promises";
import { createServer } from "node:net";
import { existsSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { tsImport } from "tsx/esm/api";

const { buildProjectionTree } = await tsImport("../../../domain/core/diagrams/diagramProjection.ts", import.meta.url);
const { evaluate, waitFor, waitForSelector, captureScreenshot, withHeadlessBrowser } = await import(
  pathToFileURL(path.join(homedir(), ".codex/skills/front-end/browser-test.mjs")).href
);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const temp = await mkdtemp(path.join(tmpdir(), "projection-browser-check-"));
const active = ".mapping-document-view:not([hidden])";
const panel = `${active} .mapping-poc-companion`;
const action = `${active} button[aria-keyshortcuts='N']`;
const port = await new Promise((resolve) => {
  const listener = createServer();
  listener.listen(0, "127.0.0.1", () => {
    const port = listener.address().port;
    listener.close(() => resolve(port));
  });
});
const url = `http://127.0.0.1:${port}`;
let server;

// Geometry reads only: every application interaction uses real CDP input events.
async function click(cdp, selector, leftInset) {
  let point;
  let previous = "";
  let stable = 0;
  await waitFor(async () => {
    point = await evaluate(cdp, `(() => {
      const element = document.querySelector(${JSON.stringify(selector)});
      if (!element || element.disabled) return null;
      const rect = element.getBoundingClientRect();
      const x = rect.x + ${leftInset ?? "rect.width / 2"}, y = rect.y + rect.height / 2;
      return element.contains(document.elementFromPoint(x, y)) ? {x, y} : null;
    })()`);
    const next = JSON.stringify(point);
    stable = point && next === previous ? stable + 1 : 0;
    previous = next;
    return stable >= 2;
  }, { message: `Click target did not settle: ${selector}` });
  await cdp.send("Input.dispatchMouseEvent", { type: "mousePressed", ...point, button: "left", buttons: 1, clickCount: 1 });
  await cdp.send("Input.dispatchMouseEvent", { type: "mouseReleased", ...point, button: "left", clickCount: 1 });
}

async function saveWorkspace(cdp) {
  let status;
  const unsubscribe = cdp.on('Network.responseReceived', ({ response }) => {
    if (new URL(response.url).pathname === '/api/mapping/workspace') status = response.status;
  });
  try {
    await click(cdp, '.mapping-workspace-actions button:first-child');
    await waitFor(() => status !== undefined, { message: 'Workspace save did not finish' });
    assert.equal(status, 200);
    await waitFor(async () => await evaluate(cdp, "!document.querySelector('.mapping-workspace-actions button:first-child').disabled"));
  } finally { unsubscribe(); }
}

async function key(cdp, key, code, modifiers = 0) {
  await cdp.send("Input.dispatchKeyEvent", { type: "keyDown", key, code, modifiers });
  await cdp.send("Input.dispatchKeyEvent", { type: "keyUp", key, code, modifiers });
}

async function fill(cdp, selector, text) {
  await click(cdp, selector);
  await cdp.send("Input.dispatchKeyEvent", { type: "rawKeyDown", key: "Control", code: "ControlLeft", windowsVirtualKeyCode: 17 });
  await cdp.send("Input.dispatchKeyEvent", { type: "rawKeyDown", key: "a", code: "KeyA", windowsVirtualKeyCode: 65, modifiers: 2 });
  await cdp.send("Input.dispatchKeyEvent", { type: "keyUp", key: "a", code: "KeyA", windowsVirtualKeyCode: 65, modifiers: 2 });
  await cdp.send("Input.dispatchKeyEvent", { type: "keyUp", key: "Control", code: "ControlLeft", windowsVirtualKeyCode: 17 });
  await cdp.send("Input.insertText", { text });
  await waitFor(async () => await evaluate(cdp,
    `document.querySelector(${JSON.stringify(selector)}).value === ${JSON.stringify(text)}`));
}

async function selectRows(cdp, first, last = first) {
  await waitFor(async () => await evaluate(cdp, `document.querySelector(${JSON.stringify(`${active} .diagram-canvas__surface`)})?.style.transform.includes('translate3d')`),
    { message: 'Canvas has not applied its initial viewport transform', timeoutMs: 15000 });
  await waitFor(async () => await evaluate(cdp,
    `document.querySelectorAll(${JSON.stringify(`${active} [data-selectable-node]`)}).length >= ${last}`));
  let points;
  let previous = "";
  let stable = 0;
  await waitFor(async () => {
    points = await evaluate(cdp, `(() => {
      const nodes = [...document.querySelectorAll(${JSON.stringify(`${active} [data-selectable-node]`)})];
      if (!nodes[${last - 1}]) return null;
      const first = nodes[${first - 1}].getBoundingClientRect();
      const last = nodes[${last - 1}].getBoundingClientRect();
      return {start: {x: first.left + 1, y: first.top + first.height / 2},
        end: {x: Math.max(first.right, last.right) - 1, y: last.top + last.height / 2}};
    })()`);
    const next = JSON.stringify(points);
    stable = points && next === previous ? stable + 1 : 0;
    previous = next;
    return stable >= 2;
  }, { message: "Selection geometry did not settle" });
  await cdp.send("Input.dispatchMouseEvent", { type: "mousePressed", ...points.start, button: "left", buttons: 1, modifiers: 2, clickCount: 1 });
  await cdp.send("Input.dispatchMouseEvent", { type: "mouseMoved", ...points.end, button: "left", buttons: 1, modifiers: 2 });
  await cdp.send("Input.dispatchMouseEvent", { type: "mouseReleased", ...points.end, button: "left", modifiers: 2, clickCount: 1 });
  await waitForSelector(cdp, `${active} .mapping-poc-selection-actions`).catch(async (error) => {
    if (process.env.PROJECTION_SCREENSHOT) await captureScreenshot(cdp, { output: process.env.PROJECTION_SCREENSHOT });
    throw new Error(`${error.message}; selection=${JSON.stringify(points)}; ${await evaluate(cdp, "document.body.innerText")}`);
  });
  await waitFor(async () => await evaluate(cdp,
    `document.querySelectorAll(${JSON.stringify(`${active} [data-selectable-node].is-selected`)}).length === ${last - first + 1}`));
}

async function openTree(cdp, expected) {
  await waitFor(async () => await evaluate(cdp, `!document.querySelector(${JSON.stringify(action)}).disabled`));
  await key(cdp, "n", "KeyN");
  await waitForSelector(cdp, `${panel} pre[data-projected-tree]`).catch(async error => { throw new Error(error.message + "\n" + await evaluate(cdp, "document.body.innerText")); });
  assert.equal(await evaluate(cdp, `Boolean(document.querySelector(${JSON.stringify(`${active} .mapping-poc-selection-menu`)}))`), false,
    "Selection menu must not obscure projected branches");
  assert.equal(await evaluate(cdp, `document.querySelector(${JSON.stringify(panel)}).dataset.projectionId`), "projection-calls");
  assert.equal(await evaluate(cdp, `document.querySelector(${JSON.stringify(`${panel} pre[data-projected-tree]`)}).textContent`), expected);
}

async function closeTree(cdp) {
  await key(cdp, "Escape", "Escape");
  assert.equal(await evaluate(cdp, `Boolean(document.querySelector(${JSON.stringify(panel)}))`), true, 'Escape preserves retained projections');
  await click(cdp, `${active} [aria-label='Remove selection']`);
  await waitFor(async () => !await evaluate(cdp, `Boolean(document.querySelector(${JSON.stringify(panel)}))`));
}

async function expectUnavailable(cdp, reason) {
  await waitFor(async () => await evaluate(cdp, `Boolean(document.querySelector(${JSON.stringify(action)})?.disabled)
    && document.querySelector(${JSON.stringify(`${active} .mapping-projection-status`)})?.textContent.includes(${JSON.stringify(reason)})`),
  { message: `Expected unavailable projection: ${reason}` });
  await key(cdp, "n", "KeyN");
  assert.equal(await evaluate(cdp, `Boolean(document.querySelector(${JSON.stringify(panel)}))`), false);
}

async function openDiagram(cdp, id, name) {
  await click(cdp, `[data-project-diagram='${id}']`);
  await waitFor(async () => await evaluate(cdp,
    `document.querySelector('[aria-label="Diagram name"]').value === ${JSON.stringify(name)}`));
  await waitForSelector(cdp, `${active} .mapping-poc-ascii`);
  await waitFor(async () => await evaluate(cdp, `(() => {
    const rect = document.querySelector(${JSON.stringify(`${active} .mapping-poc-ascii`)}).getBoundingClientRect();
    return rect.width > 0 && rect.height > 0 && rect.top >= 0 && rect.left >= 0
      && rect.top < innerHeight && rect.left < innerWidth;
  })()`), { message: "Sidebar navigation moved the diagram offscreen" });
}

async function catalog() {
  const response = await fetch(`${url}/api/core/project/representations`);
  assert.equal(response.ok, true);
  return (await response.json()).catalog;
}

async function reload(cdp) {
  let loaded = false;
  const unsubscribe = cdp.on("Page.loadEventFired", () => { loaded = true; });
  try {
    await cdp.send("Page.reload", { ignoreCache: true });
    await waitFor(() => loaded, { message: "Reload did not finish loading" });
    await waitForSelector(cdp, `${active} [data-selectable-node]`);
  } finally {
    unsubscribe();
  }
}

try {
  execFileSync("git", ["init", "-q", temp]);
  const projectId = `project-${createHash("sha256").update(path.join(temp, ".git")).digest("hex").slice(0, 12)}`;
  const timestamp = new Date().toISOString();
  const evidence = Object.fromEntries(["Alpha", "Beta", "Gamma"].map((label, index) => {
    const id = "abc"[index];
    return [id, { id, handle: id, label, category: "operation", summary: `${label} operation`,
      sourceRanges: [{ id: `range-${id}`, path: "fixture.ts", startLine: index + 1, endLine: index + 1,
        originalLines: [`export function ${label.toLowerCase()}() {}`] }] }];
  }));
  function representation(id, name, kind) {
    return { schemaVersion: 1, id, projectId, handle: id, name, viewKind: kind === "tree" ? "call-graph" : "diagram",
      representationKind: kind, status: "settled", currentRevisionId: `revision-${id}`, revisionIds: [`revision-${id}`],
      createdAt: timestamp, updatedAt: timestamp };
  }
  function revision(representation, ascii, evidence = {}, mappings = []) {
    return { schemaVersion: 1, id: representation.currentRevisionId, projectId, representationId: representation.id,
      revision: 1, ascii, asciiSha256: createHash("sha256").update(ascii).digest("hex"),
      representationKind: representation.representationKind, evidence, mappings, createdAt: timestamp };
  }
  const source = representation("source", "Source overview", "diagram");
  const target = representation("target", "Related calls", "tree");
  const sourceRevision = revision(source, "Alpha\nBeta\nGamma", evidence, ["Alpha", "Beta", "Gamma"].map((label, index) => ({
    id: `mapping-${"abc"[index]}`, evidenceId: "abc"[index], sourceRangeId: `range-${"abc"[index]}`,
    line: index + 1, startColumn: 1, endColumn: label.length
  })));
  const targetRevision = revision(target, "Calls\n|\n+-- shared()\n|   \\-- shared detail\n\\-- gamma()\n    \\-- gamma detail");
  const tree = buildProjectionTree(targetRevision);
  const nodeId = (text) => {
    const node = Object.values(tree.nodes).find((node) => node.text === text);
    assert.ok(node, `Missing fixture node ${text}`);
    return node.id;
  };
  const projection = { id: "projection-calls", projectId, name: "Related call branches",
    sourceRepresentationId: source.id, sourceRevisionId: sourceRevision.id,
    targetRepresentationId: target.id, targetRevisionId: targetRevision.id, match: "any",
    links: [{ sourceEvidenceIds: ["b", "c"], targetNodeIds: [nodeId("shared()")] },
      { sourceEvidenceIds: ["c"], targetNodeIds: [nodeId("gamma()")] }] };
  // Set PROJECTION_SOURCE_LINES=3000 to exercise dragging with a large highlighted file.
  sourceRevision.source = {sourceId:"projection-source",repositoryIdentity:path.join(temp,".git"),domainProfileId:"source-code",corpus:{kind:"git-worktree",root:temp}};
  const sourceLineCount = Number(process.env.PROJECTION_SOURCE_LINES ?? 120);
  const detailLine = sourceLineCount - 38;
  const mappedLines = [12, 13, 14, 15, detailLine, detailLine + 1, detailLine + 2];
  const sourceText = Array.from({ length: sourceLineCount }, (_, index) => index === 11
    ? 'export function selected() { return 1; }' : index === detailLine - 1 ? 'export const detail = true;'
    : index === sourceLineCount - 1 ? `export const wideLine = ${JSON.stringify('x'.repeat(240))};`
    : `export function context${index + 1}(value: number) { return value * ${index + 1} + 1; }`).join('\n');
  await mkdir(path.join(temp, 'src'), { recursive: true });
  for (const file of ['shared.ts', 'gamma.ts']) await writeFile(path.join(temp, 'src', file), sourceText);
  const compactedFile = (sourceFile) => {
    const nested = sourceFile === 'src/gamma.ts';
    const ascii = `${sourceFile}\n+-- selected method\n|   +-- selected detail\n|   \\-- hidden sibling\n\\-- unrelated method`;
    return { sourceFile, ascii, asciiSha256: createHash("sha256").update(ascii).digest("hex"), sourceSha256: createHash("sha256").update(sourceText).digest("hex"),
      mappings: [1, 2, 3, 4, 5].map((treeLine) => ({ treeLine, sourceRanges: [{ startLine: treeLine === 2 ? 12 : treeLine === 3 ? (nested ? 14 : detailLine) : treeLine, endLine: treeLine === 2 ? (nested ? 20 : 15) : treeLine === 3 ? (nested ? 16 : detailLine + 2) : treeLine }] })) };
  };
  projection.compactionProjection = { files: [compactedFile("src/shared.ts"), compactedFile("src/gamma.ts")], links: [
    { callTreeNodeId: nodeId("shared()"), file: "src/shared.ts", treeLines: [2] },
    { callTreeNodeId: nodeId("shared detail"), file: "src/shared.ts", treeLines: [3] },
    { callTreeNodeId: nodeId("gamma()"), file: "src/gamma.ts", treeLines: [2, 3] },
    // This ancestor is display context only: it must not drag in unrelated detail.
    { callTreeNodeId: nodeId("Calls"), file: "src/shared.ts", treeLines: [5] }
  ] };
  await mkdir(path.join(temp, ".diagrams/representations"), { recursive: true });
  await writeFile(path.join(temp, ".diagrams/project.json"), JSON.stringify({ schemaVersion: 1, id: projectId,
    name: "Projection browser fixture", repositoryIdentity: path.join(temp, ".git"), canonicalRepoRoot: temp,
    domainProfileId: "source-code", corpus: { kind: "git-worktree", root: temp }, diagramSetIds: [],
    createdAt: timestamp, updatedAt: timestamp }));
  await writeFile(path.join(temp, ".diagrams/representations/catalog.json"), JSON.stringify({ schemaVersion: 1, projectId,
    activeByKind: { diagram: source.id }, representations: { [source.id]: source, [target.id]: target },
    revisions: { [sourceRevision.id]: sourceRevision, [targetRevision.id]: targetRevision },
    projections: { [projection.id]: projection }, createdAt: timestamp, updatedAt: timestamp }));
  server = spawn(process.execPath, ["node_modules/vite/bin/vite.js", "preview", "--host", "127.0.0.1", "--port", String(port), "--strictPort"],
    { cwd: root, env: { ...process.env, NEW_DIAGRAM_PROJECT_ROOT: temp, NEW_DIAGRAM_AGENT: "fake" }, stdio: "ignore" });
  await waitFor(async () => Boolean((await fetch(url).catch(() => null))?.ok), { timeoutMs: 15000 });
  await withHeadlessBrowser({ url: `${url}/mapping`, width: 2400, height: 1400 }, async ({ cdp, profilePath }) => {
    await cdp.send("Page.enable");
    await cdp.send("Runtime.enable");
    await cdp.send("Network.enable");
    const errors = [];
    cdp.on("Runtime.exceptionThrown", ({ exceptionDetails }) => (errors.push(exceptionDetails.exception?.description ?? exceptionDetails.text), console.error(exceptionDetails.exception?.description ?? exceptionDetails.text)));
    cdp.on("Page.javascriptDialogOpening", () => { void cdp.send("Page.handleJavaScriptDialog", { accept: true }); });
    await waitForSelector(cdp, "[data-project-diagram='source']");
    await waitForSelector(cdp, `${active} [data-selectable-node]`);
    const sharedOnly = "Calls\n\\-- shared()\n    \\-- shared detail";
    const both = "Calls\n+-- shared()\n|   \\-- shared detail\n\\-- gamma()\n    \\-- gamma detail";
    async function checkCompactions(expectedFiles) {
      await click(cdp, `${panel} [aria-label='Open compaction']`);
      await waitForSelector(cdp, `${panel} [data-projected-compactions]`);
      assert.equal(await evaluate(cdp, `Boolean(document.querySelector(${JSON.stringify(`${panel} [data-projected-tree]`)}))`), false);
      const rendered = await evaluate(cdp, `Array.from(document.querySelectorAll(${JSON.stringify(`${panel} [data-compaction-file]`)})).map(el => ({
        file: el.dataset.compactionFile, rows: el.dataset.compactionRows, ascii: el.querySelector('pre').textContent }))`);
      assert.deepEqual(rendered.map((file) => file.file), expectedFiles);
      for (const file of rendered) {
        assert.equal(file.rows, "2 3");
        assert.equal(file.ascii, `${file.file}\n\\-- selected method\n    \\-- selected detail`);
      }
      await captureScreenshot(cdp, { output: process.env.COMPACTION_SCREENSHOT ?? path.join(temp, "compaction.png") });
      await click(cdp, `${panel} [aria-label='Back to call tree']`);
      await waitForSelector(cdp, `${panel} pre[data-projected-tree]`);
      await click(cdp, `${panel} [aria-label='Open compaction']`);
      await waitForSelector(cdp, `${panel} [data-projected-compactions]`);
      await key(cdp, "Escape", "Escape");
      await waitForSelector(cdp, `${panel} [data-projected-compactions]`);
      await click(cdp, `${panel} [aria-label='Back to call tree']`);
      await waitForSelector(cdp, `${panel} pre[data-projected-tree]`);
    }
    // Full source is an owned DisplayPane child, with its own persisted view state.
    await selectRows(cdp, 3);
    await openTree(cdp, both);
    await click(cdp, `${panel} [aria-label='Open compaction']`);
    await click(cdp, `${panel} [aria-label='Open source src/shared.ts']`);
    const sourcePane = `${active} [data-pane-content='source-code']`;
    const sourceViewer = `${sourcePane} .source-code-viewer`;
    await waitForSelector(cdp, `${sourceViewer}[data-highlighted=true]`);
    const sourceId = await evaluate(cdp, `document.querySelector(${JSON.stringify(sourcePane)}).dataset.displayNode`);
    const selectedLines = () => evaluate(cdp, `Array.from(document.querySelectorAll(${JSON.stringify(`${sourceViewer} [data-selected=true]`)})).map(node => +node.dataset.line)`);
    assert.deepEqual(await selectedLines(), [12, detailLine]);
    assert.equal(await evaluate(cdp, `document.querySelectorAll(${JSON.stringify(`${sourcePane} .source-fold-placeholder`)}).length`), 2);
    assert.equal(await evaluate(cdp, `document.querySelectorAll(${JSON.stringify(`${sourcePane} .source-token[style]`)}).length > 0`), true);
    const firstFold = `${sourceViewer} .source-fold-placeholder[data-line='12']`;
    assert.equal(await evaluate(cdp, `document.querySelector(${JSON.stringify(firstFold)}).textContent.includes('// [Lines 12-15 | 4 lines compacted]')`), true);
    assert.equal(await evaluate(cdp, `Boolean(document.querySelector(${JSON.stringify(`${sourceViewer} .source-code-line[data-line='13']`)}))`), false);
    assert.equal(await evaluate(cdp, `Boolean(document.querySelector(${JSON.stringify(`${sourcePane} .mapping-source-compaction`)}))`), false);
    await click(cdp, `${firstFold} .source-call-graph-node`, 24);
    await waitForSelector(cdp, `${firstFold} .source-call-graph-node-source`);
    assert.deepEqual(await evaluate(cdp, `Array.from(document.querySelectorAll(${JSON.stringify(`${firstFold} .source-call-graph-node-source-line`)})).map(line => +line.dataset.line)`), [12, 13, 14, 15]);
    await click(cdp, `${firstFold} .source-call-graph-node`, 24);
    await waitFor(async () => !await evaluate(cdp, `Boolean(document.querySelector(${JSON.stringify(`${firstFold} .source-call-graph-node-source`)}))`));
    await click(cdp, `${firstFold} .source-section-fold-toggle`);
    await waitForSelector(cdp, `${sourceViewer} .source-code-line[data-line='13']`);
    await click(cdp, `${sourceViewer} [data-line='12'] .source-fold-toggle`);
    await waitForSelector(cdp, firstFold);
    await captureScreenshot(cdp, { output: process.env.SOURCE_COMPACTION_SCREENSHOT ?? path.join(temp, 'source-compaction.png') });
    // Middle-button pan over the source itself must move the canvas and preserve its source view.
    const sourcePanState = () => evaluate(cdp, `(() => {
      const viewer = document.querySelector(${JSON.stringify(sourceViewer)});
      return { transform: document.querySelector(${JSON.stringify(`${active} .diagram-canvas__surface`)}).style.transform,
        top: viewer?.scrollTop ?? null, left: viewer?.scrollLeft ?? null };
    })()`);
    const sourcePoint = await evaluate(cdp, `(() => {
      const rect = document.querySelector(${JSON.stringify(sourceViewer)}).getBoundingClientRect();
      return { x: rect.left + 100, y: rect.top + 60 };
    })()`);
    async function measureSourcePan(label) {
      const beforeSourcePan = await sourcePanState();
      const zoomSelector = `${active} [aria-label='Diagram zoom']`;
      const zoomTextNode = (await cdp.send('Runtime.evaluate', {
        expression: `document.querySelector(${JSON.stringify(zoomSelector)}).firstChild`
      })).result.objectId;
      await cdp.send('Performance.enable');
      const performanceMetrics = async () => Object.fromEntries((await cdp.send('Performance.getMetrics')).metrics.map(metric => [metric.name, metric.value]));
      const beforePanMetrics = await performanceMetrics();
      await cdp.send('Input.dispatchMouseEvent', { type: 'mousePressed', ...sourcePoint, button: 'middle', buttons: 4, clickCount: 1 });
      for (let step = 1; step <= 40; step++) {
        const distance = step <= 20 ? step : 40 - step;
        await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: sourcePoint.x + distance * 4,
          y: sourcePoint.y + distance * 2, button: 'middle', buttons: 4 });
        if (step === 20) assert.notEqual((await sourcePanState()).transform, beforeSourcePan.transform, 'Pan moves the canvas over an open source pane');
      }
      await cdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', ...sourcePoint, button: 'middle', buttons: 0, clickCount: 1 });
      const afterPanMetrics = await performanceMetrics();
      console.log(`Source pane ${label} pan (40 moves, ms):`, Object.fromEntries(['TaskDuration', 'ScriptDuration', 'RecalcStyleDuration'].map(name =>
        [name, Math.round((afterPanMetrics[name] - beforePanMetrics[name]) * 1000)])));
      await cdp.send('Performance.disable');
      const retainedZoomText = await cdp.send('Runtime.callFunctionOn', { objectId: zoomTextNode,
        functionDeclaration: `function() { return this === document.querySelector(${JSON.stringify(zoomSelector)}).firstChild; }`, returnByValue: true });
      await cdp.send('Runtime.releaseObject', { objectId: zoomTextNode });
      assert.equal(retainedZoomText.result.value, true, 'Panning must not replace the unchanged zoom text and invalidate layout');
      assert.deepEqual(await sourcePanState(), beforeSourcePan, 'Pan preserves source scroll and returns to the original transform');
      assert.equal(await evaluate(cdp, 'window.getSelection()?.toString()'), '', 'Panning over source must not select text');
    }
    await measureSourcePan('expanded');
    assert.deepEqual(await selectedLines(), [12, detailLine]);
    await cdp.send('Input.dispatchMouseEvent', { type: 'mouseWheel', ...sourcePoint, deltaX: 300, deltaY: 0 });
    await waitFor(async () => (await sourcePanState()).left > 0, { message: 'Offscreen wide lines must retain horizontal scrolling' });
    await click(cdp, `${sourcePane} [aria-label='Next mapped range']`);
    await waitFor(async () => await evaluate(cdp, `document.querySelector(${JSON.stringify(`${sourcePane} .mapping-source-toolbar`)}).textContent.includes('${detailLine}')`));
    await waitFor(async () => await evaluate(cdp, `(() => {
      const viewer = document.querySelector(${JSON.stringify(sourceViewer)});
      const bounds = viewer.getBoundingClientRect();
      const target = viewer.querySelector('[data-line="${detailLine}"]').getBoundingClientRect();
      return target.top >= bounds.top && target.bottom <= bounds.bottom && viewer.scrollLeft === 0;
    })()`), { message: 'Mapped range navigation must reveal a distant deferred source block' });
    const overlays = `${sourcePane} .mapping-source-toolbar button:first-child`;
    await click(cdp, overlays);
    await waitFor(async () => await evaluate(cdp, `document.querySelector(${JSON.stringify(overlays)}).getAttribute('aria-pressed') === 'false'`));
    assert.equal(await evaluate(cdp, `document.querySelectorAll(${JSON.stringify(`${sourcePane} .source-fold-placeholder`)}).length`), 0);
    assert.deepEqual(await selectedLines(), mappedLines);
    const scroll = () => evaluate(cdp, `document.querySelector(${JSON.stringify(sourceViewer)})?.scrollTop`);
    await waitFor(async () => (await scroll()) > 500);
    const savedScroll = await scroll();
    await captureScreenshot(cdp, { output: process.env.SOURCE_SCREENSHOT ?? path.join(temp, 'source-pane.png') });
    await click(cdp, `${sourcePane} [aria-label='Back to compactions']`);
    await waitForSelector(cdp, `${panel} [data-projected-compactions]`);
    await click(cdp, `${panel} [aria-label='Forward to child pane']`);
    await waitForSelector(cdp, sourceViewer);
    assert.equal(await evaluate(cdp, `document.querySelector(${JSON.stringify(sourcePane)}).dataset.displayNode`), sourceId);
    await waitFor(async () => Math.abs((await scroll()) - savedScroll) < 1);
    await click(cdp, `${sourcePane} [aria-label='Collapse pane']`);
    await waitFor(async () => !await evaluate(cdp, `Boolean(document.querySelector(${JSON.stringify(sourceViewer)}))`));
    await measureSourcePan('collapsed');
    await click(cdp, `${sourcePane} [aria-label='Expand pane']`);
    await waitFor(async () => Math.abs((await scroll()) - savedScroll) < 1);
    await saveWorkspace(cdp);
    let savedSource;
    await waitFor(async () => {
      const workspace = await (await fetch(`${url}/api/mapping/workspace`)).json();
      const nodes = workspace?.documents[0]?.canvas.display.nodes;
      savedSource = nodes?.[sourceId];
      return savedSource?.content.scroll?.top === savedScroll;
    });
    assert.equal(savedSource.content.kind, 'source-code');
    assert.equal(savedSource.content.showCompactions, false);
    assert.equal(savedSource.content.rangeIndex, 1);
    await reload(cdp);
    await waitForSelector(cdp, `${sourceViewer}[data-highlighted=true]`);
    assert.deepEqual(await selectedLines(), mappedLines);
    assert.equal(await evaluate(cdp, `document.querySelector(${JSON.stringify(overlays)}).getAttribute('aria-pressed')`), 'false');
    await waitFor(async () => Math.abs((await scroll()) - savedScroll) < 1);
    await click(cdp, `${sourcePane} [aria-label='Projected source file']`);
    await key(cdp, 'ArrowDown', 'ArrowDown'); await key(cdp, 'Enter', 'Enter');
    await waitForSelector(cdp, `${sourcePane} [data-projected-source='src/gamma.ts'] [data-highlighted=true]`);
    await click(cdp, overlays);
    await click(cdp, `${sourcePane} [aria-label='Next mapped range']`);
    const nestedFold = `${sourceViewer} .source-fold-placeholder[data-line='12']`;
    await waitForSelector(cdp, nestedFold);
    assert.equal(await evaluate(cdp, `document.querySelectorAll(${JSON.stringify(`${sourceViewer} .source-fold-placeholder`)}).length`), 1);
    await waitFor(async () => await evaluate(cdp, `(() => {
      const viewer = document.querySelector(${JSON.stringify(sourceViewer)}).getBoundingClientRect();
      const fold = document.querySelector(${JSON.stringify(nestedFold)}).getBoundingClientRect();
      return fold.top >= viewer.top && fold.bottom <= viewer.bottom;
    })()`), { message: 'Navigation to a nested range must reveal its enclosing fold' });
    await click(cdp, `${nestedFold} .source-call-graph-node[data-graph-line='2']`, 24);
    assert.deepEqual(await evaluate(cdp, `Array.from(document.querySelectorAll(${JSON.stringify(`${nestedFold} .source-call-graph-node-source-line`)})).map(line => +line.dataset.line)`), [14, 15, 16]);
    await click(cdp, `${sourcePane} [aria-label='Close pane']`);
    await waitForSelector(cdp, `${panel} [data-projected-compactions]`);
    // Re-fetch changed and missing files without inventing current range highlights.
    await writeFile(path.join(temp, 'src/shared.ts'), sourceText + '\n// changed');
    await click(cdp, `${panel} [aria-label='Open source src/shared.ts']`);
    await waitForSelector(cdp, `${sourcePane} .mapping-source-message[role=status]`);
    await waitFor(async () => await evaluate(cdp, `document.querySelector(${JSON.stringify(sourcePane)}).textContent.includes('has changed')`));
    assert.deepEqual(await selectedLines(), []);
    assert.equal(await evaluate(cdp, `document.querySelectorAll(${JSON.stringify(`${sourcePane} .source-fold-placeholder`)}).length`), 0);
    await click(cdp, `${sourcePane} [aria-label='Close pane']`);
    await rm(path.join(temp, 'src/shared.ts'));
    await click(cdp, `${panel} [aria-label='Open source src/shared.ts']`);
    await waitForSelector(cdp, `${sourcePane} [role=alert] button`);
    await writeFile(path.join(temp, 'src/shared.ts'), sourceText);
    await click(cdp, `${sourcePane} [role=alert] button`);
    await waitForSelector(cdp, `${sourceViewer}[data-highlighted=true]`);
    assert.deepEqual(await selectedLines(), [12, detailLine]);
    await click(cdp, `${sourcePane} [aria-label='Back to compactions']`);
    await click(cdp, `${panel} [aria-label='Back to call tree']`);
    await closeTree(cdp);
    await saveWorkspace(cdp);
    await waitFor(async () => (await (await fetch(`${url}/api/mapping/workspace`)).json()).documents[0].canvas.display.rootIds.length === 0);

    await selectRows(cdp, 2);
    await openTree(cdp, sharedOnly);
    await checkCompactions(["src/shared.ts"]);
    // Persistent groups, chained geometry, projected-row selection, and a full workspace round trip.
    const row = await evaluate(cdp, `(() => {
      const r = document.querySelector(${JSON.stringify(`${panel} [data-projected-tree] .projected-row:last-child`)}).getBoundingClientRect();
      return { x: r.left + 8, y: r.top + r.height / 2 };
    })()`);
    await cdp.send('Input.dispatchMouseEvent', { type: 'mousePressed', ...row, button: 'left', buttons: 1, modifiers: 2, clickCount: 1 });
    await cdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', ...row, button: 'left', modifiers: 2, clickCount: 1 });
    await waitForSelector(cdp, '.projected-selection-actions');
    await key(cdp, 'Escape', 'Escape');
    assert.equal(await evaluate(cdp, "document.querySelector('.projected-selection-actions') === null"), true);
    await cdp.send('Input.dispatchMouseEvent', { type: 'mousePressed', ...row, button: 'left', buttons: 1, modifiers: 2, clickCount: 1 });
    await cdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', ...row, button: 'left', modifiers: 2, clickCount: 1 });
    await click(cdp, '.projected-selection-actions button:first-child');
    await waitForSelector(cdp, `${panel} [data-compaction-file]`);
    assert.equal(await evaluate(cdp, `document.querySelector(${JSON.stringify(`${panel} [data-compaction-file]`)}).dataset.compactionRows`), '3');
    await click(cdp, `${panel} [aria-label='Back to call tree']`);
    await click(cdp, `${active} [aria-label='Projection display mode']`);
    await key(cdp, "ArrowDown", "ArrowDown"); await key(cdp, "Enter", "Enter");
    await waitForSelector(cdp, `${panel} [data-projected-compactions]`);
    assert.ok(await evaluate(cdp, `document.querySelectorAll(${JSON.stringify(panel)}).length >= 2`));
    const geometry = await evaluate(cdp, `(() => {
      const root = document.querySelector('[data-selection-root]');
      const rect = root.querySelector('.retained-selection').getBoundingClientRect();
      const links = [...root.querySelectorAll('.projection-connector')].map(el => el.getBoundingClientRect());
      return { edge: rect.right, start: links[0].left, axes: links.map(r => r.top) };
    })()`);
    assert.ok(Math.abs(geometry.edge - geometry.start) < 2, 'connector begins at selection outer edge');
    assert.ok(geometry.axes.every(y => Math.abs(y - geometry.axes[0]) < 1), 'chain connectors share an axis');
    await click(cdp, `${active} [aria-label='Collapse selection effects']`);
    assert.equal(await evaluate(cdp, `document.querySelectorAll(${JSON.stringify(panel)}).length`), 0);
    await click(cdp, `${active} [aria-label='Expand selection effects']`);
    await waitForSelector(cdp, `${panel} [data-projected-compactions]`);
    // A second independent selection must leave the first group intact.
    await selectRows(cdp, 3); await key(cdp, "n", "KeyN");
    await waitFor(async () => await evaluate(cdp, "document.querySelectorAll('[data-selection-root]').length === 2"));
    await key(cdp, "Escape", "Escape");
    assert.equal(await evaluate(cdp, "document.querySelectorAll('[data-selection-root]').length"), 2);
    await key(cdp, "p", "KeyP");
    await waitForSelector(cdp, '#mapping-poc-prompt');
    await fill(cdp, '#mapping-poc-prompt', 'Preserve this instruction draft');
    await key(cdp, "Escape", "Escape");
    assert.equal(await evaluate(cdp, "document.querySelector('#mapping-poc-prompt').value"), 'Preserve this instruction draft');
    await cdp.send('Input.dispatchMouseEvent', { type: 'mouseWheel', x: 1100, y: 600, deltaX: 0, deltaY: 160, modifiers: 2 });
    await waitFor(async () => await evaluate(cdp, "document.querySelector('[aria-label=\"Diagram zoom\"]').textContent !== '100%'"));
    const beforeReload = await evaluate(cdp, "({panels: document.querySelectorAll('[data-display-node]').length, transform: document.querySelector('.diagram-canvas__surface').style.transform})");
    await saveWorkspace(cdp);
    await waitFor(async () => await evaluate(cdp, "document.querySelector('.mapping-poc-status').textContent.includes('Workspace saved')"));
    const savedWorkspace = await (await fetch(`${url}/api/mapping/workspace`)).json();
    assert.equal(savedWorkspace.schemaVersion, 3);
    assert.equal(savedWorkspace.documents[0].canvas.display.rootIds.length, 2);
    const renderedGeometry = await evaluate(cdp, `Object.fromEntries([...document.querySelectorAll('[data-display-node]')].map(el => [el.dataset.displayNode,
      { position: { x: el.offsetLeft, y: el.offsetTop }, bounds: { width: el.offsetWidth, height: el.offsetHeight } }]))`);
    for (const [id, geometry] of Object.entries(renderedGeometry)) {
      const node = savedWorkspace.documents[0].canvas.display.nodes[id];
      assert.deepEqual(node.bounds, geometry.bounds, 'measured outer bounds are saved in the node');
      assert.ok(Math.abs(node.position.x - geometry.position.x) <= .5 && Math.abs(node.position.y - geometry.position.y) <= .5, 'node position controls rendering');
    }
    await reload(cdp);
    await waitFor(async () => await evaluate(cdp, "document.querySelectorAll('[data-selection-root]').length === 2"));
    assert.deepEqual(await evaluate(cdp, "({panels: document.querySelectorAll('[data-display-node]').length, transform: document.querySelector('.diagram-canvas__surface').style.transform})"), beforeReload);
    assert.equal(await evaluate(cdp, "document.querySelector('#mapping-poc-prompt').value"), 'Preserve this instruction draft');
    await click(cdp, '.mapping-poc-prompt-form button[type=button]');
    await captureScreenshot(cdp, { output: process.env.WORKSPACE_SCREENSHOT ?? path.join(temp, 'workspace.png') });
    const browserPath = file => profilePath.startsWith('/mnt/') ? execFileSync('wslpath', ['-w', file], { encoding: 'utf8' }).trim() : file;
    await cdp.send('Browser.setDownloadBehavior', { behavior: 'allow', downloadPath: browserPath(profilePath) });
    await click(cdp, '.mapping-workspace-actions button:nth-child(3)');
    const exportFile = path.join(profilePath, 'mapping-workspace.json');
    await waitFor(() => existsSync(exportFile), { message: 'Workspace export did not download' });
    const exported = JSON.parse(await readFile(exportFile, 'utf8'));
    assert.equal(exported.documents[0].canvas.display.rootIds.length, 2);

    // Overlapping groups are allowed; remove the uppermost one first.
    await click(cdp, `${active} [data-selection-root]:last-child [aria-label='Remove selection']`);
    await click(cdp, `${active} [aria-label='Remove selection']`);
    await saveWorkspace(cdp);
    await waitFor(async () => (await (await fetch(`${url}/api/mapping/workspace`)).json()).documents[0].canvas.display.rootIds.length === 0);
    await cdp.send('Page.setInterceptFileChooserDialog', { enabled: true });
    const chooser = new Promise(resolve => { const stop = cdp.on('Page.fileChooserOpened', event => { stop(); resolve(event); }); });
    await click(cdp, '.mapping-workspace-actions button:nth-child(4)');
    const chosen = await chooser;
    // Exercise manual/fixed geometry through the public JSON import flow.
    const importedPane = Object.values(exported.documents[0].canvas.display.nodes).find(node => node.kind === 'projection');
    importedPane.geometryPolicy = { placement: 'manual', sizing: 'fixed' };
    importedPane.position = { x: 200, y: 180 };
    importedPane.bounds = { width: 460, height: 310 };
    await writeFile(exportFile, JSON.stringify(exported));
    await cdp.send('DOM.setFileInputFiles', { backendNodeId: chosen.backendNodeId, files: [browserPath(exportFile)] });
    await waitFor(async () => await evaluate(cdp, "document.querySelectorAll('[data-selection-root]').length === 2"));
    const manualSelector = `[data-display-node="${importedPane.id}"]`;
    const manualGeometry = () => evaluate(cdp, `(() => { const el = document.querySelector(${JSON.stringify(manualSelector)}); return el && { x: el.offsetLeft, y: el.offsetTop, width: el.offsetWidth, height: el.offsetHeight }; })()`);
    await waitFor(async () => (await manualGeometry())?.height === 310);
    assert.deepEqual(await manualGeometry(), { x: 200, y: 180, width: 460, height: 310 });
    await click(cdp, `${manualSelector} [aria-label='Collapse pane']`);
    await waitFor(async () => (await manualGeometry())?.height < 100);
    await click(cdp, `${manualSelector} [aria-label='Expand pane']`);
    await waitFor(async () => (await manualGeometry())?.height === 310);
    await saveWorkspace(cdp);
    await waitFor(async () => await evaluate(cdp, "document.querySelector('.mapping-poc-status').textContent.includes('Workspace saved')"));
    await reload(cdp);
    await waitFor(async () => (await manualGeometry())?.height === 310);
    assert.deepEqual(await manualGeometry(), { x: 200, y: 180, width: 460, height: 310 });
    await click(cdp, `${active} [data-selection-root]:last-child [aria-label='Remove selection']`);
    await click(cdp, `${active} [aria-label='Remove selection']`);
    await saveWorkspace(cdp);
    await waitFor(async () => (await (await fetch(`${url}/api/mapping/workspace`)).json()).documents[0].canvas.display.rootIds.length === 0);
    await selectRows(cdp, 3);
    await openTree(cdp, both);
    await checkCompactions(["src/shared.ts", "src/gamma.ts"]);
    await closeTree(cdp);
    await selectRows(cdp, 1);
    await expectUnavailable(cdp, "No linked call-tree branches");
    await key(cdp, 'Escape', 'Escape');
    assert.equal(await evaluate(cdp, "document.querySelector('.mapping-poc-selection-menu') === null"), true, 'Escape cancels a selection without a follow-up');
    await selectRows(cdp, 2, 3);
    await openTree(cdp, both); // Exact text also catches duplicate branches/root context.
    await captureScreenshot(cdp, { output: process.env.PROJECTION_SCREENSHOT ?? path.join(temp, "projection.png") });
    await closeTree(cdp);

    await reload(cdp);
    await selectRows(cdp, 2);
    await openTree(cdp, sharedOnly);
    await checkCompactions(["src/shared.ts"]);
    await closeTree(cdp);
    assert.deepEqual((await catalog()).projections[projection.id], projection);

    // Reversible local source scene edits invalidate the pin until undone.
    await click(cdp, `${active} [data-grid-box='overview'] .mapping-grid-box-tools button:nth-child(3)`);
    await waitForSelector(cdp, `${active} .mapping-grid-box.is-container`);
    await selectRows(cdp, 2);
    await expectUnavailable(cdp, "Unsaved diagram changes");
    await click(cdp, `${active} .mapping-grid-tools button:first-child`);
    await selectRows(cdp, 2);
    await openTree(cdp, sharedOnly);
    await closeTree(cdp);

    // Target exists independently in the sidebar, and dirty target content blocks the source too.
    await openDiagram(cdp, "target", "Related calls");
    assert.equal(await evaluate(cdp, `document.querySelector(${JSON.stringify(`${active} .mapping-poc-ascii`)}).textContent.includes('gamma detail')`), true);
    await click(cdp, `${active} [data-grid-box='overview'] .mapping-grid-box-tools button:nth-child(3)`);
    await waitForSelector(cdp, `${active} .mapping-grid-box.is-container`);
    await openDiagram(cdp, "source", "Source overview");
    await selectRows(cdp, 2);
    await expectUnavailable(cdp, "Unsaved diagram changes");
    await openDiagram(cdp, "target", "Related calls");
    await click(cdp, `${active} .mapping-grid-tools button:first-child`);
    await openDiagram(cdp, "source", "Source overview");
    await selectRows(cdp, 2);
    await openTree(cdp, sharedOnly);
    await closeTree(cdp);

    // Saving even a rename appends a target revision; old projections must not silently rebind.
    await openDiagram(cdp, "target", "Related calls");
    await fill(cdp, "[aria-label='Diagram name']", "Related calls revised");
    await click(cdp, ".mapping-submenu button:nth-of-type(2)");
    await waitFor(async () => (await catalog()).representations.target.revisionIds.length === 2);
    await waitFor(async () => await evaluate(cdp, "document.querySelector('.mapping-submenu small').textContent === 'Saved'"));
    await openDiagram(cdp, "source", "Source overview");
    await selectRows(cdp, 2);
    await expectUnavailable(cdp, "revision has changed");
    await reload(cdp);
    await selectRows(cdp, 2);
    await expectUnavailable(cdp, "revision has changed");
    const saved = await catalog();
    assert.deepEqual(saved.projections[projection.id], projection);
    assert.equal(saved.revisions[targetRevision.id].ascii, targetRevision.ascii);
    assert.deepEqual(errors, []);
  });
  console.log("projection browser check passed: retained source panes, exact source highlights, Studio compaction folds and node expansion, file switching, stale/missing source and retry, source view save/reload, Ctrl-selection, retained groups, Escape, stacked/chained panes, edge connectors, recursive collapse, saved form drafts/viewport, workspace reload, and revision validation");
} finally {
  if (server?.exitCode === null) {
    server.kill("SIGTERM");
    await new Promise((resolve) => server.once("exit", resolve));
  }
  await rm(temp, { recursive: true, force: true });
}
