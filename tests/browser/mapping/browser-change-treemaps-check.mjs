// npm run build && node --import tsx tests/browser/mapping/browser-change-treemaps-check.mjs
import assert from 'node:assert/strict';
import { spawn, execFileSync } from 'node:child_process';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir, homedir } from 'node:os';
import { createServer } from 'node:net';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { seedMappingFixture } from '../support/browser-mapping-fixture.mjs';
import { DiagramStore } from '../../../infrastructure/core/persistence/store.ts';
import { DiagramChangeSessionStore } from '../../../infrastructure/mapping/changes/diagramChangeSessionStore.ts';
import { ChangeSessionService } from '../../../application/mapping/changes/changeSessionService.ts';
import { RevisionedDiagramService } from '../../../domain/core/diagrams/diagramService.ts';
import { canvasSaveFixture } from '../../support/mappingDiagram.ts';
import { singleDiagramScene } from '../../../domain/core/diagrams/projectDiagramCanvas.ts';
import { diagramContentNodes } from '../../../domain/core/diagrams/diagramContentNodes.ts';
const { evaluate, waitFor, waitForSelector, withHeadlessBrowser, captureScreenshot } = await import(pathToFileURL(path.join(homedir(), '.codex/skills/front-end/browser-test.mjs')).href);
const root = await mkdtemp(path.join(tmpdir(), 'change-treemaps-'));
let server;
const git = (...args) => execFileSync('git', ['-C', root, ...args], { encoding: 'utf8' }).trim();
const commit = title => { git('add', '.'); git('-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.test', 'commit', '-qm', title); return git('rev-parse', 'HEAD'); };
try {
  await seedMappingFixture(root, { ascii: 'Overview', nodes: [] });
  await writeFile(path.join(root, '.gitignore'), '.diagrams/\n');
  await mkdir(path.join(root, 'src')); await mkdir(path.join(root, 'tests'));
  await writeFile(path.join(root, 'src/auth.ts'), 'old\nkeep\n'); commit('Baseline');
  await writeFile(path.join(root, 'src/auth.ts'), 'new\nkeep\nadded\n');
  await writeFile(path.join(root, 'README.md'), 'New docs\n');
  await writeFile(path.join(root, 'tests/auth.test.ts'), 'New test\n');
  await writeFile(path.join(root, 'binary.dat'), Buffer.from([0, 1, 0, 2]));
  const head = commit('Captured changes');
  const store = new DiagramStore(root), project = await store.loadProject(), repositoryId = project.repositories[0].id;
  const diagrams = new RevisionedDiagramService();
  for (const [name, ascii] of [['Authentication', 'Authentication\n`-- Sign-in\n    `-- Create session'], ['Storage', 'Storage\n`-- Persist']]) {
    const scene = singleDiagramScene(ascii);
    scene.contents = { ...scene.contents, overview: diagrams.create({ id: 'overview', revision: 0, ascii, structureKind: 'tree' }).diagram };
    await store.projectCatalogs.saveMappingDiagram(project.id, { ...canvasSaveFixture({ name, scene }), repositoryId });
  }
  const changes = new ChangeSessionService(new DiagramChangeSessionStore(store.storeRoot), store, { list: () => [] });
  const discovered = await changes.discoverHunks({ repositoryId, commits: [head], offset: 0, limit: 200, includePatches: true });
  const created = await changes.create({ title: 'Treemap review', repositoryId, commits: [head], requestId: 'create' });
  const empty = await changes.create({ title: 'Empty review', repositoryId, commits: [], requestId: 'empty' });
  const session = await changes.get(created.changeSessionId), auth = session.documents.find(d => d.name === 'Authentication'), storage = session.documents.find(d => d.name === 'Storage');
  const target = (doc, label) => ({ representationId: doc.id, displayNodeId: 'grid:overview', ...(label ? {
    contentNodeId: diagramContentNodes(doc.proposed.document.scene.contents.overview.content).find(n => n.label === label).id } : {}) });
  const mapping = (id, line, file, destination) => ({ id, source: { line }, targets: discovered.hunks.filter(h => h.path === file).map(h => ({ kind: 'diff-hunk', hunkId: h.id })), diagramTargets: [destination] });
  await changes.update({ changeSessionId: session.id, expectedVersion: session.version, requestId: 'map', diffTree: {
    expectedRevisionId: session.diffTree.revision.id, ascii: 'Review\n|-- Auth\n|-- Session\n`-- Storage', mappings: [
      mapping('auth', 2, 'src/auth.ts', target(auth, 'Sign-in')), mapping('session', 3, 'src/auth.ts', target(auth, 'Create session')),
      mapping('storage', 4, 'README.md', target(storage))
    ]
  } });
  const version = (await changes.get(session.id)).version;
  await writeFile(path.join(root, 'src/auth.ts'), 'LIVE CONTENT SHOULD NEVER APPEAR\n');
  const port = await new Promise(resolve => { const s = createServer(); s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => resolve(p)); }); });
  const url = `http://127.0.0.1:${port}`;
  // No --http or --pi: this visualization requires neither mutation nor generation.
  server = spawn(process.execPath, ['scripts/dev/start-server.mjs', 'preview', '--host', '127.0.0.1', '--port', String(port), '--strictPort'], {
    env: { ...process.env, NEW_DIAGRAM_PROJECT_ROOT: root, NEW_DIAGRAMS_DIR: store.storeRoot }, stdio: ['ignore', 'ignore', 'pipe'] });
  let logs = ''; server.stderr.on('data', data => { logs += data; });
  await waitFor(async () => (await fetch(url).catch(() => null))?.ok, { timeoutMs: 20000 }).catch(error => { throw Error(`${error}\n${logs}`); });
  await withHeadlessBrowser({ url: `${url}/mapping`, width: 1680, height: 1050, chromePath: process.env.CHROME_PATH,
    arguments: ['--disable-gpu', ...(process.platform === 'linux' ? ['--no-sandbox'] : [])] }, async ({ cdp }) => {
    const errors = [], requests = [];
    await cdp.send('Runtime.enable'); await cdp.send('Network.enable');
    cdp.on('Runtime.exceptionThrown', e => errors.push(e.exceptionDetails));
    cdp.on('Network.requestWillBeSent', e => requests.push(e.request.url));
    const click = async (selector, text) => {
      const point = await evaluate(cdp, `(() => {const e=[...document.querySelectorAll(${JSON.stringify(selector)})].find(e=>e.getBoundingClientRect().width>0 && (!${JSON.stringify(text)} || e.textContent.trim()===${JSON.stringify(text)})); if(!e)throw Error('Missing '+${JSON.stringify(text ?? selector)});const r=e.getBoundingClientRect();return{x:r.x+r.width/2,y:r.y+r.height/2};})()`);
      for (const type of ['mousePressed', 'mouseReleased']) await cdp.send('Input.dispatchMouseEvent', { type, ...point, button: 'left', buttons: type === 'mousePressed' ? 1 : 0, clickCount: 1 });
    };
    await waitForSelector(cdp, '.mapping-explorer-tabs');
    await click('[role=tab]', 'Changes');
    await waitForSelector(cdp, `[data-change-session-summary="${session.id}"]`);
    await click(`[data-change-session-summary="${session.id}"]`);
    await click(`[data-open-difftree="${session.id}"]`);
    await waitForSelector(cdp, '.window-panel [role=tab]');
    await click('.window-panel [role=tab]', 'Treemaps');
    await waitForSelector(cdp, '.change-treemap-cell');
    assert.equal(await evaluate(cdp, "document.querySelectorAll('.window-panel .window-panel').length"), 0, 'Treemaps share the existing window');
    await click('.window-panel [role=tab]', 'Hunks');
    await waitForSelector(cdp, '[aria-label="Captured hunks"]');
    await click('.window-panel-header button', 'Minimize');
    await click('.window-panel [role=tab]', 'Treemaps');
    await waitForSelector(cdp, '.change-treemap-cell');
    assert.equal(await evaluate(cdp, "document.querySelector('.window-panel-minimized [role=tab][aria-selected=true]').textContent"), 'Treemaps');
    await click('.window-panel [role=tab]', 'Change tree');
    await waitForSelector(cdp, '.diff-tree-scroll');
    await click('.window-panel [role=tab]', 'Hunks');
    await cdp.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'ArrowRight', code: 'ArrowRight' });
    await cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'ArrowRight', code: 'ArrowRight' });
    await waitForSelector(cdp, '.change-treemap-cell');
    assert.equal(await evaluate(cdp, "document.activeElement.textContent"), 'Treemaps', 'Arrow navigation reaches third tab');
    await click('.window-panel-header button', 'Restore');
    const totals = await evaluate(cdp, "document.querySelector('[aria-label=\"Change LOC totals\"]').textContent");
    assert.match(totals, /5 actual LOC/); assert.match(totals, /4 allocated to diagrams/); assert.match(totals, /1 unmapped LOC/); assert.match(totals, /3 duplicate LOC discounted/);
    assert.ok(await evaluate(cdp, "[...document.querySelectorAll('.change-treemap-cell')].some(e=>e.textContent.includes('auth.test.ts'))"), 'Tests contribute LOC');
    await click('.change-treemap-cell button[aria-label^="auth.ts:"]');
    await waitFor(async () => await evaluate(cdp, `document.querySelector('[aria-label="Selected treemap region"]').textContent.includes("auth.ts: 3 changed LOC")`));
    assert.equal(await evaluate(cdp, "document.querySelectorAll('.change-treemap-panel .diff-hunk, .change-treemap-detail-pane').length"), 0, "Treemaps have no source-code pane");
    assert.ok(await evaluate(cdp, "document.querySelector('.change-treemap-plot').getBoundingClientRect().width > document.querySelector('[data-pane=treemaps]').getBoundingClientRect().width * .95"), "Map fills the panel width");
    assert.equal(await evaluate(cdp, "!!document.querySelector('.window-panel-minimized')"), false, 'File selection does not navigate');
    await click('.change-treemap-switch button', 'Diagrams');
    await waitFor(async () => await evaluate(cdp, "document.querySelectorAll('.change-treemap-plot > .change-treemap-cell').length===3"));
    const areas = await evaluate(cdp, "[...document.querySelectorAll('.change-treemap-plot > .change-treemap-cell')].map(e=>{const r=e.getBoundingClientRect();return {loc:Number(e.dataset.loc),area:r.width*r.height};})");
    assert.ok(Math.abs(areas[0].area / areas[1].area - 3) < .05, 'Diagram rectangles reflect 3:1 allocated LOC after sharing');
    assert.ok(await evaluate(cdp, "document.querySelector('.change-treemap-plot > [data-treemap-kind=unmapped]').textContent.includes('Unmapped')"));
    assert.equal(await evaluate(cdp, "document.querySelector('.change-treemap-plot > [data-treemap-kind=unmapped]').dataset.loc"), '1');
    await click('.change-treemap-cell[data-treemap-kind=unmapped] button');
    assert.equal(await evaluate(cdp, "!!document.querySelector('.window-panel-minimized')"), false, 'Unmapped region has no navigation target');
    await captureScreenshot(cdp, { output: process.env.CHANGE_TREEMAP_SCREENSHOT ?? path.join(root, 'treemaps.png') });
    const widthBefore = await evaluate(cdp, "document.querySelector('.change-treemap-plot').getBoundingClientRect().width");
    await cdp.send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 900, deviceScaleFactor: 1, mobile: false });
    await waitFor(async () => await evaluate(cdp, `document.querySelector('.change-treemap-plot').getBoundingClientRect().width < ${widthBefore - 50}`));
    assert.equal(await evaluate(cdp, "[...document.querySelectorAll('.change-treemap-plot > .change-treemap-cell')].reduce((sum,e)=>sum+Number(e.dataset.loc),0)"), 5);
    await click('.change-treemap-cell button[aria-label^="Authentication / Authentication:"]');
    await waitForSelector(cdp, '.window-panel-minimized');
    await waitForSelector(cdp, `[data-change-session="${session.id}"] .is-change-target`);
    await click('.window-panel-header button', 'Restore');
    await click('.change-treemap-selection button', 'Zoom into region');
    await waitFor(async () => await evaluate(cdp, "document.querySelector('[aria-label=\"Treemap path\"]').textContent.includes('Authentication / Authentication')"));
    await click('.change-treemap-cell button[aria-label^="Sign-in:"]');
    await waitForSelector(cdp, '.window-panel-minimized');
    await click('.window-panel-header button', 'Restore');
    await click('.change-treemap-selection button', 'Zoom into region');
    await waitForSelector(cdp, '.change-treemap-cell[data-treemap-kind=direct]');
    assert.equal(await evaluate(cdp, "document.querySelector('.change-treemap-cell[data-treemap-kind=direct]').dataset.loc"), '1.5');
    await click('.change-treemap-cell button[aria-label^="Create session:"]');
    assert.ok(await evaluate(cdp, `document.querySelector('[aria-label="Selected treemap region"]').textContent.includes("Create session: 1.5 allocated LOC")`));
    assert.match(await evaluate(cdp, `document.querySelector('.change-treemap-cell button[aria-label^="Create session:"]').title`), /3 shared LOC; each shared hunk split across 2 mapped nodes/);
    await waitForSelector(cdp, '.window-panel-minimized');
    await waitForSelector(cdp, `[data-change-session="${session.id}"] .is-change-target`);
    await click('[aria-label="Close Treemap review · DiffTree"]');
    await click(`[data-open-difftree="${session.id}"]`);
    await waitForSelector(cdp, '.window-panel [role=tab]');
    await click('.window-panel [role=tab]', 'Treemaps');
    await waitForSelector(cdp, '.change-treemap-summary');
    if (await evaluate(cdp, "!!document.querySelector('.window-panel-minimized')")) await click('.window-panel-header button', 'Restore');
    assert.ok(await evaluate(cdp, "document.querySelector('.change-treemap-footnote').textContent.includes('1 binary / metadata changes')"));
    await click('[aria-label="Close Treemap review · DiffTree"]');
    await click(`[data-change-session-summary="${empty.changeSessionId}"]`);
    await cdp.send('Input.dispatchMouseEvent', { type: 'mouseWheel', x: 180, y: 600, deltaX: 0, deltaY: 400 });
    await waitFor(async () => await evaluate(cdp, `(() => {const e=document.querySelector('[data-open-treemaps="${empty.changeSessionId}"]');const r=e.getBoundingClientRect();return r.top>0 && r.bottom<innerHeight && e.contains(document.elementFromPoint(r.x+r.width/2,r.y+r.height/2));})()`));
    await click(`[data-open-treemaps="${empty.changeSessionId}"]`);
    await waitFor(async () => await evaluate(cdp, "document.querySelector('.change-treemap-panel')?.textContent.includes('No added or deleted text lines')")).catch(async error => { console.log('Empty session state', await evaluate(cdp, "({panel:document.querySelector('.change-treemap-panel')?.textContent, alerts:[...document.querySelectorAll('[role=alert]')].map(e=>e.textContent), sessions:[...document.querySelectorAll('[data-open-treemaps]')].map(e=>({id:e.dataset.openTreemaps,rect:e.getBoundingClientRect().toJSON()}))})")); await captureScreenshot(cdp,{output:path.join(root,'empty-error.png')}); throw error; });
    assert.equal(await evaluate(cdp, "document.querySelectorAll('.change-treemap-cell').length"), 0);
    assert.equal(requests.some(url => /diagram-edits|create-diagram|extend-diagram/.test(url)), false, 'No LLM generation calls');
    assert.deepEqual(errors, []);
    console.log('PASS Files/Diagrams LOC, fractional allocation and unmapped area, nested zoom, full-width map without source code, direct rectangle navigation and explicit zoom, empty/binary states, and no LLM requests');
  });
  assert.equal((await changes.get(session.id)).version, version, 'Viewing never mutates the ChangeSession');
} finally {
  if (server && server.exitCode === null) { server.kill('SIGTERM'); await new Promise(resolve => server.once('exit', resolve)); }
  await rm(root, { recursive: true, force: true });
}
