import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir, homedir } from 'node:os';
import path from 'node:path';
import { createServer } from 'node:net';
import { seedMappingFixture } from '../support/browser-mapping-fixture.mjs';
const { withHeadlessBrowser, evaluate, waitFor, waitForSelector, captureScreenshot } = await import(path.join(homedir(), '.codex/skills/front-end/browser-test.mjs'));
const root = path.resolve(new URL('../../..', import.meta.url).pathname);
const fixture = await mkdtemp(path.join(tmpdir(), 'chat-references-'));
const ascii = 'Root\n|-- Service\n|   `-- Worker\n`-- Other';
let server;
try {
  await seedMappingFixture(fixture, { ascii, nodes: [] });
  const port = await new Promise(resolve => { const s = createServer(); s.listen(0, '127.0.0.1', () => { const port = s.address().port; s.close(() => resolve(port)); }); });
  const base = `http://127.0.0.1:${port}`;
  server = spawn(process.execPath, ['scripts/dev/start-server.mjs', 'preview', '--pi', '--host', '127.0.0.1', '--port', String(port), '--strictPort'], {
    cwd: root, env: { ...process.env, NEW_DIAGRAM_PROJECT_ROOT: fixture, NEW_DIAGRAMS_DIR: path.join(fixture, '.diagrams'), NEW_DIAGRAM_AGENT: 'fake', NEW_DIAGRAM_CODEX_BIN: path.join(root, 'tests/support/codex-app-server.mjs') }, stdio: ['ignore', 'pipe', 'pipe']
  });
  let logs = ''; server.stdout.on('data', data => { logs += data; }); server.stderr.on('data', data => { logs += data; });
  await waitFor(async () => { if (server.exitCode !== null) throw Error(logs); return (await fetch(base).catch(() => null))?.ok; }, { timeoutMs: 20000 });
  await withHeadlessBrowser({ url: `${base}/mapping`, width: 1800, height: 1100, chromePath: process.env.CHROME_PATH,
    arguments: ['--disable-gpu', '--no-sandbox'] }, async ({ cdp }) => {
    const send = cdp.send.bind(cdp);
    cdp.send = (method, params) => {
      let timer; const error = Error(`CDP timeout: ${method} ${params?.expression?.slice(0, 100) ?? ''}`);
      return Promise.race([send(method, params), new Promise((_, reject) => { timer = setTimeout(() => reject(error), 15000); })]).finally(() => clearTimeout(timer));
    };
    await cdp.send('Page.enable'); await cdp.send('Runtime.enable'); await cdp.send('Network.enable');
    cdp.on('Page.javascriptDialogOpening', () => cdp.send('Page.handleJavaScriptDialog', { accept: true }));
    const errors = [], requests = [];
    cdp.on('Runtime.exceptionThrown', event => errors.push(event.exceptionDetails));
    cdp.on('Network.requestWillBeSent', event => { if (/agent-chat\/sessions\/[^/]+\/send$/.test(event.request.url)) requests.push(JSON.parse(event.request.postData)); });
    const mouse = async (point, modifiers = 0, clickCount = 1) => {
      await cdp.send('Input.dispatchMouseEvent', { type: 'mousePressed', ...point, button: 'left', buttons: 1, clickCount, modifiers });
      await cdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', ...point, button: 'left', buttons: 0, clickCount, modifiers });
    };
    const click = async selector => {
      const point = await evaluate(cdp, `(() => { const el = document.querySelector(${JSON.stringify(selector)}); if (!el || el.disabled) throw Error('Unavailable: '+${JSON.stringify(selector)}); const r = el.getBoundingClientRect(); return {x:r.x+r.width/2,y:r.y+r.height/2}; })()`);
      await mouse(point);
    };
    const key = async (key, code, windowsVirtualKeyCode, modifiers = 0) => {
      await cdp.send('Input.dispatchKeyEvent', { type: 'keyDown', key, code, windowsVirtualKeyCode, modifiers });
      await cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', key, code, windowsVirtualKeyCode, modifiers });
    };
    const nodeClick = async label => {
      await waitFor(() => evaluate(cdp, "!document.querySelector('.tl-hit-test-blocker:not(.tl-hit-test-blocker__hidden)')"));
      const point = await evaluate(cdp, `(() => { const el = [...document.querySelectorAll('[data-content-node-id][data-display-node-id]')].find(el => el.textContent.trim() === ${JSON.stringify(label)} && el.getBoundingClientRect().width); if(!el) throw Error('Missing node'); const r = el.getBoundingClientRect(); return {x:r.x+r.width/2,y:r.y+r.height/2}; })()`);
      await mouse(point, 2);
    };
    const openChat = async () => {
      if (!await evaluate(cdp, 'document.querySelector(".agent-chat")?.checkVisibility()')) {
        await waitForSelector(cdp, '[aria-label="Search diagrams"]'); await click('[aria-label="Search diagrams"]');
        await click('[role="tab"][id$="-chat"]');
      }
      await waitFor(() => evaluate(cdp, `document.querySelector('[aria-label="Message Codex"]')?.isContentEditable === true`));
    };
    const count = () => evaluate(cdp, 'document.querySelectorAll(".agent-chat-composer .agent-chat-reference").length');
    const waitCount = n => waitFor(async () => await count() === n, { message: `Expected ${n} composer references` });
    const focusEditor = async () => { const point = await evaluate(cdp, `(() => { const r=document.querySelector('.agent-chat-prompt').getBoundingClientRect(); return {x:r.left+2,y:r.top+8}; })()`); await mouse(point); };
    const type = async text => { await focusEditor(); await key('a', 'KeyA', 65, 2); await cdp.send('Input.insertText', { text }); };
    const prompt = () => evaluate(cdp, `Array.from(document.querySelector('[aria-label="Message Codex"]').childNodes).map(node => node.dataset?.referenceId ? node.querySelector('small').textContent : node.textContent).join('')`);
    const sendDraft = async () => {
      await focusEditor(); await key('Enter', 'Enter', 13);
      await waitFor(() => evaluate(cdp, `document.querySelector('.agent-chat')?.dataset.chatState === 'idle' && document.querySelector('[aria-label="Message Codex"]').textContent === ''`), { message: 'Turn did not complete' });
    };
    const submit = async text => { await type(text); await sendDraft(); };
    const caret = async offset => {
      await focusEditor(); await key('Home', 'Home', 36, 2);
      for (let i = 0; i < offset; i++) await key('ArrowRight', 'ArrowRight', 39);
    };
    const clearSelection = async () => { await mouse({ x: 900, y: 800 }); await key('Escape', 'Escape', 27); };
    const readChat = async () => {
      const [session] = await (await fetch(`${base}/api/mapping/agent-chat/sessions`)).json();
      return (await fetch(`${base}/api/mapping/agent-chat/sessions/${session.id}`)).json();
    };
    await openChat();
    await type('Line one'); await key('Enter', 'Enter', 13, 8); await cdp.send('Input.insertText', { text: 'Line two' });
    assert.equal(await prompt(), 'Line one\nLine two');
    await type('Before ');
    await cdp.send('Input.imeSetComposition', { text: '日本', selectionStart: 2, selectionEnd: 2 });
    await cdp.send('Input.insertText', { text: '日本' });
    assert.equal(await prompt(), 'Before 日本');
    await key('z', 'KeyZ', 90, 2); assert.equal(await prompt(), 'Before ');
    await type('Explain  updates selection.'); await caret(8);
    await nodeClick('Service'); await waitCount(1);
    assert.equal(await prompt(), 'Explain [ref 1] updates selection.');
    const layout = await evaluate(cdp, `(() => { const editor=document.querySelector('.agent-chat-prompt'), chip=editor.querySelector('.agent-chat-reference'), range=document.createRange(); range.selectNodeContents(editor.firstChild); const text=range.getBoundingClientRect(), ref=chip.getBoundingClientRect(); return {inline:ref.top < text.bottom && ref.bottom > text.top, label:chip.textContent}; })()`);
    assert.ok(layout.inline, 'Chip must flow on the same line as the preceding text'); assert.ok(layout.label.includes('Service'));
    await nodeClick('Service'); await waitCount(1); // Deselecting keeps the captured reference.
    await caret(9); await key('Backspace', 'Backspace', 8); await waitCount(0);
    assert.equal(await prompt(), 'Explain  updates selection.');
    await key('z', 'KeyZ', 90, 2); await waitCount(1);
    await key('z', 'KeyZ', 90, 10); await waitCount(0);
    await key('z', 'KeyZ', 90, 2); await waitCount(1);
    await caret(8); await key('Delete', 'Delete', 46); await waitCount(0);
    await key('z', 'KeyZ', 90, 2); await waitCount(1);
    assert.equal(await prompt(), 'Explain [ref 1] updates selection.');
    // Real clipboard operations retain attachments, and pasted copies get independent identities.
    await caret(8); await key('ArrowRight', 'ArrowRight', 39, 8); await key('c', 'KeyC', 67, 2);
    await key('End', 'End', 35, 2); await key('v', 'KeyV', 86, 2); await waitCount(2);
    assert.equal(await prompt(), 'Explain [ref 1] updates selection.[ref 2]');
    await key('z', 'KeyZ', 90, 2); await waitCount(1);
    await caret(8); await key('ArrowRight', 'ArrowRight', 39, 8); await key('x', 'KeyX', 88, 2); await waitCount(0);
    await key('End', 'End', 35, 2); await key('v', 'KeyV', 86, 2); await waitCount(1);
    assert.equal(await prompt(), 'Explain  updates selection.[ref 1]');
    await key('z', 'KeyZ', 90, 2); await key('z', 'KeyZ', 90, 2); await waitCount(1);
    await caret(9); await cdp.send('Input.insertText', { text: ' and ' });
    await nodeClick('Other'); await waitCount(2);
    assert.equal(await prompt(), 'Explain [ref 1] and [ref 2] updates selection.');
    await captureScreenshot(cdp, { output: process.env.AGENT_CHAT_REFS_SCREENSHOT ?? path.join(fixture, 'references.png') });
    await sendDraft(); await waitCount(0);
    assert.equal(requests[0].text, 'Explain [ref 1] and [ref 2] updates selection.');
    assert.equal(requests[0].references.length, 2);
    assert.equal(requests[0].references[0].reference.kind, 'nodes');
    assert.equal(requests[0].references[0].ascii, '|-- Service\n|   `-- Worker');
    assert.ok(requests[0].references[0].reference.revisionId);
    assert.equal(requests[0].references[0].displayNodeId, 'grid:overview');
    assert.ok(requests[0].references[1].ascii.includes('Other'));
    await waitForSelector(cdp, '.agent-message-user .agent-chat-reference-details');
    await click('.agent-message-user .agent-chat-reference-details > summary');
    await waitForSelector(cdp, '.agent-message-user .agent-chat-reference');
    const firstReference = (await readChat()).items.find(item => item.kind === 'user').references[0];
    assert.deepEqual(firstReference, requests[0].references[0]);
    // Replacing a selection across chips removes them from the structured payload as well.
    await clearSelection(); await type('Remove '); await nodeClick('Service'); await waitCount(1);
    await type('No refs'); await waitCount(0); await sendDraft();
    assert.equal(requests[1].references, undefined);
    await type('Typing must not reattach a removed reference'); await waitCount(0);
    await clearSelection(); await type('Explain selected refs '); await nodeClick('Service'); await waitCount(1);
    await nodeClick('Worker'); await waitCount(2); // A changed selection inserts a new pinned snapshot.
    await click('.agent-chat-composer .agent-chat-reference button'); await waitCount(1);
    await sendDraft();
    assert.ok(!requests[2].references[0].ascii.includes('Worker'), 'Excluded node leaked into selected context');
    assert.ok(requests[2].references[0].ascii.includes('Service'));
    assert.equal(requests[2].text, 'Explain selected refs [ref 1]');
    assert.deepEqual((await readChat()).items.find(item => item.kind === 'user').references[0], firstReference);
    // Whole-diagram references use the same native edit path as selected nodes.
    await clearSelection(); await type('Edit selected ref ');
    const whole = await evaluate(cdp, `(() => { const r=document.querySelector('[data-grid-box="overview"]').getBoundingClientRect(); return {x:r.right-6,y:r.bottom-6}; })()`);
    await mouse(whole, 2, 2); await waitCount(1); await sendDraft();
    assert.equal(requests[3].references[0].reference.kind, 'diagram'); assert.equal(requests[3].references[0].ascii, ascii);
    await waitFor(() => evaluate(cdp, `document.querySelector('.agent-chat-timeline').textContent.includes('Diagram edit completed')`), { message: 'Native edit tool did not complete' });
    const diagramText = () => evaluate(cdp, `document.querySelector('.mapping-document-view:not([hidden]) [data-native-node="grid:overview"] .mapping-poc-ascii')?.textContent`);
    assert.ok((await diagramText()).includes('[edited: chat edit]'), 'Native edit did not update the canvas');
    assert.ok((await readChat()).items.some(item => item.sourceType === 'dynamicToolCall' && item.title === 'edit-diagram'));
    await click('[title="Undo (Ctrl+Z)"]');
    await waitFor(async () => !(await diagramText()).includes('[edited: chat edit]'));
    await click('[title="Redo (Ctrl+Y)"]');
    await waitFor(async () => (await diagramText()).includes('[edited: chat edit]'));
    await click('[aria-label="Chat menu"]'); await click('[aria-label="Codex access"]');
    await key('End', 'End', 35); await key('Enter', 'Enter', 13);
    await click('[aria-label="Chat menu"]');
    await submit('Edit current diagram');
    await waitFor(() => evaluate(cdp, `document.querySelector('.agent-chat-timeline').textContent.includes('Diagram editing requires Workspace access')`), { message: 'Read-only access did not block editing' });
    assert.equal((await diagramText()).split('[edited: chat edit]').length - 1, 1);
    await clearSelection(); await type('Keep while switching canvases '); await nodeClick('Other'); await waitCount(1);
    const pinnedDraft = await prompt();
    await click('.agent-chat-read-canvas');
    await waitFor(() => evaluate(cdp, `document.querySelector('.agent-chat').dataset.chatState === 'idle' && document.querySelector('.agent-chat-prompt').isContentEditable`));
    assert.equal(await prompt(), pinnedDraft); await waitCount(1);
    await click('[aria-label="Chat menu"]'); await click('.agent-chat-sessions button');
    await waitCount(0); await type('Separate conversation draft');
    await click('[aria-label="Chat menu"]'); await click('[aria-label="Agent conversations"]');
    await key('Home', 'Home', 36); await key('ArrowDown', 'ArrowDown', 40); await key('Enter', 'Enter', 13);
    await waitCount(1); assert.equal(await prompt(), pinnedDraft);
    await click('[data-ui-test-dial]');
    await click('.mapping-submenu > button'); await waitForSelector(cdp, '[aria-label="New diagram name"]');
    await click('[aria-label="New diagram name"]'); await key('a', 'KeyA', 65, 2); await cdp.send('Input.insertText', { text: 'Other canvas' });
    await click('.mapping-create-dialog button[type=submit]');
    await waitFor(() => evaluate(cdp, `!document.querySelector('.mapping-create-dialog') && [...document.querySelectorAll('[data-project-diagram]')].some(el => el.textContent.includes('Other canvas'))`));
    if (await evaluate(cdp, 'document.querySelector("[data-ui-test-dial]").getAttribute("aria-expanded") === "true"')) await click('[data-ui-test-dial]');
    await openChat(); await waitCount(1);
    assert.equal(await prompt(), pinnedDraft);
    const reloaded = new Promise(resolve => { const off = cdp.on('Page.loadEventFired', () => { off(); resolve(); }); });
    await cdp.send('Page.reload'); await reloaded; await openChat();
    await waitForSelector(cdp, '.agent-message-user .agent-chat-reference-details');
    await click('.agent-message-user .agent-chat-reference-details > summary');
    assert.deepEqual((await readChat()).items.find(item => item.kind === 'user').references[0], firstReference);
    await click('[data-project-diagram="representation-overview"]');
    await waitFor(async () => (await diagramText())?.includes('[edited: chat edit]'), { message: 'Native edit did not survive workspace reload' });
    assert.deepEqual(errors, []);
    console.log('PASS: inline placement, atomic Backspace/Delete, undo/redo, copy/cut/paste, pinned selections, exact markers and attachments, excluded nodes, native editing, access checks, canvas switching and transcript reload.');
  });
} finally {
  if (server && server.exitCode === null) { server.kill('SIGTERM'); await new Promise(resolve => server.once('exit', resolve)); }
  await rm(fixture, { recursive: true, force: true });
}
