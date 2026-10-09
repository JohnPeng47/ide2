import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { homedir, tmpdir } from 'node:os';
import { createServer } from 'node:net';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { randomUUID } from 'node:crypto';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { seedMappingFixture } from '../support/browser-mapping-fixture.mjs';
const { evaluate, waitFor, waitForSelector, withHeadlessBrowser } = await import(pathToFileURL(path.join(homedir(), '.codex/skills/front-end/browser-test.mjs')).href);
const root = await mkdtemp(path.join(tmpdir(), 'diagram-edit-'));
let server, client;
try {
  await seedMappingFixture(root, { ascii: 'Original\n`-- Existing', nodes: [] });
  const port = await new Promise(resolve => { const s = createServer(); s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => resolve(p)); }); });
  const url = `http://127.0.0.1:${port}`;
  server = spawn(process.execPath, ['scripts/dev/start-server.mjs', '--http', 'preview', '--host', '127.0.0.1', '--port', String(port), '--strictPort'],
    { detached: true, env: { ...process.env, NEW_DIAGRAM_PROJECT_ROOT: root, NEW_DIAGRAMS_DIR: path.join(root, '.diagrams'), NEW_DIAGRAM_AGENT: 'fake' }, stdio: ['ignore', 'ignore', 'pipe'] });
  let errors = ''; server.stderr.on('data', c => { errors += c; });
  await waitFor(async () => (await fetch(url).catch(() => null))?.ok, { timeoutMs: 20000 }).catch(e => { throw Error(`${e}\n${errors}`); });
  client = new Client({ name: 'diagram-edit-check', version: '1' });
  await client.connect(new StdioClientTransport({ command: process.execPath, args: ['node_modules/tsx/dist/cli.mjs', 'scripts/mapping/mcp.ts', url], stderr: 'pipe' }));
  const call = async (name, args) => {
    const r = await client.callTool({ name, arguments: args }), value = JSON.parse(r.content[0].text);
    assert.ok(!r.isError, JSON.stringify(value)); return value;
  };
  const exec = args => call('exec', { requestId: randomUUID(), ...args });
  assert.ok((await client.listTools()).tools.some(t => t.name === 'edit-diagram'));
  await withHeadlessBrowser({ url: `${url}/mapping`, width: 1800, height: 1100, chromePath: process.env.CHROME_PATH,
    arguments: ['--disable-gpu', ...(process.platform === 'linux' ? ['--no-sandbox'] : [])] }, async ({ cdp }) => {
    await cdp.send('Page.enable');
    await waitForSelector(cdp, '[data-grid-box="overview"]');
    async function attach(excludeCanvasId) {
      let canvases;
      await waitFor(async () => { canvases = (await exec({ code: 'return canvas.list();' })).value.filter(c => c.canvasId !== excludeCanvasId); return canvases[0]?.documents.length; });
      const canvas = canvases[0];
      return (await exec({ code: `return canvas.attach(${JSON.stringify({ canvasId: canvas.canvasId, documentId: canvas.documents[0].documentId })});` })).value;
    }
    const attachment = await attach();
    const read = async sessionId => (await call('diagram-search', { sessionId, operation: 'read', nodeId: 'grid:overview' }));
    const before = await read(attachment.sessionId);
    const input = { sessionId: attachment.sessionId, nodeId: 'grid:overview', expectedVersion: before.version,
      baseRevisionId: before.node.diagram.revisionId, prompt: 'Show the edit flow', requestId: randomUUID() };
    const started = await call('edit-diagram', input);
    assert.equal((await call('edit-diagram', input)).runId, started.runId);
    let finished;
    await waitFor(async () => {
      finished = await call('edit-diagram-status', { runId: started.runId });
      assert.ok(!['failed', 'conflict', 'awaiting-acknowledgement'].includes(finished.status), JSON.stringify(finished));
      return finished.status === 'completed';
    }, { timeoutMs: 15000 });
    const after = await read(attachment.sessionId);
    assert.equal(after.version, before.version + 1);
    assert.equal(after.node.diagram.diagramId, before.node.diagram.diagramId);
    assert.equal(after.node.diagram.revisionId, finished.result.revisionId);
    assert.equal(finished.generated.revisionId, finished.result.revisionId);
    assert.equal((await call('edit-diagram', input)).result.revisionId, finished.result.revisionId);
    const visible = async () => evaluate(cdp, "document.querySelector('.mapping-poc-ascii').textContent");
    await waitFor(async () => (await visible()).includes('[edited: Show the edit flow]'));
    const click = async text => {
      const p = await evaluate(cdp, `(() => { const e=[...document.querySelectorAll('.mapping-grid-tools button')].find(e=>e.textContent===${JSON.stringify(text)}); if (!e || e.disabled) throw Error('Unavailable '+${JSON.stringify(text)}); const r=e.getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2}; })()`);
      await cdp.send('Input.dispatchMouseEvent', { type: 'mousePressed', ...p, button: 'left', buttons: 1, clickCount: 1 });
      await cdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', ...p, button: 'left', buttons: 0, clickCount: 1 });
    };
    // Completion acknowledges workspace persistence: reload immediately, without Save.
    const loaded = new Promise(resolve => cdp.on('Page.loadEventFired', resolve));
    await cdp.send('Page.reload', { ignoreCache: true }); await loaded;
    await waitForSelector(cdp, '[data-grid-box="overview"]');
    await waitFor(async () => (await visible()).includes('[edited: Show the edit flow]'));
    const restored = await attach(attachment.canvasId);
    assert.equal((await read(restored.sessionId)).node.diagram.revisionId, finished.result.revisionId);
    await click('Undo');
    await waitFor(async () => !(await visible()).includes('[edited:'));
    assert.equal((await read(restored.sessionId)).node.diagram.revisionId, input.baseRevisionId);
    await click('Redo');
    await waitFor(async () => (await visible()).includes('[edited:'));
    assert.equal((await read(restored.sessionId)).node.diagram.revisionId, finished.result.revisionId);
    // A later prompt extends the same identity and lineage.
    const current = await read(restored.sessionId);
    const second = await call('edit-diagram', { ...input, sessionId: restored.sessionId, requestId: randomUUID(),
      expectedVersion: current.version, baseRevisionId: current.node.diagram.revisionId, prompt: 'Second revision' });
    await waitFor(async () => (await call('edit-diagram-status', { runId: second.runId })).status === 'completed');
    const latest = await read(restored.sessionId);
    assert.equal(latest.node.diagram.diagramId, before.node.diagram.diagramId);
    assert.equal(latest.node.diagram.revision, before.node.diagram.revision + 2);
    console.log('PASS: MCP prompt edit, request deduplication, exact service revision transfer, acknowledged persistence, immediate reload, durable undo/redo, and successive edit lineage');
  });
} finally {
  await client?.close();
  if (server?.pid) { try { process.kill(-server.pid, 'SIGTERM'); } catch {} }
  await rm(root, { recursive: true, force: true });
}
