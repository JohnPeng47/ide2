import { mainSource, mathSource, tsconfig } from './tests/fixtures/source-navigation/source.mjs';
import { checkSourceNavigation } from './browser-source-navigation-check.mjs';
import assert from 'node:assert/strict';
import { spawn, execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { createServer } from 'node:net';
import { homedir, tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { sourceText } from './tests/fixtures/source-pane-performance/source.mjs';

const { evaluate, waitFor, waitForSelector, withHeadlessBrowser, captureScreenshot } = await import(
  pathToFileURL(path.join(homedir(), '.codex/skills/front-end/browser-test.mjs')).href);
const root = path.dirname(fileURLToPath(import.meta.url));
const baseline = process.env.SOURCE_PERF_BASELINE === '1';
const explorersOpen = process.env.SOURCE_PERF_EXPLORERS === '1';
const trials = Number(process.env.SOURCE_PERF_TRIALS ?? 3);
assert.ok(Number.isInteger(trials) && trials >= 0 && trials <= 4, 'SOURCE_PERF_TRIALS must be an integer from 0 through 4');
const temp = await mkdtemp(path.join(tmpdir(), 'source-pane-performance-'));
const reportPath = path.resolve(process.env.SOURCE_PERF_REPORT ?? 'artifacts/source-pane-performance/latest.json');
const steps = 40, cadenceMs = 1000 / 60;
let server;
const pane = id => `[data-display-node="source-${id}"]`;
const viewer = id => `${pane(id)} .source-code-viewer`;
const metrics = async cdp => Object.fromEntries((await cdp.send('Performance.getMetrics')).metrics.map(m => [m.name, m.value]));
const percentile = (values, q) => [...values].sort((a, b) => a - b)[Math.max(0, Math.ceil(values.length * q) - 1)] ?? 0;
const round = n => Math.round(n * 100) / 100;

async function point(cdp, selector, dx = 80, dy = 80) {
  return evaluate(cdp, `(() => {
    const el = document.querySelector(${JSON.stringify(selector)}), r = el.getBoundingClientRect();
    const x = r.left + Math.min(${dx}, r.width / 2), y = r.top + Math.min(${dy}, r.height / 2);
    if (!el.contains(document.elementFromPoint(x, y))) throw new Error('Occluded target: ' + ${JSON.stringify(selector)});
    return {x, y};
  })()`);
}
async function click(cdp, selector) {
  const p = await point(cdp, selector, 12, 10);
  await cdp.send('Input.dispatchMouseEvent', { type: 'mousePressed', ...p, button: 'left', buttons: 1, clickCount: 1 });
  await cdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', ...p, button: 'left', clickCount: 1 });
}
async function settle(cdp) {
  await evaluate(cdp, `new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))`);
}
async function reload(cdp) {
  let loaded = false;
  const unsubscribe = cdp.on('Page.loadEventFired', () => { loaded = true; });
  try {
    await cdp.send('Page.reload', {ignoreCache: true});
    await waitFor(() => loaded, {timeoutMs: 60000, message: 'Reload did not complete'});
    await waitForSelector(cdp, '[data-project-diagram="source"]', {timeoutMs: 60000});
  } finally { unsubscribe(); }
}
async function positions(cdp) {
  return evaluate(cdp, `Object.fromEntries([...document.querySelectorAll('[data-pane-content="source-code"]')].map(p => {
    const v = p.querySelector('.source-code-viewer'); return [p.dataset.displayNode, v ? {top: v.scrollTop, left: v.scrollLeft} : null];
  }))`);
}
async function measure(cdp, kind, count, trial) {
  const p = await point(cdp, viewer(1));
  const initial = await positions(cdp);
  const transform = await evaluate(cdp, `document.querySelector('.diagram-canvas__surface').style.transform`);
  await settle(cdp);
  await evaluate(cdp, `(() => {
    const state = window.__sourcePerf = {frames: [], last: performance.now(), chunkReads: 0, sourceMutations: 0, longTasks: []};
    state.original = window.getComputedStyle;
    window.getComputedStyle = function(el, ...args) {
      if (el.classList?.contains('source-code-chunk')) state.chunkReads++;
      return state.original.call(this, el, ...args);
    };
    state.mo = new MutationObserver(records => state.sourceMutations += records.length);
    document.querySelectorAll('.source-code-content').forEach(el => state.mo.observe(el, {subtree: true, childList: true, attributes: true, characterData: true}));
    state.po = new PerformanceObserver(list => state.longTasks.push(...list.getEntries().map(e => e.duration)));
    state.po.observe({type: 'longtask'});
    const tick = time => { state.frames.push(time - state.last); state.last = time; state.raf = requestAnimationFrame(tick); };
    state.raf = requestAnimationFrame(tick);
  })()`);
  const before = await metrics(cdp), start = performance.now();
  if (kind === 'drag') await cdp.send('Input.dispatchMouseEvent', {type: 'mousePressed', ...p, button: 'middle', buttons: 4, clickCount: 1});
  for (let step = 1; step <= steps; step++) {
    if (kind === 'drag') {
      const d = step <= steps / 2 ? step : steps - step;
      await cdp.send('Input.dispatchMouseEvent', {type: 'mouseMoved', x: p.x + d * 3, y: p.y + d, button: 'middle', buttons: 4});
      if (step === steps / 2) assert.notEqual(await evaluate(cdp, `document.querySelector('.diagram-canvas__surface').style.transform`), transform);
    } else {
      await cdp.send('Input.dispatchMouseEvent', {type: 'mouseWheel', ...p, deltaX: 0, deltaY: 60});
    }
    const remaining = start + step * cadenceMs - performance.now();
    if (remaining > 0) await new Promise(resolve => setTimeout(resolve, remaining));
  }
  if (kind === 'drag') await cdp.send('Input.dispatchMouseEvent', {type: 'mouseReleased', ...p, button: 'middle', buttons: 0});
  else await waitFor(async () => (await positions(cdp))['source-1']?.top >= initial['source-1'].top + steps * 60 - 1,
    { message: 'Wheel input did not scroll the target pane by the requested distance' });
  await settle(cdp);
  const elapsedMs = performance.now() - start, after = await metrics(cdp);
  const observation = await evaluate(cdp, `(() => {
    const s = window.__sourcePerf; cancelAnimationFrame(s.raf); s.mo.disconnect(); s.po.disconnect(); window.getComputedStyle = s.original;
    return {frames: s.frames.slice(1), chunkReads: s.chunkReads, sourceMutations: s.sourceMutations, longTasks: s.longTasks};
  })()`);
  const final = await positions(cdp);
  assert.equal(await evaluate(cdp, `document.querySelector('.diagram-canvas__surface').style.transform`), transform);
  if (kind === 'drag') assert.deepEqual(final, initial, 'Dragging preserves every source viewport');
  else for (let id = 2; id <= count; id++) assert.deepEqual(final[`source-${id}`], initial[`source-${id}`], 'Scrolling is local to one pane');
  if (!baseline) {
    assert.equal(observation.chunkReads, 0, 'Gestures must not remeasure the full source');
    assert.equal(observation.sourceMutations, 0, 'Gestures must not rebuild source rows or reset block containment');
  }
  return { panes: count, gesture: kind, trial, elapsedMs: round(elapsedMs),
    mainThreadMs: round((after.TaskDuration - before.TaskDuration) * 1000),
    scriptMs: round((after.ScriptDuration - before.ScriptDuration) * 1000),
    layoutMs: round((after.LayoutDuration - before.LayoutDuration) * 1000),
    styleMs: round((after.RecalcStyleDuration - before.RecalcStyleDuration) * 1000),
    frameP95Ms: round(percentile(observation.frames, .95)), frameMaxMs: round(Math.max(...observation.frames)),
    frames: observation.frames.length, framesOver25Ms: observation.frames.filter(n => n > 25).length,
    longTasks: observation.longTasks.length, chunkReads: observation.chunkReads, sourceMutations: observation.sourceMutations };
}

try {
  execFileSync('git', ['init', '-q', temp]);
  const hash = text => createHash('sha256').update(text).digest('hex');
  const projectId = `project-${hash(path.join(temp, '.git')).slice(0, 12)}`;
  const fixture = await readFile(path.join(root, 'tests/fixtures/source-pane-performance/workspace.json'), 'utf8');
  const workspace = JSON.parse(fixture.replaceAll('performance-fixture', projectId));
  if (explorersOpen) for (const node of Object.values(workspace.documents[0].canvas.display.nodes)) if (node.kind === 'selection') node.position.x -= 180;
  const doc = workspace.documents[0], timestamp = '2026-09-10T00:00:00.000Z';
  const representation = { schemaVersion: 1, id: 'source', projectId, handle: 'source', name: doc.name, viewKind: 'diagram',
    representationKind: 'diagram', status: 'settled', currentRevisionId: 'revision-source', revisionIds: ['revision-source'], createdAt: timestamp, updatedAt: timestamp };
  const revision = { schemaVersion: 1, id: 'revision-source', projectId, representationId: 'source', revision: 1,
    ascii: doc.document.scene.contents.overview.ascii, asciiSha256: hash(doc.document.scene.contents.overview.ascii),
    representationKind: 'diagram', evidence: {}, mappings: [], content: {kind: 'mapping-canvas', scene: doc.document.scene}, createdAt: timestamp };
  const other = {...representation, id: 'other', handle: 'other', name: 'Other document', currentRevisionId: 'revision-other', revisionIds: ['revision-other']};
  const otherRevision = {...revision, id: 'revision-other', representationId: 'other'};
  await mkdir(path.join(temp, '.diagrams/representations'), {recursive: true});
  await mkdir(path.join(temp, 'src'));
  await writeFile(path.join(temp, 'src/large.ts'), sourceText);
  await writeFile(path.join(temp, 'src/math.ts'), mathSource);
  await writeFile(path.join(temp, 'src/main.ts'), mainSource);
  await writeFile(path.join(temp, 'tsconfig.json'), JSON.stringify(tsconfig));
  await writeFile(path.join(temp, '.diagrams/project.json'), JSON.stringify({ schemaVersion: 1, id: projectId, name: doc.name,
    repositoryIdentity: path.join(temp, '.git'), canonicalRepoRoot: temp, domainProfileId: 'source-code', corpus: {kind: 'git-worktree', root: temp},
    diagramSetIds: [], createdAt: timestamp, updatedAt: timestamp }));
  await writeFile(path.join(temp, '.diagrams/representations/catalog.json'), JSON.stringify({schemaVersion: 1, projectId,
    activeByKind: {diagram: 'source'}, representations: {source: representation, other},
    revisions: {'revision-source': revision, 'revision-other': otherRevision}, projections: {}, createdAt: timestamp, updatedAt: timestamp}));
  await writeFile(path.join(temp, '.diagrams/mapping-workspace.json'), JSON.stringify(workspace));
  const port = await new Promise(resolve => { const s = createServer(); s.listen(0, '127.0.0.1', () => {const p = s.address().port; s.close(() => resolve(p));}); });
  const url = `http://127.0.0.1:${port}`;
  server = spawn(process.execPath, ['node_modules/vite/bin/vite.js', 'preview', '--host', '127.0.0.1', '--port', String(port), '--strictPort'],
    {cwd: root, env: {...process.env, NEW_DIAGRAM_PROJECT_ROOT: temp, NEW_DIAGRAM_AGENT: 'fake'}, stdio: 'ignore'});
  await waitFor(async () => (await fetch(url).catch(() => null))?.ok, {timeoutMs: 15000});
  const results = [];
  let browserVersion;
  await withHeadlessBrowser({url: `${url}/mapping`, width: 2400, height: 1500}, async ({cdp, profilePath}) => {
    await cdp.send('Page.enable'); await cdp.send('Runtime.enable'); await cdp.send('Performance.enable');
    browserVersion = await cdp.send('Browser.getVersion');
    const errors = [];
    cdp.on('Runtime.exceptionThrown', ({exceptionDetails}) => errors.push(exceptionDetails.exception?.description ?? exceptionDetails.text));
    cdp.on('Page.javascriptDialogOpening', ({type, message}) => {
      console.log(`Fixture dialog (${type}): ${message}`);
      void cdp.send('Page.handleJavaScriptDialog', {accept: true});
    });
    await waitForSelector(cdp, `${viewer(5)}[data-highlighted=true]`, {timeoutMs: 60000});
    await evaluate(cdp, 'document.fonts.ready'); await settle(cdp);
    for (let id = 1; id <= 5; id++) await point(cdp, viewer(id));
    for (let id = 5; id >= 2; id--) await click(cdp, `${pane(id)} [aria-label="Collapse pane"]`);
    for (let count = 1; count <= 5; count++) {
      if (count > 1) await click(cdp, `${pane(count)} [aria-label="Expand pane"]`);
      await waitFor(async () => await evaluate(cdp, `document.querySelectorAll('.source-code-viewer[data-highlighted=true]').length === ${count}`));
      if (explorersOpen) {
        await click(cdp, `${pane(count)} [aria-label="Toggle repository files"]`);
        await waitForSelector(cdp, `${pane(count)} [data-directory="src"]`);
        await click(cdp, `${pane(count)} [data-directory="src"]`);
        await waitForSelector(cdp, `${pane(count)} [data-repository-file="src/main.ts"]`);
      }
      await settle(cdp);
      for (let trial = 1; trial <= trials; trial++) for (const gesture of ['drag', 'scroll']) {
        const result = await measure(cdp, gesture, count, trial); results.push(result); console.log(JSON.stringify(result));
      }
    }
    if (explorersOpen) {
      await mkdir(path.dirname(reportPath), {recursive: true});
      await captureScreenshot(cdp, {output: reportPath.replace(/\.json$/, '.explorers.png')});
    }
    if (explorersOpen) for (let id = 1; id <= 5; id++) await click(cdp, `${pane(id)} [aria-label="Toggle repository files"]`);
    console.log('Persistence: independent pane positions and collapsed-pane save');
    // Exercise independent horizontal and vertical positions, including a pane hidden before saving.
    for (let id = 1; id <= 5; id++) {
      const p = await point(cdp, viewer(id)), before = (await positions(cdp))[`source-${id}`];
      await cdp.send('Input.dispatchMouseEvent', {type: 'mouseWheel', ...p, deltaX: 30 * id, deltaY: 90 * id});
      await waitFor(async () => {
        const current = (await positions(cdp))[`source-${id}`];
        return current.top >= before.top + 90 * id - 1 && current.left >= before.left + 30 * id - 1;
      });
    }
    const beforeSave = await positions(cdp);
    await click(cdp, `${pane(5)} [aria-label="Collapse pane"]`);
    await click(cdp, '[data-project-diagram="other"]');
    await waitForSelector(cdp, '.mapping-document-view[hidden] [data-display-node="source-1"]');
    await click(cdp, '.mapping-workspace-actions button:first-child');
    await waitFor(async () => {
      const saved = await (await fetch(`${url}/api/mapping/workspace`)).json();
      return saved?.activeDocumentId === 'other';
    });
    const hiddenSnapshot = await (await fetch(`${url}/api/mapping/workspace`)).json();
    for (let id = 1; id <= 5; id++) assert.deepEqual(hiddenSnapshot.documents[0].canvas.display.nodes[`source-${id}`].content.scroll,
      beforeSave[`source-${id}`], 'Inactive documents retain their source offsets');
    await reload(cdp);
    await waitForSelector(cdp, '.mapping-document-view[hidden] [data-display-node="source-1"]');
    await click(cdp, '[data-project-diagram="source"]');
    await waitForSelector(cdp, '.mapping-document-view:not([hidden]) [data-display-node="source-1"]');
    await waitFor(async () => (await positions(cdp))['source-1']?.top === beforeSave['source-1'].top,
      {message: 'A source document restored in the background must restore its viewport when activated'});
    await click(cdp, '.mapping-workspace-actions button:first-child');
    await waitFor(async () => {
      const saved = await (await fetch(`${url}/api/mapping/workspace`)).json();
      return saved?.activeDocumentId === 'source' && saved.documents[0].canvas.display.nodes['source-1'].content.scroll?.top === beforeSave['source-1'].top;
    }, {message: 'Immediate workspace save must capture the current source position'});
    const saved = await (await fetch(`${url}/api/mapping/workspace`)).json();
    for (let id = 1; id <= 5; id++) assert.deepEqual(saved.documents[0].canvas.display.nodes[`source-${id}`].content.scroll, beforeSave[`source-${id}`]);
    await click(cdp, `${pane(5)} [aria-label="Expand pane"]`);
    const exportPosition = {...beforeSave['source-1'], top: beforeSave['source-1'].top + 180};
    await cdp.send('Input.dispatchMouseEvent', {type: 'mouseWheel', ...await point(cdp, viewer(1)), deltaX: 0, deltaY: 180});
    await waitFor(async () => (await positions(cdp))['source-1']?.top >= exportPosition.top - 1);
    const downloads = path.join(profilePath, 'downloads');
    await mkdir(downloads, {recursive: true});
    const browserPath = downloads.startsWith('/mnt/') ? execFileSync('wslpath', ['-w', downloads], {encoding: 'utf8'}).trim() : downloads;
    await cdp.send('Browser.setDownloadBehavior', {behavior: 'allow', downloadPath: browserPath});
    console.log('Persistence: export live positions');
    await click(cdp, '.mapping-workspace-actions button:nth-child(3)');
    let exported;
    await waitFor(async () => {
      try { exported = JSON.parse(await readFile(path.join(downloads, 'mapping-workspace.json'), 'utf8')); return true; }
      catch { return false; }
    }, {message: 'Workspace export did not finish'});
    assert.deepEqual(exported.documents[0].canvas.display.nodes['source-1'].content.scroll, exportPosition, 'Export samples the live position without a prior save');
    console.log('Persistence: restore discards live positions');
    await click(cdp, '.mapping-workspace-actions button:nth-child(2)');
    await waitFor(async () => (await positions(cdp))['source-1']?.top === beforeSave['source-1'].top, {message: 'Restore discards the newer runtime cache'});
    console.log('Persistence: reload saved workspace');
    await reload(cdp);
    await waitForSelector(cdp, `${viewer(4)}[data-highlighted=true]`, {timeoutMs: 60000});
    await click(cdp, `${pane(5)} [aria-label="Expand pane"]`);
    await waitFor(async () => JSON.stringify(await positions(cdp)) === JSON.stringify(beforeSave), {message: 'Reload must restore all five source positions'});
    await click(cdp, `${pane(1)} [aria-label="Collapse pane"]`);
    await click(cdp, `${pane(1)} [aria-label="Expand pane"]`);
    await waitFor(async () => (await positions(cdp))['source-1']?.top === beforeSave['source-1'].top);
    await click(cdp, '.mapping-workspace-actions button:first-child');
    await waitFor(async () => (await (await fetch(`${url}/api/mapping/workspace`)).json()).documents[0].canvas.display.nodes['source-5'].expansion === 'expanded');
    await mkdir(path.dirname(reportPath), {recursive: true});
    if (process.env.SOURCE_NAVIGATION === '1') await checkSourceNavigation({ cdp, url, evaluate, waitFor, waitForSelector, click, pane, viewer, reload, captureScreenshot,
      screenshotPath: reportPath.replace(/\.json$/, '.navigation.png') });
    await captureScreenshot(cdp, {output: reportPath.replace(/\.json$/, '.png')});
    await writeFile(reportPath.replace(/\.json$/, '.workspace.json'), JSON.stringify(await (await fetch(`${url}/api/mapping/workspace`)).json(), null, 2));
    assert.deepEqual(errors, []);
  });
  const report = { baseline, explorersOpen, navigationChecked: process.env.SOURCE_NAVIGATION === '1', createdAt: new Date().toISOString(), browser: browserVersion, sourceLines: 3000, fixtureSha256: hash(fixture),
    viewport: {width: 2400, height: 1500}, steps, cadenceMs, trials,
    notes: 'Sequential real CDP gestures. Frame intervals are main-thread requestAnimationFrame observations, not compositor dropped-frame counts. CPU metrics overlap. Scroll targets pane 1; every expanded pane is onscreen.', results };
  await writeFile(reportPath, JSON.stringify(report, null, 2));
  console.log(`Source pane performance and persistence checks passed. Report: ${reportPath}`);
} finally {
  if (server?.exitCode === null) { server.kill('SIGTERM'); await new Promise(resolve => server.once('exit', resolve)); }
  await rm(temp, {recursive: true, force: true});
}
