import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir, homedir } from 'node:os';
import path from 'node:path';
import { createServer } from 'node:net';
import { seedMappingFixture } from '../support/browser-mapping-fixture.mjs';
const { withHeadlessBrowser, evaluate, waitFor, waitForSelector, captureScreenshot } = await import(path.join(homedir(), '.codex/skills/front-end/browser-test.mjs'));
const root = path.resolve(new URL('../../..', import.meta.url).pathname);
const fixture = await mkdtemp(path.join(tmpdir(), 'chat-resume-'));
const nativeId = '019a0000-0000-7000-8000-000000000001';
let server;
try {
  await seedMappingFixture(fixture, { ascii: 'Root\n`-- Worker', nodes: [] });
  const port = await new Promise(resolve => { const s = createServer(); s.listen(0, '127.0.0.1', () => { const port = s.address().port; s.close(() => resolve(port)); }); });
  const base = `http://127.0.0.1:${port}`;
  server = spawn(process.execPath, ['scripts/dev/start-server.mjs', 'preview', '--pi', '--host', '127.0.0.1', '--port', String(port), '--strictPort'], {
    cwd: root, env: { ...process.env, NEW_DIAGRAM_PROJECT_ROOT: fixture, NEW_DIAGRAMS_DIR: path.join(fixture, '.diagrams'), NEW_DIAGRAM_AGENT: 'fake', NEW_DIAGRAM_CODEX_BIN: path.join(root, 'tests/support/codex-app-server.mjs') }, stdio: ['ignore', 'pipe', 'pipe']
  });
  let logs = ''; server.stdout.on('data', data => { logs += data; }); server.stderr.on('data', data => { logs += data; });
  await waitFor(async () => { if (server.exitCode !== null) throw Error(logs); return (await fetch(base).catch(() => null))?.ok; }, { timeoutMs: 20000 });
  await withHeadlessBrowser({ url: `${base}/mapping`, width: 1800, height: 1100, chromePath: process.env.CHROME_PATH, arguments: ['--disable-gpu', '--no-sandbox'] }, async ({ cdp }) => {
    await cdp.send('Page.enable'); await cdp.send('Runtime.enable');
    const errors = [];
    cdp.on('Runtime.exceptionThrown', event => errors.push(event.exceptionDetails));
    const click = async selector => {
      const point = await evaluate(cdp, `(() => { const el = document.querySelector(${JSON.stringify(selector)}); if (!el || el.disabled) throw Error('Unavailable: '+${JSON.stringify(selector)}); const r = el.getBoundingClientRect(); return {x:r.x+r.width/2,y:r.y+r.height/2}; })()`);
      await cdp.send('Input.dispatchMouseEvent', { type: 'mousePressed', ...point, button: 'left', clickCount: 1 });
      await cdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', ...point, button: 'left', clickCount: 1 });
    };
    const key = async (key, code, windowsVirtualKeyCode, modifiers = 0) => {
      await cdp.send('Input.dispatchKeyEvent', { type: 'keyDown', key, code, windowsVirtualKeyCode, modifiers, ...(key === 'Enter' ? { text: '\r' } : {}) });
      await cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', key, code, windowsVirtualKeyCode, modifiers });
    };
    const type = async (selector, text) => { await click(selector); await key('a', 'KeyA', 65, 2); await cdp.send('Input.insertText', { text }); };
    const sendPrompt = async text => {
      await type('.agent-chat-prompt', text);
      await waitFor(() => evaluate(cdp, '!document.querySelector(".agent-chat-send").disabled'));
      await key('Enter', 'Enter', 13);
    };
    const open = async () => {
      await waitForSelector(cdp, '[data-grid-box="overview"]');
      await key('b', 'KeyB', 66, 2); await key('a', 'KeyA', 65);
      await waitFor(() => evaluate(cdp, 'document.querySelector(".agent-chat-prompt")?.isContentEditable'));
    };
    const state = async value => {
      try { await waitFor(() => evaluate(cdp, `document.querySelector('.agent-chat')?.dataset.chatState === ${JSON.stringify(value)}`)); }
      catch (error) {
        console.error(await evaluate(cdp, '({ state: document.querySelector(".agent-chat")?.dataset.chatState, text: document.querySelector(".agent-chat")?.textContent, focus: document.activeElement?.className })'));
        throw error;
      }
    };
    const menu = async () => { await click('[aria-label="Chat menu"]'); await waitFor(() => evaluate(cdp, '!document.querySelector(".window-panel-sidebar").hidden')); };
    const resume = async id => {
      await type('.agent-chat-resume input', id); await click('.agent-chat-resume button');
      await waitFor(() => evaluate(cdp, 'document.querySelector(".window-panel-sidebar").hidden || !!document.querySelector(".agent-chat-resume [role=alert]")'));
    };
    await open();
    await type('.agent-chat-prompt', 'Keep my draft');
    await menu();
    await resume('019a0000-0000-7000-8000-000000000099');
    await waitFor(() => evaluate(cdp, 'document.querySelector(".agent-chat-resume [role=alert]")?.textContent.includes("not found")'));
    assert.equal(await evaluate(cdp, 'document.querySelector(".agent-chat-prompt").textContent'), 'Keep my draft');
    await resume(nativeId);
    await state('idle');
    await waitFor(() => evaluate(cdp, 'document.querySelector(".agent-chat-timeline").textContent.includes("An answer from the CLI")'));
    assert.equal(await evaluate(cdp, 'document.querySelector("[aria-label=\'Codex model\']").value'), 'fixture-other');
    assert.equal(await evaluate(cdp, 'document.querySelector("[aria-label=\'Codex access\']").value'), 'danger-full-access');
    assert.equal(await evaluate(cdp, 'document.querySelectorAll(".agent-chat-tabs [role=tab]").length'), 2);
    assert.ok(await evaluate(cdp, 'document.querySelector(".agent-chat-timeline").textContent.includes("A question from the CLI")'));
    await menu(); await resume(nativeId); await state('idle');
    assert.equal(await evaluate(cdp, 'document.querySelectorAll(".agent-chat-tabs [role=tab]").length'), 2, 'Repeated resume reuses the existing tab');
    await click('.agent-chat-tab[data-active=false] [role=tab]');
    assert.equal(await evaluate(cdp, 'document.querySelector(".agent-chat-prompt").textContent'), 'Keep my draft');
    await click('.agent-chat-tab[data-active=false] [role=tab]');
    await sendPrompt('wait'); await state('running');
    await waitForSelector(cdp, '.agent-chat-working');
    await waitFor(() => evaluate(cdp, 'document.querySelector(".agent-chat-elapsed").textContent === "(2s)"'));
    assert.equal(await evaluate(cdp, 'getComputedStyle(document.querySelector(".agent-chat-working-label")).animationName'), 'agent-chat-working-pulse');
    assert.ok(await evaluate(cdp, '(() => { const r = document.querySelector(".agent-chat-working").getBoundingClientRect(); return r.height > 0 && r.top >= 0 && r.bottom < innerHeight; })()'));
    await captureScreenshot(cdp, { output: process.env.AGENT_CHAT_RESUME_SCREENSHOT ?? path.join(fixture, 'working.png') });
    await cdp.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] });
    assert.equal(await evaluate(cdp, 'getComputedStyle(document.querySelector(".agent-chat-working-label")).animationName'), 'none');
    await cdp.send('Emulation.setEmulatedMedia', { features: [] });
    await click('.agent-chat-tab[data-active=false] [role=tab]');
    assert.equal(await evaluate(cdp, '!!document.querySelector(".agent-chat-working")'), false);
    await click('.agent-chat-tab[data-active=false] [role=tab]'); await state('running');
    assert.ok(await evaluate(cdp, 'parseInt(document.querySelector(".agent-chat-elapsed").textContent.slice(1)) >= 2'), 'Switching tabs preserves elapsed time');
    await click('.agent-chat-send'); await state('interrupted');
    assert.equal(await evaluate(cdp, '!!document.querySelector(".agent-chat-working")'), false);
    await sendPrompt('question');
    await waitFor(() => evaluate(cdp, 'document.querySelector(".agent-chat-working-label")?.textContent.includes("Waiting for you")'));
    assert.equal(await evaluate(cdp, 'getComputedStyle(document.querySelector(".agent-chat-working-label")).animationName'), 'none');
    await click('.agent-chat-send'); await state('interrupted');
    await sendPrompt('Continue'); await state('idle');
    assert.equal(await evaluate(cdp, '!!document.querySelector(".agent-chat-working")'), false);
    await cdp.send('Page.reload'); await open(); await state('idle');
    assert.equal(await evaluate(cdp, 'document.querySelectorAll(".agent-chat-tabs [role=tab]").length'), 1);
    assert.ok(await evaluate(cdp, 'document.querySelector(".agent-chat-timeline").textContent.includes("An answer from the CLI")'));
    assert.equal(await evaluate(cdp, 'document.querySelector("[aria-label=\'Codex model\']").value'), 'fixture-other');
    assert.equal(await evaluate(cdp, 'document.querySelector("[aria-label=\'Codex access\']").value'), 'danger-full-access');
    assert.equal((await (await fetch(`${base}/api/mapping/agent-chat/sessions`)).json()).length, 1);
    assert.deepEqual(errors, []);
    console.log('PASS: native resume, duplicate/missing IDs, drafts, history after reload, working timer, tab switching, stop, waiting, reduced motion.');
  });
} finally {
  if (server && server.exitCode === null) { server.kill('SIGTERM'); await new Promise(resolve => server.once('exit', resolve)); }
  await rm(fixture, { recursive: true, force: true });
}
