import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir, homedir } from 'node:os';
import { createServer } from 'node:net';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { seedMappingFixture } from '../support/browser-mapping-fixture.mjs';
import { DiagramStore } from '../../../infrastructure/core/persistence/store.ts';
import { DiagramChangeSessionStore } from '../../../infrastructure/mapping/changes/diagramChangeSessionStore.ts';
import { ChangeSessionService } from '../../../application/mapping/changes/changeSessionService.ts';
const { evaluate, waitFor, waitForSelector, withHeadlessBrowser } = await import(pathToFileURL(path.join(homedir(), '.codex/skills/front-end/browser-test.mjs')).href);
const root = await mkdtemp(path.join(tmpdir(), 'acceptance-browser-'));
let server;
try {
  // Disposable fixture setup happens before the server or browser starts.
  await seedMappingFixture(root, { ascii: 'Root\n|-- Before acceptance\n`-- Keep', nodes: [] });
  const store = new DiagramStore(root), repository = new DiagramChangeSessionStore(store.storeRoot);
  const bridge = { list: () => [] };
  const changes = new ChangeSessionService(repository, store, bridge);
  const proposal = await changes.create({ title: 'Acceptance browser fixture', requestId: 'fixture-create' });
  const changeSessionId = proposal.changeSessionId, documentId = proposal.documents[0].documentId;
  await changes.apply(changeSessionId, documentId, 0, [{ method: 'patchDiagram', nodeId: 'grid:overview', start: 2, end: 2, patch: '|-- After acceptance' }], 'fixture-edit');
  const draft = await changes.get(changeSessionId);
  await changes.update({ changeSessionId, expectedVersion: draft.version, requestId: 'fixture-ready', status: 'ready' });
  const port = await new Promise(resolve => { const socket = createServer(); socket.listen(0, '127.0.0.1', () => { const port = socket.address().port; socket.close(() => resolve(port)); }); });
  const url = `http://127.0.0.1:${port}`;
  server = spawn(process.execPath, ['scripts/dev/start-server.mjs', 'preview', '--host', '127.0.0.1', '--port', String(port), '--strictPort'],
    { cwd: process.cwd(), env: { ...process.env, NEW_DIAGRAM_PROJECT_ROOT: root, NEW_DIAGRAMS_DIR: store.storeRoot, NEW_DIAGRAM_AGENT: 'fake' }, stdio: ['ignore', 'ignore', 'pipe'] });
  let serverErrors = ''; server.stderr.on('data', chunk => { serverErrors += chunk; });
  await waitFor(async () => (await fetch(url).catch(() => null))?.ok, { timeoutMs: 20000 }).catch(error => { throw new Error(`${error}\n${serverErrors}`); });
  await withHeadlessBrowser({ url: `${url}/mapping`, width: 1800, height: 1100, chromePath: process.env.CHROME_PATH,
    arguments: ['--disable-gpu', ...(process.platform === 'linux' ? ['--no-sandbox'] : [])] }, async ({ cdp }) => {
    const errors = [];
    await cdp.send('Runtime.enable'); cdp.on('Runtime.exceptionThrown', event => errors.push(event.exceptionDetails.text));
    const canvasReplies = [];
    await cdp.send('Network.enable');
    cdp.on('Network.requestWillBeSent', ({ request }) => {
      if (request.url.includes('/canvases/') && request.url.endsWith('/reply') && request.postData)
        canvasReplies.push(JSON.parse(request.postData));
    });
    const click = async (selector, text) => {
      let point;
      await waitFor(async () => {
        point = await evaluate(cdp, `(() => { const el = [...document.querySelectorAll(${JSON.stringify(selector)})].find(el => !el.disabled && ${text ? `el.textContent.includes(${JSON.stringify(text)})` : 'true'}); if (!el) return null; const r=el.getBoundingClientRect(); return r.width && r.height ? {x:r.x+r.width/2,y:r.y+r.height/2}:null; })()`);
        return !!point;
      });
      await cdp.send('Input.dispatchMouseEvent', { type: 'mousePressed', button: 'left', clickCount: 1, ...point });
      await cdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', button: 'left', clickCount: 1, ...point });
    };
    const visibleCanvasText = () => evaluate(cdp, `document.querySelector('.mapping-document-view:not([hidden])')?.textContent ?? ''`);
    await waitFor(async () => (await visibleCanvasText()).includes('Before acceptance'));
    await click('[role="tab"]', 'Changes');
    await click('nav[aria-label="Diagram changes"] summary', 'Acceptance browser fixture');
    await click('nav[aria-label="Diagram changes"] button', 'Current LLM prompt stack');
    await waitForSelector(cdp, '[data-diff-status="modified"]');
    canvasReplies.length = 0;
    await click('.change-session-actions button', 'Accept all changes');
    await waitFor(async () => (await visibleCanvasText()).includes('After acceptance'));
    const stateReplies = canvasReplies.filter(reply => reply.value?.document);
    assert.ok(stateReplies.length > 0, 'acceptance checked the live browser state');
    for (const reply of stateReplies)
      assert.deepEqual(Object.keys(reply.value).sort(), ['document', 'name'], 'acceptance does not transfer history or rendering metadata');
    assert.equal(await evaluate(cdp, '!!document.querySelector("[data-change-session]")'), false);
    assert.equal(await evaluate(cdp, '!!document.querySelector("[data-diff-status]")'), false);
    const accepted = await changes.get(changeSessionId);
    assert.equal(accepted.status, 'accepted');
    assert.ok(accepted.acceptance.documents[0].before.checkpointId);
    // Wait for the public workspace autosave to contain the new published head.
    await waitFor(async () => {
      const response = await fetch(`${url}/api/mapping/workspace`);
      if (!response.ok) return false;
      return JSON.stringify(await response.json()).includes(accepted.acceptance.documents[0].after.revisionId);
    });
    await cdp.send('Page.reload', { ignoreCache: true });
    await waitFor(async () => (await visibleCanvasText()).includes('After acceptance'));
    await click('[role="tab"]', 'Changes');
    await click('nav[aria-label="Diagram changes"] summary', 'Acceptance browser fixture');
    await click('nav[aria-label="Diagram changes"] button', 'Current LLM prompt stack');
    await waitForSelector(cdp, '[data-diff-status="modified"]');
    assert.ok(await evaluate(cdp, 'document.querySelector(".change-session-actions").textContent.includes("Accepted")'));
    assert.equal(await evaluate(cdp, '[...document.querySelectorAll(".change-session-actions button")].some(b=>b.textContent.includes("Accept all"))'), false);
    await click('.change-session-actions button', 'Open canvas');
    await waitFor(async () => (await visibleCanvasText()).includes('After acceptance'));
    await click('.mapping-document-view:not([hidden]) button', 'Undo');
    await waitFor(async () => (await visibleCanvasText()).includes('Before acceptance'));
    // Reopening the accepted review must not discard a later local undo/edit.
    await click('[role="tab"]', 'Changes');
    await click('nav[aria-label="Diagram changes"] summary', 'Acceptance browser fixture');
    await click('nav[aria-label="Diagram changes"] button', 'Current LLM prompt stack');
    await waitForSelector(cdp, '.change-session-actions');
    await click('.change-session-actions button', 'Open canvas');
    await waitFor(async () => (await visibleCanvasText()).includes('Before acceptance'));
    assert.deepEqual(errors, []);
    console.log('PASS: accept -> published canvas without diff -> reload -> retained review diff -> undo restores original');
  });
} finally {
  if (server && server.exitCode === null) {
    server.kill('SIGTERM');
    await new Promise(resolve => server.once('exit', resolve));
  }
  await rm(root, { recursive: true, force: true });
}
