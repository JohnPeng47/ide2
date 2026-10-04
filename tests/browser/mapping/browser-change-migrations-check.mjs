// npm run build && node --import tsx tests/browser/mapping/browser-change-migrations-check.mjs
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, rm, readFile, writeFile } from 'node:fs/promises';
import { tmpdir, homedir } from 'node:os';
import { createServer } from 'node:net';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { seedMappingFixture } from '../support/browser-mapping-fixture.mjs';
import { canvasSaveFixture } from '../../support/mappingDiagram.ts';
import { RevisionedDiagramService } from '../../../domain/core/diagrams/diagramService.ts';
import { singleDiagramScene } from '../../../domain/core/diagrams/projectDiagramCanvas.ts';
const { evaluate, waitFor, waitForSelector, withHeadlessBrowser, captureScreenshot } = await import(pathToFileURL(path.join(homedir(), '.codex/skills/front-end/browser-test.mjs')).href);
const root = await mkdtemp(path.join(tmpdir(), 'change-migrations-browser-'));
let server, client;
try {
  await seedMappingFixture(root, { ascii: 'Controller\n|-- undo / redo\n`-- checkpoints', nodes: [] });
  const catalogPath = path.join(root, '.diagrams/representations/catalog.json');
  const catalog = JSON.parse(await readFile(catalogPath, 'utf8'));
  for (const [id, name, ascii] of [['overview', 'Controller', 'Controller\n|-- undo / redo\n`-- checkpoints'], ['editor', 'Editor', 'Editor\n`-- HistoryManager\n    `-- undo / redo']]) {
    const scene = singleDiagramScene(ascii);
    scene.contents = { ...scene.contents, overview: new RevisionedDiagramService().create({ id: 'overview', revision: 0, ascii, structureKind: 'tree' }).diagram };
    catalog.representations[`representation-${id}`] = { ...catalog.representations['representation-overview'], id: `representation-${id}`, name, handle: id, currentRevisionId: `revision-${id}`, revisionIds: [`revision-${id}`] };
    catalog.revisions[`revision-${id}`] = { ...catalog.revisions['revision-overview'], id: `revision-${id}`, representationId: `representation-${id}`, ascii, asciiSha256: createHash('sha256').update(ascii).digest('hex'),
      content: { kind: 'canvas-history', history: canvasSaveFixture({ name, scene, edges: [] }).history } };
  }
  const originalCatalog = JSON.stringify(catalog); await writeFile(catalogPath, originalCatalog);
  const port = await new Promise(resolve => { const s = createServer(); s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => resolve(p)); }); });
  const url = `http://127.0.0.1:${port}`;
  server = spawn(process.execPath, ['scripts/dev/start-server.mjs', 'preview', '--host', '127.0.0.1', '--port', String(port), '--strictPort'], {
    env: { ...process.env, NEW_DIAGRAM_PROJECT_ROOT: root, NEW_DIAGRAMS_DIR: path.join(root, '.diagrams'), NEW_DIAGRAM_AGENT: 'fake' }, stdio: ['ignore', 'ignore', 'pipe'] });
  let logs = ''; server.stderr.on('data', data => logs += data);
  await waitFor(async () => (await fetch(url).catch(() => null))?.ok, { timeoutMs: 20000 }).catch(error => { throw Error(`${error}\n${logs}`); });
  client = new Client({ name: 'migration-browser-test', version: '1' });
  await client.connect(new StdioClientTransport({ command: process.execPath, args: ['--import', 'tsx', 'scripts/mapping/mcp.ts', url], stderr: 'pipe' }));
  const tools = (await client.listTools()).tools;
  assert.ok(tools.find(t => t.name === 'update_diagram_change_session').inputSchema.properties.migrations);
  assert.ok(tools.find(t => t.name === 'diagram-search').inputSchema.properties.snapshot);
  const tool = async (name, args) => { const r = await client.callTool({ name, arguments: args }); assert.ok(!r.isError, JSON.stringify(r)); return JSON.parse(r.content[0].text); };
  let seq = 0;
  const exec = (code, options = {}) => tool('exec', { code, requestId: `exec-${++seq}`, ...options });
  const { changeSessionId } = await tool('create_diagram_change_session', { title: 'Undo ownership migration', requestId: 'create' });
  const attached = (await exec(`return canvas.attach({canvasId:${JSON.stringify(changeSessionId)},documentId:'representation-overview'});`, { changeSessionId })).value;
  const scope = { changeSessionId, sessionId: attached.sessionId };
  await exec('return nodes.patchDiagram({nodeId:"grid:overview",start:2,end:2,patch:""});', { ...scope, expectedVersion: 0 });
  const endpoint = async (documentId, snapshot, label) => {
    const read = await tool('diagram-search', { operation: 'read', changeSessionId, representationId: documentId, snapshot });
    const node = read.nodes.find(n => n.id === 'grid:overview');
    return { documentId, snapshot, displayNodeId: node.id, contentNodeId: Object.values(node.content.structure.nodes).find(n => n.label === label).id, revisionId: node.content.revisionId, scope: 'node' };
  };
  const migration = { id: 'U', title: 'Live undo/redo', description: 'Mounted Editor owns live undo/redo; the controller retains persisted checkpoints.', kind: 'feature-ownership',
    source: await endpoint('representation-overview', 'baseline', 'undo / redo'),
    destination: { ...await endpoint('representation-editor', 'proposed', 'HistoryManager'), scope: 'subtree' } };
  const session = async () => (await fetch(`${url}/api/mapping/agent/change-sessions/${changeSessionId}`)).json();
  const update = async args => tool('update_diagram_change_session', { changeSessionId, expectedVersion: (await session()).version, requestId: `update-${++seq}`, ...args });
  await update({ migrations: [migration], status: 'ready' });
  await withHeadlessBrowser({ url: `${url}/mapping`, width: 1600, height: 1000, chromePath: process.env.CHROME_PATH, arguments: ['--disable-gpu'] }, async ({ cdp }) => {
    const errors = []; await cdp.send('Runtime.enable'); cdp.on('Runtime.exceptionThrown', e => errors.push(e.exceptionDetails.text));
    const click = async (selector, text) => {
      await waitForSelector(cdp, selector);
      const p = await evaluate(cdp, `(()=>{const e=[...document.querySelectorAll(${JSON.stringify(selector)})].find(e=>e.getClientRects().length&&(!${JSON.stringify(text ?? '')}||e.textContent.trim()===${JSON.stringify(text ?? '')}));if(!e)throw Error('Missing button');const r=e.getBoundingClientRect();return{x:r.left+r.width/2,y:r.top+r.height/2};})()`);
      await cdp.send('Input.dispatchMouseEvent', { type: 'mousePressed', ...p, button: 'left', buttons: 1, clickCount: 1 });
      await cdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', ...p, button: 'left', buttons: 0, clickCount: 1 });
    };
    const sourceLink = '[data-migration-link="U"][data-migration-role="source"]';
    const destinationLink = '[data-migration-link="U"][data-migration-role="destination"]';
    const destinationNode = '.change-preview-stage .diagram-content-node[data-migration-role="destination"]';
    await waitForSelector(cdp, '.mapping-poc-ascii');
    await click('[role=tab]', 'Changes');
    await click('nav[aria-label="Diagram changes"] summary[data-change-session-summary]');
    console.log('Opening migration source');
    await click(sourceLink);
    await waitForSelector(cdp, '.migration-baseline [data-migration-id="U"]');
    assert.equal(await evaluate(cdp, 'getComputedStyle(document.querySelector(".migration-baseline [data-migration-id=U]")).backgroundColor'), 'rgb(32, 54, 77)');
    assert.equal(await evaluate(cdp, 'document.querySelector(".migration-baseline [data-migration-id=U]").textContent'), 'undo / redo');
    await waitForSelector(cdp, '.change-preview-stage .migration-source');
    assert.equal(await evaluate(cdp, 'document.querySelector(".change-preview-stage .migration-source").textContent'), 'undo / redo');
    if (process.env.MIGRATION_SCREENSHOT) await captureScreenshot(cdp, { output: process.env.MIGRATION_SCREENSHOT + '.source.png' });
    console.log('Navigating to unchanged destination');
    await click('.migration-endpoint button', 'Go to destination ↗');
    await waitForSelector(cdp, destinationNode);
    assert.deepEqual(await evaluate(cdp, `[...document.querySelectorAll(${JSON.stringify(destinationNode)})].map(n=>({text:n.textContent,color:getComputedStyle(n).backgroundColor,status:n.dataset.diffStatus??null}))`), [
      { text: 'HistoryManager', color: 'rgb(23, 63, 112)', status: null }, { text: 'undo / redo', color: 'rgb(23, 63, 112)', status: null }]);
    // Navigation reveals a collapsed destination and focuses the exact node.
    await click('[aria-label="Collapse subtree Editor"]');
    await waitFor(async () => !await evaluate(cdp, `document.querySelector(${JSON.stringify(destinationNode)})`));
    await click('.migration-endpoint button', 'Locate HistoryManager');
    await waitForSelector(cdp, destinationNode);
    await waitFor(async () => await evaluate(cdp, `(()=>{const e=document.querySelector(${JSON.stringify(destinationNode)});const r=e.getBoundingClientRect();const hit=document.elementFromPoint(r.x+r.width/2,r.y+r.height/2);return !!hit&&(hit===e||e.contains(hit));})()`));
    if (process.env.MIGRATION_SCREENSHOT) await captureScreenshot(cdp, { output: process.env.MIGRATION_SCREENSHOT });
    // Reopening a persisted proposal still exposes the pair and unchanged destination.
    console.log('Reloading persisted migration');
    await cdp.send('Page.reload');
    await waitForSelector(cdp, '[role=tab]');
    await click('[role=tab]', 'Changes');
    await click('nav[aria-label="Diagram changes"] summary[data-change-session-summary]');
    await click(destinationLink);
    await waitForSelector(cdp, destinationNode);
    // Metadata-only updates refresh the existing document without a document-version change.
    const remaining = { ...migration, id: 'S', title: 'Retained source annotation', source: await endpoint('representation-overview', 'proposed', 'checkpoints') };
    await update({ migrations: [migration, remaining] });
    console.log('Opening migration source');
    await click(sourceLink);
    await waitForSelector(cdp, '.change-preview-stage [data-migration-id="S"]');
    assert.equal(await evaluate(cdp, 'getComputedStyle(document.querySelector(".change-preview-stage [data-migration-id=S]")).backgroundColor'), 'rgb(32, 54, 77)');
    // A later edit flags the stale proposed endpoint rather than decorating unrelated text.
    await exec('return nodes.patchDiagram({nodeId:"grid:overview",start:2,end:2,patch:"`-- domain checkpoints"});', { ...scope, expectedVersion: 1 });
    await waitFor(async () => await evaluate(cdp, '[...document.querySelectorAll(".migration-review [role=alert]")].some(e=>e.textContent.includes("revision is stale"))'));
    assert.equal(await evaluate(cdp, 'document.querySelectorAll(".change-preview-stage [data-migration-id=S]").length'), 0);
    assert.equal(await readFile(catalogPath, 'utf8'), originalCatalog, 'Preview changed saved canvases');
    await update({ migrations: [migration], status: 'ready' });
    await click(destinationLink);
    await waitForSelector(cdp, destinationNode);
    console.log('Accepting while viewing unchanged destination');
    await click('.change-session-actions button', 'Accept all changes');
    await waitFor(async () => (await session()).status === 'accepted');
    await waitFor(async () => await evaluate(cdp, '!document.querySelector(".change-session-preview")'));
    assert.ok(await evaluate(cdp, 'document.querySelector(".mapping-document-view:not([hidden])").textContent.includes("HistoryManager")'));
    await click('[role=tab]', 'Changes');
    await click('nav[aria-label="Diagram changes"] summary[data-change-session-summary]');
    await click(sourceLink);
    await waitForSelector(cdp, '.migration-baseline [data-migration-id="U"]');
    assert.ok(await evaluate(cdp, 'document.querySelector(".change-session-actions").textContent.includes("Accepted")'));
    assert.deepEqual(errors, []);
  });
  const acceptedCatalog = JSON.parse(await readFile(catalogPath, 'utf8'));
  assert.equal(acceptedCatalog.representations['representation-editor'].currentRevisionId, 'revision-editor', 'Acceptance republished unchanged destination');
  console.log('Migration MCP schema, baseline reads, paired colors, unchanged destination, subtree navigation, reload, metadata refresh, stale references and acceptance from unchanged destination passed.');
} finally {
  await client?.close(); server?.kill('SIGTERM'); await rm(root, { recursive: true, force: true });
}
