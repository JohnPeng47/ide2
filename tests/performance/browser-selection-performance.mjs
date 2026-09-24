// Run after npm run build. Set CHROME_PATH to override the browser executable.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir, homedir } from 'node:os';
import { createServer } from 'node:net';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { seedMappingFixture } from '../browser/support/browser-mapping-fixture.mjs';
const { evaluate, waitFor, waitForSelector, withHeadlessBrowser } = await import(pathToFileURL(path.join(homedir(), '.codex/skills/front-end/browser-test.mjs')).href);
const root = await mkdtemp(path.join(tmpdir(), 'selection-performance-'));
let server;
const ascii = 'Workbench renderer\n' + Array.from({length: 500}, (_, i) => (i === 499 ? '`-- ' : '|-- ') + 'Diagram node ' + i).join('\n');
try {
  await seedMappingFixture(root, { ascii, nodes: [] });
  const port = await new Promise(resolve => { const s = createServer(); s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => resolve(p)); }); });
  const url = `http://127.0.0.1:${port}`;
  server = spawn(process.execPath, ['scripts/dev/start-server.mjs', 'preview', '--host', '127.0.0.1', '--port', String(port), '--strictPort'],
    { cwd: process.cwd(), env: { ...process.env, NEW_DIAGRAM_PROJECT_ROOT: root, NEW_DIAGRAMS_DIR: path.join(root, '.diagrams'), NEW_DIAGRAM_AGENT: 'fake' }, stdio: 'ignore' });
  await waitFor(async () => (await fetch(url).catch(() => null))?.ok, { timeoutMs: 20000 });
  await withHeadlessBrowser({ url: `${url}/mapping`, width: 1800, height: 1100, chromePath: process.env.CHROME_PATH }, async ({ cdp }) => {
    await waitForSelector(cdp, '[data-grid-box="overview"]');
    await waitFor(async () => await evaluate(cdp, `document.querySelector('.diagram-canvas__surface')?.style.transform.includes('translate3d(')`));
    await cdp.send('Performance.enable');
    const metrics = async () => Object.fromEntries((await cdp.send('Performance.getMetrics')).metrics.map(m => [m.name, m.value]));
    const p = await evaluate(cdp, `(() => { const r = document.querySelector('[data-grid-box="overview"]').getBoundingClientRect(); return {x: r.left + 15, y: r.top + 25}; })()`);
    await cdp.send('Input.dispatchMouseEvent', {type: 'mousePressed', ...p, button: 'left', buttons: 1, modifiers: 2, clickCount: 1});
    await evaluate(cdp, `new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))`);
    const initialRect = await evaluate(cdp, `document.querySelector('.mapping-poc-selection-rect').style.cssText`);
    await evaluate(cdp, `(() => {
      window.__selectionMeasurements = 0;
      const original = Element.prototype.getBoundingClientRect;
      Element.prototype.getBoundingClientRect = function(...args) {
        if (this.matches('.diagram-content-node')) window.__selectionMeasurements++;
        return original.apply(this, args);
      };
    })()`);
    const before = await metrics(), start = performance.now();
    for (let i = 0; i < 40; i++) await cdp.send('Input.dispatchMouseEvent', {
      type: 'mouseMoved', x: p.x + 20 + i * 2, y: p.y + 20 + i * 2, button: 'left', buttons: 1, modifiers: 2
    });
    await cdp.send('Input.dispatchMouseEvent', {type:'mouseReleased', x:p.x+98, y:p.y+98, button:'left', modifiers:2});
    await waitForSelector(cdp, '.mapping-poc-selection-menu');
    const after = await metrics();
    console.log(JSON.stringify({wallMs:performance.now()-start, taskMs:(after.TaskDuration-before.TaskDuration)*1000, scriptMs:(after.ScriptDuration-before.ScriptDuration)*1000, layoutMs:(after.LayoutDuration-before.LayoutDuration)*1000}));
    assert.notEqual(await evaluate(cdp, `document.querySelector('.mapping-poc-selection-rect').style.cssText`), initialRect);
    assert.equal(await evaluate(cdp, 'window.__selectionMeasurements'), 0, 'Selection must not remeasure unchanged diagram labels');
    await keyEscape(cdp);
    await waitFor(async () => await evaluate(cdp, '!document.querySelector(".mapping-poc-selection-rect")'));
    console.log('Selection moved and cleared without remeasuring the 500-node diagram.');
  });
} finally {
  if (server && server.exitCode === null) { server.kill('SIGTERM'); await new Promise(resolve => server.once('exit', resolve)); }
  await rm(root, { recursive: true, force: true });
}

async function keyEscape(cdp) {
  await cdp.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
  await cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
}
