// npm run build && node --import tsx tests/browser/mapping/browser-experiment-tags-check.mjs
import assert from 'node:assert/strict';
import { access, mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir, homedir } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { chromium } from '@playwright/test';
import { seedMappingFixture } from '../support/browser-mapping-fixture.mjs';
import { JsonDirectoryStore } from '../../../infrastructure/mapping/evals/jsonDirectoryStore.ts';
const { evaluate, waitFor, waitForSelector, withHeadlessBrowser, captureScreenshot } = await import(pathToFileURL(path.join(homedir(), '.codex/skills/front-end/browser-test.mjs')).href);
const root = await mkdtemp(path.join(tmpdir(), 'experiment-tags-'));
let server;
try {
  const chromePath = process.env.CHROME_PATH || chromium.executablePath();
  await access(chromePath);
  await seedMappingFixture(root, { ascii: 'Fixture\n`-- Source', nodes: [] });
  const storeRoot = path.join(root, '.diagrams');
  const { id: projectId } = JSON.parse(await readFile(path.join(storeRoot, 'project.json'), 'utf8'));
  const now = new Date().toISOString();
  const fixture = { schemaVersion: 1, id: 'tag-study', projectId, revision: 1, name: 'Tag study', description: 'Experiment tag browser check', createdAt: now, updatedAt: now,
    workflow: { id: 'study', name: 'Study', version: 1, stages: [{ id: 'tree', name: 'Tree', dependsOn: [] }] },
    cases: [{ id: 'source', name: 'Source', agentContextId: 'fixture' }], conditions: [{ id: 'a', name: 'A', description: '' }], samples: [], comparisons: [],
    comments: [{ id: 'note', text: 'Existing comment', tags: ['todo'], createdAt: now }], commentTags: ['todo'], lastRequest: { id: 'fixture', hash: 'fixture' } };
  const experiments = new JsonDirectoryStore(storeRoot, 'eval-experiments');
  await experiments.save(fixture);
  const mappedId = 'd6db3d5a-0042-4bc3-b633-c1ffc3027efd';
  await experiments.save({ ...fixture, id: mappedId, name: 'Other study', tags: ['reuse-me'],
    comments: [...fixture.comments, { id: 'draft', phaseId: 'tree', text: 'Internal note', tags: ['draft'], createdAt: now }] });
  const port = await new Promise(resolve => { const socket = createServer(); socket.listen(0, '127.0.0.1', () => { const port = socket.address().port; socket.close(() => resolve(port)); }); });
  const base = `http://127.0.0.1:${port}`;
  server = spawn(process.execPath, ['scripts/dev/start-server.mjs', 'preview', '--host', '127.0.0.1', '--port', String(port), '--strictPort'], {
    env: { ...process.env, NEW_DIAGRAM_PROJECT_ROOT: root, NEW_DIAGRAMS_DIR: storeRoot, NEW_DIAGRAM_AGENT: 'fake', NEW_DIAGRAM_USAGE_DB: path.join(root, 'usage.sqlite') }, stdio: 'ignore' });
  await waitFor(async () => (await fetch(base).catch(() => null))?.ok, { timeoutMs: 30000 });
  const api = async suffix => { const response = await fetch(`${base}/api/mapping/evals/experiments${suffix}`); assert.equal(response.status, 200); return response.json(); };
  assert.deepEqual((await api('/tag-study')).tags, []);
  await withHeadlessBrowser({ url: 'about:blank', width: 1440, height: 1000, chromePath, arguments: ['--no-sandbox', '--blink-settings=primaryHoverType=2,availableHoverTypes=2'] }, async ({ cdp }) => {
    const errors = []; let loads = 0;
    await cdp.send('Page.enable'); await cdp.send('Runtime.enable'); await cdp.send('Network.enable');
    cdp.on('Runtime.exceptionThrown', event => errors.push(event.exceptionDetails.text));
    cdp.on('Page.loadEventFired', () => { loads++; });
    const click = async selector => {
      const point = await evaluate(cdp, `(()=>{const el=document.querySelector(${JSON.stringify(selector)});el.scrollIntoView({block:'center'});const r=el.getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2}})()`);
      await cdp.send('Input.dispatchMouseEvent', { type: 'mousePressed', ...point, button: 'left', buttons: 1, clickCount: 1 });
      await cdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', ...point, button: 'left', buttons: 0, clickCount: 1 });
    };
    const reload = async () => { const before = loads; await cdp.send('Page.reload'); await waitFor(() => loads > before); await waitForSelector(cdp, '.experiment-tags input'); };
    const tags = () => evaluate(cdp, `[...document.querySelectorAll('.experiment-tags .experiment-tag')].map(el=>el.firstChild.textContent)`);
    const input = '.experiment-tags input', submit = '.experiment-tags button[type="submit"]';
    const type = async text => {
      await click(input);
      await cdp.send('Input.dispatchKeyEvent', { type:'keyDown', key:'a', code:'KeyA', modifiers:2, windowsVirtualKeyCode:65 });
      await cdp.send('Input.dispatchKeyEvent', { type:'keyUp', key:'a', code:'KeyA', modifiers:2, windowsVirtualKeyCode:65 });
      await cdp.send('Input.insertText', { text });
    };
    const settled = () => waitFor(async () => await evaluate(cdp, `document.querySelector('.experiment-tags').getAttribute('aria-busy') === 'false'`));
    await cdp.send('Page.navigate', { url: `${base}/evals?experiment=tag-study` });
    await waitForSelector(cdp, input, { timeoutMs:30000 });
    assert.deepEqual(await tags(), []);
    assert.deepEqual(await evaluate(cdp, `[...document.querySelectorAll('.experiment-tags datalist option')].map(el=>el.value)`), ['reuse-me']);
    await type('  discovery  ');
    // A transport failure retains the draft and leaves persisted tags untouched.
    await cdp.send('Network.setBlockedURLs', { urls:['*/experiments/tag-study/tags'] });
    await click(submit); await waitForSelector(cdp, '.experiment-tags [role="alert"]'); await settled();
    assert.equal(await evaluate(cdp, `document.querySelector(${JSON.stringify(input)}).value`), '  discovery  ');
    assert.deepEqual((await api('/tag-study')).tags, []);
    await cdp.send('Network.setBlockedURLs', { urls:[] });
    await click(submit); await waitFor(async () => (await tags()).includes('discovery')); await settled();
    assert.deepEqual((await api('/tag-study')).tags, ['discovery']);
    assert.deepEqual((await api('')).find(e=>e.id==='tag-study').tags, ['discovery']);
    assert.deepEqual((await api('/tag-study/overview')).experiment.tags, ['discovery']);
    await reload(); assert.deepEqual(await tags(), ['discovery']);
    assert.ok(await evaluate(cdp, `document.querySelector('.experiment-nav-link[aria-current="page"] .experiment-nav-tags').textContent.includes('discovery')`));
    await type('discovery');
    assert.equal(await evaluate(cdp, `document.querySelector(${JSON.stringify(submit)}).disabled`), true);
    await type('reuse-me');
    await click(submit);
    await waitFor(async () => (await tags()).length===2); await settled();
    await captureScreenshot(cdp, { output: path.join(root, 'tags.png') });
    if (process.env.TAG_SCREENSHOT) await captureScreenshot(cdp, { output: process.env.TAG_SCREENSHOT });
    await click('[aria-label="Remove experiment tag discovery"]');
    await waitFor(async () => JSON.stringify(await tags())===JSON.stringify(['reuse-me'])); await settled();
    await reload(); assert.deepEqual(await tags(), ['reuse-me']);
    await click('[aria-label="Remove experiment tag reuse-me"]');
    await waitFor(async () => (await tags()).length===0); await settled();
    await reload(); assert.deepEqual(await tags(), []);
    assert.deepEqual((await api('/tag-study')).comments, fixture.comments);
    assert.deepEqual((await api('/' + mappedId)).tags, ['reuse-me']);
    await cdp.send('Page.navigate', { url: `${base}/evals?experiment=${mappedId}` });
    const rename = 'button[aria-label="Rename experiment"]';
    const editor = 'input[aria-label="Experiment name"]';
    await waitForSelector(cdp, rename);
    const key = async (key, code) => {
      for (const type of ['keyDown', 'keyUp']) await cdp.send('Input.dispatchKeyEvent', { type, key, windowsVirtualKeyCode: code, ...(key === 'Enter' && type === 'keyDown' ? { text: '\r' } : {}) });
    };
    await click(rename);
    await cdp.send('Input.insertText', { text: '   ' });
    assert.equal(await evaluate(cdp, `document.querySelector('.experiment-rename button[type="submit"]').disabled`), true);
    await key('Escape', 27);
    await waitForSelector(cdp, rename);
    assert.equal((await api('/' + mappedId)).revision, 1);
    await click(rename);
    await waitForSelector(cdp, editor);
    await cdp.send('Input.insertText', { text: '  Seed study [E12]  ' });
    await key('Enter', 13);
    await waitForSelector(cdp, rename);
    assert.equal(await evaluate(cdp, `document.querySelector('.experiment-title h2').textContent`), 'Seed study [E12]');
    await waitForSelector(cdp, '.experiment-nav-link[title="Seed study [E12]"]');
    await reload();
    assert.equal(await evaluate(cdp, `document.querySelector('.experiment-title h2').textContent`), 'Seed study [E12]');
    assert.equal((await api('/' + mappedId)).revision, 2);
    const phaseRow = '[data-node-id="phase/tree"] > .experiment-ascii-row';
    const addPhaseComment = phaseRow + ' button[aria-label="Add comment to Phase 1 · Tree"]';
    const opacity = () => evaluate(cdp, `getComputedStyle(document.querySelector(${JSON.stringify(addPhaseComment)})).opacity`);
    await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 0, y: 0 });
    assert.equal(await evaluate(cdp, `matchMedia('(hover: hover)').matches`), true);
    assert.equal(await opacity(), '0');
    const rowPoint = await evaluate(cdp, `(() => {
      const el = document.querySelector(${JSON.stringify(phaseRow)});
      el.scrollIntoView({ block: 'center' });
      const rect = el.getBoundingClientRect();
      return { x: rect.left + 5, y: rect.top + rect.height / 2 };
    })()`);
    await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', ...rowPoint });
    assert.equal(await opacity(), '1');
    await captureScreenshot(cdp, { output: path.join(root, 'phase-hover.png') });
    await click(addPhaseComment);
    const form = phaseRow + ' form';
    await waitForSelector(cdp, form + ' textarea:focus');
    await key('Escape', 27);
    await waitForSelector(cdp, addPhaseComment + ':focus');
    await click(addPhaseComment);
    await waitForSelector(cdp, form + ' textarea:focus');
    const phaseNote = 'Check the phase inputs';
    await cdp.send('Input.insertText', { text: phaseNote });
    await click(form + ' input');
    await cdp.send('Input.insertText', { text: 'insight' });
    await click(form + ' button[type="submit"]');
    await waitFor(async () => await evaluate(cdp, `!document.querySelector('${form}')`));
    const saved = (await api('/' + mappedId)).comments.find(comment => comment.text === phaseNote);
    assert.equal(saved.phaseId, 'tree');
    const savedNote = `[data-node-id="phase/tree/comment/${saved.id}"] .experiment-ascii-comment`;
    await waitForSelector(cdp, savedNote);
    await reload();
    await waitForSelector(cdp, savedNote);
    assert.equal(await evaluate(cdp, `document.querySelector('${savedNote}').textContent`), '# ' + phaseNote);
    const homeNote = `[data-map-node="comment:${mappedId}:${saved.id}"] .experiment-home-comment`;
    await cdp.send('Page.navigate', { url: `${base}/evals` });
    const mapLink = '.experiment-home-id[aria-label="E16: Seed study [E12]"]';
    await waitForSelector(cdp, mapLink);
    assert.ok(await evaluate(cdp, `document.querySelector('${mapLink}').parentElement.textContent.includes('Seed study [E12]')`));
    assert.equal(await evaluate(cdp, `document.querySelector('${mapLink}').parentElement.querySelectorAll('a').length`), 1);
    await click('.experiment-home-views button:nth-child(2)');
    await waitForSelector(cdp, mapLink);
    for (const tab of ['first-child', 'nth-child(2)']) {
      await click('.experiment-home-views button:' + tab);
      await waitForSelector(cdp, homeNote);
      assert.equal(await evaluate(cdp, `document.querySelector('[data-map-node="comment:${mappedId}:draft"]') === null`), true);
      assert.equal(await evaluate(cdp, `document.querySelector('${homeNote}').textContent`), '# [insight] ' + phaseNote);
      assert.equal(await evaluate(cdp, `document.querySelector('[data-map-node="comment:${mappedId}:note"] .experiment-home-comment').textContent`), '# [todo] Existing comment');
    }
    assert.deepEqual(errors, []);
  });
  console.log('PASS: create, trim, reuse, duplicate prevention, failure retry, removal and reload persistence; list/detail/overview API tags; comment tags unchanged.');
} finally {
  if(server && server.exitCode===null){ const closed=new Promise(resolve=>server.once('exit',resolve)); server.kill('SIGTERM'); await closed; }
  await rm(root, { recursive:true, force:true });
}
