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
  if (await evaluate(cdp, `!document.querySelector(${JSON.stringify(`${active} .mapping-poc-selection-actions`)})`)) {
    await click(cdp, `${active} .retained-selection-controls button:first-child`);
  }
  await waitForSelector(cdp, `${active} .mapping-poc-selection-actions`).catch(async (error) => {
    if (process.env.PROJECTION_SCREENSHOT) await captureScreenshot(cdp, { output: process.env.PROJECTION_SCREENSHOT });
    throw new Error(`${error.message}; selection=${JSON.stringify(points)}; ${await evaluate(cdp, "document.body.innerText")}`);
  });
  await waitFor(async () => await evaluate(cdp,
    `document.querySelectorAll(${JSON.stringify(`${active} [data-selectable-node].is-selected`)}).length === ${last - first + 1}`));
}

async function openTree(cdp, expected) {
  await waitFor(async () => await evaluate(cdp, `!document.querySelector(${JSON.stringify(action)}).disabled`)).catch(async error => { throw new Error(error.message + "\n" + await evaluate(cdp, "document.body.innerText")); });
  await key(cdp, "n", "KeyN");
  await waitForSelector(cdp, `${panel} pre[data-projected-tree]`).catch(async error => { throw new Error(error.message + "\n" + await evaluate(cdp, "document.body.innerText")); });
  assert.equal(await evaluate(cdp, `Boolean(document.querySelector(${JSON.stringify(`${active} .mapping-poc-selection-menu`)}))`), false,
    "Selection menu must not obscure projected branches");
  assert.equal(await evaluate(cdp, `document.querySelector(${JSON.stringify(`${panel} pre[data-projected-tree]`)}).closest("[data-display-node]").dataset.projectionId`), "projection-calls");
  assert.equal(await evaluate(cdp, `document.querySelector(${JSON.stringify(`${panel} pre[data-projected-tree]`)}).textContent`), expected);
}

async function closeTree(cdp) {
  await key(cdp, "Escape", "Escape");
  assert.equal(await evaluate(cdp, `Boolean(document.querySelector(${JSON.stringify(panel)}))`), true, 'Escape preserves retained projections');
  await click(cdp, `${active} [data-selection-root]:has([data-projected-tree]) [aria-label='Remove selection']`);
  await waitFor(async () => !await evaluate(cdp, `Boolean(document.querySelector(${JSON.stringify(`${panel} pre[data-projected-tree]`)}))`));
}

async function expectUnavailable(cdp, reason) {
  await waitFor(async () => await evaluate(cdp, `Boolean(document.querySelector(${JSON.stringify(action)})?.disabled)
    && document.querySelector(${JSON.stringify(`${active} .mapping-projection-status`)})?.textContent.includes(${JSON.stringify(reason)})`),
  { message: `Expected unavailable projection: ${reason}` });
  await key(cdp, "n", "KeyN");
  assert.equal(await evaluate(cdp, `Boolean(document.querySelector(${JSON.stringify(`${panel} pre[data-projected-tree]`)}))`), false);
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
  await withHeadlessBrowser({ url: `${url}/mapping`, width: 2400, height: 1400, chromePath: process.env.CHROME_PATH, arguments: process.platform === 'linux' ? ['--no-sandbox'] : [] }, async ({ cdp, profilePath }) => {
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
    await selectRows(cdp, 3);
    await openTree(cdp, both);
    await closeTree(cdp);
    await selectRows(cdp, 1);
    await expectUnavailable(cdp, "No linked call-tree branches");
    await key(cdp, 'Escape', 'Escape');
    assert.equal(await evaluate(cdp, "document.querySelector('.mapping-poc-selection-menu') === null"), true, 'Escape cancels a selection without a follow-up');
    await selectRows(cdp, 2, 3);
    await openTree(cdp, both); // Exact text also catches duplicate branches/root context.
    await captureScreenshot(cdp, { output: process.env.PROJECTION_SCREENSHOT ?? path.join(temp, "projection.png") });
    await closeTree(cdp);

    await saveWorkspace(cdp);
    await reload(cdp);
    await selectRows(cdp, 2);
    await openTree(cdp, sharedOnly);
    await closeTree(cdp);
    assert.deepEqual((await catalog()).projections[projection.id], projection);

    // Remove retained CodePanels before using diagram-level tools that share the anchor area.
    while (await evaluate(cdp, `!!document.querySelector(${JSON.stringify(`${active} [aria-label='Remove selection']`)})`)) {
      await click(cdp, `${active} [aria-label='Remove selection']`);
    }
    // Reversible local source scene edits invalidate the pin until undone.
    await click(cdp, `${active} .mapping-grid-box[data-grid-box='overview'] .mapping-grid-box-tools button:nth-child(3)`);
    await waitForSelector(cdp, `${active} .mapping-grid-box.is-container`);
    await selectRows(cdp, 2);
    await expectUnavailable(cdp, "Unsaved diagram changes");
    // Opening CodePanel is now an undoable effect, followed by the scene edit.
    for (let i = 0; i < 5 && await evaluate(cdp, `!!document.querySelector(${JSON.stringify(`${active} .mapping-grid-box.is-container`)})`); i++) {
      await click(cdp, `${active} .mapping-grid-tools button:first-child`);
    }
    await saveWorkspace(cdp);
    await selectRows(cdp, 2);
    await openTree(cdp, sharedOnly);
    await closeTree(cdp);

    // Target exists independently in the sidebar, and dirty target content blocks the source too.
    await openDiagram(cdp, "target", "Related calls");
    assert.equal(await evaluate(cdp, `document.querySelector(${JSON.stringify(`${active} .mapping-poc-ascii`)}).textContent.includes('gamma detail')`), true);
    await click(cdp, `${active} .mapping-grid-box[data-grid-box='overview'] .mapping-grid-box-tools button:nth-child(3)`);
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
    await saveWorkspace(cdp);
    await reload(cdp);
    await selectRows(cdp, 2);
    await expectUnavailable(cdp, "revision has changed");
    const saved = await catalog();
    assert.deepEqual(saved.projections[projection.id], projection);
    assert.equal(saved.revisions[targetRevision.id].ascii, targetRevision.ascii);
    assert.deepEqual(errors, []);
  });
  console.log("Projection browser check passed: call-tree selection, retained panes, Actions menu, and source/target revision validation. Source display is covered by browser-code-panel-check.mjs.");
} finally {
  if (server?.exitCode === null) {
    server.kill("SIGTERM");
    await new Promise((resolve) => server.once("exit", resolve));
  }
  await rm(temp, { recursive: true, force: true });
}
