// npm run build && node --import tsx tests/browser/mapping/browser-repository-explorer-check.mjs
import assert from 'node:assert/strict';
import { spawn, execFileSync } from 'node:child_process';
import { mkdtemp, mkdir, rm } from 'node:fs/promises';
import { tmpdir, homedir } from 'node:os';
import { createServer } from 'node:net';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { seedMappingFixture } from '../support/browser-mapping-fixture.mjs';
import { DiagramStore } from '../../../infrastructure/core/persistence/store.ts';
import { DiagramChangeSessionStore } from '../../../infrastructure/mapping/changes/diagramChangeSessionStore.ts';
import { ChangeSessionService } from '../../../application/mapping/changes/changeSessionService.ts';
import { canvasSaveFixture } from '../../support/mappingDiagram.ts';
import { singleDiagramScene } from '../../../domain/core/diagrams/projectDiagramCanvas.ts';
const { evaluate, waitFor, waitForSelector, withHeadlessBrowser, captureScreenshot } = await import(pathToFileURL(path.join(homedir(), '.codex/skills/front-end/browser-test.mjs')).href);
const root = await mkdtemp(path.join(tmpdir(), 'repository-browser-'));
let server;
try {
  const alphaRoot = path.join(root, 'alpha'), betaRoot = path.join(root, 'beta');
  await mkdir(alphaRoot); await mkdir(betaRoot);
  await seedMappingFixture(alphaRoot, { ascii: 'Alpha diagram\n`-- Original', nodes: [] });
  execFileSync('git', ['init', '-q', betaRoot]);
  execFileSync('git', ['-C', betaRoot, '-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.test', 'commit', '--allow-empty', '-qm', 'Beta baseline']);
  const store = new DiagramStore(alphaRoot), project = await store.loadProject();
  const alpha = project.repositories[0];
  // Backfill the legacy canvas before introducing an additional repository.
  await store.projectCatalogs.loadRepresentationCatalog(project.id);
  const beta = await store.repositories.register({ path: betaRoot, name: 'Beta repository' });
  const saved = await store.projectCatalogs.saveMappingDiagram(project.id, { ...canvasSaveFixture({ name: 'Beta canvas', scene: singleDiagramScene('Beta diagram') }), repositoryId: beta.id });
  const changes = new ChangeSessionService(new DiagramChangeSessionStore(store.storeRoot), store, { list: () => [] });
  const proposals = [];
  for (const repository of [alpha, beta]) {
    const proposal = await changes.create({ title: `${repository.name} proposal`, repositoryId: repository.id, commits: ['HEAD'], requestId: `create-${repository.id}` });
    const documentId = proposal.documents[0].documentId;
    await changes.apply(proposal.changeSessionId, documentId, 0, [{ method: 'patchDiagram', nodeId: 'grid:overview', start: 1, end: 1, patch: `${repository.name} updated` }], `edit-${repository.id}`);
    proposals.push(proposal);
  }
  const port = await new Promise(resolve => { const s = createServer(); s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => resolve(p)); }); });
  const url = `http://127.0.0.1:${port}`;
  server = spawn(process.execPath, ['scripts/dev/start-server.mjs', '--http', 'preview', '--host', '127.0.0.1', '--port', String(port), '--strictPort'], {
    env: { ...process.env, NEW_DIAGRAM_PROJECT_ROOT: alphaRoot, NEW_DIAGRAMS_DIR: store.storeRoot, NEW_DIAGRAM_AGENT: 'fake' }, stdio: ['ignore', 'ignore', 'pipe'] });
  let logs = ''; server.stderr.on('data', data => logs += data);
  await waitFor(async () => (await fetch(url).catch(() => null))?.ok, { timeoutMs: 20000 }).catch(error => { throw Error(`${error}\n${logs}`); });
  await withHeadlessBrowser({ url: `${url}/mapping`, width: 1600, height: 1000, chromePath: process.env.CHROME_PATH, arguments: ['--disable-gpu'] }, async ({ cdp }) => {
    const send = cdp.send.bind(cdp);
    cdp.send = async (method, params) => {
      let timer;
      try { return await Promise.race([send(method, params), new Promise((_, reject) => { timer = setTimeout(() => reject(Error(`CDP timed out: ${method}`)), 20000); })]); }
      finally { clearTimeout(timer); }
    };
    await cdp.send('Page.enable');
    cdp.on('Page.javascriptDialogOpening', () => void cdp.send('Page.handleJavaScriptDialog', { accept: true }));
    const errors = []; await cdp.send('Runtime.enable'); cdp.on('Runtime.exceptionThrown', e => errors.push(e.exceptionDetails.text));
    const click = async (selector, text) => {
      let point;
      await waitFor(async () => {
        point = await evaluate(cdp, `(()=>{const e=[...document.querySelectorAll(${JSON.stringify(selector)})].find(e=>!e.disabled&&e.getClientRects().length&&(!${JSON.stringify(text ?? '')}||e.textContent.trim()===${JSON.stringify(text ?? '')}));if(!e)return null;const r=e.getBoundingClientRect();return{x:r.left+r.width/2,y:r.top+r.height/2};})()`);
        return !!point;
      });
      await cdp.send('Input.dispatchMouseEvent', { type: 'mousePressed', ...point, button: 'left', buttons: 1, clickCount: 1 });
      await cdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', ...point, button: 'left', buttons: 0, clickCount: 1 });
    };
    const key = async (key, modifiers = 0) => {
      const windowsVirtualKeyCode = { a: 65, Home: 36, Enter: 13, Backspace: 8 }[key];
      const params = { key, code: key === 'a' ? 'KeyA' : key, modifiers, windowsVirtualKeyCode };
      await cdp.send('Input.dispatchKeyEvent', { type: 'rawKeyDown', ...params });
      await cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', ...params });
    };
    const fill = async (selector, value) => { await click(selector); await key('a', 2); await key('Backspace'); if (value) await cdp.send('Input.insertText', { text: value }); };
    const group = id => `[data-repository-group="${id}"]`;
    await waitForSelector(cdp, `nav[aria-label="Project diagrams"] ${group(beta.id)}`);
    console.log('Checking repository groups and filtering');
    assert.deepEqual(await evaluate(cdp, `[...document.querySelectorAll('nav[aria-label="Project diagrams"] [data-repository-group]')].map(e=>({id:e.dataset.repositoryGroup,canvases:[...e.querySelectorAll('[data-project-diagram]')].map(b=>b.dataset.projectDiagram)}))`), [
      { id: alpha.id, canvases: ['representation-overview'] }, { id: beta.id, canvases: [saved.representation.id] }]);
    await click(`${group(beta.id)} > details > summary`);
    assert.equal(await evaluate(cdp, `document.querySelector('${group(beta.id)} > details').open`), false);
    await click(`${group(beta.id)} > details > summary`);
    await fill('[aria-label="Filter diagrams"]', 'Beta repository');
    assert.equal(await evaluate(cdp, 'document.querySelectorAll("[data-project-diagram]").length'), 1);
    await fill('[aria-label="Filter diagrams"]', '');
    await click(`[data-project-diagram="${saved.representation.id}"]`);
    await waitFor(async () => await evaluate(cdp, 'document.querySelector(".mapping-document-view:not([hidden])")?.textContent.includes("Beta diagram")'));
    // Create in the other repository using the public form and real keyboard input.
    await click('button', 'New');
    console.log('Creating a canvas in another repository');
    await fill('[aria-label="New diagram name"]', 'Cross repository canvas');
    await click('[aria-label="Canvas repository"]'); await key('Home'); await key('Enter');
    assert.equal(await evaluate(cdp, `document.querySelector('[aria-label="Canvas repository"]').value`), alpha.id);
    await fill('[aria-label="Initial diagram content"]', 'Created through UI');
    await click('.mapping-create-dialog button[type=submit]');
    await waitFor(async () => await evaluate(cdp, `document.querySelector('${group(alpha.id)}')?.textContent.includes('Cross repository canvas')`)).catch(async error => {
      throw Error(`${error}\n${await evaluate(cdp, 'document.body.innerText')}`);
    });
    const catalog = await store.projectCatalogs.loadRepresentationCatalog(project.id);
    const created = Object.values(catalog.representations).find(r => r.name === 'Cross repository canvas');
    assert.equal(created.repositoryId, alpha.id);
    await waitFor(async () => JSON.stringify(await fetch(`${url}/api/mapping/workspace`).then(response => response.json())).includes(created.id));
    const beforeReload = await evaluate(cdp, 'performance.timeOrigin');
    await cdp.send('Page.reload');
    console.log('Reloading saved ownership');
    await waitFor(async () => await evaluate(cdp, 'performance.timeOrigin').catch(() => beforeReload) !== beforeReload);
    await waitForSelector(cdp, `[data-project-diagram="${created.id}"]`);
    assert.equal(await evaluate(cdp, `document.querySelector('[data-project-diagram="${created.id}"]').closest('[data-repository-group]').dataset.repositoryGroup`), alpha.id);
    await click('[role=tab]', 'Changes');
    console.log('Opening repository-scoped proposal');
    await waitForSelector(cdp, '[data-change-session-summary]');
    for (const [index, repository] of [alpha, beta].entries()) {
      assert.equal(await evaluate(cdp, `document.querySelector('[data-change-session-summary="${proposals[index].changeSessionId}"]').closest('[data-repository-group]').dataset.repositoryGroup`), repository.id);
    }
    await click(`[data-change-session-summary="${proposals[0].changeSessionId}"]`);
    assert.ok(await evaluate(cdp, `document.querySelector('${group(alpha.id)} .change-repository-context').textContent.includes('HEAD ${proposals[0].head.slice(0, 12)} · 1 commits')`));
    await click(`${group(alpha.id)} [data-change-id]`);
    await waitForSelector(cdp, '[data-diff-status="modified"]');
    if (process.env.REPOSITORY_SCREENSHOT) await captureScreenshot(cdp, { output: process.env.REPOSITORY_SCREENSHOT });
    assert.deepEqual(errors, []);
  });
  console.log('PASS: repository grouping, collapse/filter, canvas selection, repository choice on create, saved ownership after reload, grouped ChangeSessions and pinned context preview.');
} finally {
  if (server && server.exitCode === null) { server.kill('SIGTERM'); await new Promise(resolve => server.once('exit', resolve)); }
  await rm(root, { recursive: true, force: true });
}
