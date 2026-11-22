// npm run build && node --import tsx tests/browser/mapping/browser-experiment-phase-links-check.mjs
// Phase deep-links and Home map navigation in disposable data; no generation.
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
import { JsonDirectoryStore } from '../../../infrastructure/mapping/evals/jsonDirectoryStore.ts';
const { evaluate, waitFor, waitForSelector, withHeadlessBrowser, captureScreenshot } = await import(pathToFileURL(path.join(homedir(), '.codex/skills/front-end/browser-test.mjs')).href);
const root = await mkdtemp(path.join(tmpdir(), 'experiment-overview-read-'));
let server;
try {
  await seedMappingFixture(root, { ascii: 'Fixture\n`-- Source', nodes: [] });
  const storeRoot = path.join(root, '.diagrams');
  const { id: projectId } = JSON.parse(await readFile(path.join(storeRoot, 'project.json'), 'utf8'));
  const { run } = evalOutputFixture(projectId);
  const text = '# Raw prompt\n\nKeep **literal** Markdown and {{context}}.\n\n```text\nRoot\n  child\n```';
  run.prompts = [{ promptId: 'pinned', name: 'Saved generation prompt', version: 7, stages: { proposal: text } }];
  run.cells = ['one', 'two'].map(key => ({ key, stage: 'proposal', status: 'finished', pass: 1, promptId: 'pinned', promptVersion: 7, output: { format: 'markdown', canvases: [] } }));
  run.status = 'finished';
  run.outputResults = Object.fromEntries(run.cells.map(cell => [cell.key, { schemaVersion: 1, format: 'markdown', markdown: `# Result ${cell.key}`, canvases: [], diagramRevisions: {} }]));
  const experiment = { schemaVersion: 1, id: '7821c7da-cfcd-446d-8d7f-43b26df049fe', projectId, revision: 1, name: 'Read study', description: '', createdAt: run.createdAt, updatedAt: run.createdAt,
    workflow: { id: 'study', name: 'Study workflow', version: 1, stages: [{ id: 'tree', name: 'Generate trees', dependsOn: [] }] },
    phases: [{ id: 'canvas', name: 'Phase 1 · Core diagram → canvas', description: '' }, { id: 'expand', name: 'Phase 2 · Expand canvas', description: '' }],
    cases: [{ id: 'source', name: 'Source', agentContextId: run.agentContextId }],
    inputLineage: [{ caseId: 'source', agentContextId: run.agentContextId, sources: [{ label: 'Upstream sample', experimentId: 'other-study', runId: run.id, cellKey: 'one' }] }],
    conditions: [{ id: 'a', name: 'A', description: 'First variant' }, { id: 'b', name: 'B', description: 'Second variant' }],
    samples: run.cells.map((cell, i) => ({ id: cell.key, phaseId: i ? 'expand' : 'canvas', caseId: 'source', conditionId: i ? 'b' : 'a', number: 1, attempt: 1, outputs: [{ stageId: 'tree', runId: run.id, cellKey: cell.key }] })), comparisons: [], lastRequest: { id: 'fixture', hash: 'fixture' } };
  await new JsonDirectoryStore(storeRoot, 'eval-runs').save(run);
  await new JsonDirectoryStore(storeRoot, 'eval-experiments').save(experiment);
  await new JsonDirectoryStore(storeRoot, 'eval-experiments').save({ ...experiment, inputLineage: [], id: 'other-study', name: 'Other study' });
  const runFile = path.join(storeRoot, 'eval-runs', `${run.id}.json`), experimentFile = path.join(storeRoot, 'eval-experiments', `${experiment.id}.json`);
  const before = await Promise.all([readFile(runFile, 'utf8'), readFile(experimentFile, 'utf8')]);
  const port = await new Promise(resolve => { const socket = createServer(); socket.listen(0, '127.0.0.1', () => { const port = socket.address().port; socket.close(() => resolve(port)); }); });
  const base = `http://127.0.0.1:${port}`;
  server = spawn(process.execPath, ['scripts/dev/start-server.mjs', 'preview', '--host', '127.0.0.1', '--port', String(port), '--strictPort'], {
    env: { ...process.env, NEW_DIAGRAM_PROJECT_ROOT: root, NEW_DIAGRAMS_DIR: storeRoot, NEW_DIAGRAM_AGENT: 'fake' }, stdio: 'ignore' });
  await waitFor(async () => (await fetch(base).catch(() => null))?.ok, { timeoutMs: 30000 });
  await withHeadlessBrowser({ url: 'about:blank', width: 1440, height: 1000, chromePath: process.env.CHROME_PATH || chromium.executablePath(), arguments: ['--no-sandbox'] }, async ({ cdp }) => {
    await cdp.send('Page.enable'); await cdp.send('Runtime.enable');
    let loads = 0;
    cdp.on('Page.loadEventFired', () => { loads++; });
    const load = async (method, params = {}) => {
      const previous = loads;
      await cdp.send(method, params);
      await waitFor(() => loads > previous);
    };
    const errors = [];
    cdp.on('Runtime.exceptionThrown', event => errors.push(event.exceptionDetails.text));
    const click = async selector => {
      const point = await evaluate(cdp, `(()=>{const el=document.querySelector(${JSON.stringify(selector)});el.scrollIntoView({block:'center'});const r=el.getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2}})()`);
      await cdp.send('Input.dispatchMouseEvent', { type: 'mousePressed', ...point, button: 'left', buttons: 1, clickCount: 1 });
      await cdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', ...point, button: 'left', buttons: 0, clickCount: 1 });
    };
    const mapFile = name => readFile(new URL('../../../artifacts/experiment-map-2026-11-20/' + name, import.meta.url), 'utf8');
    const map = JSON.parse(await mapFile('links.json'));
    const checkMapLinks = async () => {
      assert.equal(await evaluate(cdp, `document.querySelectorAll('.experiment-home-id').length`), Object.keys(map.experiments).length);
      const expected = {
        'd6db3d5a-0042-4bc3-b633-c1ffc3027efd': ['core', 'p1', 'p2', 'p3'],
        'f579350b-0a1a-5ddb-8c2c-e0ea72e2335e': ['baseline'],
        '044f0072-fded-4c61-b694-2a75fd2433ca': ['core', 'expand', 'expand2'],
        '62f5c79a-07c0-5e5e-acbb-d41ee64acdda': ['critique'],
      };
      for (const [id, phases] of Object.entries(expected)) {
        const selector = `.experiment-home a.experiment-phase-link[href*="${id}"]`;
        const links = await evaluate(cdp, `Array.from(document.querySelectorAll(${JSON.stringify(selector)}), a => new URL(a.href).searchParams.get('focusPhase'))`);
        assert.deepEqual(new Set(links), new Set(phases));
      }
    };
    const target = `.experiment-home a[href*="${experiment.id}"][href$="focusPhase=expand"]`;
    const focused = '[data-node-id="phase/expand"] > .experiment-phase-focused';
    await load('Page.navigate', { url: `${base}/evals` });
    await waitForSelector(cdp, target);
    await checkMapLinks();
    assert.equal(await evaluate(cdp, `getComputedStyle(document.querySelector(${JSON.stringify(target)})).color !== getComputedStyle(document.querySelector('.experiment-home-id')).color`), true);
    await click(target);
    await waitForSelector(cdp, focused);
    assert.equal(await evaluate(cdp, `new URL(location.href).searchParams.get('focusPhase')`), 'expand');
    assert.equal(await evaluate(cdp, `document.querySelectorAll('.experiment-overview > ul > li[data-node-id^="phase/"]').length`), 2);
    assert.equal(await evaluate(cdp, `document.activeElement.matches(${JSON.stringify(focused)})`), true);
    assert.equal(await evaluate(cdp, `getComputedStyle(document.querySelector(${JSON.stringify(focused)})).backgroundColor !== 'rgba(0, 0, 0, 0)'`), true);
    await cdp.send('Browser.grantPermissions', { origin: base, permissions: ['clipboardReadWrite', 'clipboardSanitizedWrite'] });
    const copy = '[data-node-id="phase/expand"] > .experiment-ascii-row [aria-label="Copy phase ID"]';
    const fullPhaseId = `experiment/${experiment.id}/phase/expand`;
    assert.equal(await evaluate(cdp, `document.querySelector(${JSON.stringify(copy)}).title`), `Copy phase ID: ${fullPhaseId}`);
    await click(copy);
    await waitFor(async () => await evaluate(cdp, `navigator.clipboard.readText()`) === fullPhaseId);
    const [, copiedExperimentId, ...phasePath] = (await evaluate(cdp, `navigator.clipboard.readText()`)).split('/');
    const overview = await (await fetch(`${base}/api/mapping/evals/experiments/${copiedExperimentId}/overview`)).json();
    assert.equal(overview.root.children.find(node => node.id === phasePath.join('/'))?.label, experiment.phases[1].name);
    assert.equal(await evaluate(cdp, `document.querySelector(${JSON.stringify(copy)}).nextElementSibling.textContent`), 'Copied');
    await captureScreenshot(cdp, { output: path.join(root, 'phase-focus.png') });
    await load('Page.reload');
    await waitForSelector(cdp, focused);
    await click('[aria-label="Collapse phase/canvas"]');
    await click('[data-node-id="phase/canvas"] > .experiment-ascii-row .experiment-phase-link');
    await waitForSelector(cdp, '[data-node-id="phase/canvas"] > .experiment-phase-focused');
    assert.equal(await evaluate(cdp, `document.querySelector('[aria-label="Collapse phase/canvas"]').getAttribute('aria-expanded')`), 'true');
    assert.equal(await evaluate(cdp, `document.querySelectorAll('.experiment-phase-focused').length`), 1);
    await click('[data-node-id="phase/canvas"] > .experiment-ascii-row [aria-label="Copy phase ID"]');
    await waitFor(async () => await evaluate(cdp, `navigator.clipboard.readText()`) === `experiment/${experiment.id}/phase/canvas`);
    await load('Page.navigate', { url: `${base}/evals` });
    await waitForSelector(cdp, target);
    await click('.experiment-home-views button:nth-child(2)');
    await waitForSelector(cdp, '[aria-label="Experiments by creation date"]');
    await checkMapLinks();
    await click(target);
    await waitForSelector(cdp, focused);
    await load('Page.navigate', { url: `${base}/evals` });
    const styleView = '.experiment-home-tree[aria-label="Diagram Styles"]';
    const canvasView = '.experiment-home-tree[aria-label="3+1 canvas expansion"]';
    await waitForSelector(cdp, '.experiment-home-views');
    await click('.experiment-home-views button:nth-child(4)');
    await waitForSelector(cdp, styleView);
    assert.equal(await evaluate(cdp, 'location.search'), '?view=diagram-styles');
    const styleTree = await evaluate(cdp, `document.querySelector(${JSON.stringify(styleView)}).textContent`);
    assert.match(styleTree, /Nov 13–14 · \[E10\]/);
    assert.match(styleTree, /Nov 14 · \[E10\]/);
    assert.doesNotMatch(styleTree, /E12|E18/);
    assert.deepEqual(await evaluate(cdp, `Array.from(document.querySelectorAll('.experiment-home .experiment-phase-link'), el => new URL(el.href).searchParams.get('focusPhase'))`), ['phase-2', 'prompt-trial', 'fewshot-trial']);
    await click('[aria-label="Collapse Change the examples"]');
    await load('Page.reload');
    await waitForSelector(cdp, '[aria-label="Expand Change the examples"]');
    await click('.experiment-home-views button:nth-child(3)');
    await waitForSelector(cdp, canvasView);
    assert.equal(await evaluate(cdp, 'location.search'), '?view=3plus1-canvas-expansion');
    const canvasPhases = [...(await mapFile('3plus1-canvas-expansion.txt')).matchAll(/\]\(E\d+\/([^)]+)\)/g)].map(match => match[1]);
    assert.deepEqual(await evaluate(cdp, `Array.from(document.querySelectorAll('.experiment-home .experiment-phase-link'), el => new URL(el.href).searchParams.get('focusPhase'))`), canvasPhases);
    await click(target);
    await waitForSelector(cdp, focused);
    const { entries, currentIndex } = await cdp.send('Page.getNavigationHistory');
    await cdp.send('Page.navigateToHistoryEntry', { entryId: entries[currentIndex - 1].id });
    await waitForSelector(cdp, canvasView);
    // Explicit open and closed choices survive unmounts and reloads, scoped by experiment.
    await load('Page.navigate', { url: `${base}/evals?experiment=${experiment.id}` });
    await waitForSelector(cdp, '[aria-label="Expand phase/expand/variant/b/outputs"]');
    await click('[aria-label="Expand phase/expand/variant/b/outputs"]');
    await click('[aria-label="Collapse phase/expand"]');
    await load('Page.reload');
    await waitForSelector(cdp, '[aria-label="Expand phase/expand"]');
    await click('[aria-label="Expand phase/expand"]');
    await waitForSelector(cdp, '[aria-label="Collapse phase/expand/variant/b/outputs"]');
    await click('[aria-label="Collapse phase/expand"]');
    await load('Page.navigate', { url: `${base}/evals?experiment=other-study` });
    await waitForSelector(cdp, '[aria-label="Collapse phase/expand"]');
    await load('Page.navigate', { url: `${base}/evals?experiment=${experiment.id}` });
    await waitForSelector(cdp, '[aria-label="Expand phase/expand"]');
    await load('Page.navigate', { url: `${base}/evals?experiment=${experiment.id}&focusPhase=expand` });
    await waitForSelector(cdp, '[aria-label="Collapse phase/expand"]');
    await waitForSelector(cdp, focused);
    // Home caches each view independently, including bulk expand/collapse choices.
    await load('Page.navigate', { url: `${base}/evals` });
    await waitForSelector(cdp, '[aria-label="Collapse Style and representation"]');
    await click('[aria-label="Collapse Style and representation"]');
    await click('.experiment-home-views button:nth-child(2)');
    const dateToggle = '.experiment-home-tree > ul > li:first-child > .experiment-ascii-row .experiment-ascii-toggle';
    await click(dateToggle);
    await click('.experiment-home-views button:first-child');
    await waitForSelector(cdp, '[aria-label="Expand Style and representation"]');
    await load('Page.reload');
    await waitForSelector(cdp, '[aria-label="Expand Style and representation"]');
    await click('.experiment-home-views button:nth-child(2)');
    assert.equal(await evaluate(cdp, `document.querySelector(${JSON.stringify(dateToggle)}).getAttribute('aria-expanded')`), 'false');
    await click('.experiment-home-views button:first-child');
    await click('.experiment-home-controls > button:last-child');
    await load('Page.reload');
    await waitForSelector(cdp, '.experiment-home-tree');
    assert.equal(await evaluate(cdp, `document.querySelectorAll('.experiment-home-tree button[aria-expanded="true"]').length`), 0);
    await click('.experiment-home-controls > button:nth-last-child(2)');
    await load('Page.reload');
    await waitForSelector(cdp, '.experiment-home-tree');
    assert.equal(await evaluate(cdp, `document.querySelectorAll('.experiment-home-tree button[aria-expanded="false"]').length`), 0);
    const cookies = await cdp.send('Network.getCookies', { urls: [`${base}/evals`] });
    const cookie = cookies.cookies.find(cookie => cookie.name === 'eval-tree-expansion-v1');
    assert.ok(cookie && cookie.expires > Date.now() / 1000 && cookie.size < 4096);
    // A directly shared URL restores focus in a fresh page, including unknown targets gracefully.
    await load('Page.navigate', { url: `${base}/evals?experiment=${experiment.id}&focusPhase=missing` });
    await waitForSelector(cdp, '.experiment-overview');
    assert.equal(await evaluate(cdp, `document.querySelectorAll('.experiment-phase-focused').length`), 0);
    await click('[aria-label="Expand inputs/cases"]');
    const upstream = '[data-node-id="inputs/case/source/source/0"] a';
    await waitForSelector(cdp, upstream);
    await click(upstream);
    await waitForSelector(cdp, '.explorer-overview-title[title="Other study"]');
    assert.equal(await evaluate(cdp, "new URLSearchParams(location.search).get('output')"), 'one');
    assert.equal(await evaluate(cdp, "new URLSearchParams(location.search).get('run')"), run.id);
    await evaluate(cdp, 'history.back()');
    await waitFor(async () => await evaluate(cdp, `document.activeElement.matches('[data-node-id="inputs/case/source/source/0"] > .experiment-ascii-row')`));
    assert.deepEqual(errors, []);
  });
  assert.deepEqual(await Promise.all([readFile(runFile, 'utf8'), readFile(experimentFile, 'utf8')]), before);
  console.log('PASS: Home map, relationship/date phase links, distinct colors, focused phase expansion, sibling visibility, reload, phase ID clipboard, cookie persistence, per-view/experiment isolation, bulk collapse/expand and invalid targets.');
} finally {
  if (server) { const exited = new Promise(resolve => server.once('exit', resolve)); server.kill('SIGTERM'); await Promise.race([exited, new Promise(resolve => setTimeout(resolve, 5000))]); if (server.exitCode === null) { server.kill('SIGKILL'); await exited; } }
  await rm(root, { recursive: true, force: true });
}
