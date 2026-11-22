// npm run build && node --import tsx tests/browser/mapping/browser-experiment-overview-read-check.mjs
// Exercises read routes, the shared tree renderer, and saved user comments in disposable data; no generation.
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir, homedir } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { chromium } from '@playwright/test';
import { seedMappingFixture } from '../support/browser-mapping-fixture.mjs';
import { evalOutputFixture } from '../../support/evalOutputResult.ts';
import { UsageStore } from '../../../infrastructure/core/usage/usageStore.ts';
import { JsonDirectoryStore } from '../../../infrastructure/mapping/evals/jsonDirectoryStore.ts';
const { evaluate, waitFor, waitForSelector, withHeadlessBrowser, captureScreenshot } = await import(pathToFileURL(path.join(homedir(), '.codex/skills/front-end/browser-test.mjs')).href);
const root = await mkdtemp(path.join(tmpdir(), 'experiment-overview-read-'));
let server;
try {
  await seedMappingFixture(root, { ascii: 'Fixture\n`-- Source', nodes: [] });
  const usageFile = path.join(root, 'usage.sqlite');
  const usageStore = new UsageStore(usageFile);
  const usageStart = Date.now() - 12 * 60 * 60_000;
  usageStore.set('startedAt', usageStart); usageStore.set('collectorAt', Date.now()); usageStore.set('pollAttemptAt', Date.now());
  const sample = (at, usedPercent) => ({ at, usedPercent, account: 'fixture', plan: 'pro', limitId: 'codex', windowMinutes: 10080, resetsAt: usageStart + 7 * 86400_000 });
  usageStore.sample(sample(usageStart, 0));
  for (let block = 0; block < 16; block++) {
    const at = usageStart + block * 45 * 60_000, model = block % 2 ? 'model-b' : 'model-a';
    usageStore.event({ id: `fixture-${block}`, at: at + 10 * 60_000, sessionId: model, model, effort: 'high', tier: 'standard', source: 'fixture',
      input: (block % 2 ? 2_000_000 : 1_000_000) - 100, cached: 100_000, cacheWrite: 0, output: 100, reasoning: 10 });
    for (let tick = 1; tick <= 9; tick++) usageStore.sample(sample(at + tick * 5 * 60_000, 2 * block + (tick === 9 ? 2 : 0)));
  }
  usageStore.close();
  const storeRoot = path.join(root, '.diagrams');
  const { id: projectId } = JSON.parse(await readFile(path.join(storeRoot, 'project.json'), 'utf8'));
  const { run } = evalOutputFixture(projectId);
  const text = '# Raw prompt\n\nKeep **literal** Markdown and {{context}}.\n\n```text\nRoot\n  child\n```';
  run.prompts = [{ promptId: 'pinned', name: 'Saved generation prompt', version: 7, stages: { proposal: text } }];
  run.cells = ['one', 'two'].map(key => ({ key, stage: 'proposal', status: 'finished', pass: 1, promptId: 'pinned', promptVersion: 7, output: { format: 'markdown', canvases: [] } }));
  run.status = 'finished';
  run.outputResults = Object.fromEntries(run.cells.map(cell => [cell.key, { schemaVersion: 1, format: 'markdown', markdown: `# Result ${cell.key}`, canvases: [], diagramRevisions: {} }]));
  const experiment = { schemaVersion: 1, id: 'read-study', projectId, revision: 1, name: 'Read study', description: '', createdAt: run.createdAt, updatedAt: run.createdAt,
    workflow: { id: 'study', name: 'Study workflow', version: 1, stages: [{ id: 'tree', name: 'Generate trees', dependsOn: [] }] },
    phases: [{ id: 'phase-2', name: 'Phase 2', description: 'Compare two variants' }],
    cases: [{ id: 'source', name: 'Source', agentContextId: run.agentContextId }],
    conditions: [{ id: 'a', name: 'A', description: 'First variant' }, { id: 'b', name: 'B', description: 'Second variant' }],
    samples: run.cells.map((cell, i) => ({ id: cell.key, phaseId: 'phase-2', caseId: 'source', conditionId: i ? 'b' : 'a', number: 1, attempt: 1, outputs: [{ stageId: 'tree', runId: run.id, cellKey: cell.key }] })), comparisons: [], lastRequest: { id: 'fixture', hash: 'fixture' } };
  await new JsonDirectoryStore(storeRoot, 'eval-runs').save(run);
  await new JsonDirectoryStore(storeRoot, 'eval-experiments').save(experiment);
  await new JsonDirectoryStore(storeRoot, 'eval-experiments').save({ ...experiment, id: 'other-study', name: 'Other study' });
  const runFile = path.join(storeRoot, 'eval-runs', `${run.id}.json`), experimentFile = path.join(storeRoot, 'eval-experiments', `${experiment.id}.json`);
  const before = await Promise.all([readFile(runFile, 'utf8'), readFile(experimentFile, 'utf8')]);
  const port = await new Promise(resolve => { const socket = createServer(); socket.listen(0, '127.0.0.1', () => { const port = socket.address().port; socket.close(() => resolve(port)); }); });
  const base = `http://127.0.0.1:${port}`;
  server = spawn(process.execPath, ['scripts/dev/start-server.mjs', 'preview', '--host', '127.0.0.1', '--port', String(port), '--strictPort'], {
    env: { ...process.env, NEW_DIAGRAM_PROJECT_ROOT: root, NEW_DIAGRAMS_DIR: storeRoot, NEW_DIAGRAM_AGENT: 'fake', NEW_DIAGRAM_USAGE_DB: usageFile }, stdio: 'ignore' });
  await waitFor(async () => (await fetch(base).catch(() => null))?.ok, { timeoutMs: 30000 });
  const response = await fetch(`${base}/api/mapping/evals/experiments/${experiment.id}/overview`);
  assert.equal(response.status, 200);
  const overview = await response.json();
  const flatten = node => [node, ...(node.children ?? []).flatMap(flatten)];
  const nodes = flatten(overview.root), phase = nodes.find(node => node.id === 'phase/phase-2');
  const promptRefs = phase.actions[0].refs;
  const outputRefs = nodes.flatMap(node => node.actions?.filter(action => action.label === 'output').flatMap(action => action.refs) ?? []);
  assert.equal(promptRefs.length, 1);
  assert.equal(outputRefs.length, 2);
  assert.ok(!JSON.stringify(overview).includes('# Raw prompt'));
  const read = await fetch(base + overview.read.url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ refs: [...promptRefs, ...outputRefs, 'missing'] }) });
  assert.equal(read.status, 200);
  const batch = await read.json();
  assert.equal(batch.results[0].value.text, text);
  assert.equal(batch.results[0].value.sources.length, 2);
  assert.equal(batch.results[0].value.sources[0].version, 7);
  assert.equal(batch.results[1].value.result.markdown, '# Result one');
  assert.equal(batch.results[2].value.result.markdown, '# Result two');
  assert.equal(batch.results[3].error.code, 'not-found');
  await withHeadlessBrowser({ url: 'about:blank', width: 1440, height: 1000, chromePath: process.env.CHROME_PATH || chromium.executablePath(), arguments: ['--no-sandbox'] }, async ({ cdp }) => {
    const errors = [];
    await cdp.send('Page.enable');
    let loads = 0;
    cdp.on('Page.loadEventFired', () => { loads++; });
    const reload = async () => {
      const before = loads;
      await cdp.send('Page.reload');
      await waitFor(() => loads > before);
    };
    await cdp.send('Runtime.enable'); cdp.on('Runtime.exceptionThrown', event => errors.push(event.exceptionDetails.text));
    await cdp.send('Fetch.enable', { patterns: [{ urlPattern: '*api/mapping/*' }] });
    cdp.on('Fetch.requestPaused', event => { const pathname = new URL(event.request.url).pathname;
      void (event.request.method === 'GET' || pathname.endsWith('/read') || (pathname.endsWith('/comments') || pathname.includes('/comments/')) ? cdp.send('Fetch.continueRequest', { requestId: event.requestId })
        : pathname.endsWith('/migrate') ? cdp.send('Fetch.fulfillRequest', { requestId: event.requestId, responseCode: 200, responseHeaders: [{ name: 'Content-Type', value: 'application/json' }], body: Buffer.from('{"migrated":0}').toString('base64') })
        : cdp.send('Fetch.failRequest', { requestId: event.requestId, errorReason: 'BlockedByClient' })).catch(() => {});
    });
    await cdp.send('Page.navigate', { url: `${base}/evals?experiment=${experiment.id}` });
    await waitForSelector(cdp, '.experiment-ascii-action', { timeoutMs: 30000 });
    const click = async selector => {
      const point = await evaluate(cdp, `(()=>{const el=document.querySelector(${JSON.stringify(selector)});el.scrollIntoView({block:'center'});const r=el.getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2}})()`);
      await cdp.send('Input.dispatchMouseEvent', { type: 'mousePressed', ...point, button: 'left', buttons: 1, clickCount: 1 });
      await cdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', ...point, button: 'left', buttons: 0, clickCount: 1 });
    };
    await cdp.send('Browser.grantPermissions', { origin: base, permissions: ['clipboardReadWrite', 'clipboardSanitizedWrite'] });
    await click('[aria-label="Copy experiment ID"]');
    await waitFor(async () => await evaluate(cdp, `document.querySelector('.experiment-title [role="status"]').textContent === 'Copied'`));
    assert.equal(await evaluate(cdp, 'navigator.clipboard.readText()'), experiment.id);
    await click('[aria-label="Collapse phase/phase-2"] ~ .experiment-ascii-action');
    await waitForSelector(cdp, '[aria-label="Raw prompt text"]', { timeoutMs: 10000 });
    const rawPrompt = JSON.stringify('[aria-label="Raw prompt text"]');
    assert.equal(await evaluate(cdp, `document.querySelector(${rawPrompt}).textContent`), text);
    assert.equal(await evaluate(cdp, `document.querySelector(${rawPrompt}).children.length`), 0);
    await captureScreenshot(cdp, { output: path.join(root, 'prompt.png') });
    await click('.evals-drawer-close');
    await click('[aria-label="Expand phase/phase-2/variant/a/outputs"]');
    const selector = '[aria-label="Collapse phase/phase-2/variant/a/outputs"]';
    assert.equal(await evaluate(cdp, `document.querySelector(${JSON.stringify(selector)}).getAttribute('aria-expanded')`), 'true');
    await click(selector);
    assert.equal(await evaluate(cdp, `!!document.querySelector(${JSON.stringify('[aria-label="Expand phase/phase-2/variant/a/outputs"]')})`), true);
    assert.deepEqual(await evaluate(cdp, `Array.from(document.querySelectorAll('[aria-label="Experiment views"] button')).map(el => el.textContent)`), ['Overview', 'Prompt ancestry']);
    assert.equal(await evaluate(cdp, `Array.from(document.querySelectorAll('summary')).some(el => el.textContent === 'Execution history')`), false);
    assert.deepEqual(await Promise.all([readFile(runFile, 'utf8'), readFile(experimentFile, 'utf8')]), before, 'Inspection must not change saved records');
    await click('[aria-label="Experiment views"] button:nth-child(2)');
    await waitForSelector(cdp, '[aria-label="Generation prompts"]');
    assert.equal(await evaluate(cdp, `new URL(location.href).searchParams.get('view')`), 'prompts');
    await reload();
    await waitForSelector(cdp, '[aria-label="Generation prompts"]');
    assert.equal(await evaluate(cdp, `document.querySelector('[aria-label="Experiment views"] [aria-current="page"]').textContent`), 'Prompt ancestry');
    await click('[aria-label="Experiment views"] button:first-child');
    await waitForSelector(cdp, '.experiment-ascii-action');
    assert.equal(await evaluate(cdp, `document.querySelector('.experiment-comments button[type="submit"]').disabled`), true);
    const note = 'Useful result.\nCompare the smaller variant next.';
    await click('.experiment-comments textarea');
    await cdp.send('Input.insertText', { text: note });
    await click('.experiment-comments input');
    await cdp.send('Input.insertText', { text: 'follow-up, useful' });
    // A draft survives switching between the experiment tabs.
    await click('[aria-label="Experiment views"] button:nth-child(2)');
    await waitForSelector(cdp, '[aria-label="Generation prompts"]');
    assert.equal(await evaluate(cdp, `document.querySelector('.experiment-comments textarea').value`), note);
    // A failed submission keeps the text available to retry.
    await cdp.send('Network.enable');
    await cdp.send('Network.setBlockedURLs', { urls: ['*comments'] });
    await click('.experiment-comments button[type="submit"]');
    await waitForSelector(cdp, '.experiment-comments [role="alert"]');
    assert.equal(await evaluate(cdp, `document.querySelector('.experiment-comments textarea').value`), note);
    await cdp.send('Network.setBlockedURLs', { urls: [] });
    await click('[aria-label="Experiment views"] button:first-child');
    await waitForSelector(cdp, '.experiment-ascii-action');
    await click('.experiment-comments button[type="submit"]');
    const commentSection = '.experiment-ascii-tree > li[data-node-id="comments"]';
    const commentSelector = commentSection + ' [data-node-id^="comment/"] .experiment-ascii-comment';
    await waitForSelector(cdp, commentSelector);
    assert.equal(await evaluate(cdp, `document.querySelector(${JSON.stringify(commentSelector)}).textContent`), '# ' + note);
    assert.equal(await evaluate(cdp, `document.querySelectorAll('.experiment-comments li').length`), 0);
    assert.equal(await evaluate(cdp, `document.querySelector(${JSON.stringify(commentSection + ' > .experiment-ascii-row strong')}).textContent`), 'Comments');
    assert.equal(await evaluate(cdp, `getComputedStyle(document.querySelector(${JSON.stringify(commentSelector)})).color`), 'rgb(250, 178, 131)');
    const positions = await evaluate(cdp, `(() => {
      const rows = [...document.querySelectorAll('.experiment-ascii-tree > li > .experiment-ascii-row')];
      return rows.map(row => row.getBoundingClientRect().left);
    })()`);
    assert.ok(positions.every(left => left === positions[0]), 'Comment section aligns with Inputs and phases');
    await waitFor(async () => await evaluate(cdp, `document.querySelector('.experiment-comments textarea').value === ''`));
    await captureScreenshot(cdp, { output: path.join(root, 'comments.png') });
    await reload();
    await waitForSelector(cdp, commentSelector);
    assert.equal(await evaluate(cdp, `document.querySelectorAll(${JSON.stringify(commentSelector)}).length`), 1);
    assert.equal(await evaluate(cdp, `document.querySelector(${JSON.stringify(commentSelector)}).textContent`), '# ' + note);
    assert.deepEqual(await evaluate(cdp, `Array.from(document.querySelectorAll('.experiment-comment-tag')).map(el => el.textContent)`), ['follow-up', 'useful']);
    await click('[aria-label="Edit comment tags"]');
    await click('.experiment-comment-tag-editor input');
    await cdp.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'a', code: 'KeyA', modifiers: 2, windowsVirtualKeyCode: 65 });
    await cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'a', code: 'KeyA', modifiers: 2, windowsVirtualKeyCode: 65 });
    await cdp.send('Input.insertText', { text: 'reviewed' });
    await click('.experiment-comment-tag-editor button[type="submit"]');
    await waitFor(async () => await evaluate(cdp, `document.querySelector('.experiment-comment-tag')?.textContent === 'reviewed'`));
    await reload();
    await waitForSelector(cdp, commentSelector);
    assert.equal(await evaluate(cdp, `document.querySelector('.experiment-comment-tag').textContent`), 'reviewed');
    await click('[aria-label="Edit comment"]');
    assert.equal(await evaluate(cdp, `document.querySelector('.experiment-comment-text-editor textarea').value`), note);
    await cdp.send('Input.insertText', { text: 'Discard this draft' });
    await click('.experiment-comment-text-editor button[type="button"]');
    assert.equal(await evaluate(cdp, `document.querySelector(${JSON.stringify(commentSelector)}).textContent`), '# ' + note);
    await click('[aria-label="Edit comment"]');
    await cdp.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'a', code: 'KeyA', modifiers: 2, windowsVirtualKeyCode: 65 });
    await cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'a', code: 'KeyA', modifiers: 2, windowsVirtualKeyCode: 65 });
    await cdp.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Backspace', code: 'Backspace', windowsVirtualKeyCode: 8 });
    await cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Backspace', code: 'Backspace', windowsVirtualKeyCode: 8 });
    assert.equal(await evaluate(cdp, `document.querySelector('.experiment-comment-text-editor button[type="submit"]').disabled`), true);
    const revised = 'Revised result.\nKeep the smaller variant.';
    await cdp.send('Input.insertText', { text: revised });
    await cdp.send('Network.setBlockedURLs', { urls: ['*comments/*'] });
    await click('.experiment-comment-text-editor button[type="submit"]');
    await waitForSelector(cdp, '[data-node-id="comments"] [role="alert"]');
    assert.equal(await evaluate(cdp, `document.querySelector('.experiment-comment-text-editor textarea').value`), revised);
    await cdp.send('Network.setBlockedURLs', { urls: [] });
    await click('.experiment-comment-text-editor button[type="submit"]');
    await waitFor(async () => await evaluate(cdp, `document.querySelector(${JSON.stringify(commentSelector)}).textContent === ${JSON.stringify('# ' + revised)}`));
    await reload();
    await waitForSelector(cdp, commentSelector);
    assert.equal(await evaluate(cdp, `document.querySelector(${JSON.stringify(commentSelector)}).textContent`), '# ' + revised);
    assert.equal(await evaluate(cdp, `document.querySelector('.experiment-comment-tag').textContent`), 'reviewed');
    // Failed deletion keeps the comment available; retry removes it persistently.
    await cdp.send('Network.setBlockedURLs', { urls: ['*comments/*'] });
    await click('[aria-label="Delete comment"]');
    await waitForSelector(cdp, '[data-node-id="comments"] [role="alert"]');
    assert.equal(await evaluate(cdp, `document.querySelectorAll(${JSON.stringify(commentSelector)}).length`), 1);
    await cdp.send('Network.setBlockedURLs', { urls: [] });
    await click('[aria-label="Delete comment"]');
    await waitFor(async () => await evaluate(cdp, `!document.querySelector(${JSON.stringify(commentSelector)})`));
    await reload();
    await waitForSelector(cdp, '.experiment-comments textarea');
    assert.equal(await evaluate(cdp, `document.querySelectorAll(${JSON.stringify(commentSelector)}).length`), 0);
    assert.deepEqual(await evaluate(cdp, `Array.from(document.querySelectorAll('.experiment-comments [aria-label="Saved tags"] button')).map(el => el.textContent)`), ['follow-up', 'reviewed', 'useful']);
    // Reuse the deleted comment's tag without typing it again.
    await click('.experiment-comments [aria-label="Use tag useful"]');
    await click('.experiment-comments textarea');
    await cdp.send('Input.insertText', { text: 'Another comment with a saved tag.' });
    await click('.experiment-comments button[type="submit"]');
    await waitForSelector(cdp, commentSelector);
    await reload();
    await waitForSelector(cdp, commentSelector);
    assert.equal(await evaluate(cdp, `document.querySelector('.experiment-comment-tag').textContent`), 'useful');
    await captureScreenshot(cdp, { output: path.join(root, 'comment-tags.png') });
    await cdp.send('Page.navigate', { url: `${base}/evals?experiment=other-study` });
    await waitForSelector(cdp, '.experiment-comments [aria-label="Use tag useful"]');
    await click('.experiment-comments [aria-label="Use tag useful"]');
    assert.equal(await evaluate(cdp, `document.querySelector('.experiment-comments input').value`), 'useful');
    const costButton = '.evals-header button';
    const costPosition = await evaluate(cdp, `(() => {const el=[...document.querySelectorAll(${JSON.stringify(costButton)})].find(el=>el.textContent==='Cost statistics');const r=el.getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2};})()`);
    await cdp.send('Input.dispatchMouseEvent', { type: 'mousePressed', ...costPosition, button: 'left', buttons: 1, clickCount: 1 });
    await cdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', ...costPosition, button: 'left', buttons: 0, clickCount: 1 });
    await waitForSelector(cdp, 'dialog[aria-label="Discard edits"]');
    await click('dialog[aria-label="Discard edits"] button.is-danger');
    await waitForSelector(cdp, 'table[aria-label="Tokens per one percent of weekly usage"]');
    assert.equal(await evaluate(cdp, `new URL(location.href).searchParams.has('cost-statistics')`), true);
    assert.equal(await evaluate(cdp, `document.querySelector('progress[aria-label="Weekly allowance used"]').value`), 32);
    assert.equal(await evaluate(cdp, `document.querySelector('table[aria-label="Tokens per one percent of weekly usage"]').textContent.includes('500,000')`), true);
    assert.equal(await evaluate(cdp, `document.querySelector('table[aria-label="Tokens per one percent of weekly usage"]').textContent.includes('1,000,000')`), true);
    await reload();
    await waitForSelector(cdp, 'table[aria-label="Tokens per one percent of weekly usage"]');
    const writer = new UsageStore(usageFile);
    writer.event({ id: 'live-update', at: Date.now(), sessionId: 'new-agent', model: 'live-model', effort: 'low', tier: 'standard', source: 'fixture', input: 200, cached: 100, cacheWrite: 0, output: 50, reasoning: 10 });
    writer.set('collectorAt', Date.now()); writer.close();
    await waitFor(async () => await evaluate(cdp, `document.querySelector('table[aria-label="Recent agent token usage"]').textContent.includes('live-model / low')`), { timeoutMs: 15000 });
    assert.equal(await evaluate(cdp, `document.querySelector('.cost-statistics').scrollWidth <= document.querySelector('.cost-statistics').clientWidth`), true);
    await captureScreenshot(cdp, { output: process.env.COST_SCREENSHOT || path.join(root, 'cost-statistics.png') });
    assert.deepEqual(errors, []);
  });
  assert.equal(await readFile(runFile, 'utf8'), before[0], 'Comments must not change output records');
  const saved = JSON.parse(await readFile(experimentFile, 'utf8'));
  assert.equal(saved.comments.length, 1);
  assert.equal(saved.revision, experiment.revision + 5);
  assert.deepEqual(saved.comments[0].tags, ['useful']);
  assert.deepEqual(saved.commentTags, ['follow-up', 'useful', 'reviewed']);
  assert.deepEqual(saved.samples, experiment.samples);
  console.log('PASS: overview/batch lookup, prompt inspection, ancestry navigation/reload, comments/tags/delete/reuse/retry/reload, unchanged output records.');
} finally {
  if (server) { const exited = new Promise(resolve => server.once('exit', resolve)); server.kill('SIGTERM'); await Promise.race([exited, new Promise(resolve => setTimeout(resolve, 5000))]); if (server.exitCode === null) { server.kill('SIGKILL'); await exited; } }
  await rm(root, { recursive: true, force: true });
}
