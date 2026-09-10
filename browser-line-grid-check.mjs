import { seedMappingFixture } from "./browser-mapping-fixture.mjs";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createServer } from "node:net";
import { mkdtemp, rm } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

const { evaluate, waitFor, waitForSelector, captureScreenshot, withHeadlessBrowser } =
  await import(pathToFileURL(path.join(homedir(), ".codex/skills/front-end/browser-test.mjs")).href);
const root = path.dirname(new URL(import.meta.url).pathname);
const temp = await mkdtemp(path.join(tmpdir(), "line-grid-check-"));
const port = await new Promise((resolve) => {
  const server = createServer();
  server.listen(0, "127.0.0.1", () => { const port = server.address().port; server.close(() => resolve(port)); });
});
let server;

async function mouse(cdp, type, point, buttons = 0, modifiers = 0) {
  await cdp.send("Input.dispatchMouseEvent", { type, x: point.x, y: point.y, button: "left", buttons, modifiers, clickCount: 1 });
}
async function click(cdp, selector) {
  const point = await evaluate(cdp, `(() => { const e = document.querySelector(${JSON.stringify(selector)}); if (!e) throw new Error('Missing: ' + ${JSON.stringify(selector)}); const r = e.getBoundingClientRect(); return {x:r.x+r.width/2,y:r.y+r.height/2}; })()`);
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
  return evaluate(cdp, `({ascii:document.querySelector('.mapping-poc-ascii').textContent,boxes:[...document.querySelectorAll('[data-grid-box]')].map(e=>({id:e.dataset.gridBox,column:+e.dataset.gridColumn,row:+e.dataset.gridRow,columns:+e.dataset.gridColumns,rows:+e.dataset.gridRows,collapsed:e.dataset.collapsed}))})`);
}
async function generate(cdp, column, row, title, sourceSelector = '[data-selectable-node="overview:a-system-templates:range-1"]') {
  await waitForSelector(cdp, sourceSelector);
  // A source-mapped node, using rendered geometry after layout.
  const rect = await evaluate(cdp, `(() => { const r=document.querySelector(${JSON.stringify(sourceSelector)}).getBoundingClientRect();return {x:r.x+1,y:r.y+2,width:r.width,height:r.height};})()`);
  await drag(cdp, rect, { x: rect.x + rect.width - 2, y: rect.y + rect.height - 4 }, 2);
  await waitForSelector(cdp, ".mapping-poc-selection-actions");
  await click(cdp, ".mapping-poc-selection-actions button:first-of-type");
  await waitForSelector(cdp, "#mapping-poc-prompt");
  await click(cdp, "#mapping-poc-prompt");
  await cdp.send("Input.insertText", { text: title });
  await click(cdp, ".mapping-poc-prompt-form button[type=submit]");
  await waitFor(async () => (await evaluate(cdp, "document.querySelector('.mapping-grid-tools').textContent")).includes("Drag a region"));
  await drag(cdp, await gridPoint(cdp, column, row), await gridPoint(cdp, column + 20, row + 4));
  await waitFor(async () => (await state(cdp)).ascii.includes(title), { timeoutMs: 10000, message: "sub-diagram did not appear" });
}

