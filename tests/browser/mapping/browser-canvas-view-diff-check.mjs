// Run after npm run build. Seeds only a disposable project; interactions use CDP events.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir, homedir } from 'node:os';
import { createServer } from 'node:net';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { tsImport } from 'tsx/esm/api';
import { seedMappingFixture } from '../support/browser-mapping-fixture.mjs';
const { evaluate, waitFor, waitForSelector, withHeadlessBrowser, captureScreenshot } = await import(pathToFileURL(path.join(homedir(), '.codex/skills/front-end/browser-test.mjs')).href);
const { MappingDocumentController } = await tsImport('../../../domain/mapping/workspace/mappingDocumentController.ts', import.meta.url);
const { documentFromHistory } = await tsImport('../../../domain/core/diagrams/canvasHistory.ts', import.meta.url);
const { initialCanvasState } = await tsImport('../../../domain/mapping/workspace/mappingWorkspace.ts', import.meta.url);
const { revisionFixture } = await tsImport('../../support/diagramRevisions.ts', import.meta.url);
const { diagramContentNodes } = await tsImport('../../../domain/core/diagrams/diagramContentNodes.ts', import.meta.url);
const root = await mkdtemp(path.join(tmpdir(), 'canvas-view-diff-'));
let server;
try {
  await seedMappingFixture(root, { ascii: 'Root\n|-- !! Original !!\n`-- Deleted leaf', nodes: [] });
  const catalogPath = path.join(root, '.diagrams/representations/catalog.json');
  const catalog = JSON.parse(await readFile(catalogPath, 'utf8')), revision = catalog.revisions['revision-overview'];
  const history = revision.content.history;
  history.snapshots[history.headId].view = initialCanvasState();
  const c = new MappingDocumentController(documentFromHistory(history), history.snapshots[history.headId].view, 0, undefined, undefined, history);
  const edit = (...ops) => c.applyUpdate(c.getSnapshot().version, ops);
  const command = input => c.canvasView(c.getSnapshot().version, input);
  edit({ method: 'diagram-create', id: 'removed', ascii: 'Removed diagram', structureKind: 'tree', position: { column: 0, row: 7 } });
  edit({ method: 'setPresentation', nodeId: 'grid:overview', settings: {
    markerRules: [{ id: 'review', marker: '!!' }], markerStyles: { review: { color: 'blue', underline: true } },
    highlights: [{ id: 'original-text', color: 'yellow', revisionId: c.getSnapshot().document.scene.contents.overview.revisionId,
      textRange: { startLine: 2, endLine: 2, startColumn: 8, endColumn: 15 } }]
  } });
  command({ operation: 'start', name: 'Content changes' });
  const service = revisionFixture();
  const base = c.exportRevisions([c.getSnapshot().document.scene.contents.overview.revisionId])[0];
  service.importRevision(base);
  const nodes = diagramContentNodes(base.diagram.content);
  const next = service.revise(base.id, { kind: 'replace', input: { ascii: 'Root\n|-- !! Renamed !!\n`-- Added child', structureKind: 'tree' },
    nodeCorrespondence: Object.fromEntries(nodes.slice(0, 2).map(n => [base.nodeRefs[n.id], n.line])) });
  edit({ method: 'diagram-revision-apply', nodeId: 'grid:overview', expectedRevisionId: base.id, revision: next.revision },
    { method: 'delete-diagrams', nodeIds: ['grid:removed'] },
    { method: 'diagram-create', id: 'added', ascii: 'Added diagram', structureKind: 'tree', position: { column: 0, row: 3 } });
  command({ operation: 'stop' });
  command({ operation: 'start', name: 'Variant selection' });
  const alternative = service.revise(next.revision.id, { kind: 'replace', input: { ascii: 'Root\n|-- !! Variant label !!\n`-- Added child', structureKind: 'tree' },
    nodeCorrespondence: Object.fromEntries(diagramContentNodes(next.diagram.content).map(n => [next.revision.nodeRefs[n.id], n.line])) }).revision;
  const variant = { id: 'alternative', name: 'Alternative', diagramId: base.diagramId, contentId: base.diagram.id, ownerNodeId: 'root',
    baseRevisionId: next.revision.id, headRevisionId: alternative.id, revisionIds: [alternative.id], decisions: {}, prompt: '' };
  edit({ method: 'variant-store', nodeId: 'grid:overview', expectedRevisionId: next.revision.id, variants: [{ variant, revision: alternative }] },
    { method: 'variant-select', nodeId: 'grid:overview', ownerNodeId: 'root', contextVariantId: null, variantId: variant.id });
  command({ operation: 'stop' });
  edit({ method: 'variant-select', nodeId: 'grid:overview', ownerNodeId: 'root', contextVariantId: null, variantId: null },
    { method: 'replace', nodeId: 'grid:overview', ascii: 'Live content stays here', structureKind: 'tree' });
  revision.content.history = c.exportHistory();
  await writeFile(catalogPath, JSON.stringify(catalog));
  const port = await new Promise(resolve => { const s = createServer(); s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => resolve(p)); }); });
  const url = `http://127.0.0.1:${port}`;
  server = spawn(process.execPath, ['scripts/dev/start-server.mjs', 'preview', '--http', '--pi', '--host', '127.0.0.1', '--port', String(port), '--strictPort'],
    { detached: true, env: { ...process.env, NEW_DIAGRAM_PROJECT_ROOT: root, NEW_DIAGRAMS_DIR: path.join(root, '.diagrams'), NEW_DIAGRAM_AGENT: 'fake' }, stdio: ['ignore', 'ignore', 'pipe'] });
  let errors = ''; server.stderr.on('data', chunk => { errors += chunk; });
  await waitFor(async () => (await fetch(url).catch(() => null))?.ok, { timeoutMs: 20000 }).catch(e => { throw Error(`${e}\n${errors}`); });
  await withHeadlessBrowser({ url: `${url}/mapping?diagram=representation-overview`, width: 1600, height: 1000,
    chromePath: process.env.CHROME_PATH, arguments: ['--no-sandbox', '--disable-gpu'] }, async ({ cdp }) => {
    const browserErrors = [];
    await cdp.send('Runtime.enable'); await cdp.send('Page.enable');
    cdp.on('Runtime.exceptionThrown', event => browserErrors.push(event.exceptionDetails));
    cdp.on('Page.javascriptDialogOpening', () => void cdp.send('Page.handleJavaScriptDialog', { accept: true }));
    const click = async (selector, text) => {
      const point = await evaluate(cdp, `(() => { const e=[...document.querySelectorAll(${JSON.stringify(selector)})].find(e=>!${JSON.stringify(text)} || e.textContent.trim()===${JSON.stringify(text)});
        if(!e || e.disabled) throw Error('Unavailable '+${JSON.stringify(text ?? selector)}); const r=e.getBoundingClientRect(), p={x:r.x+r.width/2,y:r.y+r.height/2};
        if(!e.contains(document.elementFromPoint(p.x,p.y))) throw Error('Occluded '+${JSON.stringify(text ?? selector)}); return p; })()`);
      await cdp.send('Input.dispatchMouseEvent', { type: 'mousePressed', ...point, button: 'left', buttons: 1, clickCount: 1 });
      await cdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', ...point, button: 'left', buttons: 0, clickCount: 1 });
    };
    const key = async key => { await cdp.send('Input.dispatchKeyEvent', { type: 'keyDown', key, code: key, windowsVirtualKeyCode: { Home: 36, End: 35, Enter: 13 }[key] }); await cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', key }); };
    const live = () => evaluate(cdp, "[...document.querySelectorAll('[data-native-node] .mapping-poc-ascii')].map(e=>e.textContent).join('\\n')");
    const preview = () => evaluate(cdp, "document.querySelector('[data-canvas-view-diff]')?.textContent ?? ''");
    const toggle = '.canvas-view-diff-toggle input';
    const open = async () => { await waitForSelector(cdp, '[aria-label="Explorer mode"]'); await click('[aria-label="Explorer mode"] button', 'Canvas'); await waitForSelector(cdp, toggle); };
    await open();
    await waitFor(async () => (await live()).includes('Live content stays here'));
    const original = await live();
    const liveBounds = () => evaluate(cdp, `[...document.querySelectorAll('.mapping-document-view:not([hidden]) [data-grid-box]')].filter(e=>['overview','added'].includes(e.dataset.gridBox)).map(e=>{const r=e.getBoundingClientRect();return {id:e.dataset.gridBox,x:r.x,y:r.y,width:r.width};})`);
    const unzoomed = await liveBounds();
    await cdp.send('Input.dispatchMouseEvent', { type: 'mouseWheel', x: 850, y: 550, deltaY: 160, deltaX: 0, modifiers: 2 });
    await waitFor(async () => (await liveBounds())[0].width !== unzoomed[0].width);
    const positions = await liveBounds();
    await click(toggle);
    await waitForSelector(cdp, '[data-canvas-view-diff] [data-diff-status="modified"]');
    assert.match(await preview(), /Original/); assert.match(await preview(), /Renamed/);
    await waitFor(async () => await evaluate(cdp, `(() => { const expected=${JSON.stringify(positions.filter(p => p.id === 'overview'))}; return expected.every(p=>{const e=document.querySelector('[data-canvas-view-diff] [data-grid-box="'+p.id+'"]'); if(!e)return false; const r=e.getBoundingClientRect(); return Math.abs(r.x-p.x)<1 && Math.abs(r.y-p.y)<1;}); })()`), { message: 'Diff must preserve the live camera and the unmoved diagram origin' });
    assert.match(await preview(), /Deleted leaf/); assert.match(await preview(), /Added child/);
    assert.match(await preview(), /Removed diagram/); assert.match(await preview(), /Added diagram/);
    assert.equal(await evaluate(cdp, "document.querySelectorAll('.is-removed-diagram').length"), 1);
    assert.equal(await evaluate(cdp, "document.querySelectorAll('.is-added-diagram').length"), 1);
    assert.equal(await live(), original);
    const markerStyles = await evaluate(cdp, `(() => { const e = document.querySelector('[data-diff-diagram=overview] [data-source-side=before] [data-marker-rule=review]');
      if(!e) throw Error('Missing baseline marker'); const s = getComputedStyle(e); return {color:s.color, background:s.backgroundColor, underline:s.textDecorationLine}; })()`);
    assert.deepEqual(markerStyles, { color: 'rgb(96, 165, 250)', background: 'rgba(250, 204, 21, 0.333)', underline: 'underline' });
    const diffBounds = () => evaluate(cdp, `[...document.querySelectorAll('[data-canvas-view-diff] [data-grid-box]')].filter(e=>['overview','added','removed'].includes(e.dataset.gridBox)).map(e=>{const r=e.getBoundingClientRect();return {id:e.dataset.gridBox,x:r.x,y:r.y,width:r.width,height:r.height};})`);
    const prepared = await diffBounds();
    assert.ok(prepared.find(p=>p.id==='added').x > positions.find(p=>p.id==='added').x, 'Expanded diff must move the colliding neighbor');
    for (let i=0;i<prepared.length;i++) for (const b of prepared.slice(i+1)) {
      const a=prepared[i]; assert.ok(!(a.x<b.x+b.width && b.x<a.x+a.width && a.y<b.y+b.height && b.y<a.y+a.height), `${a.id} overlaps ${b.id}`);
    }
    const overviewText = () => evaluate(cdp, "document.querySelector('[data-diff-diagram=overview] pre').textContent");
    await click('[data-diff-diagram=overview] button', 'Regular');
    await waitFor(async () => !(await overviewText()).includes('Original'));
    assert.match(await overviewText(), /Renamed/);
    assert.deepEqual(await diffBounds(), prepared, 'Regular mode must keep the frozen layout');
    assert.equal(await evaluate(cdp, "document.querySelector('[data-diff-diagram=added] button[aria-pressed=true]').textContent"), 'Diff');
    await click('[data-diff-diagram=overview] button', 'Diff');
    await waitFor(async () => (await overviewText()).includes('Original'));
    assert.deepEqual(await diffBounds(), prepared, 'Diff mode must keep the frozen layout');
    await click('[data-canvas-view-diff] [aria-label="Collapse subtree Root"]');
    await waitForSelector(cdp, '[data-canvas-view-diff] [aria-label="Expand subtree Root"]');
    assert.deepEqual(await diffBounds(), prepared, 'Folding must retain the prepared layout');
    await click('[data-canvas-view-diff] [aria-label="Expand subtree Root"]');
    await waitForSelector(cdp, '[data-canvas-view-diff] [aria-label="Collapse subtree Root"]');
    assert.deepEqual(await diffBounds(), prepared, 'Expanding must retain the prepared layout');
    await captureScreenshot(cdp, { output: process.env.CANVAS_VIEW_DIFF_SCREENSHOT_PATH ?? path.join(root, 'diff.png') });
    console.log('PASS initial diff; selecting second view');
    await click('[aria-label="Saved canvas view"]'); await key('End'); await key('Enter');
    await waitFor(async () => (await preview()).includes('Variant label'));
    assert.match(await preview(), /Renamed/);
    console.log('PASS selected variant; closing preview');
    await click('[data-canvas-view-diff] button', 'Close diff');
    await waitFor(async () => !await evaluate(cdp, "!!document.querySelector('[data-canvas-view-diff]')"));
    assert.equal(await evaluate(cdp, `document.querySelector('${toggle}').checked`), false);
    assert.equal(await live(), original);
    console.log('PASS live canvas restored; reloading');
    const beforeReload = await evaluate(cdp, 'performance.timeOrigin');
    await cdp.send('Page.reload', { ignoreCache: true });
    await waitFor(async () => { try { return await evaluate(cdp, `performance.timeOrigin !== ${beforeReload} && document.readyState === 'complete'`); } catch { return false; } });
    await open(); await click(toggle);
    await waitForSelector(cdp, '[data-canvas-view-diff] [data-diff-status="modified"]');
    assert.match(await preview(), /Original/); assert.match(await preview(), /Renamed/);
    await click(toggle);
    await waitFor(async () => !await evaluate(cdp, "!!document.querySelector('[data-canvas-view-diff]')"));
    assert.equal(await live(), original);
    await click(toggle);
    await waitForSelector(cdp, '[data-canvas-view-diff]');
    await click('.canvas-view-controls button', 'Apply view');
    await waitFor(async () => !await evaluate(cdp, "!!document.querySelector('[data-canvas-view-diff]')"));
    await waitFor(async () => (await live()).includes('Renamed'));
    await click('.mapping-grid-tools button', 'Undo');
    await waitFor(async () => (await live()).includes('Live content stays here'));
    assert.equal(await live(), original);
    assert.deepEqual(browserErrors, []);
    console.log('PASS saved view diff: before/after colors, added/deleted diagrams, selected variants, view switching, collision-free frozen layout, collapse/expand and live camera, toggle/close, reload, unchanged live canvas and apply/undo');
  });
} finally {
  if (server) { try { process.kill(-server.pid, 'SIGTERM'); } catch {} }
  await rm(root, { recursive: true, force: true });
}
