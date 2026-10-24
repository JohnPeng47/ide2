// npm run build && node --import tsx tests/browser/mapping/browser-diagram-syntax-check.mjs
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir, homedir } from 'node:os';
import { createServer } from 'node:net';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { seedMappingFixture } from '../support/browser-mapping-fixture.mjs';
import { DiagramStore } from '../../../infrastructure/core/persistence/store.ts';
import { revisionFixture } from '../../support/diagramRevisions.ts';
import { singleDiagramScene } from '../../../domain/core/diagrams/projectDiagramCanvas.ts';
import { diagramContentNodes } from '../../../domain/core/diagrams/diagramContentNodes.ts';
import { canvasSaveFixture } from '../../support/mappingDiagram.ts';
import { ChangeSessionService } from '../../../application/mapping/changes/changeSessionService.ts';
import { DiagramChangeSessionStore } from '../../../infrastructure/mapping/changes/diagramChangeSessionStore.ts';
const { evaluate, waitFor, waitForSelector, withHeadlessBrowser, captureScreenshot } = await import(pathToFileURL(path.join(homedir(), '.codex/skills/front-end/browser-test.mjs')).href);
const root = await mkdtemp(path.join(tmpdir(), 'diagram-syntax-'));
let server;
try {
  await seedMappingFixture(root, { ascii: 'Overview', nodes: [] });
  await mkdir(path.join(root, 'src'));
  const originalLines = ['export interface CanvasSession {}'];
  await writeFile(path.join(root, 'src/session.ts'), originalLines.join('\n') + '\n');
  const store = new DiagramStore(root), project = await store.loadProject();
  const source = { sourceId: 'fixture-source', repositoryIdentity: path.join(root, '.git'), domainProfileId: 'source-code', corpus: { kind: 'git-worktree', root } };
  const ascii = 'interface CanvasSession\n|-- controller: CanvasSession\n|   `-- applyUpdate(expectedVersion, operations)\n|-- kind: "grid"\n|-- schemaVersion: 3\n|-- History: owned by SessionManager\n`-- CanvasSession [D3]';
  const scene = singleDiagramScene(ascii, source), diagrams = revisionFixture();
  const target = diagrams.create({ id: 'target', revision: 0, ascii: 'TargetCanvas\n`-- ready: true', structureKind: 'tree' }).diagram;
  const targetNode = diagramContentNodes(target.content).find(n => n.label === 'TargetCanvas').id;
  const mappings = ascii.split('\n').flatMap((line, i) => [...line.matchAll(/CanvasSession/g)].map(m => ({
    id: `mapping-${i}`, entityId: 'session', sourceRangeIndex: 0, line: i + 1, startColumn: m.index + 1, endColumn: m.index + m[0].length
  })));
  const tagStart = ascii.split('\n').at(-1).indexOf('[D3]') + 1;
  scene.contents.overview = diagrams.create({ id: 'overview', revision: 0, ascii, structureKind: 'tree', source, mappings,
    evidence: { session: { id: 'session', handle: 'CanvasSession', label: 'CanvasSession', category: 'interface-data-struct', summary: '',
      sourceRanges: [{ id: 'session-range', path: 'src/session.ts', symbol: 'CanvasSession', startLine: 1, endLine: 1, originalLines }] } },
    jumps: [{ id: 'syntax-jump', source: { revisionId: 'overview:0', contentHash: createHash('sha256').update(ascii).digest('hex'), line: 7, startColumn: tagStart, endColumn: tagStart + 3 },
      target: { representationId: 'representation-overview', displayNodeId: 'grid:target', contentNodeId: targetNode } }]
  }).diagram;
  scene.contents.target = target;
  scene.root.children.push({ id: 'target', kind: 'diagram', contentId: 'target', collapsed: false, position: { column: 0, row: 15 } });
  await store.projectCatalogs.saveMappingDiagram(project.id, canvasSaveFixture({ name: 'Syntax examples', scene, representationId: 'representation-overview', expectedRevisionId: 'revision-overview' }));
  const changes = new ChangeSessionService(new DiagramChangeSessionStore(store.storeRoot), store, { list: () => [] });
  const session = await changes.create({ title: 'Syntax review', commits: [], requestId: 'syntax-review' });
  const port = await new Promise(resolve => { const s = createServer(); s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => resolve(p)); }); });
  const url = `http://127.0.0.1:${port}`;
  server = spawn(process.execPath, ['scripts/dev/start-server.mjs', 'preview', '--host', '127.0.0.1', '--port', String(port), '--strictPort'], {
    env: { ...process.env, NEW_DIAGRAM_PROJECT_ROOT: root, NEW_DIAGRAMS_DIR: store.storeRoot }, stdio: ['ignore', 'ignore', 'pipe'] });
  let logs = ''; server.stderr.on('data', data => { logs += data; });
  await waitFor(async () => (await fetch(url).catch(() => null))?.ok, { timeoutMs: 20000 }).catch(error => { throw Error(`${error}\n${logs}`); });
  await withHeadlessBrowser({ url: `${url}/mapping`, width: 1680, height: 1050, chromePath: process.env.CHROME_PATH,
    arguments: ['--disable-gpu', '--no-sandbox'] }, async ({ cdp }) => {
    const errors = [];
    await cdp.send('Runtime.enable'); cdp.on('Runtime.exceptionThrown', e => errors.push(e.exceptionDetails.text));
    await cdp.send('Page.enable'); cdp.on('Page.javascriptDialogOpening', () => void cdp.send('Page.handleJavaScriptDialog', { accept: true }));
    const pointFor = (selector, text) => evaluate(cdp, `(() => { const e=[...document.querySelectorAll(${JSON.stringify(selector)})].find(e=>!e.disabled && e.getBoundingClientRect().width && (!${JSON.stringify(text)} || e.textContent.trim()===${JSON.stringify(text)})); if(!e)return null;const r=e.getBoundingClientRect(),p={x:r.x+r.width/2,y:r.y+r.height/2};return e.contains(document.elementFromPoint(p.x,p.y))?p:null; })()`);
    const click = async (selector, text, modifiers = 0) => {
      let point; await waitFor(async () => (point = await pointFor(selector, text)));
      for (const type of ['mousePressed', 'mouseReleased']) await cdp.send('Input.dispatchMouseEvent', { type, ...point, modifiers, button: 'left', buttons: type === 'mousePressed' ? 1 : 0, clickCount: 1 });
    };
    const native = '.mapping-document-view:not([hidden]) [data-native-node="grid:overview"]';
    const pre = `${native} pre`;
    const rendered = () => evaluate(cdp, `document.querySelector(${JSON.stringify(pre)}).textContent`);
    await waitForSelector(cdp, `${pre} .syntax-type`);
    assert.equal(await rendered(), ascii, 'Syntax never changes text or whitespace');
    assert.equal(await evaluate(cdp, `document.querySelectorAll(${JSON.stringify(pre + ' .syntax-type.syntax-definition')}).length`), 1, 'Mapped source references are not definitions');
    assert.ok(await evaluate(cdp, `document.querySelector(${JSON.stringify(pre + ' .syntax-type')}).title.includes('src/session.ts:1')`));
    const appearance = () => evaluate(cdp, `(() => {const pre=document.querySelector(${JSON.stringify(pre)}); return [...pre.querySelectorAll('.diagram-syntax')].map(e=>({text:e.textContent,color:getComputedStyle(e).color,width:e.getBoundingClientRect().width,height:e.getBoundingClientRect().height,weight:getComputedStyle(e).fontWeight}));})()`);
    const dark = await appearance();
    assert.ok(new Set(dark.map(t => t.color)).size >= 6);
    const refPoint = await pointFor(`${pre} .syntax-type[data-syntax-role=reference]`, 'CanvasSession');
    await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', ...refPoint });
    await waitFor(async () => await evaluate(cdp, `document.querySelectorAll(${JSON.stringify(pre + ' .is-symbol-match')}).length===3`));
    await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 5, y: 5 });
    await waitFor(async () => await evaluate(cdp, `document.querySelectorAll('.is-symbol-match').length===0`));
    await captureScreenshot(cdp, { output: path.join(root, 'syntax-dark.png') });
    await click('.theme-toggle');
    await waitFor(async () => await evaluate(cdp, "document.documentElement.dataset.theme==='light'"));
    const light = await appearance();
    assert.notDeepEqual(light.map(t => t.color), dark.map(t => t.color));
    assert.deepEqual(light.map(({color, ...t}) => t), dark.map(({color, ...t}) => t), 'Theme changes preserve every token metric');
    await captureScreenshot(cdp, { output: path.join(root, 'syntax-light.png') });
    if (process.env.DIAGRAM_SYNTAX_SCREENSHOT_DIR) {
      await mkdir(process.env.DIAGRAM_SYNTAX_SCREENSHOT_DIR, { recursive: true });
      const { copyFile } = await import('node:fs/promises');
      for (const name of ['syntax-dark.png', 'syntax-light.png']) await copyFile(path.join(root, name), path.join(process.env.DIAGRAM_SYNTAX_SCREENSHOT_DIR, name));
    }
    // Nested token elements still participate in the Ctrl-click node selection gesture.
    await click(`${pre} .syntax-function`, 'applyUpdate', 2);
    await waitForSelector(cdp, `${pre} .diagram-content-node.is-selected`);
    await click('[aria-label="Collapse subtree controller: CanvasSession"]');
    await waitFor(async () => !(await rendered()).includes('applyUpdate'));
    await click('[aria-label="Expand subtree controller: CanvasSession"]');
    await waitFor(async () => (await rendered()) === ascii);
    await click(`${pre} [data-diagram-jump-id="syntax-jump"]`);
    await waitForSelector(cdp, '[data-native-node="grid:target"] .diagram-content-node[data-jump-focus]');
    await click('[role=tab]', 'Changes');
    await click(`[data-change-session-summary="${session.changeSessionId}"]`);
    await click('nav[aria-label="Diagram changes"] button', 'Syntax examples');
    await waitForSelector(cdp, '.change-session-preview .syntax-type');
    assert.equal(await evaluate(cdp, "document.querySelectorAll('.change-session-preview .syntax-type.syntax-definition').length"), 1);
    assert.ok(await evaluate(cdp, "document.querySelector('.change-session-preview .syntax-type').title.includes('src/session.ts:1')"));
    assert.ok(await evaluate(cdp, "document.querySelector('.change-session-preview pre').textContent.includes('applyUpdate(expectedVersion, operations)')"));
    assert.deepEqual(errors, []);
    console.log('PASS exact text, semantic roles, source tooltips, symbol hover, dark/light colors and metrics, nested-token selection, folding, jump navigation and ChangeSession highlighting');
  });
} finally {
  if (server && server.exitCode === null) { server.kill('SIGTERM'); await new Promise(resolve => server.once('exit', resolve)); }
  await rm(root, { recursive: true, force: true });
}
