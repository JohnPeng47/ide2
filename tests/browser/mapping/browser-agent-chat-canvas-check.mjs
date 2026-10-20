import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir, homedir } from 'node:os';
import path from 'node:path';
import { createServer } from 'node:net';
import { seedMappingFixture } from '../support/browser-mapping-fixture.mjs';
const { withHeadlessBrowser, evaluate, waitFor, waitForSelector, captureScreenshot } = await import(path.join(homedir(), '.codex/skills/front-end/browser-test.mjs'));
const root = path.resolve(new URL('../../..', import.meta.url).pathname);
const fixture = await mkdtemp(path.join(tmpdir(), 'new-diagram-chat-canvas-'));
const port = await new Promise(resolve => { const server = createServer(); server.listen(0, '127.0.0.1', () => { const port = server.address().port; server.close(() => resolve(port)); }); });
let server;
async function click(cdp, selector) {
  const hiddenDrawer = await evaluate(cdp, `!!document.querySelector(${JSON.stringify(selector)})?.closest('.window-panel-sidebar[hidden]')`);
  if (hiddenDrawer) {
    await click(cdp, '[aria-label="Chat menu"]');
    await waitFor(() => evaluate(cdp, `!document.querySelector('.window-panel-sidebar').hidden`), { message: 'Chat drawer did not open' });
  }
  if (selector.startsWith('.mapping-submenu') && !await evaluate(cdp, '!!document.querySelector(".mapping-submenu")')) await click(cdp, '[aria-label="Menu"]');
  const scroll = await evaluate(cdp, `(() => { const target = document.querySelector(${JSON.stringify(selector)}); const viewport = target?.closest('.agent-chat-timeline'); if (!viewport) return null; const r = target.getBoundingClientRect(), v = viewport.getBoundingClientRect(); return r.top < v.top + 4 || r.bottom > v.bottom - 4 ? { x: v.x + 12, y: v.y + v.height / 2, delta: r.y + r.height / 2 - v.y - v.height / 2 } : null; })()`);
  if (scroll) {
    await cdp.send('Input.dispatchMouseEvent', { type: 'mouseWheel', x: scroll.x, y: scroll.y, deltaX: 0, deltaY: scroll.delta });
    await waitFor(() => evaluate(cdp, `(() => { const target = document.querySelector(${JSON.stringify(selector)}); const r = target.getBoundingClientRect(), v = target.closest('.agent-chat-timeline').getBoundingClientRect(); return r.top >= v.top && r.bottom <= v.bottom; })()`), { message: `Could not scroll ${selector} into view` });
  }
  const rect = await evaluate(cdp, `(() => { const r = document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; })()`);
  await cdp.send('Input.dispatchMouseEvent', { type: 'mousePressed', ...rect, button: 'left', clickCount: 1 });
  await cdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', ...rect, button: 'left', clickCount: 1 });
}
async function key(cdp, key, code, windowsVirtualKeyCode, modifiers = 0) {
  await cdp.send('Input.dispatchKeyEvent', { type: 'keyDown', key, code, windowsVirtualKeyCode, modifiers });
  await cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', key, code, windowsVirtualKeyCode, modifiers });
}
async function waitText(cdp, selector, text) {
  try {
    await waitFor(() => evaluate(cdp, `document.querySelector(${JSON.stringify(selector)})?.textContent.includes(${JSON.stringify(text)})`), { timeoutMs: 15000, message: `${selector} missing ${text}` });
  } catch (error) {
    console.error('Chat state at failure:', await evaluate(cdp, 'document.querySelector(".agent-chat")?.innerText.slice(0, 1600)'));

    throw error;
  }
}
try {
  await seedMappingFixture(fixture);
  const url = `http://127.0.0.1:${port}/mapping`;
  server = spawn(process.execPath, ['scripts/dev/start-server.mjs', 'preview', '--pi', '--host', '127.0.0.1', '--port', String(port), '--strictPort'], {
    cwd: root, env: { ...process.env, NEW_DIAGRAM_PROJECT_ROOT: fixture, NEW_DIAGRAM_AGENT: 'fake', NEW_DIAGRAM_CODEX_BIN: path.join(root, 'tests/support/codex-app-server.mjs') }, stdio: ['ignore', 'pipe', 'pipe']
  });
  let logs = ''; server.stdout.on('data', data => { logs += data; }); server.stderr.on('data', data => { logs += data;  });
  await waitFor(async () => { if (server.exitCode !== null) throw new Error(logs); return (await fetch(url).catch(() => null))?.ok; }, { timeoutMs: 20000, message: 'Preview did not start' });
  await withHeadlessBrowser({ url, width: 1440, height: 1000, chromePath: process.env.CHROME_PATH,
    arguments: ['--disable-gpu', ...(process.platform === 'linux' ? ['--no-sandbox'] : [])] }, async ({ cdp }) => {
    const send = cdp.send.bind(cdp);
    cdp.send = (method, params) => {
      let timer;
      const timeout = new Error(`CDP timeout: ${method} ${params?.expression?.slice(0, 160) ?? ''}`);
      return Promise.race([send(method, params), new Promise((_, reject) => { timer = setTimeout(() => reject(timeout), 15000); })])
        .finally(() => clearTimeout(timer));
    };
    await cdp.send('Runtime.enable');
    await cdp.send('Page.enable');
    cdp.on('Page.javascriptDialogOpening', () => cdp.send('Page.handleJavaScriptDialog', { accept: true }));
    cdp.on('Runtime.exceptionThrown', event => console.error('Browser exception:', event.exceptionDetails.exception?.description || event.exceptionDetails.text));
    const chatTab = '[role="tab"][id$="-chat"]';
    const open = async () => {
      await waitForSelector(cdp, '[aria-label="Search diagrams"]');
      await click(cdp, '[aria-label="Search diagrams"]');
      await waitForSelector(cdp, chatTab); await click(cdp, chatTab);
      await waitForSelector(cdp, '.agent-chat');
    };
    await open();

    await waitFor(() => evaluate(cdp, `document.querySelector('[aria-label="Message Codex"]').isContentEditable`), { message: 'Codex info not loaded' });
    const selectedModel = () => evaluate(cdp, `document.querySelector('[aria-label="Codex model"]').value`);
    await click(cdp, '[aria-label="Codex model"]');
    await key(cdp, 'End', 'End', 35); await key(cdp, 'Enter', 'Enter', 13);
    assert.equal(await selectedModel(), 'fixture-other');
    await click(cdp, '[aria-label="Message Codex"]');
    assert.equal(await evaluate(cdp, `localStorage.getItem('agent-chat-model')`), 'fixture-other', 'Model selection was not saved before sending');
    await click(cdp, '[aria-label="Codex access"]');
    await key(cdp, 'End', 'End', 35); await key(cdp, 'Enter', 'Enter', 13);
    // Read Canvas starts a tool-output turn, preserves an unsent draft, and reads the active document.
    await cdp.send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 1000, deviceScaleFactor: 1, mobile: false });
    await click(cdp, '.agent-chat-sessions button');
    await click(cdp, '[aria-label="Message Codex"]');
    await cdp.send('Input.insertText', { text: 'What canvas did you read?' });
    await waitFor(() => evaluate(cdp, '!document.querySelector(".agent-chat-read-canvas").disabled'), { message: 'Read Canvas unavailable' });
    await click(cdp, '.agent-chat-read-canvas');
    await waitText(cdp, '.agent-chat-timeline', 'Canvas received: Current LLM prompt stack');
    await waitFor(() => evaluate(cdp, 'document.querySelector(".agent-chat")?.dataset.chatState === "idle"'), { message: 'Chat did not reach idle' });
    assert.equal(await evaluate(cdp, `document.querySelector('[aria-label="Message Codex"]').textContent`), 'What canvas did you read?');
    assert.equal(await evaluate(cdp, 'document.querySelectorAll(".agent-message-user").length'), 0, 'Canvas output was sent as a user message');
    const readChat = async () => {
      const id = await evaluate(cdp, `document.querySelector('[aria-label="Agent conversations"]').value`);
      return (await fetch(`http://127.0.0.1:${port}/api/mapping/agent-chat/sessions/${id}`)).json();
    };
    assert.equal((await readChat()).settings.sandbox, 'read-only');
    assert.equal((await readChat()).settings.model, 'fixture-other', 'New conversation ignored the saved model');
    const toolItem = (await readChat()).items.find(item => item.sourceType === 'functionCallOutput');
    assert.equal(toolItem.title, 'Read Canvas');
    const canvasOutput = JSON.parse(toolItem.text);
    const fresh = await (await fetch(`http://127.0.0.1:${port}/api/mapping/live/context/short?workspaceInstanceId=${canvasOutput.workspaceInstanceId}&documentId=${canvasOutput.documentId}`)).json();
    assert.deepEqual(canvasOutput, fresh, 'Agent did not receive the existing short-context format');
    assert.ok(canvasOutput.diagrams[0].ascii.length > 0);
    await click(cdp, '[aria-label="Message Codex"]'); await key(cdp, 'Enter', 'Enter', 13);
    await waitText(cdp, '.agent-chat-timeline', 'Remembered canvas: Current LLM prompt stack');
    await waitFor(() => evaluate(cdp, 'document.querySelector(".agent-chat")?.dataset.chatState === "idle"'), { message: 'Chat did not reach idle' });
    await captureScreenshot(cdp, { output: process.env.AGENT_CHAT_SCREENSHOT ? process.env.AGENT_CHAT_SCREENSHOT.replace('dark', 'read-canvas') : path.join(fixture, 'agent-chat-read-canvas.png') });
    // An explicit Codex default selection must survive older conversation settings.
    await click(cdp, '[aria-label="Codex model"]');
    await key(cdp, 'Home', 'Home', 36); await key(cdp, 'Enter', 'Enter', 13);
    assert.equal(await selectedModel(), '');
    await click(cdp, '[aria-label="Message Codex"]');
    await cdp.send('Page.reload'); await open();
    await waitText(cdp, '.agent-chat-timeline', 'Remembered canvas: Current LLM prompt stack');
    await waitFor(() => evaluate(cdp, '!document.querySelector(".agent-chat-read-canvas").disabled'), { message: 'Read Canvas unavailable after reload' });
    assert.equal(await selectedModel(), '', 'Conversation snapshot replaced the saved default preference');
    await click(cdp, '.agent-chat-read-canvas');
    await waitFor(async () => (await readChat()).items.filter(item => item.sourceType === 'functionCallOutput').length === 2, { message: 'Read Canvas did not work in the restored conversation' });
    await waitFor(() => evaluate(cdp, 'document.querySelector(".agent-chat")?.dataset.chatState === "idle"'), { message: 'Chat did not reach idle' });
    await click(cdp, '[aria-label="Close Workspace tools"]');
    await click(cdp, '.mapping-submenu > button');
    await waitForSelector(cdp, '[aria-label="New diagram name"]');
    await click(cdp, '[aria-label="New diagram name"]'); await key(cdp, 'a', 'KeyA', 65, 2);
    await cdp.send('Input.insertText', { text: 'Second canvas' });
    await click(cdp, '[aria-label="Initial diagram content"]'); await key(cdp, 'a', 'KeyA', 65, 2);
    await cdp.send('Input.insertText', { text: 'Second canvas root\n`-- Fresh content' });
    await click(cdp, '.mapping-create-dialog button[type=submit]');
    await waitFor(() => evaluate(cdp, `!document.querySelector('.mapping-create-dialog') && !!document.querySelector('.mapping-document-view:not([hidden])')`), { message: 'Second canvas was not created' });
    await open();
    await waitFor(() => evaluate(cdp, '!document.querySelector(".agent-chat-read-canvas").disabled'), { message: 'Second canvas not readable' });
    await click(cdp, '.agent-chat-read-canvas');
    await waitText(cdp, '.agent-chat-timeline', 'Canvas received: Second canvas');
    const secondOutput = JSON.parse((await readChat()).items.filter(item => item.sourceType === 'functionCallOutput').at(-1).text);
    assert.notEqual(secondOutput.documentId, canvasOutput.documentId, 'Read Canvas retained the previous canvas target');
    assert.ok(secondOutput.diagrams.some(diagram => diagram.ascii.includes('Fresh content')));
    await waitFor(() => evaluate(cdp, 'document.querySelector(".agent-chat")?.dataset.chatState === "idle"'), { message: 'Chat did not reach idle' });
    await click(cdp, '.agent-chat-sessions button');
    assert.equal(await selectedModel(), '', 'New chat lost the saved model preference');
    // Copy a chat diagram into the existing pointer-paste workflow, without editing on copy.
    await click(cdp, '[aria-label="Message Codex"]');
    await cdp.send('Input.insertText', { text: 'diagram' }); await key(cdp, 'Enter', 'Enter', 13);
    await waitForSelector(cdp, '.agent-diagram-block');
    await waitFor(() => evaluate(cdp, 'document.querySelector(".agent-chat")?.dataset.chatState === "idle"'), { message: 'Chat did not reach idle' });
    const ascii = 'LiveCanvasService\n\n|-- Keep spaces  \n`-- CanvasSessionBridge';
    assert.equal(await evaluate(cdp, 'document.querySelector(".agent-diagram-block pre").textContent'), ascii);
    assert.deepEqual(await evaluate(cdp, `(() => {
      const block = document.querySelector('.agent-diagram-block'), style = getComputedStyle(block);
      return { background: getComputedStyle(block.querySelector('pre')).backgroundColor, border: style.borderTopWidth, indent: style.paddingLeft };
    })()`), { background: 'rgba(0, 0, 0, 0)', border: '0px', indent: '16px' });
    await click(cdp, '.theme-toggle');
    await waitFor(() => evaluate(cdp, 'document.documentElement.dataset.theme === "light"'));
    assert.equal(await evaluate(cdp, 'getComputedStyle(document.querySelector(".agent-diagram-block pre")).backgroundColor'), 'rgba(0, 0, 0, 0)');
    await click(cdp, '.theme-toggle');
    const context = async () => (await fetch(`http://127.0.0.1:${port}/api/mapping/live/context/short?workspaceInstanceId=${secondOutput.workspaceInstanceId}&documentId=${secondOutput.documentId}`)).json();
    const before = await context();
    const expandedHeight = await evaluate(cdp, 'document.querySelector(".agent-diagram-block").getBoundingClientRect().height');
    await click(cdp, '.agent-diagram-block .agent-block-toggle');
    await waitText(cdp, '.agent-block-toggle', '4 lines collapsed');
    assert.equal(await evaluate(cdp, 'document.querySelectorAll(".agent-diagram-block pre").length'), 0);
    assert.ok(await evaluate(cdp, `document.querySelector('.agent-diagram-block').getBoundingClientRect().height < ${expandedHeight}`));
    await captureScreenshot(cdp, { output: process.env.AGENT_CHAT_SCREENSHOT ? process.env.AGENT_CHAT_SCREENSHOT.replace('dark', 'collapsed') : path.join(fixture, 'agent-chat-collapsed.png') });
    await click(cdp, '.agent-block-toggle');
    assert.equal(await evaluate(cdp, 'document.querySelector(".agent-diagram-block pre").textContent'), ascii, 'Expanding changed diagram whitespace');
    await click(cdp, '.agent-block-toggle');
    // Copy to canvas must still use the entire original block while it is collapsed.
    await click(cdp, '.agent-canvas-copy button');
    await waitForSelector(cdp, '.is-cursor-copy');
    assert.deepEqual(await context(), before, 'Copy unexpectedly edited the canvas');
    const pointer = { x: 650, y: 600 };
    await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', ...pointer });
    await waitForSelector(cdp, '.canvas-cursor-copy:not([hidden])');
    assert.equal(await evaluate(cdp, 'document.querySelector(".canvas-cursor-copy__preview").textContent'), ascii);
    await captureScreenshot(cdp, { output: process.env.AGENT_CHAT_SCREENSHOT ? process.env.AGENT_CHAT_SCREENSHOT.replace('dark', 'diagram') : path.join(fixture, 'agent-chat-diagram.png') });
    await key(cdp, 'v', 'KeyV', 86, 2);
    await waitFor(async () => (await context()).diagrams.length === before.diagrams.length + 1, { message: 'Chat diagram did not paste' });
    assert.ok((await context()).diagrams.some(diagram => diagram.ascii === ascii), 'Paste changed the diagram whitespace');
    await key(cdp, 'Escape', 'Escape', 27);
    await waitFor(() => evaluate(cdp, '!document.querySelector(".is-cursor-copy")'), { message: 'Escape did not clear staged diagram' });
    // Focus the canvas so its ordinary undo/redo shortcuts receive the keys.
    await cdp.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: 650, y: 800, button: 'left', clickCount: 1 });
    await cdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: 650, y: 800, button: 'left', clickCount: 1 });
    await key(cdp, 'z', 'KeyZ', 90, 2);
    await waitFor(async () => (await context()).diagrams.length === before.diagrams.length, { message: 'Paste could not be undone' });
    await key(cdp, 'y', 'KeyY', 89, 2);
    await waitFor(async () => (await context()).diagrams.some(diagram => diagram.ascii === ascii), { message: 'Paste could not be redone' });
    await click(cdp, '[aria-label="Menu"]');
    const save = await evaluate(cdp, `(() => { const el = [...document.querySelectorAll('button')].find(el => el.textContent === 'Save workspace'); const r = el.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; })()`);
    await cdp.send('Input.dispatchMouseEvent', { type: 'mousePressed', ...save, button: 'left', clickCount: 1 });
    await cdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', ...save, button: 'left', clickCount: 1 });
    await waitFor(() => evaluate(cdp, 'document.querySelector(".mapping-menu-status")?.textContent.includes("Workspace saved")'), { message: 'Workspace not saved' });
    await cdp.send('Page.reload');
    await waitFor(() => evaluate(cdp, `document.querySelectorAll('[data-native-node^="grid:diagram-"]').length === 1`).catch(() => false), { message: 'Pasted diagram did not survive reload' });
    assert.equal(await evaluate(cdp, '!!document.querySelector(".is-cursor-copy")'), false);
    console.log('PASS: Read Canvas, saved model preference, indented diagram rendering, copy without mutation, exact pointer paste, Escape, undo/redo and saved reload.');
  });
} finally {
  if (server && server.exitCode === null) { server.kill('SIGTERM'); await new Promise(resolve => server.once('exit', resolve)); }
  await rm(fixture, { recursive: true, force: true });
}
