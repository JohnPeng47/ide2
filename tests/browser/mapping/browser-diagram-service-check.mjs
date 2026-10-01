import { seedMappingFixture } from "../support/browser-mapping-fixture.mjs";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createServer } from "node:net";
import { mkdtemp, rm } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

const { evaluate, waitFor, waitForSelector, captureScreenshot, withHeadlessBrowser } =
  await import(pathToFileURL(path.join(homedir(), ".codex/skills/front-end/browser-test.mjs")).href);
const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '../../..');
const temp = await mkdtemp(path.join(tmpdir(), "line-grid-check-"));
const port = await new Promise((resolve) => {
  const server = createServer();
  server.listen(0, "127.0.0.1", () => { const port = server.address().port; server.close(() => resolve(port)); });
});
let server;

async function mouse(cdp, type, point, buttons = 0, modifiers = 0) {
  await cdp.send("Input.dispatchMouseEvent", { type, x: point.x, y: point.y, button: "left", buttons, modifiers, clickCount: 1 });
}
async function click(cdp, selector, text) {
  const point = await evaluate(cdp, `(() => { const e = [...document.querySelectorAll(${JSON.stringify(selector)})].find(node => !${JSON.stringify(text)} || node.textContent.trim() === ${JSON.stringify(text)}); if (!e) throw new Error('Missing: ' + ${JSON.stringify(selector)}); const r = e.getBoundingClientRect(); return {x:r.x+r.width/2,y:r.y+r.height/2}; })()`);
  await mouse(cdp, "mousePressed", point, 1); await mouse(cdp, "mouseReleased", point);
}
async function drag(cdp, start, end, modifiers = 0) {
  await mouse(cdp, "mousePressed", start, 1, modifiers);
  await mouse(cdp, "mouseMoved", end, 1, modifiers);
  await mouse(cdp, "mouseReleased", end, 0, modifiers);
}
async function gridPoint(cdp, column, row) {
  return evaluate(cdp, `(() => { const pre=document.querySelector('.mapping-poc-ascii'); const r=pre.getBoundingClientRect(); const scale=r.width/pre.offsetWidth; const w=document.querySelector('.mapping-poc-cell-probe').offsetWidth/10; const h=parseFloat(getComputedStyle(pre).lineHeight); return {x:r.x+(${column}+.3)*w*scale,y:r.y+(${row}+.3)*h*scale}; })()`);
}
async function state(cdp) {
  return evaluate(cdp, `({ascii:document.querySelector('.mapping-poc-ascii').textContent,boxes:[...document.querySelectorAll('[data-grid-box][data-grid-column]')].map(e=>({id:e.dataset.gridBox,column:+e.dataset.gridColumn,row:+e.dataset.gridRow,columns:+e.dataset.gridColumns,rows:+e.dataset.gridRows,collapsed:e.dataset.collapsed}))})`);
}
async function generate(cdp, column, row, title, sourceSelector = '[data-selectable-node="overview:a-system-templates:range-1"]') {
  await waitForSelector(cdp, sourceSelector);
  // A source-mapped node, using rendered geometry after layout.
  const rect = await evaluate(cdp, `(() => { const r=document.querySelector(${JSON.stringify(sourceSelector)}).getBoundingClientRect();return {x:r.x+1,y:r.y+2,width:r.width,height:r.height};})()`);
  await drag(cdp, rect, { x: rect.x + rect.width - 2, y: rect.y + rect.height - 4 }, 2);
  // Source panes open automatically on selection; fold them before placing on the canvas.
  while (await evaluate(cdp, "Boolean(document.querySelector('.selection-root-join[aria-expanded=true]'))"))
    await click(cdp, '.selection-root-join[aria-expanded=true]');
  if (!await evaluate(cdp, "Boolean(document.querySelector('.mapping-poc-selection-actions'))")) {
    await waitForSelector(cdp, '.retained-selection-controls');
    const actions = await evaluate(cdp, `(() => { const e=[...document.querySelectorAll('.retained-selection-controls button')].filter(e=>e.textContent==='Actions').at(-1);const r=e.getBoundingClientRect();return{x:r.x+r.width/2,y:r.y+r.height/2};})()`);
    await mouse(cdp, 'mousePressed', actions, 1); await mouse(cdp, 'mouseReleased', actions);
  }
  await waitForSelector(cdp, ".mapping-poc-selection-actions");
  await click(cdp, ".mapping-poc-selection-actions button", "Generate sub-diagram");
  await waitForSelector(cdp, "#mapping-poc-prompt");
  await click(cdp, "#mapping-poc-prompt");
  await cdp.send("Input.insertText", { text: title });
  await click(cdp, ".mapping-poc-prompt-form button[type=submit]");
  await waitFor(async () => (await evaluate(cdp, "document.querySelector('.mapping-grid-tools').textContent")).includes("Drag a region"));
  await drag(cdp, await gridPoint(cdp, column, row), await gridPoint(cdp, column + 20, row + 4));
  try {
    await waitFor(async () => (await state(cdp)).ascii.includes(title), { timeoutMs: 10000, message: "sub-diagram did not appear" });
  } catch (error) {
    console.error(await evaluate(cdp, "document.body.innerText.slice(-6000)"));
    throw error;
  }
}

