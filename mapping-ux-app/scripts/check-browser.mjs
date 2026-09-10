import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { readFile, writeFile, mkdtemp, rm } from "node:fs/promises";
import path from "node:path";
import { homedir, tmpdir } from "node:os";
import { pathToFileURL, fileURLToPath } from "node:url";
const { evaluate, waitFor, waitForSelector, captureScreenshot, withHeadlessBrowser } = await import(pathToFileURL(path.join(homedir(), ".codex/skills/front-end/browser-test.mjs")).href);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const screenshots = await mkdtemp(path.join(tmpdir(), "mapping-copy-browser-"));
const seed = JSON.parse(await readFile(path.join(root, "data/project-snapshot.json"), "utf8"));
const extraction = JSON.parse(await readFile(path.join(root, "data/extraction.json"), "utf8"));
const active = ".mapping-document-view:not([hidden])";
const target = `http://127.0.0.1:5197/mapping?diagram=${extraction.primaryDiagramId}`;
const server = spawn(process.execPath, ["node_modules/vite/bin/vite.js", "preview", "--port", "5197", "--strictPort"], { cwd: root, stdio: "ignore" });
// Geometry reads only: every application interaction uses real CDP input events.
async function click(cdp, selector) {
  let point;
  let previous = "";
  let stable = 0;
  await waitFor(async () => {
    point = await evaluate(cdp, `(() => {
      const element = document.querySelector(${JSON.stringify(selector)});
      if (!element || element.disabled) return null;
      const rect = element.getBoundingClientRect();
      const x = rect.x + rect.width / 2, y = rect.y + rect.height / 2;
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

async function middlePan(cdp, selector, dx, dy, modifiers = 0) {
  const matrix = () => evaluate(cdp, `(() => {
    const surface = document.querySelector(${JSON.stringify(`${active} .diagram-canvas__surface`)});
    const m = new DOMMatrixReadOnly(getComputedStyle(surface).transform);
    return { x: m.e, y: m.f, scale: m.a };
  })()`);
  const before = await matrix();
  const point = await evaluate(cdp, `(() => {
    const el = document.querySelector(${JSON.stringify(selector)});
    const r = el.getBoundingClientRect();
    const x = (Math.max(0, r.left) + Math.min(innerWidth, r.right)) / 2;
    const y = (Math.max(0, r.top) + Math.min(innerHeight, r.bottom)) / 2;
    return el.contains(document.elementFromPoint(x, y)) ? { x, y } : null;
  })()`);
  assert.ok(point, `Middle-drag target must be visible: ${selector}`);
  await cdp.send('Input.dispatchMouseEvent', { type: 'mousePressed', ...point, button: 'middle', buttons: 4, clickCount: 1, modifiers });
  await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: point.x + dx, y: point.y + dy, button: 'middle', buttons: 4, modifiers });
  await cdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: point.x + dx, y: point.y + dy, button: 'middle', buttons: 0, clickCount: 1, modifiers });
  await waitFor(async () => {
    const after = await matrix();
    return Math.abs(after.x - before.x - dx) < 1 && Math.abs(after.y - before.y - dy) < 1 && after.scale === before.scale;
  }, { message: `Middle-drag did not pan the main canvas from ${selector}` });
  assert.equal(await evaluate(cdp, `document.querySelector(${JSON.stringify(`${active} [data-diagram-canvas]`)}).classList.contains('is-dragging')`), false);
  const released = await matrix();
  await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: point.x + dx + 12, y: point.y + dy + 12, buttons: 0 });
  assert.deepEqual(await matrix(), released, 'Panning must stop when the middle button is released');
}

async function checkSelectionCopy(cdp, expected) {
  const previous = await evaluate(cdp, 'navigator.clipboard.readText()');
  try {
    await click(cdp, `${active} [aria-label="Copy ASCII + code refs"]`);
    await waitFor(async () => (await evaluate(cdp, 'navigator.clipboard.readText()')).replace(/\r\n/g, '\n') === expected,
      { message: 'Copy action did not include the selected ASCII and exact code references' }).catch(async (error) => {
        throw new Error(`${error.message}: ${JSON.stringify(await evaluate(cdp, 'navigator.clipboard.readText()'))}`);
      });
    for (const modifiers of [0, 2, 4]) {
      await evaluate(cdp, 'navigator.clipboard.writeText("copy-shortcut-sentinel")');
      await key(cdp, 'c', 'KeyC', modifiers);
      await waitFor(async () => (await evaluate(cdp, 'navigator.clipboard.readText()')).replace(/\r\n/g, '\n') === expected,
        { message: 'Selection copy shortcut did not write the expected content' });
    }
    await key(cdp, 'p', 'KeyP');
    await fill(cdp, '#mapping-poc-prompt', 'Native text copy stays native');
    await cdp.send('Input.dispatchKeyEvent', { type: 'rawKeyDown', key: 'Control', code: 'ControlLeft', windowsVirtualKeyCode: 17 });
    for (const [key, code, windowsVirtualKeyCode] of [['a', 'KeyA', 65], ['c', 'KeyC', 67]]) {
      await cdp.send('Input.dispatchKeyEvent', { type: 'rawKeyDown', key, code, windowsVirtualKeyCode, modifiers: 2 });
      await cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', key, code, windowsVirtualKeyCode, modifiers: 2 });
    }
    await cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Control', code: 'ControlLeft', windowsVirtualKeyCode: 17 });
    await waitFor(async () => await evaluate(cdp, 'navigator.clipboard.readText()') === 'Native text copy stays native',
      { message: 'Selection copy must not replace normal input copying' });
    await key(cdp, 'Escape', 'Escape');
    await waitForSelector(cdp, `${active} [aria-label="Copy ASCII + code refs"]`);
  } finally {
    await evaluate(cdp, `navigator.clipboard.writeText(${JSON.stringify(previous)})`);
  }
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
  await cdp.send("Input.dispatchMouseEvent", { type: "mousePressed", ...points.start, button: "left", buttons: 1, clickCount: 1 });
  await cdp.send("Input.dispatchMouseEvent", { type: "mouseMoved", ...points.end, button: "left", buttons: 1 });
  await cdp.send("Input.dispatchMouseEvent", { type: "mouseReleased", ...points.end, button: "left", clickCount: 1 });
  await waitForSelector(cdp, `${active} .mapping-poc-selection-actions`).catch(async (error) => {
    if (process.env.PROJECTION_SCREENSHOT) await captureScreenshot(cdp, { output: process.env.PROJECTION_SCREENSHOT });
    throw new Error(`${error.message}; selection=${JSON.stringify(points)}; ${await evaluate(cdp, "document.body.innerText")}`);
  });
  await waitFor(async () => await evaluate(cdp,
    `document.querySelectorAll(${JSON.stringify(`${active} [data-selectable-node].is-selected`)}).length === ${last - first + 1}`));
}


async function appearance(cdp) {
  await waitForSelector(cdp, `${active} [data-selectable-node]`, { timeoutMs: 20000 });
  await waitFor(async () => await evaluate(cdp, `document.querySelector('.mapping-poc-cell-probe').offsetWidth > 0`));
  return evaluate(cdp, `(() => {
    const pre = document.querySelector('.mapping-poc-ascii');
    const style = getComputedStyle(pre);
    return { name: document.querySelector('[aria-label="Diagram name"]').value, ascii: pre.textContent,
      nodes: [...document.querySelectorAll('[data-selectable-node]')].map(n=>n.dataset.selectableNode),
      font: style.fontFamily, fontSize: style.fontSize, lineHeight: style.lineHeight,
      paneWidth: document.querySelector('.mapping-floating-pane').getBoundingClientRect().width };
  })()`);
}
try {
  await waitFor(async () => (await fetch(target).catch(()=>null))?.ok, { timeoutMs: 15000 });
  let baseline;
  if (process.env.COMPARE_ORIGINAL === "1") await withHeadlessBrowser({ url: extraction.sourceUrl, width: 1900, height: 1100 }, async ({cdp}) => {
    baseline = await appearance(cdp);
    await captureScreenshot(cdp, { output: path.join(screenshots, 'original.png') });
    await selectRows(cdp, 1);
    await key(cdp, 'n', 'KeyN');
    await waitForSelector(cdp, '[data-projected-tree]');
    baseline.projectedTree = await evaluate(cdp, "document.querySelector('[data-projected-tree]').textContent");
  });
  await withHeadlessBrowser({ url: target, width: 1900, height: 1100 }, async ({cdp}) => {
    await cdp.send('Browser.grantPermissions', { origin: new URL(target).origin, permissions: ['clipboardReadWrite', 'clipboardSanitizedWrite'] });
    const errors = [], requests = [];
    await cdp.send('Runtime.enable'); await cdp.send('Network.enable'); await cdp.send('Page.enable');
    cdp.on('Runtime.exceptionThrown', e => errors.push(e.exceptionDetails.exception?.description ?? e.exceptionDetails.text));
    cdp.on('Network.requestWillBeSent', e => requests.push(e.request.url));
    const actual = await appearance(cdp);
    const representation = seed.catalog.representations[extraction.primaryDiagramId];
    const revision = seed.catalog.revisions[representation.currentRevisionId];
    const expected = baseline ? (({projectedTree, ...appearance}) => appearance)(baseline) : { ...actual, name: representation.name, ascii: revision.ascii };
    assert.deepEqual(actual, expected);
    assert.equal(actual.nodes.length, revision.mappings.length);
    const diagramCount = Object.keys(seed.catalog.representations).length;
    assert.equal(await evaluate(cdp, "document.querySelectorAll('[data-project-diagram]').length"), diagramCount);
    await captureScreenshot(cdp, { output: path.join(screenshots, 'extracted.png') });
    await selectRows(cdp, 1);
    const firstMapping = [...revision.mappings].sort((a, b) => a.line - b.line || a.startColumn - b.startColumn)[0];
    const firstEvidence = revision.evidence[firstMapping.evidenceId];
    const range = firstEvidence.sourceRanges.find((range) => range.id === firstMapping.sourceRangeId);
    const selectedAscii = revision.ascii.split('\n')[firstMapping.line - 1].slice(firstMapping.startColumn - 1, firstMapping.endColumn);
    await checkSelectionCopy(cdp, `${selectedAscii}\nAssociated Code Entities:\n${firstEvidence.label}: ${range.path}:${range.startLine}-${range.endLine}`);
    await key(cdp, 'n', 'KeyN');
    await waitForSelector(cdp, '[data-projected-tree]');
    if (baseline) assert.equal(await evaluate(cdp, "document.querySelector('[data-projected-tree]').textContent"), baseline.projectedTree);
    await captureScreenshot(cdp, { output: path.join(screenshots, 'call-tree.png') });
    // Zoom out to bring the companion controls into the viewport, using real wheel input.
    for (let i=0;i<5;i++) await cdp.send('Input.dispatchMouseEvent', {type:'mouseWheel',x:1400,y:350,deltaX:0,deltaY:160,modifiers:2});
    await click(cdp, '[aria-label="Open compaction"]');
    await waitForSelector(cdp, '[data-projected-compactions]');
    assert.ok(await evaluate(cdp, "document.querySelectorAll('[data-compaction-file]').length > 0"));
    await captureScreenshot(cdp, { output: path.join(screenshots, 'compactions.png') });
    const file = await evaluate(cdp, "document.querySelector('[data-compaction-file]').dataset.compactionFile");
    await click(cdp, `[aria-label="Open source ${file}"]`);
    await waitForSelector(cdp, '.mapping-source-stack:not([hidden]) [data-highlighted="true"]', { timeoutMs: 20000 });
    assert.ok(await evaluate(cdp, "document.querySelectorAll('.source-code-line[data-selected=true]').length > 0"));
    assert.ok(await evaluate(cdp, "document.querySelectorAll('[data-source-compaction-range]').length > 0"));
    assert.equal(await evaluate(cdp, "Boolean(document.querySelector('.mapping-source-message'))"), false);
    assert.deepEqual(await evaluate(cdp, `(() => {const el = document.querySelector('.mapping-source-stack');const css = getComputedStyle(el);return [css.left, css.top];})()`), ['24px', '24px']);
    await middlePan(cdp, '.mapping-source-pane .source-code-viewer', -36, -24);
    await middlePan(cdp, '.mapping-source-toolbar button:first-child', 36, 24, 8);
    await middlePan(cdp, '.mapping-floating-pane input', -25, 15);
    await middlePan(cdp, '.mapping-floating-pane input', 25, -15);
    assert.equal(await evaluate(cdp, "document.querySelector('.mapping-source-toolbar button').getAttribute('aria-pressed')"), 'true');
    await captureScreenshot(cdp, { output: path.join(screenshots, 'source-stack.png') });
    await click(cdp, '.mapping-source-toolbar button[aria-pressed=true]');
    assert.equal(await evaluate(cdp, "document.querySelectorAll('[data-source-compaction-range]').length"), 0);
    await key(cdp, 'Escape', 'Escape');
    await click(cdp, '[aria-label="Return to source file"]');
    await waitForSelector(cdp, '.mapping-source-stack:not([hidden])');
    await click(cdp, '[aria-label="Back to compactions"]');
    await key(cdp, 'Escape', 'Escape'); await key(cdp, 'Escape', 'Escape');
    await cdp.send('Page.reload', {ignoreCache:true});
    await appearance(cdp);
    await selectRows(cdp, 1); await key(cdp, 'a', 'KeyA');
    await waitForSelector(cdp, '#mapping-poc-local-question');
    await fill(cdp, '#mapping-poc-local-question', 'Explain this selected region');
    await key(cdp, 'Enter', 'Enter', 2);
    await waitForSelector(cdp, '[data-local-chat-bubble]');
    await waitForSelector(cdp, '[data-local-chat-role="assistant"]');
    assert.ok(await evaluate(cdp, "document.querySelector('[data-local-chat-role=assistant]').textContent.includes('Demo reply')"));
    await click(cdp, '.local-chat-convo .local-chat-verbosity button:last-child');
    await fill(cdp, '.local-chat-convo textarea', 'Show more implementation context');
    await key(cdp, 'Enter', 'Enter', 2);
    await waitFor(async () => await evaluate(cdp, "document.querySelectorAll('[data-local-chat-role=assistant]').length === 2"));
    assert.ok(await evaluate(cdp, "document.querySelectorAll('[data-local-chat-role=assistant]')[1].textContent.includes('saved source ranges')"));
    await captureScreenshot(cdp, { output: path.join(screenshots, 'chat.png') });
    await click(cdp, '[aria-label="Collapse local conversation"]');
    await selectRows(cdp, 1); await key(cdp, 'p', 'KeyP');
    await fill(cdp, '#mapping-poc-prompt', 'Show context');
    await click(cdp, '.mapping-poc-prompt-form button[type=submit]');
    await waitFor(async () => await evaluate(cdp, "document.querySelector('.mapping-poc-ascii').textContent.includes('[Demo edit: Show context]')"));
    await click(cdp, '.mapping-grid-tools button:first-child');
    await waitFor(async () => await evaluate(cdp, "!document.querySelector('.mapping-poc-ascii').textContent.includes('[Demo edit: Show context]')"));
    await click(cdp, '[data-grid-box="overview"] > .mapping-grid-box-tools button:nth-child(3)');
    await waitForSelector(cdp, '.mapping-grid-box.is-container');
    await click(cdp, '.mapping-submenu button:nth-of-type(2)');
    await waitFor(async()=> await evaluate(cdp, "document.querySelector('.mapping-submenu small').textContent === 'Saved'"));
    await cdp.send('Page.reload', {ignoreCache:true});
    await waitForSelector(cdp, '.mapping-grid-box.is-container');
    assert.equal(await evaluate(cdp, "document.querySelector('.mapping-poc-ascii').textContent"), expected.ascii);
    await click(cdp, '.mapping-submenu button:first-of-type');
    await fill(cdp, '[aria-label="New diagram name"]', 'UX draft');
    await click(cdp, '.mapping-create-dialog button[type=submit]');
    await waitFor(async () => await evaluate(cdp, "document.querySelector('[aria-label=\"Diagram name\"]').value === 'UX draft'"));
    await cdp.send('Page.reload', {ignoreCache:true});
    await waitFor(async () => await evaluate(cdp, "document.querySelector('[aria-label=\"Diagram name\"]')?.value === 'UX draft'"));
    assert.equal(await evaluate(cdp, "document.querySelectorAll('[data-project-diagram]').length"), diagramCount + 1);
    assert.deepEqual(errors, []);
    assert.equal(requests.some(url => url.includes(':5177') || url.includes('/internal/') || url.includes('/api/')), false);
    await writeFile(path.join(root, 'review/validation.json'), JSON.stringify({diagram:actual.name,mappedNodes:actual.nodes.length,originalRenderingMatches:baseline ? true : undefined,seedMatches:true,callTreeMatches:baseline ? true : undefined,compactions:true,sourceStack:true,shiki:true,sourceHighlights:true,selectionClipboard:true,middleButtonPan:true,chat:true,saveReload:true,originalServerRequests:0,browserErrors:errors}, null, 2)+'\n');
  });
  console.log('PASS: bundled diagram, projections, Shiki source stack, highlights, overlays, demo chat, group/save/reload, and no original-server calls.');
} finally {
  await rm(screenshots, { recursive: true, force: true });
  server.kill('SIGTERM');
  await new Promise(resolve => server.exitCode !== null ? resolve() : server.once('exit', resolve));
}