try {
  await seedMappingFixture(temp);
  server = spawn("npm", ["run", "preview", "--", "--port", String(port), "--strictPort"], {
    cwd: root, detached: true, stdio: "ignore", env: { ...process.env, NEW_DIAGRAM_PROJECT_ROOT: temp, NEW_DIAGRAM_AGENT: "fake" }
  });
  const url = `http://127.0.0.1:${port}/mapping`;
  await waitFor(async () => (await fetch(url).catch(() => null))?.ok, { timeoutMs: 15000 });
  await withHeadlessBrowser({ url, width: 2400, height: 1400 }, async ({ cdp }) => {
    await waitForSelector(cdp, "[data-grid-box=overview]");
    await waitFor(async () => await evaluate(cdp, "document.querySelector('.diagram-canvas__surface')?.style.transform.includes('translate3d')"),
      { timeoutMs: 15000, message: 'Canvas has not applied its initial viewport transform' });
    await waitFor(async () => (await gridPoint(cdp, 0, 0)).x > 50);
    const before = await state(cdp);
    await generate(cdp, 100, 10, "Profile detail");
    const first = await state(cdp);
    assert.equal(first.boxes.length, 2);
    const detail = first.boxes.find((box) => box.id !== "overview");
    assert.equal(detail.column, 100);
    assert.equal(detail.row, 10);
    assert.equal(first.ascii.split("\n")[10].slice(100, 114), "Profile detail");
    assert.equal(await evaluate(cdp, "document.querySelectorAll('.mapping-poc-graph-stage pre').length"), 1);

    // Switch back to the overview through its text, then insert across B's bounds.
    await drag(cdp, await gridPoint(cdp, 9, 4), await gridPoint(cdp, 20, 4), 2);
    await generate(cdp, 95, 10, "Another detail");
    const second = await state(cdp);
    assert.equal(second.boxes.length, 3);
    assert.ok(second.boxes.find((box) => box.id === detail.id).column > 100);

    await click(cdp, ".mapping-grid-tools button:first-child");
    await waitFor(async () => (await state(cdp)).boxes.length === 2);
    assert.deepEqual(await state(cdp), first);
    await click(cdp, ".mapping-grid-tools button:nth-child(2)");
    await waitFor(async () => (await state(cdp)).boxes.length === 3);
    assert.deepEqual(await state(cdp), second);

    const latest = second.boxes.find((box) => box.id !== "overview" && box.id !== detail.id);
    await click(cdp, `[data-grid-box="${latest.id}"] button:first-child`);
    await waitFor(async () => (await state(cdp)).boxes.find((box) => box.id === latest.id)?.collapsed === "true");
    await click(cdp, `[data-grid-box="${latest.id}"] button:first-child`);
    await waitFor(async () => (await state(cdp)).boxes.find((box) => box.id === latest.id)?.collapsed === "false");
    await click(cdp, `[data-grid-box="${latest.id}"] button:nth-child(3)`);
    await waitFor(async () => (await state(cdp)).boxes.length === 4);
    const grouped = await state(cdp);
    const group = grouped.boxes.find((box) => box.id.startsWith("group-"));
    await click(cdp, `[data-grid-box="${group.id}"] > .mapping-grid-box-tools button:first-child`);
    await waitFor(async () => !(await state(cdp)).boxes.some((box) => box.id === latest.id));
    await click(cdp, `[data-grid-box="${group.id}"] > .mapping-grid-box-tools button:first-child`);
    await waitFor(async () => (await state(cdp)).boxes.some((box) => box.id === latest.id));
    assert.deepEqual(await state(cdp), grouped);

    // Zoom with a real wheel event, then move a whole group in grid coordinates.
    const anchor = await gridPoint(cdp, 95, 10);
    await cdp.send("Input.dispatchMouseEvent", { type: "mouseWheel", ...anchor, deltaX: 0, deltaY: 100, modifiers: 2 });
    await waitFor(async () => (await evaluate(cdp, "document.querySelector('[aria-label=\"Diagram zoom\"]').textContent")) !== "100%");
    await click(cdp, `[data-grid-box="${group.id}"] > .mapping-grid-box-tools button:nth-child(2)`);
    const destination = await gridPoint(cdp, 95, 20);
    await mouse(cdp, "mousePressed", destination, 1); await mouse(cdp, "mouseReleased", destination);
    await waitFor(async () => (await state(cdp)).boxes.find((box) => box.id === group.id)?.row === 20);
    assert.equal((await state(cdp)).boxes.find((box) => box.id === latest.id).row, 20);
    // Generate recursively inside the moved group using the child's own evidence.
    const movedChild = (await state(cdp)).boxes.find((box) => box.id === latest.id);
    await drag(cdp, await gridPoint(cdp, movedChild.column + 6, movedChild.row + 1), await gridPoint(cdp, movedChild.column + 18, movedChild.row + 1), 2);
    await generate(cdp, movedChild.column + 5, movedChild.row + 3, "Nested detail", `[data-selectable-node^="${latest.id}:"]`);
    const nested = await state(cdp);
    const nestedBox = nested.boxes.find((box) => !grouped.boxes.some((old) => old.id === box.id));
    assert.ok(nestedBox);
    assert.equal(nestedBox.row, 23);
    const grownGroup = nested.boxes.find((box) => box.id === group.id);
    assert.ok(grownGroup.columns > group.columns);

    // Patch only this generated box's local rows; sibling text is preserved.
    await drag(cdp, await gridPoint(cdp, nestedBox.column + 6, nestedBox.row + 1), await gridPoint(cdp, nestedBox.column + 18, nestedBox.row + 1), 2);
    await waitForSelector(cdp, '.mapping-poc-selection-actions');
    await click(cdp, '.mapping-poc-selection-actions button[aria-keyshortcuts="P"]');
    await click(cdp, '#mapping-poc-prompt');
    await cdp.send('Input.insertText', { text: 'Add local detail' });
    await click(cdp, '.mapping-poc-prompt-form button[type=submit]');
    await waitFor(async () => (await state(cdp)).ascii.includes('[edited: Add local detail]'));
    const edited = await state(cdp);
    for (const sibling of nested.boxes.filter((box) => box.id !== nestedBox.id && !box.id.startsWith('group-'))) {
      assert.deepEqual(edited.boxes.find((box) => box.id === sibling.id), sibling);
    }
    await click(cdp, '.mapping-grid-tools button:first-child');
    await waitFor(async () => !(await state(cdp)).ascii.includes('[edited: Add local detail]'));
    assert.deepEqual(await state(cdp), nested);
    assert.equal(await evaluate(cdp, "document.querySelector('.mapping-poc-contract')"), null);
    const transform = await evaluate(cdp, "document.querySelector('.diagram-canvas__surface').style.transform");
    await drag(cdp, { x: 345, y: 800 }, { x: 390, y: 840 });
    await waitFor(async () => (await evaluate(cdp, "document.querySelector('.diagram-canvas__surface').style.transform")) !== transform);
    await drag(cdp, await gridPoint(cdp, nestedBox.column + 6, nestedBox.row + 1), await gridPoint(cdp, nestedBox.column + 18, nestedBox.row + 1), 2);
    await waitForSelector(cdp, `[data-selectable-node^="${nestedBox.id}:"].is-selected`);
    await click(cdp, '.mapping-poc-selection-actions button:first-of-type');
    await click(cdp, '#mapping-poc-prompt');
    await cdp.send('Input.insertText', { text: 'Cancelled placement' });
    await click(cdp, '.mapping-poc-prompt-form button[type=submit]');
    await mouse(cdp, 'mousePressed', await gridPoint(cdp, 90, 32), 1);
    await mouse(cdp, 'mouseMoved', await gridPoint(cdp, 108, 36), 1);
    await waitForSelector(cdp, '.mapping-grid-placement');
    await cdp.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
    await cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
    await mouse(cdp, 'mouseReleased', await gridPoint(cdp, 108, 36));
    await waitFor(async () => !(await evaluate(cdp, "document.querySelector('.mapping-grid-placement') !== null")));
    assert.deepEqual(await state(cdp), nested);
    assert.ok(before.ascii.startsWith("CurrentLLMPromptStack"));
    // Persist generated children and their evidence, then edit a child after reload.
    await click(cdp, '.mapping-submenu button:nth-of-type(2)');
    await waitFor(async () => (await evaluate(cdp, "document.querySelector('.mapping-submenu small')?.textContent")) === 'Saved');
    await cdp.send('Page.reload', { ignoreCache: true });
    await waitForSelector(cdp, `[data-grid-box="${nestedBox.id}"]`);
    assert.deepEqual(await state(cdp), nested);
    await click(cdp, `[data-explorer-box="${nestedBox.id}"]`);
    let previousPosition = "";
    let stableFrames = 0;
    await waitFor(async () => {
      const point = await gridPoint(cdp, nestedBox.column, nestedBox.row);
      const position = JSON.stringify(point);
      stableFrames = previousPosition === position ? stableFrames + 1 : 0;
      previousPosition = position;
      return point.x > 330 && stableFrames >= 2;
    });
    await selectAndEditReloadedChild(cdp, nestedBox);
    await captureScreenshot(cdp, { output: process.env.GRID_SCREENSHOT_OUTPUT || path.join(temp, "line-grid.png") });
    console.log("PASS: generation into shared rows, collision displacement, atomic undo/redo, nested collapse/expand, recursive generation, local edits, group movement, selection under pan/zoom, placement cancellation, and generated evidence after save/reload");
  });
} finally {
  if (server?.pid) { try { process.kill(-server.pid, "SIGTERM"); } catch {} }
  await rm(temp, { recursive: true, force: true });
}

async function selectAndEditReloadedChild(cdp, box) {
  await drag(cdp, await gridPoint(cdp, box.column + 6, box.row + 1), await gridPoint(cdp, box.column + 18, box.row + 1), 2);
  await waitForSelector(cdp, '.mapping-poc-selection-actions');
  await click(cdp, '.mapping-poc-selection-actions button[aria-keyshortcuts="P"]');
  await click(cdp, '#mapping-poc-prompt');
  await cdp.send('Input.insertText', { text: 'Reloaded child evidence' });
  await click(cdp, '.mapping-poc-prompt-form button[type=submit]');
  await waitFor(async () => (await state(cdp)).ascii.includes('[edited: Reloaded child evidence]'));
}
