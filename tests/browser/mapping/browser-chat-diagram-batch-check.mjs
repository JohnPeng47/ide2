import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir, homedir } from 'node:os';
import path from 'node:path';
import { createServer } from 'node:net';
import { seedMappingFixture } from '../support/browser-mapping-fixture.mjs';
const { withHeadlessBrowser, evaluate, waitFor, waitForSelector } = await import(path.join(homedir(), '.codex/skills/front-end/browser-test.mjs'));
const root = process.cwd(), fixture = await mkdtemp(path.join(tmpdir(), 'chat-diagram-batches-'));
let server;
try {
  await seedMappingFixture(fixture, { ascii: 'Root\n`-- Child', nodes: [] });
  const port = await new Promise(resolve => { const s = createServer(); s.listen(0, '127.0.0.1', () => { const port = s.address().port; s.close(() => resolve(port)); }); });
  const base = `http://127.0.0.1:${port}`;
  server = spawn(process.execPath, ['scripts/dev/start-server.mjs', 'preview', '--pi', '--host', '127.0.0.1', '--port', String(port), '--strictPort'], {
    detached: true, env: { ...process.env, NEW_DIAGRAM_PROJECT_ROOT: fixture, NEW_DIAGRAMS_DIR: path.join(fixture, '.diagrams'), NEW_DIAGRAM_AGENT: 'fake', NEW_DIAGRAM_CODEX_BIN: path.join(root, 'tests/support/codex-app-server.mjs') }, stdio: ['ignore', 'pipe', 'pipe']
  });
  let logs = ''; server.stdout.on('data', data => { logs += data; }); server.stderr.on('data', data => { logs += data; });
  await waitFor(async () => { if (server.exitCode !== null) throw Error(logs); return (await fetch(base).catch(() => null))?.ok; }, { timeoutMs: 20000 });
  await withHeadlessBrowser({ url: `${base}/mapping`, width: 1800, height: 1100, chromePath: process.env.CHROME_PATH, arguments: ['--disable-gpu', '--no-sandbox'] }, async ({ cdp }) => {
    const send = cdp.send.bind(cdp);
    cdp.send = (method, params) => {
      let timer;
      return Promise.race([send(method, params), new Promise((_, reject) => {
        timer = setTimeout(() => reject(Error(`CDP timeout: ${method} ${params?.expression?.slice(0, 120) ?? ''}`)), 15000);
      })]).finally(() => clearTimeout(timer));
    };
    await cdp.send('Page.enable');
    const click = async selector => {
      await waitForSelector(cdp, selector);
      const point = await evaluate(cdp, `(() => { const e=document.querySelector(${JSON.stringify(selector)}); if(e.disabled) throw Error('Disabled '+${JSON.stringify(selector)}); const r=e.getBoundingClientRect(); return {x:r.x+r.width/2,y:r.y+r.height/2}; })()`);
      await cdp.send('Input.dispatchMouseEvent', { type: 'mousePressed', ...point, button: 'left', buttons: 1, clickCount: 1 });
      await cdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', ...point, button: 'left', buttons: 0, clickCount: 1 });
    };
    const key = async (key, code, windowsVirtualKeyCode, modifiers = 0) => {
      await cdp.send('Input.dispatchKeyEvent', { type: 'keyDown', key, code, windowsVirtualKeyCode, modifiers });
      await cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', key, code, windowsVirtualKeyCode, modifiers });
    };
    const idle = () => waitFor(() => evaluate(cdp, `document.querySelector('.agent-chat')?.dataset.chatState === 'idle' && document.querySelector('[aria-label="Message Codex"]')?.isContentEditable`));
    const readChat = async () => {
      const [session] = await (await fetch(`${base}/api/mapping/agent-chat/sessions`)).json();
      return session ? (await fetch(`${base}/api/mapping/agent-chat/sessions/${session.id}`)).json() : { items: [] };
    };
    await click('[aria-label="Search diagrams"]'); await click('[role="tab"][id$="-chat"]');
    await waitFor(() => evaluate(cdp, `document.querySelector('[aria-label="Message Codex"]')?.isContentEditable`));
    const readCanvas = async () => {
      await waitFor(() => evaluate(cdp, `!document.querySelector('.agent-chat-read-canvas').disabled`));
      const old = await readChat().catch(() => ({ items: [] }));
      await click('.agent-chat-read-canvas');
      await waitFor(async () => (await readChat()).items.filter(item => item.title === 'Read Canvas').length > old.items.filter(item => item.title === 'Read Canvas').length);
      await idle();
      const items = (await readChat()).items.filter(item => item.title === 'Read Canvas');
      return JSON.parse(items.at(-1).text);
    };
    const snapshot = async context => (await fetch(`${base}/api/mapping/live/context/short?workspaceInstanceId=${context.workspaceInstanceId}&documentId=${context.documentId}`)).json();
    let context = await readCanvas();
    for (const [text, count, label] of [['Create diagram batch', 3, 'Created'], ['Edit diagram batch', 3, 'Updated'], ['Extend diagram batch', 5, 'Extended']]) {
      const before = await snapshot(context);
      await click('[aria-label="Message Codex"]'); await cdp.send('Input.insertText', { text }); await key('Enter', 'Enter', 13);
      await waitFor(async () => {
        const chat = await readChat(), last = chat.items.at(-1);
        if (last?.kind === 'assistant' && last.text?.includes('failed')) throw Error(last.text);
        return chat.items.some(item => item.kind === 'user' && item.text === text) && chat.status === 'idle';
      }, { timeoutMs: 20000 });
      await idle();
      const after = await snapshot(context);
      assert.equal(after.diagrams.length, count, JSON.stringify((await readChat()).items.slice(-3)));
      assert.equal(after.version, before.version + 1);
      assert.equal(after.diagrams.filter(diagram => diagram.ascii.startsWith(label)).length, 2);
      if (label === 'Extended') assert.equal(after.edges.length, 2);
      await waitFor(() => evaluate(cdp, `document.querySelector('.mapping-document-view:not([hidden])').textContent.includes(${JSON.stringify(label + ' 1')})`));
      await click('[title="Undo (Ctrl+Z)"]');
      await waitFor(async () => (await snapshot(context)).diagrams.filter(diagram => diagram.ascii.startsWith(label)).length === 0);
      await click('[title="Redo (Ctrl+Y)"]');
      await waitFor(async () => (await snapshot(context)).diagrams.filter(diagram => diagram.ascii.startsWith(label)).length === 2);
      context = await readCanvas();
    }
    console.log('Batches, connections, and undo/redo passed; checking a fresh browser.');
  });
  await withHeadlessBrowser({ url: `${base}/mapping`, width: 1800, height: 1100, chromePath: process.env.CHROME_PATH, arguments: ['--disable-gpu', '--no-sandbox'] }, async ({ cdp }) => {
    await waitForSelector(cdp, '[data-grid-box="overview"]');
    await waitFor(() => evaluate(cdp, `document.querySelector('.mapping-document-view:not([hidden])').textContent.includes('Extended 1')`));
    assert.ok(await evaluate(cdp, `document.querySelector('.mapping-document-view:not([hidden])').textContent.includes('Updated 1')`));
    console.log('PASS: AgentChat directly creates, edits, and extends two diagrams per batch with caller-supplied content; one version increment, one undo step, connections, and persistence across browser restart.');
  });
} finally {
  if (server?.pid) { try { process.kill(-server.pid, 'SIGTERM'); } catch {} }
  await rm(fixture, { recursive: true, force: true });
}
