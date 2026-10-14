// npm run build && node --import tsx tests/browser/mapping/browser-diff-session-workflow-check.mjs
import assert from 'node:assert/strict';
import { spawn, execFileSync } from 'node:child_process';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir, homedir } from 'node:os';
import { createServer } from 'node:net';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { seedMappingFixture } from '../support/browser-mapping-fixture.mjs';
import { DiagramStore } from '../../../infrastructure/core/persistence/store.ts';
import { DiagramChangeSessionStore } from '../../../infrastructure/mapping/changes/diagramChangeSessionStore.ts';
import { ChangeSessionService } from '../../../application/mapping/changes/changeSessionService.ts';
const { evaluate, waitFor, waitForSelector, withHeadlessBrowser } = await import(pathToFileURL(path.join(homedir(), '.codex/skills/front-end/browser-test.mjs')).href);
const root = await mkdtemp(path.join(tmpdir(), 'diff-session-ui-'));
let server;
try {
  await seedMappingFixture(root, { ascii: 'Overview', nodes: [] });
  const git = (...args) => execFileSync('git', ['-C', root, ...args], { encoding: 'utf8' }).trim();
  await writeFile(path.join(root, '.gitignore'), '.diagrams/\n');
  git('add', '.'); git('-c', 'user.name=Fixture', '-c', 'user.email=test@example.test', 'commit', '-qm', 'Baseline');
  await writeFile(path.join(root, 'change.txt'), 'New content\n');
  git('add', '.'); git('-c', 'user.name=Fixture', '-c', 'user.email=test@example.test', 'commit', '-qm', 'Change');
  const store = new DiagramStore(root), project = await store.loadProject();
  const changes = new ChangeSessionService(new DiagramChangeSessionStore(store.storeRoot), store, { list: () => [] });
  const proposal = await changes.create({ title: 'Baseline fixture', repositoryId: project.repositories[0].id, commits: [git('rev-parse', 'HEAD')], requestId: 'fixture' });
  const port = await new Promise(resolve => { const s = createServer(); s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => resolve(p)); }); });
  const url = `http://127.0.0.1:${port}`;
  server = spawn(process.execPath, ['scripts/dev/start-server.mjs', 'preview', '--host', '127.0.0.1', '--port', String(port), '--strictPort'], {
    env: { ...process.env, NEW_DIAGRAM_PROJECT_ROOT: root, NEW_DIAGRAMS_DIR: store.storeRoot }, stdio: ['ignore', 'ignore', 'pipe'] });
  let logs = ''; server.stderr.on('data', data => { logs += data; });
  await waitFor(async () => (await fetch(url).catch(() => null))?.ok, { timeoutMs: 20000 }).catch(e => { throw Error(`${e}\n${logs}`); });
  await withHeadlessBrowser({ url: `${url}/mapping`, width: 1680, height: 1050, chromePath: process.env.CHROME_PATH,
    arguments: ['--disable-gpu', ...(process.platform === 'linux' ? ['--no-sandbox'] : [])] }, async ({ cdp }) => {
    const click = async (selector, text) => {
      let point;
      await waitFor(async () => (point = await evaluate(cdp, `(() => {const e=[...document.querySelectorAll(${JSON.stringify(selector)})].find(e=>e.getBoundingClientRect().width>0 && (!${JSON.stringify(text)} || e.textContent.trim()===${JSON.stringify(text)})); if(!e)return null; const r=e.getBoundingClientRect(),p={x:r.x+r.width/2,y:r.y+r.height/2};return e.contains(document.elementFromPoint(p.x,p.y))?p:null;})()`)));
      for (const type of ['mousePressed', 'mouseReleased']) await cdp.send('Input.dispatchMouseEvent', { type, ...point, button: 'left', buttons: type === 'mousePressed' ? 1 : 0, clickCount: 1 });
    };
    const key = async key => { for (const type of ['keyDown', 'keyUp']) await cdp.send('Input.dispatchKeyEvent', { type, key, code: key }); };
    await waitForSelector(cdp, '.mapping-explorer-tabs'); await click('[role=tab]', 'Changes');
    await waitForSelector(cdp, `[data-change-session-summary="${proposal.changeSessionId}"]`);
    await click('.diff-session-workflow summary');
    assert.match(await evaluate(cdp, "document.querySelector('.diff-session-workflow').textContent"), /astra-high/);
    await click('.diff-session-workflow select'); await key('ArrowDown'); await key('Enter');
    await click('.diff-session-workflow label:nth-child(3) select'); await key('ArrowDown'); await key('Enter');
    await click('.diff-session-workflow button[type=submit]');
    await waitFor(async () => /PI_DISABLED|--pi|AI.*disabled/i.test(await evaluate(cdp, "document.querySelector('.diff-session-workflow').textContent")));
    // Simulate model progress after checking the real disabled-AI boundary. No paid call.
    let started = 0, cancelled = false; const bodies = [];
    await cdp.send('Fetch.enable', { patterns: [{ urlPattern: '*/api/mapping/workflows/diff-session-create*' }] });
    cdp.on('Fetch.requestPaused', async event => {
      if (event.request.url.endsWith('/cancel')) cancelled = true;
      else if (event.request.method === 'POST') { started++; cancelled = false; bodies.push(JSON.parse(event.request.postData)); }
      const completed = started > 1 && event.request.method === 'GET';
      await cdp.send('Fetch.fulfillRequest', { requestId: event.requestId, responseCode: 200,
        responseHeaders: [{ name: 'Content-Type', value: 'application/json' }], body: Buffer.from(JSON.stringify({
          id: 'diff-run-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', status: cancelled ? 'cancelled' : completed ? 'completed' : 'running',
          stage: completed ? 'validate' : 'analyze', message: completed ? 'Ready for review' : 'Analyzing diagrams',
          ...(completed ? { changeSessionId: proposal.changeSessionId } : {})
        })).toString('base64') });
    });
    await click('.diff-session-workflow button[type=submit]');
    await waitForSelector(cdp, '.diff-session-workflow fieldset[disabled]');
    await click('.diff-session-workflow button', 'Cancel generation');
    await waitFor(async () => (await evaluate(cdp, "document.querySelector('.diff-session-workflow [role=status]').textContent")).includes('cancelled'));
    await click('.diff-session-workflow button[type=submit]');
    await waitFor(async () => (await evaluate(cdp, "document.querySelector('.diff-session-workflow [role=status]').textContent")).includes('completed'));
    assert.equal(bodies[0].baselineChangeSessionId, proposal.changeSessionId);
    assert.notEqual(bodies[0].requestId, bodies[1].requestId);
    assert.equal(bodies[0].repositoryId, undefined);
    await click('.diff-session-workflow button', 'Open proposal');
    await waitForSelector(cdp, '.diff-tree-scroll');
    console.log('PASS: baseline selection, AI opt-in error, generation state, cancellation, fresh retry, and proposal navigation');
  });
} finally {
  if (server) { server.kill('SIGTERM'); await new Promise(resolve => { if (server.exitCode !== null) return resolve(); server.once('exit', resolve); setTimeout(resolve, 5000).unref(); }); }
  await rm(root, { recursive: true, force: true });
}
