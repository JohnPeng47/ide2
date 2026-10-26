// npm run build && node --import tsx tests/browser/mapping/browser-diagram-alternatives-check.mjs
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir, homedir } from 'node:os';
import { createServer } from 'node:net';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { seedMappingFixture } from '../support/browser-mapping-fixture.mjs';
import { DiagramStore } from '../../../infrastructure/core/persistence/store.ts';
import { revisionFixture } from '../../support/diagramRevisions.ts';
import { singleDiagramScene } from '../../../domain/core/diagrams/projectDiagramCanvas.ts';
import { diagramContentNodes } from '../../../domain/core/diagrams/diagramContentNodes.ts';
import { MappingDocumentController } from '../../../domain/mapping/workspace/mappingDocumentController.ts';
import { initialCanvasState } from '../../../domain/mapping/workspace/mappingWorkspace.ts';
const { evaluate, waitFor, waitForSelector, withHeadlessBrowser, captureScreenshot } = await import(pathToFileURL(path.join(homedir(), '.codex/skills/front-end/browser-test.mjs')).href);
const root = await mkdtemp(path.join(tmpdir(), 'diagram-alternatives-'));
let server;
try {
  await seedMappingFixture(root, { ascii: 'Overview', nodes: [] });
  const store = new DiagramStore(root), project = await store.loadProject(), revisions = revisionFixture();
  const ascii = 'Root\n|-- Branch\n|   `-- Original\n`-- Other';
  const base = revisions.create({ id: 'overview', revision: 0, ascii, structureKind: 'tree' }).revision;
  const nodes = diagramContentNodes(base.diagram.content), refs = Object.fromEntries(nodes.map(n => [n.label, base.nodeRefs[n.id]]));
  const next = revisions.revise(base.id, { kind: 'replace', input: { ascii: ascii.replace('Original', 'Alternative').replace('Other', 'Grouped'), structureKind: 'tree' },
    nodeCorrespondence: Object.fromEntries(nodes.map(n => [base.nodeRefs[n.id], n.line])) }).revision;
  const scene = singleDiagramScene(ascii); scene.contents = { ...scene.contents, overview: base.diagram };
  scene.root.children[0].position = { column: 50, row: 6 };
  const controller = new MappingDocumentController({ scene, edges: [], sections: {} }, initialCanvasState());
  controller.applyUpdate(0, [{ method: 'alternative-promote', nodeId: 'grid:overview', alternativeId: 'group', name: 'Grouped choice', parts: [refs.Branch, refs.Other].map(nodeRef => ({
    target: { kind: 'subtree', nodeRef }, source: { revisionId: next.id, scope: { kind: 'subtree', nodeRef } }, baseRevisionId: base.id })) }]);
  const document = controller.getSnapshot().document;
  await store.projectCatalogs.saveMappingDiagram(project.id, { name: 'Alternatives', scene: document.scene, edges: [], history: controller.exportHistory(), representationId: 'representation-overview', expectedRevisionId: 'revision-overview' });
  const port = await new Promise(resolve => { const s = createServer(); s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => resolve(p)); }); });
  const url = `http://127.0.0.1:${port}`;
  server = spawn(process.execPath, ['scripts/dev/start-server.mjs', 'preview', '--host', '127.0.0.1', '--port', String(port), '--strictPort'], {
    detached: true, env: { ...process.env, NEW_DIAGRAM_PROJECT_ROOT: root, NEW_DIAGRAMS_DIR: store.storeRoot }, stdio: ['ignore', 'ignore', 'pipe'] });
  let logs = ''; server.stderr.on('data', data => { logs += data; });
  await waitFor(async () => (await fetch(url).catch(() => null))?.ok, { timeoutMs: 20000 }).catch(error => { throw Error(`${error}\n${logs}`); });
  await withHeadlessBrowser({ url: `${url}/mapping?diagram=representation-overview`, width: 1800, height: 1100, chromePath: process.env.CHROME_PATH,
    arguments: ['--disable-gpu', '--no-sandbox'] }, async ({ cdp }) => {
    const errors = [];
    await cdp.send('Runtime.enable'); await cdp.send('Page.enable');
    cdp.on('Runtime.exceptionThrown', event => { errors.push(event.exceptionDetails.exception?.description ?? event.exceptionDetails.text); });
    cdp.on('Page.javascriptDialogOpening', () => void cdp.send('Page.handleJavaScriptDialog', { accept: true }));
    const click = async selector => {
      let p; await waitFor(async () => p = await evaluate(cdp, `(() => { const e=document.querySelector(${JSON.stringify(selector)}); if(!e || e.disabled)return null; const r=e.getBoundingClientRect(),p={x:r.x+r.width/2,y:r.y+r.height/2};return e.contains(document.elementFromPoint(p.x,p.y)) ? p : null; })()`));
      for (const type of ['mousePressed','mouseReleased']) await cdp.send('Input.dispatchMouseEvent', { type, ...p, button: 'left', buttons: type === 'mousePressed' ? 1 : 0, clickCount: 1 });
    };
    const native = '[data-native-node="grid:overview"]', text = () => evaluate(cdp, `document.querySelector('${native} pre')?.textContent`);
    await waitForSelector(cdp, `${native} pre`);
    const select = async () => {
      const p = await evaluate(cdp, `(() => { const r=document.querySelector('[data-grid-box="overview"]').getBoundingClientRect(); return {x:r.right-2,y:r.bottom-2}; })()`);
      for (const type of ['mousePressed','mouseReleased']) await cdp.send('Input.dispatchMouseEvent', { type, ...p, button: 'left', buttons: type === 'mousePressed' ? 1 : 0, clickCount: 1 });
      await waitForSelector(cdp, '[data-alternative-node]');
    };
    await select();
    assert.equal(await evaluate(cdp, "document.querySelectorAll('[data-alternative-node]').length"), 2);
    await click('[aria-label="Swap alternative Grouped choice"]');
    await waitFor(async () => (await text())?.includes('Alternative') && (await text())?.includes('Grouped')).catch(async error => { console.error(await evaluate(cdp, `({text:document.querySelector('${native}')?.textContent,alerts:[...document.querySelectorAll('[role=alert]')].map(e=>e.textContent), pressed:[...document.querySelectorAll('[data-alternative-node] button')].map(e=>e.outerHTML)})`), errors); throw error; });
    await click('[aria-label="Open alternative panel Grouped choice"]');
    await waitForSelector(cdp, '[data-side-panel] pre');
    const align = () => evaluate(cdp, `(() => { const a=document.querySelector('${native} [data-source-line="2"]'),b=document.querySelector('[data-side-panel] .ascii-line'); return a && b ? Math.abs(a.getBoundingClientRect().top-b.getBoundingClientRect().top) : 999; })()`);
    await waitFor(async () => await align() < 1).catch(async e => { console.error(await evaluate(cdp, `(() => {const a=document.querySelector('${native} [data-source-line="2"]'),b=document.querySelector('[data-side-panel] .ascii-line'); return {a:a?.getBoundingClientRect().toJSON(),b:b?.getBoundingClientRect().toJSON(),text:document.querySelector('[data-side-panel]')?.textContent};})()`)); throw e; });
    await click('[aria-label="Toggle panel diff"]');
    await waitFor(async () => await evaluate(cdp, "document.querySelector('[data-side-panel] pre').textContent.includes('Original')"));
    await click('[aria-label="Toggle panel layout flow"]');
    await waitForSelector(cdp, '[data-panel-placement="flow"]');
    await waitFor(async () => await align() < 1).catch(async e => { console.error(await evaluate(cdp, `(() => {const a=document.querySelector('${native} [data-source-line="2"]'),b=document.querySelector('[data-side-panel] .ascii-line'); return {a:a?.getBoundingClientRect().toJSON(),b:b?.getBoundingClientRect().toJSON(),text:document.querySelector('[data-side-panel]')?.textContent};})()`)); throw e; });
    await captureScreenshot(cdp, { output: process.env.ALTERNATIVES_SCREENSHOT_PATH ?? path.join(root, 'alternatives.png') });
    // Wait for autosave by observing the persisted workspace through the public endpoint.
    await waitFor(async () => { const response = await fetch(`${url}/api/mapping/workspace`); if (!response.ok) return false; const value = await response.json(); return JSON.stringify(value).includes('diagram-side-panel'); }, { timeoutMs: 20000 });
    await cdp.send('Page.reload', { ignoreCache: true });
    await waitForSelector(cdp, '[data-panel-placement="flow"]');
    await waitFor(async () => (await text())?.includes('Alternative'));
    await click('[aria-label="Close alternative panel"]');
    await waitFor(async () => await evaluate(cdp, "!document.querySelector('[data-side-panel]')"));
    await cdp.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'z', code: 'KeyZ', modifiers: 2, windowsVirtualKeyCode: 90 });
    await cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'z', modifiers: 2 });
    await waitForSelector(cdp, '[data-side-panel]');
    assert.deepEqual(errors, []);
    console.log('PASS grouped inline swap, two markers, aligned SidePanel, diff/flow toggles, persistence/reload and undo');
  });
} finally {
  if (server) { try { process.kill(-server.pid, 'SIGTERM'); } catch {} }
  await rm(root, { recursive: true, force: true });
}
