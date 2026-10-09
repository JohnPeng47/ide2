import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, rm, readFile, writeFile } from 'node:fs/promises';
import { homedir, tmpdir } from 'node:os';
import { createServer } from 'node:net';
import { once } from 'node:events';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { WebSocket } from 'ws';
import { seedMappingFixture } from '../support/browser-mapping-fixture.mjs';
const { evaluate, waitFor, waitForSelector, withHeadlessBrowser, captureScreenshot } = await import(pathToFileURL(path.join(homedir(), '.codex/skills/front-end/browser-test.mjs')).href);
import { sceneFromRevision } from '../../../domain/core/diagrams/projectDiagramCanvas.ts';
import { RevisionedDiagramService } from '../../../domain/core/diagrams/diagramService.ts';
import { canvasSaveFixture } from '../../support/mappingDiagram.ts';
const root = await mkdtemp(path.join(tmpdir(), 'live-canvas-'));
let server, socket, secondSocket;
try {
  await seedMappingFixture(root, { ascii: 'Root\n\n`-- Service', nodes: [{ id: 'service', label: 'Service', head: { line: 3, startColumn: 5, endColumn: 11 },
    sourceRanges: [{ path: 'fixture.ts', startLine: 1, endLine: 2 }] }] });
  const catalogPath = path.join(root, '.diagrams/representations/catalog.json');
  const catalog = JSON.parse(await readFile(catalogPath, 'utf8'));
  const scene = sceneFromRevision(catalog.revisions['revision-overview']);
  const diagrams = new RevisionedDiagramService();
  scene.contents = Object.fromEntries(Object.entries(scene.contents).map(([id, diagram]) => [id, diagrams.create({ id, revision: 0,
    ascii: diagram.content.ascii, structureKind: diagram.content.structure.kind, source: diagram.sourceContext.binding,
    evidence: diagram.sourceContext.evidence, mappings: diagram.sourceContext.mappings }).diagram]));
  scene.contents.other = new RevisionedDiagramService().create({ id: 'other', revision: 0, ascii: 'Other diagram\n|-- Worker\n`-- Tail', structureKind: 'tree' }).diagram;
  scene.root.children.push({ id: 'other', kind: 'diagram', contentId: 'other', collapsed: false, position: { column: 30, row: 0 } });
  catalog.revisions['revision-overview'].content = { kind: 'canvas-history', history: canvasSaveFixture({ name: 'Fixture', scene, edges: [] }).history };
  await writeFile(catalogPath, JSON.stringify(catalog));
  const port = await new Promise(resolve => { const s = createServer(); s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => resolve(p)); }); });
  const url = `http://127.0.0.1:${port}`;
  server = spawn(process.execPath, ['scripts/dev/start-server.mjs', '--http', 'preview', '--host', '127.0.0.1', '--port', String(port), '--strictPort'],
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
    assert.ok(canvas.stableWorkspaceId, 'The localhost browser must advertise a protected stable tab identity');
    const statusText = () => evaluate(cdp, 'document.querySelector(".mapping-agent-status")?.textContent.trim()');
    await waitFor(async () => await statusText() === 'No agents connected');
    socket = new WebSocket(`${url.replace('http:', 'ws:')}/api/mapping/live`);
    const messages = []; socket.on('message', raw => messages.push(JSON.parse(raw.toString())));
    await once(socket, 'open');
    let attached;
    await waitFor(async () => {
      attached = messages.find(m => m.type === 'attached');
      if (!attached) socket.send(JSON.stringify({ type: 'attach', protocolVersion: 2, workspaceInstanceId: canvas.canvasId, documentId: canvas.documents[0].documentId, includeContext: true }));
      return attached;
    });
    assert.equal(attached.context.apiFormatVersion, 1);
    for (const node of attached.context.nodes) {
      assert.equal(node.apiFormatVersion, 1);
      assert.ok(!('contentNodes' in node));
      assert.ok(!node.diagram || !('content' in node.diagram));
      if (node.content) assert.ok(node.content.structure.nodes);
    }
    await waitFor(async () => await statusText() === '1 agent connected');
    secondSocket = new WebSocket(`${url.replace('http:', 'ws:')}/api/mapping/live`);
    await once(secondSocket, 'open');
    const secondAttached = once(secondSocket, 'message');
    secondSocket.send(JSON.stringify({ type: 'attach', protocolVersion: 2, workspaceInstanceId: canvas.canvasId, documentId: canvas.documents[0].documentId }));
    assert.equal(JSON.parse(String((await secondAttached)[0])).type, 'attached');
    await waitFor(async () => await statusText() === '2 agents connected');
    const statusBounds = await evaluate(cdp, `(() => {
      const status = document.querySelector('.mapping-agent-status'), actions = document.querySelector('.mapping-workspace-actions button');
      const a = status.getBoundingClientRect(), b = actions.getBoundingClientRect();
      return { left: a.left, right: a.right, buttonLeft: b.left, color: getComputedStyle(status).color, state: status.dataset.state };
    })()`);
    assert.equal(statusBounds.state, 'connected');
    assert.ok(statusBounds.left >= 0 && statusBounds.right < statusBounds.buttonLeft);
    if (process.env.LIVE_CANVAS_SCREENSHOT) await captureScreenshot(cdp, { output: process.env.LIVE_CANVAS_SCREENSHOT });
    secondSocket.close();
    await waitFor(async () => await statusText() === '1 agent connected');
    const get = () => fetch(`${url}/api/mapping/live/connections/${attached.connectionId}/selection`);
    assert.deepEqual(attached.regions, []); assert.deepEqual((await (await get()).json()).regions, []);
    const regions = new Map(); let diagramIds = attached.diagramIds ?? []; let sequence = attached.sequence; let consumed = messages.indexOf(attached) + 1;
    const sync = () => {
      for (const message of messages.slice(consumed)) if (message.type === 'selection.delta') {
        assert.equal(message.baseSequence, sequence);
        if (message.diagramIds !== undefined) diagramIds = message.diagramIds;
        message.removed.forEach(id => regions.delete(id));
        message.upserted.forEach(region => regions.set(region.id, region));
        sequence = message.sequence;
      }
      consumed = messages.length; return [...regions.values()];
    };
    const points = await evaluate(cdp, `(() => {
      const pre=document.querySelector('.mapping-document-view:not([hidden]) [data-native-node="grid:overview"] .mapping-poc-ascii');
      const r=pre.getBoundingClientRect(), scale=r.width/pre.offsetWidth;
      const probe=document.querySelector('.mapping-poc-cell-probe');
      const w=probe.offsetWidth/10, h=parseFloat(getComputedStyle(pre).lineHeight);
      return { start:{x:r.x+.3*w*scale,y:r.y+.3*h*scale},end:{x:r.x+10.3*w*scale,y:r.y+2.3*h*scale} };
    })()`);
    await cdp.send('Input.dispatchMouseEvent', { type: 'mousePressed', ...points.start, button: 'left', buttons: 1, modifiers: 2, clickCount: 1 });
    await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', ...points.end, button: 'left', buttons: 1, modifiers: 2 });
    await cdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', ...points.end, button: 'left', buttons: 0, modifiers: 2, clickCount: 1 });
    await waitFor(() => sync().some(region => region.text.includes('Service: fixture.ts:1-2')));
    const expected = 'Root       \n           \n`-- Service\nAssociated Code Entities:\nService: fixture.ts:1-2';
    assert.equal(sync()[0].text, expected);
    const response = await get(); assert.equal(response.status, 200); assert.equal((await response.json()).regions[0].text, expected);
    assert.equal((await fetch(`${url}/api/mapping/live/connections/${attached.connectionId}/selection`, { headers: { 'If-None-Match': response.headers.get('etag') } })).status, 304);
    const key = async (key, code, windowsVirtualKeyCode) => {
      await cdp.send('Input.dispatchKeyEvent', { type: 'keyDown', key, code, windowsVirtualKeyCode });
      await cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', key, code, windowsVirtualKeyCode });
    };
    await key('c', 'KeyC', 67);
    await waitFor(async () => await evaluate(cdp, 'navigator.clipboard.readText()') === expected);
    // Leave the first region retained, then open another through the public UI.
    const click = async selector => {
      let point;
      await waitFor(async () => {
        point = await evaluate(cdp, `(() => { const el = document.querySelector(${JSON.stringify(selector)}); if (!el) return null;
          const r = el.getBoundingClientRect(), x = r.x + r.width / 2, y = r.y + r.height / 2;
          return el.contains(document.elementFromPoint(x, y)) ? { x, y } : null; })()`);
        return point;
      });
      await cdp.send('Input.dispatchMouseEvent', { type: 'mousePressed', ...point, button: 'left', buttons: 1, clickCount: 1 });
      await cdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', ...point, button: 'left', buttons: 0, clickCount: 1 });
    };
    await waitFor(async () => await evaluate(cdp, 'document.querySelectorAll("[data-code-panel]").length === 0'));
    assert.equal(sync().length, 1);
    const beforeOutside = sync().map(region => region.id);
    const outside = await evaluate(cdp, `(()=>{const r=document.querySelector('[data-grid-box="other"]').getBoundingClientRect();return{x:r.right+20,y:r.bottom+30}})()`);
    await cdp.send('Input.dispatchMouseEvent', {type:'mousePressed',...outside,button:'left',buttons:1,clickCount:1});
    await cdp.send('Input.dispatchMouseEvent', {type:'mouseReleased',...outside,button:'left',buttons:0,clickCount:1});
    assert.deepEqual((await (await get()).json()).regions.map(region => region.id), beforeOutside);
    assert.equal(await evaluate(cdp, 'document.querySelectorAll("[data-selection-active=true]").length'), 1);
    await click('[data-content-node-id][data-display-node-id="grid:overview"]');
    await waitFor(() => sync().length === 2);
    const ids = sync().map(region => region.id);
    const beforeRemoval = messages.length;
    await click('[aria-label="Remove selection"]');
    await waitFor(() => sync().length === 1);
    const removal = messages.slice(beforeRemoval).find(message => message.type === 'selection.delta' && message.removed.length);
    assert.ok(removal); assert.deepEqual(removal.upserted, []);
    assert.ok(ids.includes(removal.removed[0]));
    await click('[aria-label="Remove selection"]');
    await waitFor(() => sync().length === 0);
    assert.deepEqual((await (await get()).json()).regions, []);
    const mouse = (type, p, modifiers = 2) => cdp.send('Input.dispatchMouseEvent', { type, ...p, button: 'left', buttons: type === 'mouseReleased' ? 0 : 1, modifiers, clickCount: 1 });
    const box = id => evaluate(cdp, `(() => { const r = document.querySelector('[data-grid-box="${id}"]').getBoundingClientRect();
      return { left:r.left, top:r.top, right:r.right, bottom:r.bottom }; })()`);
    const a = await box('overview'), b = await box('other');
    const start = { x: a.left - 6, y: a.top - 6 }, full = { x: a.right + 6, y: a.bottom + 6 };
    // Shift no longer owns selection.
    await mouse('mousePressed', start, 8); await mouse('mouseMoved', full, 8); await mouse('mouseReleased', full, 8);
    assert.equal(sync().length, 0); assert.deepEqual(diagramIds, []);
    // A canceled Ctrl gesture leaves both selection and the wire unchanged.
    const beforeCancel = messages.length;
    await mouse('mousePressed', start); await mouse('mouseMoved', full);
    await waitForSelector(cdp, '[data-diagram-selection-preview]');
    assert.equal(messages.slice(beforeCancel).filter(m => m.type === 'selection.delta').length, 0);
    await key('Escape', 'Escape', 27); await mouse('mouseReleased', full);
    await waitFor(async () => !await evaluate(cdp, '!!document.querySelector("[data-selection-preview]")'));
    assert.equal(sync().length, 0); assert.deepEqual(diagramIds, []);
    // Select a partial region first, then replace it with the whole diagram.
    await mouse('mousePressed', points.start); await mouse('mouseMoved', points.end); await mouse('mouseReleased', points.end);
    await waitFor(() => sync().some(region => region.text === expected));
    const oldIds = sync().map(region => region.id);
    const promotionStart = messages.length;
    await mouse('mousePressed', start); await mouse('mouseMoved', full);
    // Promotion remains sticky when the pointer comes back inside the box.
    const shrunk = { x: a.left + 4, y: a.top + 4 };
    await mouse('mouseMoved', shrunk); await mouse('mouseReleased', shrunk);
    await waitFor(() => { sync(); return diagramIds.includes('grid:overview'); });
    assert.deepEqual(sync(), []);
    const promotion = messages.slice(promotionStart).find(m => m.diagramIds?.includes('grid:overview'));
    assert.deepEqual(promotion.upserted, []); assert.deepEqual(promotion.removed.sort(), oldIds.sort());
    assert.deepEqual((await (await get()).json()).diagramIds, ['grid:overview']);
    assert.ok(attached.context.nodes.some(node => node.id === diagramIds[0]));
    await key('Escape', 'Escape', 27);
    await waitFor(() => { sync(); return !diagramIds.length; });
    assert.deepEqual(sync(), [], 'Deselecting a diagram must not resurrect its old regions');
    // One marquee may include a whole diagram and only part of a second diagram.
    const mixedEnd = { x: b.left + (b.right - b.left) * .45, y: b.bottom + 6 };
    await mouse('mousePressed', start); await mouse('mouseMoved', mixedEnd); await mouse('mouseReleased', mixedEnd);
    await waitFor(() => { const r = sync(); return diagramIds.includes('grid:overview') && r.some(region => region.sourceBoxId === 'other'); });
    assert.equal(sync().length, 1);
    assert.ok(sync()[0].text.includes('Associated Code Entities:'));
    await key('c', 'KeyC', 67);
    await waitFor(async () => await evaluate(cdp, 'navigator.clipboard.readText()') === sync()[0].text);
    assert.equal(await evaluate(cdp, 'document.querySelector("[data-grid-box=overview]").dataset.diagramSelected'), 'true');
    // Whole-diagram gestures use the same membership as regions and the socket snapshot.
    const doubleClickDiagram = async (boxId, toggle) => {
      const point = await evaluate(cdp, `(() => {
        const box = document.querySelector('[data-grid-box="${boxId}"]'), r = box.getBoundingClientRect();
        for (let y = r.top + 3; y < r.bottom; y += 5) for (let x = r.left + 3; x < r.right; x += 5) {
          const target = document.elementFromPoint(x, y);
          if (target?.closest('[data-diagram-canvas]') && !target.closest('[data-content-node-id],button,a,[data-mapping-static-ui],[data-display-node]')) return {x, y};
        }
        throw Error('No exposed diagram background');
      })()`);
      for (const clickCount of [1, 2]) {
        await cdp.send('Input.dispatchMouseEvent', { type: 'mousePressed', ...point, button: 'left', buttons: 1, clickCount, modifiers: toggle ? 2 : 0 });
        await cdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', ...point, button: 'left', clickCount, modifiers: toggle ? 2 : 0 });
      }
    };
    const otherRegionId = sync()[0].id;
    await doubleClickDiagram('overview', true);
    await waitFor(() => { sync(); return diagramIds.length === 0; });
    assert.equal(sync()[0].id, otherRegionId, 'Toggling a diagram preserves unrelated region identity');
    await doubleClickDiagram('overview', true);
    await waitFor(() => { sync(); return diagramIds.includes('grid:overview'); });
    assert.equal(sync()[0].id, otherRegionId);
    await doubleClickDiagram('overview', false);
    await waitFor(() => sync().length === 0);
    assert.deepEqual(diagramIds, ['grid:overview'], 'Plain double-click replaces the entire mixed selection');
    await click('.mapping-grid-tools button:first-child');
    await waitFor(() => sync().some(region => region.id === otherRegionId));
    assert.deepEqual(diagramIds, ['grid:overview'], 'Undo restores the previous mixed collection');
    await click('.mapping-grid-tools button:nth-child(2)');
    await waitFor(() => sync().length === 0);
    assert.deepEqual(diagramIds, ['grid:overview'], 'Redo restores whole-diagram replacement');
    await doubleClickDiagram('overview', true);
    await waitFor(() => { sync(); return diagramIds.length === 0; });
    assert.deepEqual(sync(), [], 'Deselection must not revive replaced regions');
    await mouse('mousePressed', start); await mouse('mouseMoved', mixedEnd); await mouse('mouseReleased', mixedEnd);
    await waitFor(() => { const r = sync(); return diagramIds.includes('grid:overview') && r.some(region => region.sourceBoxId === 'other'); });
    await captureScreenshot(cdp, { output: process.env.LIVE_CANVAS_SELECTION_SCREENSHOT || path.join(root, 'mixed-selection.png') });
    await waitFor(async () => {
      const value = await fetch(`${url}/api/mapping/workspace`).then(r => r.json());
      const workspace = value.workspace ?? value;
      return workspace.documents?.some(doc => doc.canvas.selection.items.some(item => !item.region && item.displayNodeId === 'grid:overview'));
    });
    await cdp.send('Page.reload', { ignoreCache: true });
    await waitFor(() => messages.some(m => m.type === 'canvas.disconnected'));
    await waitForSelector(cdp, '[data-grid-box="overview"]');
    await waitFor(async () => await statusText() === 'No agents connected');
    let refreshed;
    await waitFor(async () => {
      const descriptors = await fetch(`${url}/api/mapping/agent/canvases`).then(r => r.json());
      const matches = descriptors.filter(value => value.stableWorkspaceId === canvas.stableWorkspaceId);
      refreshed = matches.length === 1 && matches[0].canvasId !== canvas.canvasId ? matches[0] : undefined;
      return refreshed?.documents.length;
    });
    assert.equal(refreshed.projectId, canvas.projectId);
    assert.deepEqual(refreshed.documents, canvas.documents);
    assert.equal((await get()).status, 503, 'Old connection must not silently rebind after reload');
    const closed = once(socket, 'close'); socket.close(); await closed;
    await waitFor(async () => (await get()).status === 404);
    // An opener-created tab copies sessionStorage. It must acquire a new stable
    // identity instead of competing with the original tab's runtime ownership.
    await cdp.send('Runtime.evaluate', { expression: 'window.open(location.href, "_blank")', userGesture: true });
    let duplicate;
    await waitFor(async () => {
      duplicate = (await fetch(`${url}/api/mapping/agent/canvases`).then(r => r.json()))
        .find(value => value.stableWorkspaceId !== canvas.stableWorkspaceId && value.documents.length);
      return duplicate;
    });
    assert.ok(duplicate.stableWorkspaceId);
    assert.equal(duplicate.projectId, canvas.projectId);
    console.log('PASS: agent indicator 0 → 1 → 2 → 1 → 0, Ctrl-only mixed selection, sticky diagram promotion, cancellation, double-click replacement/toggling and undo/redo, nodes.list IDs, exact copy payload, multiple regions, removal deltas, conditional GET, reload invalidation, stable tab identity, isolated duplicate identity, disconnect cleanup');
    } catch (error) { console.error('Browser assertion failed:', error); throw error; }
  });
} finally {
  socket?.terminate(); secondSocket?.terminate();
  if (server?.pid) { try { process.kill(-server.pid, 'SIGTERM'); } catch {} }
  await rm(root, { recursive: true, force: true });
}