try {
  await seedMappingFixture(temp);
  server = spawn("npm", ["run", "preview", "--", "--port", String(port), "--strictPort"], {
    cwd: root, detached: true, stdio: "ignore", env: { ...process.env, NEW_DIAGRAM_PROJECT_ROOT: temp, NEW_DIAGRAM_AGENT: "fake" }
  });
  const url = `http://127.0.0.1:${port}/mapping`;
  await waitFor(async () => (await fetch(url).catch(() => null))?.ok, { timeoutMs: 15000 });
  await withHeadlessBrowser({ chromePath: process.env.CHROME_PATH, arguments: process.env.CHROME_PATH ? ['--no-sandbox', '--disable-gpu'] : [], url, width: 2400, height: 1400 }, async ({ cdp }) => {
    await cdp.send('Page.enable');
    cdp.on('Page.javascriptDialogOpening', () => void cdp.send('Page.handleJavaScriptDialog', { accept: true }));
    const send = cdp.send.bind(cdp);
    cdp.send = (method, parameters) => {
      let timer;
      return Promise.race([send(method, parameters), new Promise((_, reject) => { timer = setTimeout(() => reject(Error(`CDP timeout: ${method}`)), 15000); })]).finally(() => clearTimeout(timer));
    };
    await waitForSelector(cdp, "[data-grid-box=overview]");
    await waitFor(async () => await evaluate(cdp, "document.querySelector('.diagram-canvas__surface')?.style.transform.includes('translate3d')"),
      { timeoutMs: 15000, message: 'Canvas has not applied its initial viewport transform' });
    await waitFor(async () => (await gridPoint(cdp, 0, 0)).x > 50);
    const before = await state(cdp);
    await generate(cdp, 100, 10, 'Service generated detail');
    const generated = await state(cdp), detail = generated.boxes.find(box => box.id !== 'overview');
    assert.equal(generated.boxes.length, before.boxes.length + 1);
    assert.ok(detail);
    await click(cdp, '.mapping-grid-tools button', 'Undo');
    await waitFor(async () => !(await state(cdp)).boxes.some(box => box.id === detail.id));
    await click(cdp, '.mapping-grid-tools button', 'Redo');
    await waitFor(async () => (await state(cdp)).boxes.some(box => box.id === detail.id));
    assert.deepEqual(await state(cdp), generated);
    await click(cdp, '.mapping-submenu button', 'Save');
    try {
      await waitFor(async () => await evaluate(cdp, "document.querySelector('.mapping-submenu small')?.textContent === 'Saved'"));
    } catch (error) { console.error(await evaluate(cdp, "({alerts:[...document.querySelectorAll('[role=alert]')].map(e=>e.textContent), menu:document.querySelector('.mapping-submenu')?.innerText, buttons:[...document.querySelectorAll('.mapping-submenu button')].map(e=>({text:e.textContent,disabled:e.disabled,rect:e.getBoundingClientRect().toJSON()}))})")); await captureScreenshot(cdp, {output: path.join(temp, 'failure.png')}); throw error; }
    const catalog = (await (await fetch(`${url.replace(/\/mapping$/, '')}/api/core/project/representations`)).json()).catalog;
    const representation = catalog.representations['representation-overview'];
    const history = catalog.revisions[representation.currentRevisionId].content.history;
    const revisionId = history.snapshots[history.headId].diagramBindings[detail.id];
    const revision = history.diagramRevisions[revisionId];
    assert.equal(revision.diagram.revisionId, revisionId);
    assert.equal(revision.diagram.diagramId, revision.diagramId);
    assert.ok(revision.diagram.content.ascii.includes('Service generated detail'));
    const loaded = new Promise(resolve => cdp.on('Page.loadEventFired', resolve));
    await cdp.send('Page.reload', { ignoreCache: true });
    await loaded;
    await waitForSelector(cdp, `[data-grid-box="${detail.id}"]`);
    assert.deepEqual(await state(cdp), generated);
    await click(cdp, '.mapping-grid-tools button', 'Undo');
    await waitFor(async () => !(await state(cdp)).boxes.some(box => box.id === detail.id));
    await click(cdp, '.mapping-grid-tools button', 'Redo');
    await waitFor(async () => (await state(cdp)).boxes.some(box => box.id === detail.id));
    assert.deepEqual(await state(cdp), generated);
    await captureScreenshot(cdp, { output: path.join(temp, 'service-generation.png') });
    console.log('PASS: service generation, immutable revision identity, undo/redo, save/reload, and durable undo/redo');
  });
} finally {
  if (server?.pid) { try { process.kill(-server.pid, 'SIGTERM'); } catch {} }
  await rm(temp, { recursive: true, force: true });
}
