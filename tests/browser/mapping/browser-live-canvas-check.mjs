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
const { evaluate, waitFor, waitForSelector, withHeadlessBrowser } = await import(pathToFileURL(path.join(homedir(), '.codex/skills/front-end/browser-test.mjs')).href);
const root = await mkdtemp(path.join(tmpdir(), 'live-canvas-'));
let server, socket;
try {
  await seedMappingFixture(root, { ascii: 'Root\n\n`-- Service', nodes: [{ id: 'service', label: 'Service', head: { line: 3, startColumn: 5, endColumn: 11 },
    sourceRanges: [{ path: 'fixture.ts', startLine: 1, endLine: 2 }] }] });
  const port = await new Promise(resolve => { const s = createServer(); s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => resolve(p)); }); });
  const url = `http://127.0.0.1:${port}`;
  server = spawn(process.execPath, ['scripts/dev/start-server.mjs', 'preview', '--host', '127.0.0.1', '--port', String(port), '--strictPort'],
    { detached: true, env: { ...process.env, NEW_DIAGRAM_PROJECT_ROOT: root, NEW_DIAGRAMS_DIR: path.join(root, '.diagrams'), NEW_DIAGRAM_AGENT: 'fake' }, stdio: ['ignore', 'ignore', 'pipe'] });
  let errors = ''; server.stderr.on('data', c => { errors += c; });
  await waitFor(async () => (await fetch(url).catch(() => null))?.ok, { timeoutMs: 20000 }).catch(e => { throw Error(`${e}\n${errors}`); });
  await withHeadlessBrowser({ url: `${url}/mapping`, width: 1800, height: 1100, chromePath: process.env.CHROME_PATH,
    arguments: ['--disable-gpu', ...(process.platform === 'linux' ? ['--no-sandbox'] : [])] }, async ({ cdp }) => {
    try {
    await cdp.send('Page.enable');
    cdp.on('Page.javascriptDialogOpening', () => cdp.send('Page.handleJavaScriptDialog', { accept: true }));
    await cdp.send('Browser.grantPermissions', { origin: url, permissions: ['clipboardReadWrite', 'clipboardSanitizedWrite'] });
    await waitForSelector(cdp, '[data-grid-box="overview"]');
    let canvas;
    await waitFor(async () => { canvas = (await (await fetch(`${url}/api/mapping/agent/canvases`)).json())[0]; return canvas?.documents.length; });
    socket = new WebSocket(`${url.replace('http:', 'ws:')}/api/mapping/live`);
    const messages = []; socket.on('message', raw => messages.push(JSON.parse(raw.toString())));
    await once(socket, 'open');
    let attached;
    await waitFor(async () => {
      attached = messages.find(m => m.type === 'attached');
      if (!attached) socket.send(JSON.stringify({ type: 'attach', workspaceInstanceId: canvas.canvasId, documentId: canvas.documents[0].documentId }));
      return attached;
    });
    const get = () => fetch(`${url}/api/mapping/live/connections/${attached.connectionId}/selection`);
    assert.equal(attached.text, null); assert.equal((await get()).status, 204);
    const points = await evaluate(cdp, `(() => {
      const pre=document.querySelector('.mapping-document-view:not([hidden]) .mapping-poc-ascii');
      const r=pre.getBoundingClientRect(), scale=r.width/pre.offsetWidth;
      const probe=document.querySelector('.mapping-poc-cell-probe');
      const w=probe.offsetWidth/10, h=parseFloat(getComputedStyle(pre).lineHeight);
      return { start:{x:r.x+.3*w*scale,y:r.y+.3*h*scale},end:{x:r.x+10.3*w*scale,y:r.y+2.3*h*scale} };
    })()`);
    await cdp.send('Input.dispatchMouseEvent', { type: 'mousePressed', ...points.start, button: 'left', buttons: 1, modifiers: 2, clickCount: 1 });
    await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', ...points.end, button: 'left', buttons: 1, modifiers: 2 });
    await cdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', ...points.end, button: 'left', buttons: 0, modifiers: 2, clickCount: 1 });
    const latest = () => messages.filter(m => m.type === 'selection.changed').at(-1);
    await waitFor(() => latest()?.text?.includes('Service: fixture.ts:1-2'));
    const expected = 'Root       \n           \n`-- Service\nAssociated Code Entities:\nService: fixture.ts:1-2';
    assert.equal(latest().text, expected);
    const response = await get(); assert.equal(response.status, 200); assert.equal(await response.text(), expected);
    const key = async (key, code, windowsVirtualKeyCode) => {
      await cdp.send('Input.dispatchKeyEvent', { type: 'keyDown', key, code, windowsVirtualKeyCode });
      await cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', key, code, windowsVirtualKeyCode });
    };
    await key('c', 'KeyC', 67);
    await waitFor(async () => await evaluate(cdp, 'navigator.clipboard.readText()') === expected);
    await key('Escape', 'Escape', 27);
    if (latest().text !== null) await key('Escape', 'Escape', 27);
    await waitFor(() => latest()?.text === null);
    assert.equal((await get()).status, 204);
    await cdp.send('Page.reload', { ignoreCache: true });
    await waitFor(() => messages.some(m => m.type === 'canvas.disconnected'));
    await waitForSelector(cdp, '[data-grid-box="overview"]');
    assert.equal((await get()).status, 503, 'Old connection must not silently rebind after reload');
    const closed = once(socket, 'close'); socket.close(); await closed;
    await waitFor(async () => (await get()).status === 404);
    console.log('PASS: real Ctrl-drag, preserved spaces/blank lines/code refs, clipboard = WebSocket = GET, clear = 204, reload invalidates binding, disconnect cleanup');
    } catch (error) { console.error('Browser assertion failed:', error); throw error; }
  });
} finally {
  socket?.terminate();
  if (server?.pid) { try { process.kill(-server.pid, 'SIGTERM'); } catch {} }
  await rm(root, { recursive: true, force: true });
}
