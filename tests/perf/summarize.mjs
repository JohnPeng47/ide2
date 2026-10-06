// Run after a complete six-trial Playwright run. No failed/partial run is scored.
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const output = fileURLToPath(new URL('./.results/', import.meta.url));
const report = JSON.parse(await readFile(path.join(output, 'report.json'), 'utf8'));
const results = [];
function visit(suite) {
  for (const spec of suite.specs ?? []) for (const test of spec.tests ?? []) {
    if (!spec.title.startsWith('F02 trial')) continue;
    if (test.results.length !== 1 || test.results[0].status !== 'passed') throw Error(`Unscored failed/retried trial: ${spec.title}`);
    results.push(test.results[0]);
  }
  for (const child of suite.suites ?? []) visit(child);
}
for (const suite of report.suites) visit(suite);
if (results.length !== 6) throw Error(`Expected six completed trials; found ${results.length}`);
const trials = await Promise.all(results.map(async result => {
  const attachment = result.attachments.find(a => a.name === 'f02-samples');
  if (!attachment) throw Error('Missing sample attachment');
  const sample = JSON.parse(attachment.body ? Buffer.from(attachment.body, 'base64').toString() : await readFile(attachment.path, 'utf8'));
  if (!sample.completed) throw Error(`Incomplete trial ${sample.trial}`);
  const phaseAttachment = result.attachments.find(a => a.name === 'phases');
  const phases = (await readFile(phaseAttachment.path, 'utf8')).trim().split('\n').map(JSON.parse);
  if (phases.some(p => p.status !== 'passed')) throw Error(`Failed phase in trial ${sample.trial}`);
  return { ...sample, phases };
}));
trials.sort((a, b) => a.trial - b.trial);
if (trials.some((trial, i) => trial.trial !== i || trial.warmup !== (i === 0))) throw Error('Invalid trial/warm-up sequence');
const scored = trials.filter(t => !t.warmup);
const median = values => {
  if (!values.every(Number.isFinite)) throw Error(`Non-finite metric: ${values}`);
  const sorted = [...values].sort((a, b) => a - b), mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
};
const frames = select => Object.fromEntries(['frames', 'p50', 'p95', 'max', 'overBudgetMs', 'dispatchLagMax'].map(key =>
  [key, median(scored.map(t => select(t)[key]))]));
