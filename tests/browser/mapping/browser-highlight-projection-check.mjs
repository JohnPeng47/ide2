import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, rm, readFile, writeFile } from 'node:fs/promises';
import { tmpdir, homedir } from 'node:os';
import { createServer } from 'node:net';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { seedMappingFixture } from '../support/browser-mapping-fixture.mjs';
import { canvasSaveFixture } from '../../support/mappingDiagram.ts';
import { emptyCanvasDocument } from '../../../domain/core/diagrams/canvasTransfer.ts';
import { RevisionedDiagramService } from '../../../domain/core/diagrams/diagramService.ts';
import { diagramContentNodes } from '../../../domain/core/diagrams/diagramContentNodes.ts';
import { defaultArrowAppearance } from '../../../domain/core/diagrams/diagramConnection.ts';
import { DiagramStore } from '../../../infrastructure/core/persistence/store.ts';
import { initialCanvasState } from '../../../domain/mapping/workspace/mappingWorkspace.ts';
const { evaluate, waitFor, withHeadlessBrowser, captureScreenshot } = await import(pathToFileURL(path.join(homedir(), '.codex/skills/front-end/browser-test.mjs')).href);
const root = await mkdtemp(path.join(tmpdir(), 'highlight-projection-browser-'));
let server;
try {
  await seedMappingFixture(root, { ascii: 'Projection fixture', nodes: [] });
  const catalogPath = path.join(root, '.diagrams/representations/catalog.json');
  const catalog = JSON.parse(await readFile(catalogPath, 'utf8'));
  const document = emptyCanvasDocument(), service = new RevisionedDiagramService();
  const positions = [[0, 0], [55, 5], [18, 26], [80, 40]];
  const names = ['API gateway', 'Worker service', 'Database', 'Not highlighted'];
  document.scene.contents = Object.fromEntries(names.map((name, i) => {
    const id = `d${i}`;
    let diagram = service.create({ id, revision: 0, ascii: `${name}\n|-- Input\n\x60-- Output`, structureKind: 'tree' }).diagram;
    if (i < 3) diagram = service.revise(diagram.revisionId, { kind: 'highlights', highlights: [
      { id: `highlight-${i}`, color: ['yellow', 'blue', 'green'][i], ...(i === 1 ? { contentNodeId: diagramContentNodes(diagram.content)[0].id } : {}) }
    ] }).diagram;
    return [id, diagram];
  }));
  document.scene.root.children = names.map((_, i) => ({ id: `d${i}`, kind: 'diagram', contentId: `d${i}`, collapsed: false, position: { column: positions[i][0], row: positions[i][1] } }));
  document.edges = [[0, 1], [1, 2], [0, 3]].map(([a, b], i) => ({ id: `edge-${i}`,
    source: { kind: 'content-node', displayNodeId: `grid:d${a}`, contentNodeId: diagramContentNodes(document.scene.contents[`d${a}`].content)[0].id,
      revisionId: document.scene.contents[`d${a}`].content.revisionId, side: 'auto' },
    target: { kind: 'box', displayNodeId: `grid:d${b}`, side: 'auto' }, appearance: { ...defaultArrowAppearance, label: 'calls' } }));
  catalog.representations['representation-overview'].name = 'Services';
  catalog.revisions['revision-overview'].content = { kind: 'canvas-history', history: canvasSaveFixture({ name: 'Services', scene: document.scene, edges: document.edges }).history };
  // Old checkpoints can dwarf the current scene. Projection must not copy them.
  if (process.env.PROJECTION_MEMORY === '1') {
    const history = catalog.revisions['revision-overview'].content.history;
    const head = history.snapshots[history.headId];
    for (let i = 0; i < 24; i++) {
      const id = `archived-${i}`;
      history.snapshots[id] = { ...head, id, parentId: history.past.at(-1),
        view: { ...head.view, memoryFixture: `${i}:` + 'archived conversation '.repeat(50_000) } };
      history.past.push(id);
    }
    head.parentId = history.past.at(-1);
    head.view = initialCanvasState();
    await writeFile(path.join(root, '.diagrams/mapping-workspace.json'), JSON.stringify({
      schemaVersion: 3, projectId: catalog.projectId, activeDocumentId: 'representation-overview', transfers: [],
      documents: [{ representationId: 'representation-overview', name: 'Services', savedName: 'Services',
        revisionId: 'revision-overview', savedScene: JSON.stringify(document.scene), savedEdges: JSON.stringify(document.edges),
        document, canvas: initialCanvasState(), history }]
    }));
  }
  await writeFile(catalogPath, JSON.stringify(catalog));
  const port = await new Promise(resolve => { const socket = createServer(); socket.listen(0, '127.0.0.1', () => { const { port } = socket.address(); socket.close(() => resolve(port)); }); });
  const url = `http://127.0.0.1:${port}`;
  server = spawn(process.execPath, ['scripts/dev/start-server.mjs', '--http', 'preview', '--host', '127.0.0.1', '--port', String(port), '--strictPort'], {
    cwd: process.cwd(), env: { ...process.env, NEW_DIAGRAM_PROJECT_ROOT: root, NEW_DIAGRAMS_DIR: new DiagramStore(root).storeRoot, NEW_DIAGRAM_AGENT: 'fake' }, stdio: ['ignore', 'ignore', 'pipe']
  });
  let errors = ''; server.stderr.on('data', chunk => { errors += chunk; });
  await waitFor(async () => (await fetch(url).catch(() => null))?.ok, { timeoutMs: 25000 }).catch(error => { throw Error(`${error}\n${errors}`); });
  await withHeadlessBrowser({ url: `${url}/mapping?diagram=representation-overview`, width: 1600, height: 1050, chromePath: process.env.CHROME_PATH,
    arguments: ['--disable-gpu', ...(process.platform === 'linux' ? ['--no-sandbox'] : [])] }, async ({ cdp }) => {
    await cdp.send('Runtime.enable'); await cdp.send('Page.enable');
    cdp.on('Page.javascriptDialogOpening', () => cdp.send('Page.handleJavaScriptDialog', { accept: true }));
    const exceptions = []; cdp.on('Runtime.exceptionThrown', e => exceptions.push(e.exceptionDetails.text));
    const click = async (selector, text) => {
      let point;
      await waitFor(async () => {
        point = await evaluate(cdp, `(() => {
          const el = [...document.querySelectorAll(${JSON.stringify(selector)})].find(el => !el.disabled && !el.closest('[inert]') && ${text ? `el.textContent.trim() === ${JSON.stringify(text)}` : 'true'});
          if (!el) return null;
          const r = el.getBoundingClientRect(), p = { x: r.x + r.width / 2, y: r.y + r.height / 2 };
          return r.width && r.height && el.contains(document.elementFromPoint(p.x, p.y)) ? p : null;
        })()`); return !!point;
      }, { timeoutMs: 15000 });
      await cdp.send('Input.dispatchMouseEvent', { type: 'mousePressed', ...point, button: 'left', buttons: 1, clickCount: 1 });
      await cdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', ...point, button: 'left', clickCount: 1 });
    };
    const key = async (key, code, windowsVirtualKeyCode, modifiers = 0) => {
      await cdp.send('Input.dispatchKeyEvent', { type: 'keyDown', key, code, windowsVirtualKeyCode, modifiers });
      await cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', key, code, windowsVirtualKeyCode });
    };
    const persisted = async predicate => {
      let workspace;
      await waitFor(async () => { const value = await fetch(url + '/api/mapping/workspace').then(r => r.json()); workspace = value?.workspace ?? value; return !!workspace && predicate(workspace); }, { timeoutMs: process.env.PROJECTION_MEMORY === '1' ? 60000 : 15000 }).catch(async error => {
        console.error(await evaluate(cdp, `document.body.innerText.slice(-3000)`)); throw error;
      });
      return workspace;
    };
    const child = workspace => workspace.documents.find(d => d.parentCanvasId === 'representation-overview');
    const positionsOf = doc => doc.document.scene.root.children.map(b => b.position);
    await click('[aria-label="Explorer mode"] button', 'Canvas'); await click('[aria-label="Canvas panels"] button', 'Actions');
    assert.equal(await evaluate(cdp, `[...document.querySelectorAll('.mapping-explorer-tabs button')].some(b => b.textContent === 'LLMs')`), false);
    await waitFor(() => evaluate(cdp, `!!document.querySelector('.mapping-canvas-actions button:not(:disabled)')`));
    if (process.env.PROJECTION_MEMORY === '1') await waitFor(() => evaluate(cdp,
      `!!document.querySelector('.mapping-document-view:not([hidden]) button[title="Undo (Ctrl+Z)"]:not(:disabled)')`));
    await waitFor(() => evaluate(cdp, `!!document.querySelector('.mapping-document-view:not([hidden]) [data-grid-box]')`));
    await evaluate(cdp, `void (window.__projectionSourceView = document.querySelector('.mapping-document-view:not([hidden])'))`);
    await cdp.send('HeapProfiler.collectGarbage');
    const heapBefore = (await cdp.send('Runtime.getHeapUsage')).usedSize;
    let heapPeak = heapBefore, sampling = false;
    const heapTimer = setInterval(async () => {
      if (sampling) return;
      sampling = true;
      try { heapPeak = Math.max(heapPeak, (await cdp.send('Runtime.getHeapUsage')).usedSize); } catch {}
      finally { sampling = false; }
    }, 50);
    let ws;
    try {
    await click('.mapping-canvas-actions button', 'Project Highlights');
    ws = await persisted(w => w?.documents?.some(d => d.parentCanvasId === 'representation-overview'));
    await waitFor(() => evaluate(cdp, `!!document.querySelector('.projection-layout-panel')`));
    } finally { clearInterval(heapTimer); }
    const retainedSource = await evaluate(cdp, 'window.__projectionSourceView.isConnected');
    await evaluate(cdp, 'delete window.__projectionSourceView');
    await cdp.send('HeapProfiler.collectGarbage');
    console.log('Projection memory:', JSON.stringify({ heapBeforeMB: heapBefore / 1e6, heapPeakMB: heapPeak / 1e6,
      heapAfterMB: (await cdp.send('Runtime.getHeapUsage')).usedSize / 1e6, retainedSource }));
    assert.equal(retainedSource, true, 'Projection retains the source editor/session');
    const projectedId = child(ws).representationId;
    const initial = positionsOf(child(ws));
    const layout = child(ws).canvas.projectionLayout;
    assert.deepEqual(layout.settings, { mode: 'compact', centroid: 'mean', attraction: 1, neighbors: 1, fidelity: 1, gap: 8 });
    assert.deepEqual(child(ws).document.scene.contents[layout.placeholderId].content.ascii.split('\n'), Array.from({ length: 35 }, () => ' '.repeat(65)));
    assert.equal(child(ws).document.scene.root.children.length, 4);
    assert.equal(child(ws).document.edges.length, 2);
    assert.deepEqual(ws.documents.find(d => d.representationId === 'representation-overview').document.scene, JSON.parse(JSON.stringify(document.scene)));
    if (process.env.PROJECTION_MEMORY === '1') {
      const archive = ws.documents.find(d => d.representationId === 'representation-overview').history;
      assert.equal(archive.snapshots['archived-0'].view.memoryFixture.length, 'archived conversation '.length * 50_000 + 2);
      assert.ok(archive.past.includes('archived-23'), 'Source undo archive remains available');
    }
    await waitFor(() => evaluate(cdp, `!!document.querySelector('.mapping-canvas-children [data-project-diagram="${projectedId}"]') && !!document.querySelector('.projection-layout-panel')`));
    await click('.mapping-document-view:not([hidden]) [title="Reset zoom and center diagram"]');
    await captureScreenshot(cdp, { output: process.env.PROJECTION_SCREENSHOT || path.join(root, 'projection-default.png') });
    await click('[aria-label="Filter diagrams"]');
    await cdp.send('Input.insertText', { text: 'Highlights' });
    assert.ok(await evaluate(cdp, `!!document.querySelector('[data-project-diagram="representation-overview"]') && !!document.querySelector('.mapping-canvas-children [data-project-diagram="${projectedId}"]')`), 'Filtering a child retains its ancestor');
    await key('a', 'KeyA', 65, 2); await key('Backspace', 'Backspace', 8);
    const rendered = () => evaluate(cdp, `[...document.querySelectorAll('.mapping-document-view:not([hidden]) [data-grid-box]')].filter(e => e.dataset.gridBox !== 'root').map(el => {const r=el.getBoundingClientRect();return {id:el.dataset.gridBox,x:r.x,y:r.y,w:r.width,h:r.height}})`);
    const before = await rendered();
    await click('.projection-layout-presets button', 'Tight');
    ws = await persisted(w => child(w)?.canvas.projectionLayout.settings.attraction === .9);
    assert.notDeepEqual(positionsOf(child(ws)), initial);
    await waitFor(async () => JSON.stringify(await rendered()) !== JSON.stringify(before));
    const compact = await rendered();
    assert.equal(compact.length, 4);
    for (let i = 0; i < compact.length; i++) for (let j = i + 1; j < compact.length; j++) {
      const a = compact[i], b = compact[j];
      assert.ok(a.x + a.w <= b.x || b.x + b.w <= a.x || a.y + a.h <= b.y || b.y + b.h <= a.y);
    }
    await click('.projection-layout-panel input[aria-label="Minimum gap"]');
    await key('End', 'End', 35);
    ws = await persisted(w => child(w)?.canvas.projectionLayout.settings.gap === 20);
    await click('.projection-layout-panel select[aria-label="Layout centroid"]');
    await key('End', 'End', 35); await key('Enter', 'Enter', 13);
    await persisted(w => child(w)?.canvas.projectionLayout.settings.centroid === 'placeholder');
    await click('.projection-layout-presets button', 'Original');
    ws = await persisted(w => child(w)?.canvas.projectionLayout.settings.mode === 'original');
    const originalPositions = positionsOf(child(ws));
    await click('.projection-layout-presets button', 'Default');
    ws = await persisted(w => child(w)?.canvas.projectionLayout.settings.attraction === 1 && child(w)?.canvas.projectionLayout.settings.gap === 8);
    assert.deepEqual(positionsOf(child(ws)), initial);
    await click('.projection-layout-presets button', 'Original');
    await persisted(w => child(w)?.canvas.projectionLayout.settings.mode === 'original');
    await click('.projection-layout-presets button', 'Balanced');
    ws = await persisted(w => child(w)?.canvas.projectionLayout.settings.attraction === .4);
    const savedPositions = positionsOf(child(ws));
    await captureScreenshot(cdp, { output: path.join(root, 'projection-layout.png') });
    console.log('Screenshot captured: projected child, preserved edges, bottom-right layout controls.');
    const previous = await evaluate(cdp, 'performance.timeOrigin');
    await cdp.send('Page.reload', { ignoreCache: true });
    await waitFor(async () => { try { return await evaluate(cdp, `performance.timeOrigin !== ${previous} && !!document.querySelector('.projection-layout-panel input[aria-label="Minimum gap"]')`); } catch { return false; } });
    assert.equal(await evaluate(cdp, 'document.querySelector(\'.projection-layout-panel input[aria-label="Closeness to centroid"]\').value'), '0.4');
    ws = await persisted(w => child(w)?.canvas.projectionLayout.settings.attraction === .4);
    assert.deepEqual(positionsOf(child(ws)), savedPositions);
    assert.ok(await evaluate(cdp, `!!document.querySelector('.mapping-canvas-children [data-project-diagram="${projectedId}"]')`));
    await click('[aria-label="Minimize layout settings"]');
    await waitFor(() => evaluate(cdp, `!!document.querySelector('.projection-layout-panel.is-minimized')`));
    await click('[aria-label="Expand layout settings"]');
    await click('.mapping-document-view:not([hidden]) [title="Reset zoom and center diagram"]');
    await key('z', 'KeyZ', 90, 2);
    ws = await persisted(w => child(w)?.canvas.projectionLayout.settings.mode === 'original');
    assert.deepEqual(positionsOf(child(ws)), originalPositions);
    await key('y', 'KeyY', 89, 2);
    ws = await persisted(w => child(w)?.canvas.projectionLayout.settings.attraction === .4);
    assert.deepEqual(positionsOf(child(ws)), savedPositions);
    // Project again from the child to prove recursive ancestry rather than a flat parent label.
    await click('[aria-label="Explorer mode"] button', 'Canvas'); await click('[aria-label="Canvas panels"] button', 'Actions'); await click('.mapping-canvas-actions button', 'Project Highlights');
    ws = await persisted(w => w.documents.some(d => d.parentCanvasId === projectedId));
    const grandchild = ws.documents.find(d => d.parentCanvasId === projectedId);
    await waitFor(() => evaluate(cdp, `!!document.querySelector('.mapping-canvas-children .mapping-canvas-children [data-project-diagram="${grandchild.representationId}"]')`));
    assert.equal(grandchild.document.scene.root.children.length, 4, 'Reprojection adds one fresh placeholder');
    await click('.mapping-document-view:not([hidden]) [title="Reset zoom and center diagram"]');
    await key('z', 'KeyZ', 90, 2);
    await persisted(w => w.activeDocumentId === projectedId && w.documents.find(d => d.representationId === grandchild.representationId)?.hidden);
    await key('y', 'KeyY', 89, 2);
    await persisted(w => w.activeDocumentId === grandchild.representationId && !w.documents.find(d => d.representationId === grandchild.representationId)?.hidden);
    await waitFor(() => evaluate(cdp, `!!document.querySelector('.projection-layout-panel')`));
    assert.deepEqual(exceptions, []);
    console.log('PASS: exact highlighted subset, internal edges, recursive Explorer ancestry, live presets and sliders, rendered nonoverlap, original reset, persistence, reload, undo/redo, and minimization.');
  });
} finally {
  server?.kill('SIGTERM');
  if (server && server.exitCode === null) await new Promise(resolve => { server.once('exit', resolve); setTimeout(resolve, 3000); });
  await rm(root, { recursive: true, force: true });
}
