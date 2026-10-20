import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { homedir, tmpdir } from 'node:os';
import { createServer } from 'node:net';
import { once } from 'node:events';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { WebSocket } from 'ws';
import { seedMappingFixture } from '../support/browser-mapping-fixture.mjs';
const { evaluate, waitFor, waitForSelector, withHeadlessBrowser, captureScreenshot } = await import(pathToFileURL(path.join(homedir(), '.codex/skills/front-end/browser-test.mjs')).href);
const root = await mkdtemp(path.join(tmpdir(), 'cursor-copy-'));
let server, socket;
try {
  await seedMappingFixture(root, { ascii: 'Root\n`-- Existing', nodes: [] });
  const port = await new Promise(resolve => { const s = createServer(); s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => resolve(p)); }); });
  const url = `http://127.0.0.1:${port}`;
  server = spawn(process.execPath, ['--import', 'tsx', 'scripts/dev/start-server.mjs', '--http', 'preview', '--configLoader', 'native', '--host', '127.0.0.1', '--port', String(port), '--strictPort',
    ...(process.env.CURSOR_COPY_BUILD_DIR ? ['--outDir', process.env.CURSOR_COPY_BUILD_DIR] : [])],
    { detached: true, env: { ...process.env, NEW_DIAGRAM_PROJECT_ROOT: root, NEW_DIAGRAMS_DIR: path.join(root, '.diagrams'), NEW_DIAGRAM_AGENT: 'fake' }, stdio: ['ignore', 'pipe', 'pipe'] });
  let errors = ''; server.stdout.on('data', c => { errors += c; }); server.stderr.on('data', c => { errors += c; });
  await waitFor(async () => (await fetch(url).catch(() => null))?.ok, { timeoutMs: 20000 }).catch(error => { throw Error(`${error}\n${errors}`); });
  await withHeadlessBrowser({ url: `${url}/mapping`, width: 1800, height: 1100, chromePath: process.env.CHROME_PATH,
    arguments: ['--disable-gpu', ...(process.platform === 'linux' ? ['--no-sandbox'] : [])] }, async ({ cdp }) => {
    const send = cdp.send.bind(cdp);
    cdp.send = (method, params) => {
      let timer;
      return Promise.race([send(method, params), new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(`CDP timeout: ${method}`)), 15000); })])
        .finally(() => clearTimeout(timer));
    };
    try {
    await cdp.send('Page.enable');
    cdp.on('Page.javascriptDialogOpening', () => cdp.send('Page.handleJavaScriptDialog', { accept: true }));
    await waitForSelector(cdp, '[data-native-node="grid:overview"]');
    let canvas;
    await waitFor(async () => { canvas = (await fetch(`${url}/api/mapping/agent/canvases`).then(r => r.json()))[0]; return canvas?.documents.length; });
    socket = new WebSocket(`${url.replace('http:', 'ws:')}/api/mapping/live`);
    const messages = []; socket.on('message', raw => messages.push(JSON.parse(String(raw))));
    await once(socket, 'open');
    const request = async frame => {
      const from = messages.length; socket.send(JSON.stringify(frame));
      let result;
      await waitFor(() => { result = messages.slice(from).find(value => frame.requestId ? value.requestId === frame.requestId : value.type === 'attached' || value.type === 'error'); return result; });
      return result;
    };
    let attached;
    await waitFor(async () => { const result = await request({ type: 'attach', protocolVersion: 2, workspaceInstanceId: canvas.canvasId, documentId: canvas.documents[0].documentId }); if (result.type === 'attached') attached = result; return attached; });
    let serial = 0;
    const context = async () => {
      const result = await request({ type: 'context.get', requestId: `context-${serial++}` });
      assert.equal(result.type, 'context.snapshot'); return result.context;
    };
    const diagrams = async () => (await context()).nodes.filter(node => node.kind === 'diagram');
    const key = async (key, code, windowsVirtualKeyCode, modifiers = 0) => {
      await cdp.send('Input.dispatchKeyEvent', { type: 'keyDown', key, code, windowsVirtualKeyCode, modifiers });
      await cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', key, code, windowsVirtualKeyCode, modifiers });
    };
    const move = point => cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', ...point });
    const click = async point => {
      await move(point);
      await cdp.send('Input.dispatchMouseEvent', { type: 'mousePressed', ...point, button: 'left', buttons: 1, clickCount: 1 });
      await cdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', ...point, button: 'left', buttons: 0, clickCount: 1 });
    };
    const count = (await diagrams()).length;
    const text = 'From T3\n\n|-- Keep spaces  \n`-- Tail';
    const copy = { type: 'diagram.copy', requestId: 'copy-1', text };
    const before = (await context()).version;
    const receipt = await request(copy);
    assert.deepEqual(receipt, { type: 'diagram.copied', requestId: copy.requestId, connectionId: attached.connectionId,
      workspaceInstanceId: canvas.canvasId, documentId: attached.documentId, canvasEpoch: attached.canvasEpoch });
    assert.equal((await context()).version, before, 'Copy does not edit the document');
    await waitForSelector(cdp, '.is-cursor-copy');
    const pointer = { x: 1100, y: 550 };
    await move(pointer);
    await waitFor(async () => await evaluate(cdp, '!!document.querySelector(".canvas-cursor-copy:not([hidden])")'));
    assert.equal(await evaluate(cdp, 'document.querySelector(".canvas-cursor-copy__preview")?.textContent'), text);
    assert.deepEqual(await evaluate(cdp, `(() => { const el = document.querySelector('.canvas-cursor-copy-halo:not([hidden])'); return {x: parseFloat(el.style.left), y: parseFloat(el.style.top), pointerEvents: getComputedStyle(el).pointerEvents}; })()`), { x: pointer.x, y: pointer.y, pointerEvents: 'none' });
    assert.equal((await diagrams()).length, count);
    console.log('Staging and acknowledgement passed');
    // Pan and zoom using real pointer gestures, then paste at the current screen point.
    await cdp.send('Input.dispatchMouseEvent', { type: 'mousePressed', ...pointer, button: 'middle', buttons: 4, clickCount: 1 });
    await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: pointer.x + 50, y: pointer.y + 30, button: 'middle', buttons: 4 });
    await cdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: pointer.x + 50, y: pointer.y + 30, button: 'middle', buttons: 0 });
    await cdp.send('Input.dispatchMouseEvent', { type: 'mouseWheel', ...pointer, deltaX: 0, deltaY: -150, modifiers: 2 });
    await waitFor(async () => await evaluate(cdp, 'document.querySelector(".diagram-canvas__controls output")?.textContent !== "100%"'));
    await move(pointer);
    const expected = await evaluate(cdp, `(() => {
      const box = document.querySelector('[data-native-node="grid:overview"] [data-grid-box]');
      const r = box.getBoundingClientRect(), w = r.width / Number(box.dataset.gridColumns), h = r.height / Number(box.dataset.gridRows);
      return { column: Math.max(0, Math.floor((${pointer.x} - r.x) / w) + Number(box.dataset.gridColumn)),
        row: Math.max(0, Math.floor((${pointer.y} - r.y) / h) + Number(box.dataset.gridRow)) };
    })()`);
    await key('v', 'KeyV', 86, 2);
    await waitFor(async () => (await diagrams()).length === count + 1);
    const inserted = (await diagrams()).find(node => node.content?.ascii === text);
    assert.ok(inserted, 'Raw text retains blank lines and spaces');
    assert.equal(inserted.geometry.bounds.column, expected.column);
    assert.equal(inserted.geometry.bounds.row, expected.row);
    console.log('Cursor placement after pan/zoom passed');
    await key('v', 'KeyV', 86, 2);
    await waitFor(async () => (await diagrams()).length === count + 2);
    assert.equal(await evaluate(cdp, 'document.querySelector(".canvas-cursor-copy__preview")?.textContent'), text, 'Preview survives repeated paste feedback');
    // Escape consumes no undo checkpoint and duplicate copy cannot re-arm it.
    await key('Escape', 'Escape', 27);
    await waitFor(async () => await evaluate(cdp, '!document.querySelector(".is-cursor-copy,.canvas-cursor-copy,.canvas-cursor-copy-halo")'));
    assert.equal((await request(copy)).type, 'diagram.copied');
    assert.equal(await evaluate(cdp, '!!document.querySelector(".is-cursor-copy")'), false);
    await key('v', 'KeyV', 86, 2);
    assert.equal((await diagrams()).length, count + 2);
    // Undo removes one pasted diagram; redo restores it.
    await key('z', 'KeyZ', 90, 2);
    await waitFor(async () => (await diagrams()).length === count + 1);
    await key('y', 'KeyY', 89, 2);
    await waitFor(async () => (await diagrams()).length === count + 2);
    console.log('Repeat paste, Escape, retry and undo/redo passed');
    // Text inputs retain their normal Ctrl+V behavior even with a staged diagram.
    assert.equal((await request({ ...copy, requestId: 'copy-2' })).type, 'diagram.copied');
    const input = await evaluate(cdp, `(() => { const el = [...document.querySelectorAll('input')].find(el => el.getBoundingClientRect().width > 0 && !el.disabled); if (!el) return null; const r=el.getBoundingClientRect(); return {x:r.x+r.width/2,y:r.y+r.height/2}; })()`);
    assert.ok(input, 'Fixture has a visible input');
    await click(input); await move(pointer); await key('v', 'KeyV', 86, 2);
    assert.equal((await diagrams()).length, count + 2);
    await key('Escape', 'Escape', 27);
    await click(pointer); // restore canvas keyboard focus
    assert.equal((await request({ ...copy, requestId: 'copy-3' })).type, 'diagram.copied');
    await move(pointer);
    await captureScreenshot(cdp, { output: process.env.CURSOR_COPY_SCREENSHOT ?? path.join(root, 'cursor-copy.png') });
    console.log('Typing isolation passed');
    // Save only the inserted diagrams. Reload clears the ephemeral buffer.
    const save = await evaluate(cdp, `(() => { const el=[...document.querySelectorAll('button')].find(el=>el.textContent==='Save workspace'); const r=el.getBoundingClientRect(); return {x:r.x+r.width/2,y:r.y+r.height/2}; })()`);
    await click(save);
    console.log('Save clicked');
    await waitFor(async () => await evaluate(cdp, 'document.querySelector(".mapping-poc-workspace footer, footer")?.textContent.includes("Workspace saved")'));
    socket.close();
    console.log('Reloading');
    await cdp.send('Page.reload', { ignoreCache: true });
    await waitForSelector(cdp, '[data-native-node="grid:overview"]');
    await waitFor(async () => await evaluate(cdp, `document.querySelectorAll('[data-native-node^="grid:diagram-"]').length === 2`));
    assert.equal(await evaluate(cdp, '!!document.querySelector(".is-cursor-copy,.canvas-cursor-copy")'), false);
    console.log('PASS: WebSocket acknowledgement, exact staging without mutation, cursor placement after pan/zoom, repeat paste, Escape, retry, undo/redo, typing isolation and persisted reload');
    } catch (error) { console.error('Browser assertion failed:', error); throw error; }
  });
} finally {
  socket?.terminate();
  if (server?.pid) { try { process.kill(-server.pid, 'SIGTERM'); } catch {} }
  await rm(root, { recursive: true, force: true });
}
