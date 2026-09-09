import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { homedir } from "node:os";
import { pathToFileURL, fileURLToPath } from "node:url";
const { evaluate, waitFor, waitForSelector, captureScreenshot, withHeadlessBrowser } = await import(pathToFileURL(path.join(homedir(), ".codex/skills/front-end/browser-test.mjs")).href);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
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
  await withHeadlessBrowser({ url: extraction.sourceUrl, width: 1900, height: 1100 }, async ({cdp}) => {
    baseline = await appearance(cdp);
    await captureScreenshot(cdp, { output: path.join(root, 'review/original.png') });
    await selectRows(cdp, 1);
    await key(cdp, 'n', 'KeyN');
    await waitForSelector(cdp, '[data-projected-tree]');
    baseline.projectedTree = await evaluate(cdp, "document.querySelector('[data-projected-tree]').textContent");
  });
  await withHeadlessBrowser({ url: target, width: 1900, height: 1100 }, async ({cdp}) => {
    const errors = [], requests = [];
    await cdp.send('Runtime.enable'); await cdp.send('Network.enable'); await cdp.send('Page.enable');
    cdp.on('Runtime.exceptionThrown', e => errors.push(e.exceptionDetails.exception?.description ?? e.exceptionDetails.text));
    cdp.on('Network.requestWillBeSent', e => requests.push(e.request.url));
    const actual = await appearance(cdp);
    const {projectedTree, ...expected} = baseline;
    assert.deepEqual(actual, expected);
    assert.equal(await evaluate(cdp, "document.querySelectorAll('[data-project-diagram]').length"), 1);
    await captureScreenshot(cdp, { output: path.join(root, 'review/extracted.png') });
    await selectRows(cdp, 1); await key(cdp, 'n', 'KeyN');
    await waitForSelector(cdp, '[data-projected-tree]');
    assert.equal(await evaluate(cdp, "document.querySelector('[data-projected-tree]').textContent"), projectedTree);
    await captureScreenshot(cdp, { output: path.join(root, 'review/call-tree.png') });
    // Zoom out to bring the companion controls into the viewport, using real wheel input.
    for (let i=0;i<5;i++) await cdp.send('Input.dispatchMouseEvent', {type:'mouseWheel',x:1400,y:350,deltaX:0,deltaY:160,modifiers:2});
    await click(cdp, '[aria-label="Open compaction"]');
    await waitForSelector(cdp, '[data-projected-compactions]');
    assert.ok(await evaluate(cdp, "document.querySelectorAll('[data-compaction-file]').length > 0"));
    await captureScreenshot(cdp, { output: path.join(root, 'review/compactions.png') });
    await key(cdp, 'Escape', 'Escape'); await key(cdp, 'Escape', 'Escape');
    await cdp.send('Page.reload', {ignoreCache:true});
    await appearance(cdp);
    await selectRows(cdp, 1); await key(cdp, 'a', 'KeyA');
    await waitForSelector(cdp, '#mapping-poc-local-question');
    await fill(cdp, '#mapping-poc-local-question', 'Explain this selected region');
    await key(cdp, 'Enter', 'Enter', 2);
    await waitForSelector(cdp, '.mapping-poc-graph-stage.is-placing-chat');
    await cdp.send('Input.dispatchMouseEvent', {type:'mousePressed',x:900,y:350,button:'left',buttons:1,clickCount:1});
    await cdp.send('Input.dispatchMouseEvent', {type:'mouseReleased',x:900,y:350,button:'left',clickCount:1});
    await waitForSelector(cdp, '[data-local-chat-bubble]');
    await click(cdp, '[data-local-chat-bubble]');
    await waitForSelector(cdp, '[data-local-chat-role="assistant"]');
    assert.ok(await evaluate(cdp, "document.querySelector('[data-local-chat-role=assistant]').textContent.includes('Demo reply')"));
    await captureScreenshot(cdp, { output: path.join(root, 'review/chat.png') });
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
    assert.equal(await evaluate(cdp, "document.querySelectorAll('[data-project-diagram]').length"), 2);
    assert.deepEqual(errors, []);
    assert.equal(requests.some(url => url.includes(':5177') || url.includes('/internal/') || url.includes('/api/')), false);
    await writeFile(path.join(root, 'review/validation.json'), JSON.stringify({diagram:actual.name,mappedNodes:actual.nodes.length,originalRenderingMatches:true,callTreeMatches:true,compactions:true,chat:true,saveReload:true,originalServerRequests:0,browserErrors:errors}, null, 2)+'\n');
  });
  console.log('PASS: original diagram rendering and projection match; scoped explorer; compactions; demo chat; group/save/reload; no original-server calls.');
} finally {
  server.kill('SIGTERM');
  await new Promise(resolve => server.exitCode !== null ? resolve() : server.once('exit', resolve));
}