const latency = select => Object.fromEntries(['visibleMs', 'settledMs'].map(key => [key, median(scored.map(t => select(t)[key]))]));
const summary = {
  runStartedAt: report.stats.startTime,
  scoredTrials: scored.length, excludedTrials: [0], aggregation: 'median of per-trial metrics (p95 is median of trial p95s)',
  environment: { browser: trials[0].browser, viewport: trials[0].viewport, build: trials[0].build,
    machine: trials[0].machine, revision: trials[0].revision,
    fixture: trials[0].fixture, frameBudgetMs: trials[0].frameBudgetMs, settleDefinition: trials[0].settleDefinition },
  preparationMs: median(scored.map(t => t.phases.find(p => p.phase === 'scenario-preparation').durationMs)),
  pan: frames(t => t.pan), zoom: frames(t => t.zoom),
  drag: { frames: frames(t => t.drag.frames), release: latency(t => t.drag.release) },
  fold: latency(t => t.fold), unfold: latency(t => t.unfold),
  longTasks: scored.flatMap(t => ['pan', 'zoom', 'fold', 'unfold'].flatMap(key => t[key].longTasks)
    .concat(t.drag.frames.longTasks, t.drag.release.longTasks)).length,
};
const ms = n => `${n.toFixed(1)} ms`;
const f = s => `frame p50/p95/max ${ms(s.p50)} / ${ms(s.p95)} / ${ms(s.max)}; dispatch lag max ${ms(s.dispatchLagMax)}`;
const a = s => `input -> visible ${ms(s.visibleMs)}; input -> stable ${ms(s.settledMs)}`;
const tree = `F02: Navigate and arrange a diagram canvas
Five measured trials; trial 0 excluded. All values are medians of trial metrics.
Frame intervals describe pacing, not function execution duration.
The input driver did not sustain its requested 16 ms cadence; dispatch lag is reported alongside frames.
~> means reactive notification/later render. Internal calls are not separately timed.
Stable = three consecutive rAF observations with the same outcome geometry.

F02
|
+-- 1. Open canvas [setup only: ${ms(summary.preparationMs)}; unscored]
|   +-- MappingPage -> MappingEditorCanvas -> useMemo(new CanvasRuntime)
|   |   STATE [memo]: canvasRuntime, stable per session
|   +-- Tldraw.onMount -> setEditor ~> render -> useLayoutEffect
|   |   STATE [useState]: editor, undefined -> Editor
|   |   +-- MappingEditorRuntime.hydrate() -> writeShapes() -> createShapes()
|   |   \x60-- editor.setCamera(); STATE [editor store]: { x, y, z }
|   \x60-- DiagramShapeContent -> useValue(model, interaction) -> Text
|       STATE [subscribed]: frame, view, selectedContent, disabled flags
|       \x60-- useMemo(rows) -> DiagramText; STATE [memo]: visible rows
|
+-- 2. Navigate, drag, and release
|   +-- Pan [${f(summary.pan)}]
|   |   \x60-- editor camera ~> ApplicationOverlay.useQuickReactor()
|   |       \x60-- ref.current.style.transform; STATE [ref]: overlay DOM
|   +-- Zoom [${f(summary.zoom)}]
|   |   \x60-- Ctrl+wheel -> editor camera ~> overlay CSS transform
|   |       STATE [editor store]: zoom; no React setState in this transform path
|   \x60-- Drag [${f(summary.drag.frames)}]
|       STATE [editor store]: live shape geometry and gesture flags
|       +-- shape transform ~> NativeConnection.useValue(geometry)
|       |   \x60-- nativeEdgeGeometry() -> PanelConnector SVG
|       |       STATE [subscribed]: endpoint anchors/transforms
|       \x60-- Release [${a(summary.drag.release)}]
|           +-- editor tick -> settle() -> grid coordinate conversion
|           +-- controller.commitEditorGesture(moves, canvas)
|           |   STATE [controller]: committed layout and selection
|           \x60-- controller notification -> publish()/writeShapes() -> updateShapes()
|
\x60-- 3. Fold, unfold, and inspect
    +-- Fold [${a(summary.fold)}]
    |   \x60-- onClick -> onCollapse -> runtime.actions.collapse -> controller.transact()
    |       STATE [controller]: diagramViews[nodeId].collapsedContentNodeIds
    |       \x60-- CanvasRuntime.sync() -> grids/edges.publish() ~> useValue render
    |           STATE [atoms]: node/edge models; Text useMemo updates visible rows
    +-- Unfold [${a(summary.unfold)}]
    |   \x60-- same collapse command with false -> sync()/publish() ~> Text render
    |       \x60-- useLocalAnchors -> schedule() -> rAF measure() -> anchors.set()
    |           STATE [refs]: elements, ResizeObserver, pending frame
    |           \x60-- anchor notification ~> NativeConnection -> SVG path
    \x60-- Inspect result [assertions only; unscored]
        +-- Leaf visible again and connection status restored from proxy to resolved
        +-- SVG endpoint touches the source label; no page errors
        \x60-- Screenshot captured after measurement
`;
await writeFile(path.join(output, 'summary.json'), JSON.stringify({ summary, trials }, null, 2));
await writeFile(path.join(output, 'f02-timed-tree.txt'), tree);
const screenshot = results.at(-1).attachments.find(a => a.name === 'canvas');
if (screenshot?.body) await writeFile(path.join(output, 'canvas-final.png'), Buffer.from(screenshot.body, 'base64'));
console.log(JSON.stringify(summary, null, 2));
console.log(`Tree: ${path.join(output, 'f02-timed-tree.txt')}`);
