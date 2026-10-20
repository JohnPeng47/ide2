import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir, homedir } from 'node:os';
import path from 'node:path';
import { createServer } from 'node:net';
import { seedMappingFixture } from '../support/browser-mapping-fixture.mjs';
const { withHeadlessBrowser, evaluate, waitFor, waitForSelector, captureScreenshot } = await import(path.join(homedir(), '.codex/skills/front-end/browser-test.mjs'));
const root = path.resolve(new URL('../../..', import.meta.url).pathname);
const fixture = await mkdtemp(path.join(tmpdir(), 'new-diagram-agent-chat-'));
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
  await cdp.send('Input.dispatchKeyEvent', { type: 'keyDown', key, code, windowsVirtualKeyCode, modifiers, ...(key === 'Enter' ? { text: '\r' } : {}) });
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
  await mkdir(path.join(fixture, 'src'), { recursive: true });
  await writeFile(path.join(fixture, 'src/parser.ts'), '// Fixture parser\nexport const parsed = true;\n');
  const url = `http://127.0.0.1:${port}/mapping`;
  server = spawn(process.execPath, ['scripts/dev/start-server.mjs', 'preview', '--pi', '--host', '127.0.0.1', '--port', String(port), '--strictPort'], {
    cwd: root, env: { ...process.env, NEW_DIAGRAM_PROJECT_ROOT: fixture, NEW_DIAGRAM_AGENT: 'fake', NEW_DIAGRAM_CODEX_BIN: path.join(root, 'tests/support/codex-app-server.mjs') }, stdio: ['ignore', 'pipe', 'pipe']
  });
  let logs = ''; server.stdout.on('data', data => { logs += data; }); server.stderr.on('data', data => { logs += data;  });
  await waitFor(async () => { if (server.exitCode !== null) throw new Error(logs); return (await fetch(url).catch(() => null))?.ok; }, { timeoutMs: 20000, message: 'Preview did not start' });
  await withHeadlessBrowser({ url, width: 1440, height: 1000, chromePath: process.env.CHROME_PATH, arguments: ['--disable-gpu', '--no-sandbox'] }, async ({ cdp }) => {
    const sendCdp = cdp.send.bind(cdp);
    cdp.send = (method, params) => {
      let timer;
      return Promise.race([sendCdp(method, params), new Promise((_, reject) => { timer = setTimeout(() => reject(Error(`CDP timeout: ${method}`)), 15000); })]).finally(() => clearTimeout(timer));
    };
    await cdp.send('Page.enable'); await cdp.send('Runtime.enable');
    cdp.on('Page.javascriptDialogOpening', () => cdp.send('Page.handleJavaScriptDialog', { accept: true }));
    const reload = async () => {
      const loaded = new Promise(resolve => { const off = cdp.on('Page.loadEventFired', () => { off(); resolve(); }); });
      await cdp.send('Page.reload'); await loaded;
    };
    cdp.on('Runtime.exceptionThrown', event => console.error('Browser exception:', event.exceptionDetails.exception?.description || event.exceptionDetails.text));
    const chatTab = '[role="tab"][id$="-chat"]';
    const searchTab = '[role="tab"][id$="-search"]';
    const llmTab = '[role="tab"][id$="-llm"]';
    const open = async () => {
      await waitForSelector(cdp, '[aria-label="Search diagrams"]');
      await click(cdp, '[aria-label="Search diagrams"]');
      await waitForSelector(cdp, chatTab); await click(cdp, chatTab);
      await waitForSelector(cdp, '.agent-chat');
    };
    await open();
    await waitFor(() => evaluate(cdp, `document.querySelector('[aria-label="Message Codex"]').isContentEditable`), { message: 'Codex info not loaded' });
    assert.deepEqual(await evaluate(cdp, `Array.from(document.querySelectorAll('.window-panel-tabs > [role="tab"]')).map(tab => tab.textContent)`), ['Search', 'Treemaps', 'LLM', 'Agent Chat']);
    assert.equal(await evaluate(cdp, 'document.querySelectorAll(".window-panel-tabbed .window-panel").length'), 0);
    assert.equal(await evaluate(cdp, `document.querySelector('[aria-label="Codex access"]').value`), 'danger-full-access', 'New chats default to YOLO');
    await click(cdp, '[aria-label="Message Codex"]');
    await cdp.send('Input.insertText', { text: 'Draft survives tabs' });
    await click(cdp, searchTab); await click(cdp, llmTab); await click(cdp, chatTab);
    await waitFor(() => evaluate(cdp, `document.querySelector('[aria-label="Message Codex"]').textContent === 'Draft survives tabs'`), { message: 'Switching tabs lost the draft' });
    await click(cdp, '[aria-label="Close Agent Chat"]');
    assert.equal(await evaluate(cdp, 'document.querySelector(".agent-chat").checkVisibility()'), false);
    await open();
    assert.equal(await evaluate(cdp, `document.querySelector('[aria-label="Message Codex"]').textContent`), 'Draft survives tabs', 'Closing chat lost the draft');
    await click(cdp, '[aria-label="Message Codex"]');
    await key(cdp, 'a', 'KeyA', 65, 2); await key(cdp, 'Backspace', 'Backspace', 8);
    // Chrome has no fixed top/bottom bars; their actions live in the floating Menu.
    assert.equal(await evaluate(cdp, '!!document.querySelector(".mapping-poc-header, .mapping-poc-status")'), false);
    assert.ok(await evaluate(cdp, '(() => { const r = document.querySelector(".mapping-viewport").getBoundingClientRect(); return r.top === 0 && Math.abs(r.bottom - innerHeight) <= 1; })()'));
    await click(cdp, '[aria-label="Menu"]');
    assert.deepEqual(await evaluate(cdp, 'Array.from(document.querySelectorAll(".mapping-menu-content .mapping-workspace-actions button")).map(e => e.textContent)'), ['Treemaps', 'Save workspace', 'Restore workspace', 'Export', 'Import']);
    assert.ok(await evaluate(cdp, '!!document.querySelector(".mapping-menu-content input")'));
    await captureScreenshot(cdp, { output: process.env.AGENT_CHAT_SCREENSHOT ? process.env.AGENT_CHAT_SCREENSHOT.replace('dark', 'menu') : path.join(fixture, 'agent-menu.png') });
    await key(cdp, 'Escape', 'Escape', 27);
    await waitFor(() => evaluate(cdp, '!document.querySelector(".ui-test-framework__panel")'), { message: 'Menu did not close on Escape' });
    assert.equal(await evaluate(cdp, 'document.activeElement.getAttribute("aria-label")'), 'Menu');
    // The default chat header is collapsed and the drawer overlays the canvas without shrinking chat.
    assert.equal(await evaluate(cdp, 'document.querySelector(".window-panel-sidebar").hidden'), true);
    const transcriptWidth = await evaluate(cdp, 'document.querySelector(".agent-chat-timeline").clientWidth');
    await click(cdp, '[aria-label="Chat menu"]');
    assert.ok(await evaluate(cdp, '(() => { const d = document.querySelector(".window-panel-sidebar").getBoundingClientRect(), p = document.querySelector(".window-panel-tabbed").getBoundingClientRect(); return d.left >= 0 && d.right < p.left; })()'));
    assert.equal(await evaluate(cdp, 'document.querySelector(".agent-chat-timeline").clientWidth'), transcriptWidth);
    await captureScreenshot(cdp, { output: process.env.AGENT_CHAT_SCREENSHOT ? process.env.AGENT_CHAT_SCREENSHOT.replace('dark', 'drawer') : path.join(fixture, 'agent-drawer.png') });
    assert.equal(await evaluate(cdp, '!!document.querySelector(".window-panel-sidebar .agent-chat-controls select")'), true);
    await click(cdp, '[aria-label="Message Codex"]');
    await key(cdp, 'Escape', 'Escape', 27);
    await waitFor(() => evaluate(cdp, 'document.querySelector(".window-panel-sidebar").hidden'), { message: 'Chat menu did not close on Escape' });
    assert.equal(await evaluate(cdp, 'document.activeElement.getAttribute("aria-label")'), 'Chat menu');
    assert.equal(await evaluate(cdp, '!!document.querySelector(".agent-chat-composer footer, .agent-chat-composer select, .agent-chat-composer [role=status]")'), false);
    const inputHeight = () => evaluate(cdp, 'document.querySelector(".agent-chat-prompt").getBoundingClientRect().height');
    const emptyInputHeight = await inputHeight();
    assert.ok(emptyInputHeight >= 40 && emptyInputHeight < 100, `Expected a panel-sized input, got ${emptyInputHeight}px`);
    await click(cdp, '[aria-label="Message Codex"]');
    await cdp.send('Input.insertText', { text: 'first line\nsecond line\nthird line\nfourth line\nfifth line' });
    await waitFor(async () => await inputHeight() > emptyInputHeight + 20, { message: 'Composer did not grow with multiline text' });
    await key(cdp, 'a', 'KeyA', 65, 2); await key(cdp, 'Backspace', 'Backspace', 8);
    await waitFor(async () => await inputHeight() === emptyInputHeight, { message: 'Composer did not shrink after clearing text' });
    assert.ok(await evaluate(cdp, 'document.querySelector(".agent-chat-composer").getBoundingClientRect().height < 150'));
    const send = async text => {
      await click(cdp, '[aria-label="Message Codex"]'); await cdp.send('Input.insertText', { text });
      await key(cdp, 'Enter', 'Enter', 13);
    };
    await send('Show markdown');
    await waitFor(() => evaluate(cdp, 'document.querySelector(".agent-chat")?.dataset.chatState === "idle"'), { message: 'Chat did not reach idle' });
    await waitForSelector(cdp, '.agent-message-assistant .agent-code-block .shiki');
    assert.equal(await evaluate(cdp, 'document.querySelectorAll(".agent-message-assistant .agent-markdown input[type=checkbox]").length'), 2);
    assert.equal(await evaluate(cdp, 'document.querySelector(".agent-message-assistant blockquote").dataset.alert'), 'note');
    assert.equal(await evaluate(cdp, 'window.chatUnsafe === undefined'), true);
    assert.equal(await evaluate(cdp, 'document.querySelector(".agent-message-assistant a").rel'), 'noopener noreferrer');
    assert.equal(await evaluate(cdp, 'document.querySelectorAll(".agent-message-assistant table td").length'), 4);
    // Pointer capture keeps resizing active outside the visible handle; the panel stays right anchored.
    const panelSize = () => evaluate(cdp, '(() => { const r = document.querySelector(".window-panel-tabbed").getBoundingClientRect(); return { width: r.width, height: r.height, right: r.right }; })()');
    const dragHandle = async (edge, dx, dy) => {
      const corner = await evaluate(cdp, `(() => { const r = document.querySelector('.window-panel-tabbed > .window-panel-resize-${edge}').getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; })()`);
      await cdp.send('Input.dispatchMouseEvent', { type: 'mousePressed', ...corner, button: 'left', buttons: 1, clickCount: 1 });
      await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: corner.x + dx, y: corner.y + dy, button: 'left', buttons: 1 });
      await cdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: corner.x + dx, y: corner.y + dy, button: 'left', buttons: 0 });
    };
    const inputSize = () => evaluate(cdp, '(() => { const r = document.querySelector(".agent-chat-prompt").getBoundingClientRect(); return { width: r.width, height: r.height }; })()');
    const initialSize = await panelSize(), initialInputSize = await inputSize();
    await dragHandle('corner', 100, -80);
    const compactSize = await panelSize();
    assert.equal(compactSize.width, initialSize.width - 100);
    assert.equal(compactSize.height, initialSize.height - 80);
    assert.equal(compactSize.right, initialSize.right);
    const compactInputSize = await inputSize();
    assert.ok(compactInputSize.height < initialInputSize.height, 'Empty input height shrinks with the panel');
    assert.equal(compactInputSize.width, initialInputSize.width - 100, 'Input width follows the panel');
    await dragHandle('bottom', 0, 80);
    assert.equal((await panelSize()).height, initialSize.height);
    assert.equal((await panelSize()).width, compactSize.width);
    assert.equal((await inputSize()).height, initialInputSize.height, 'Input height grows back with the panel');
    await click(cdp, '[aria-label="Message Codex"]');
    await cdp.send('Input.insertText', { text: Array.from({ length: 30 }, (_, i) => `Prompt line ${i + 1}`).join('\n') });
    const longInputHeight = await inputHeight();
    await dragHandle('bottom', 0, -120);
    assert.ok(await inputHeight() < longInputHeight, 'Long prompt height shrinks with the panel');
    assert.ok(await evaluate(cdp, 'document.querySelector(".agent-chat-prompt").scrollHeight > document.querySelector(".agent-chat-prompt").clientHeight'), 'Long prompts scroll within the resized input');
    await dragHandle('bottom', 0, 120);
    assert.equal(await inputHeight(), longInputHeight, 'Long prompt height grows back with the panel');
    assert.equal(await evaluate(cdp, 'document.querySelector(".agent-chat-prompt").textContent.includes("Prompt line 30")'), true, 'Resizing preserves prompt text');
    await click(cdp, '[aria-label="Message Codex"]');
    await key(cdp, 'a', 'KeyA', 65, 2); await key(cdp, 'Backspace', 'Backspace', 8);
    await dragHandle('left', -40, 0);
    assert.equal((await panelSize()).width, compactSize.width + 40);
    // The focused edge also supports keyboard resizing, with no canvas shortcut leakage.
    await key(cdp, 'ArrowRight', 'ArrowRight', 39);
    assert.equal((await panelSize()).width, compactSize.width + 16);
    const keyboardSize = await panelSize();
    await dragHandle('left', 1000, 0);
    assert.equal((await panelSize()).width, 260, 'Width did not stop at the minimum');
    await dragHandle('left', 260 - keyboardSize.width, 0);
    const resizedSize = await panelSize();
    const savedPanelSize = await evaluate(cdp, 'localStorage.getItem("window-panel-size:workspace-tools")');
    assert.equal(JSON.parse(savedPanelSize).width, resizedSize.width);
    assert.equal(JSON.parse(savedPanelSize).height, resizedSize.height);
    await click(cdp, searchTab); await click(cdp, llmTab); await click(cdp, chatTab);
    assert.deepEqual(await panelSize(), resizedSize);
    assert.equal(await evaluate(cdp, 'document.querySelector(".agent-chat").scrollWidth <= document.querySelector(".agent-chat").clientWidth'), true);
    assert.equal(await evaluate(cdp, '(() => { const e = document.querySelector(".agent-chat-timeline"); return e.scrollWidth <= e.clientWidth; })()'), true, 'Transcript has unnecessary horizontal overflow');
    assert.ok(await evaluate(cdp, '(() => { const e = document.querySelector(".agent-chat-timeline"); return e.offsetWidth - e.clientWidth <= 10 && getComputedStyle(e).scrollbarWidth === "thin"; })()'), 'Transcript scrollbar takes too much space');
    assert.ok(await evaluate(cdp, `(() => { const close=document.querySelector('[aria-label="Close Agent Chat"]').getBoundingClientRect(); const expand=document.querySelector('.agent-chat-new-tab').getBoundingClientRect(); return close.width > 0 && expand.right <= close.left; })()`), 'Close button overlaps transcript controls');
    await captureScreenshot(cdp, { output: process.env.AGENT_CHAT_SCREENSHOT || path.join(fixture, 'agent-chat-dark.png') });
    await cdp.send('Browser.grantPermissions', { origin: new URL(url).origin, permissions: ['clipboardReadWrite', 'clipboardSanitizedWrite'] });
    await click(cdp, '.agent-code-block .agent-block-toggle');
    await waitText(cdp, '.agent-block-toggle', '1 line collapsed');
    assert.equal(await evaluate(cdp, 'document.querySelectorAll(".agent-code-block pre").length'), 0, 'Collapsed code is still mounted');
    await click(cdp, searchTab); await click(cdp, chatTab);
    assert.equal(await evaluate(cdp, 'document.querySelector(".agent-block-toggle").getAttribute("aria-expanded")'), 'false', 'Switching tabs expanded the code block');
    await click(cdp, '[aria-label="Copy code"]');
    assert.equal(await evaluate(cdp, 'navigator.clipboard.readText()'), 'const answer: number = 42;');
    await click(cdp, '.agent-block-toggle');
    await waitForSelector(cdp, '.agent-code-block .shiki');
    // The same toggle remains keyboard-operable and owns the hidden content region.
    await key(cdp, 'Enter', 'Enter', 13);
    await waitFor(() => evaluate(cdp, '(() => { const toggle = document.querySelector(".agent-block-toggle"); return document.getElementById(toggle.getAttribute("aria-controls")).hidden; })()'), { message: 'Enter did not collapse the focused code block' });
    await key(cdp, 'Enter', 'Enter', 13);
    await waitForSelector(cdp, '.agent-code-block pre');
    await click(cdp, '[aria-label="Close Agent Chat"]');
    assert.equal(await evaluate(cdp, 'document.querySelector(".window-panel-tabbed").getBoundingClientRect().width'), 0);
    await open();
    assert.deepEqual(await panelSize(), resizedSize, 'Reopening lost the panel size');
    await waitText(cdp, '.agent-message-assistant', 'Markdown port');
    // Codex message lifecycles and lazy activity detail.
    await send('transcript');
    await waitText(cdp, '.agent-chat-timeline', 'I will inspect the parser');
    assert.equal(await evaluate(cdp, 'document.querySelector(".agent-chat-composer [role=status]")'), null);
    await waitForSelector(cdp, '[data-activity="command"][data-active="true"]');
    await click(cdp, searchTab);
    const canvasBefore = await evaluate(cdp, 'document.querySelector(".mapping-document-view:not([hidden]) .diagram-canvas__surface").style.transform');
    await cdp.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: 700, y: 500, button: 'middle', buttons: 4, clickCount: 1 });
    await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 745, y: 525, button: 'middle', buttons: 4 });
    await cdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: 745, y: 525, button: 'middle', buttons: 0 });
    await waitFor(() => evaluate(cdp, `document.querySelector('.mapping-document-view:not([hidden]) .diagram-canvas__surface').style.transform !== ${JSON.stringify(canvasBefore)}`), { message: 'Canvas did not pan while chat streamed in the hidden tab' });
    const hiddenText = await evaluate(cdp, 'document.querySelector(".agent-chat-timeline").textContent');
    await waitFor(async () => {
      const sessions = await (await fetch(`http://127.0.0.1:${port}/api/mapping/agent-chat/sessions`)).json();
      return sessions[0]?.status === 'idle';
    }, { timeoutMs: 15000, message: 'Hidden transcript did not finish' });
    assert.equal(await evaluate(cdp, 'document.querySelector(".agent-chat-timeline").textContent'), hiddenText, 'Hidden tab rendered incoming transcript changes');
    await click(cdp, chatTab);
    await waitText(cdp, '.agent-chat-timeline', 'All 30 tests pass.');
    await click(cdp, '.agent-message-assistant button.agent-file-reference');
    await waitText(cdp, '.agent-source-preview', 'export const parsed = true;');
    await click(cdp, '[aria-label="Close source preview"]');
    assert.equal(await evaluate(cdp, 'document.querySelectorAll("[data-activity=exploration]").length'), 1);
    assert.equal(await evaluate(cdp, 'document.querySelectorAll(".agent-detail-body").length'), 0, 'Collapsed details mounted expensive bodies');
    assert.equal(await evaluate(cdp, 'document.querySelector("[data-activity=exploration]").textContent.includes("parser.test.ts")'), true);
    assert.equal(await evaluate(cdp, 'document.querySelector("[data-activity=files]").textContent.includes("+1")'), true);
    assert.equal(await evaluate(cdp, 'document.querySelector(".agent-chat-timeline").textContent.includes("Retained exploration output")'), false);
    if (await evaluate(cdp, '!!document.querySelector(".agent-chat-latest")')) await click(cdp, '.agent-chat-latest');
    await waitFor(() => evaluate(cdp, '!document.querySelector(".agent-chat-latest")'), { message: 'Jump to latest did not restore following' });
    await click(cdp, '.agent-transcript-controls button');
    assert.equal(await evaluate(cdp, 'document.querySelectorAll(".agent-chat-latest").length'), 0, 'Expansion disabled bottom following');
    await waitText(cdp, '.agent-chat-timeline', 'earlier characters omitted');
    assert.ok(await evaluate(cdp, 'document.querySelectorAll(".agent-detail-body").length > 0'));
    if (await evaluate(cdp, '!!document.querySelector(".agent-chat-latest")')) await click(cdp, '.agent-chat-latest');
    await waitFor(() => evaluate(cdp, '!document.querySelector(".agent-chat-latest")'), { message: 'Jump to latest did not restore following' });
    await click(cdp, '.agent-transcript-controls button');
    assert.equal(await evaluate(cdp, 'document.querySelectorAll(".agent-detail-body").length'), 0);
    await captureScreenshot(cdp, { output: process.env.AGENT_CHAT_SCREENSHOT ? process.env.AGENT_CHAT_SCREENSHOT.replace('dark', 'transcript') : path.join(fixture, 'agent-chat-transcript.png') });
    await send('approval');
    await waitText(cdp, '.agent-approval', 'Allow this command?');
    await click(cdp, '.agent-approval-actions button:last-child');
    await waitText(cdp, '.agent-chat-timeline', 'Response received');
    await waitFor(() => evaluate(cdp, 'document.querySelector(".agent-chat")?.dataset.chatState === "idle"'), { message: 'Chat did not reach idle' });
    await send('question');
    await waitText(cdp, '.agent-approval', 'Choose a color');
    await click(cdp, '.agent-approval input[type=radio]'); await click(cdp, '.agent-approval-actions button');
    await waitText(cdp, '.agent-chat-timeline', '"Blue"');
    await waitFor(() => evaluate(cdp, 'document.querySelector(".agent-chat")?.dataset.chatState === "idle"'), { message: 'Chat did not reach idle' });
    await send('wait'); await waitFor(() => evaluate(cdp, 'document.querySelector(".agent-chat")?.dataset.chatState === "running"'), { message: 'Chat did not reach running' });
    await click(cdp, searchTab); await click(cdp, llmTab); await click(cdp, chatTab);
    await waitFor(() => evaluate(cdp, 'document.querySelector(".agent-chat")?.dataset.chatState === "running"'), { message: 'Chat did not reach running' });
    await click(cdp, '.agent-chat-send'); await waitFor(() => evaluate(cdp, 'document.querySelector(".agent-chat")?.dataset.chatState === "interrupted"'), { message: 'Chat did not reach interrupted' });
    await reload();
    await open();
    assert.deepEqual(await panelSize(), resizedSize, 'Reload lost the preferred panel dimensions');
    // A smaller viewport clamps both axes without saving over the preferred dimensions.
    await cdp.send('Emulation.setDeviceMetricsOverride', { width: 600, height: 500, deviceScaleFactor: 1, mobile: false });
    await waitFor(() => evaluate(cdp, '(() => { const r = document.querySelector(".window-panel-tabbed").getBoundingClientRect(); return r.left >= 0 && r.bottom <= innerHeight && r.right <= innerWidth; })()'), { message: 'Saved size overflowed a smaller viewport' });
    assert.ok((await panelSize()).width < resizedSize.width);
    assert.ok((await panelSize()).height < resizedSize.height);
    assert.equal(await evaluate(cdp, 'localStorage.getItem("window-panel-size:workspace-tools")'), savedPanelSize, 'Viewport clamping overwrote the saved preference');
    await cdp.send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 1000, deviceScaleFactor: 1, mobile: false });
    await waitFor(async () => JSON.stringify(await panelSize()) === JSON.stringify(resizedSize), { message: 'Panel did not recover its preferred size after enlarging the viewport' });
    await waitText(cdp, '.agent-chat-timeline', 'Markdown port');
    await waitFor(() => evaluate(cdp, 'document.querySelector(".agent-chat")?.dataset.chatState === "interrupted"'), { message: 'Chat did not reach interrupted' });
    await click(cdp, '.agent-chat-sessions button');
    await waitFor(() => evaluate(cdp, 'document.querySelectorAll(".agent-message").length === 0'), { message: 'New chat retained previous transcript' });
    await send('New thread'); await waitText(cdp, '.agent-message-assistant', 'Markdown port');
    assert.equal(await evaluate(cdp, 'document.querySelectorAll(".agent-message-user").length'), 1);
    await click(cdp, '.theme-toggle');
    await waitFor(() => evaluate(cdp, 'document.documentElement.dataset.theme === "light"'), { message: 'Light theme did not apply' });
    await waitFor(() => evaluate(cdp, 'document.querySelector(".agent-code-block .shiki")?.className.includes("catppuccin-latte")'), { message: 'Light code highlighting did not apply' });
    await captureScreenshot(cdp, { output: process.env.AGENT_CHAT_SCREENSHOT ? process.env.AGENT_CHAT_SCREENSHOT.replace('dark', 'light') : path.join(fixture, 'agent-chat-light.png') });
    await cdp.send('Emulation.setDeviceMetricsOverride', { width: 600, height: 900, deviceScaleFactor: 1, mobile: false });
    assert.equal(await evaluate(cdp, 'document.querySelector(".window-panel-tabbed").getBoundingClientRect().right <= innerWidth'), true);
    // A long tool history stays cheap to mount, including after a reconnect snapshot.
    await click(cdp, '.agent-chat-sessions button');
    await evaluate(cdp, `(() => { window.chatLongTasks = []; window.chatPerfObserver = new PerformanceObserver(list => window.chatLongTasks.push(...list.getEntries().map(entry => entry.duration))); window.chatPerfObserver.observe({type: 'longtask'}); })()`);
    const stressStarted = Date.now();
    await send('stress');
    await waitText(cdp, '.agent-chat-timeline', 'Stress fixture complete.');
    console.log('250-command browser fixture:', JSON.stringify({ elapsedMs: Date.now() - stressStarted, longTasksMs: await evaluate(cdp, 'window.chatPerfObserver.disconnect(); window.chatLongTasks') }));

    assert.ok(await evaluate(cdp, 'document.querySelectorAll("[data-transcript-row]").length <= 80'));
    assert.equal(await evaluate(cdp, 'document.querySelectorAll(".agent-detail-body").length'), 0);
    await reload(); await open();
    await waitText(cdp, '.agent-chat-timeline', 'Stress fixture complete.');
    assert.ok(await evaluate(cdp, 'document.querySelectorAll("[data-transcript-row]").length <= 80'));
    await click(cdp, '[data-activity="command"] .agent-disclosure button');
    await waitFor(() => evaluate(cdp, 'document.querySelector(".agent-detail-body pre")?.textContent.length > 10000'), { message: 'Retained output did not load on demand after reconnect' });
    const timelineRect = await evaluate(cdp, '(() => { const r = document.querySelector(".agent-chat-timeline").getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; })()');
    await cdp.send('Input.dispatchMouseEvent', { type: 'mouseWheel', ...timelineRect, deltaX: 0, deltaY: -100000 });
    await waitFor(() => evaluate(cdp, 'document.querySelector(".agent-chat-timeline").scrollTop < 20'), { message: 'History did not scroll to top' });
    await click(cdp, '.agent-history-more');
    await waitFor(() => evaluate(cdp, 'document.querySelectorAll("[data-transcript-row]").length > 80'), { message: 'Earlier history did not load' });
    // Long tool previews truncate, while full output and markdown reflow at high zoom.
    await click(cdp, '.agent-chat-sessions button');
    await send('layout');
    await waitText(cdp, '.agent-chat-timeline', 'Layout fixture complete.');
    const zoomLabel = '[aria-label="Reset markdown zoom"]';
    const zoom = () => evaluate(cdp, `parseInt(document.querySelector('${zoomLabel}').textContent, 10)`);
    const fontSize = () => evaluate(cdp, 'parseFloat(getComputedStyle(document.querySelector(".agent-message-assistant .agent-markdown")).fontSize)');
    const wheelInTranscript = async (deltaY, modifiers = 0) => {
      const point = await evaluate(cdp, '(() => { const r = document.querySelector(".agent-chat-timeline").getBoundingClientRect(); return {x: r.x + 12, y: r.y + r.height / 2}; })()');
      await cdp.send('Input.dispatchMouseEvent', { type: 'mouseWheel', ...point, deltaX: 0, deltaY, modifiers });
    };
    const canvasAtZoom = await evaluate(cdp, 'document.querySelector(".mapping-document-view:not([hidden]) .diagram-canvas__surface").style.transform');
    const sizeAtZoom = await panelSize();
    const initialFont = await fontSize();
    await wheelInTranscript(-120, 2);
    await waitFor(async () => await zoom() > 100 && await fontSize() > initialFont, { message: 'Ctrl + scroll did not zoom markdown' });
    assert.deepEqual(await panelSize(), sizeAtZoom, 'Zoom resized the panel');
    assert.equal(await evaluate(cdp, 'window.visualViewport.scale'), 1, 'Browser pinch zoom leaked out of the transcript');
    assert.equal(await evaluate(cdp, 'document.querySelector(".mapping-document-view:not([hidden]) .diagram-canvas__surface").style.transform'), canvasAtZoom, 'Transcript wheel zoom changed the canvas');
    assert.equal(await evaluate(cdp, '!!document.querySelector(".agent-chat-latest")'), false, 'Zoom stopped following the latest message');
    await waitFor(() => evaluate(cdp, '(() => { const e = document.querySelector(".agent-chat-timeline"); return e.scrollHeight - e.clientHeight - e.scrollTop < 2; })()'), { message: 'Zoom did not preserve bottom following after reflow' });
    const zoomBeforeScroll = await zoom();
    const scrollBeforeWheel = await evaluate(cdp, 'document.querySelector(".agent-chat-timeline").scrollTop');
    await wheelInTranscript(-200);
    await waitFor(() => evaluate(cdp, `document.querySelector('.agent-chat-timeline').scrollTop < ${scrollBeforeWheel}`), { message: 'Ordinary wheel did not scroll the transcript' });
    assert.equal(await zoom(), zoomBeforeScroll, 'Ordinary scrolling changed zoom');
    await wheelInTranscript(-120, 4);
    await waitFor(async () => await zoom() > zoomBeforeScroll, { message: 'Cmd + scroll did not zoom markdown' });
    const savedZoom = await zoom();
    await click(cdp, searchTab); await click(cdp, chatTab);
    assert.equal(await zoom(), savedZoom);
    await reload(); await open();
    await waitText(cdp, '.agent-chat-timeline', 'Layout fixture complete.');
    assert.equal(await zoom(), savedZoom, 'Zoom was not restored after reload');
    await wheelInTranscript(-10000, 2);
    await waitFor(async () => await zoom() === 200, { message: 'Maximum zoom is not bounded at 200%' });
    // Expand the full tool output without hiding or horizontally scrolling its long lines.
    await click(cdp, '.agent-transcript-controls > button');
    await waitForSelector(cdp, '.agent-detail-body pre');
    await waitFor(() => evaluate(cdp, `(() => {
      const timeline = document.querySelector('.agent-chat-timeline');
      return timeline.scrollWidth <= timeline.clientWidth && [...timeline.querySelectorAll('pre, .codex-table, .agent-markdown, .agent-activity-heading')].every(e => e.scrollWidth <= e.clientWidth + 1);
    })()`), { message: 'Markdown or tool details still overflow horizontally at 200% zoom' });
    assert.equal(await evaluate(cdp, `(() => { const e = document.querySelector('.agent-activity-preview > div'); return e.scrollWidth > e.clientWidth && getComputedStyle(e).textOverflow === 'ellipsis'; })()`), true, 'Long tool preview did not truncate');
    assert.ok(await evaluate(cdp, 'document.querySelector(".agent-detail-body pre").textContent.length > 500'), 'Truncation discarded the full tool output');
    assert.equal(await evaluate(cdp, 'getComputedStyle(document.querySelector(".agent-markdown")).fontFamily.includes("mono")'), true);
    assert.equal(await evaluate(cdp, 'getComputedStyle(document.querySelector(".agent-markdown a")).color'), 'rgb(28, 100, 200)');
    assert.equal(await evaluate(cdp, 'getComputedStyle(document.querySelector(".agent-markdown h1")).textDecorationLine'), 'underline');
    await captureScreenshot(cdp, { output: process.env.AGENT_CHAT_SCREENSHOT ? process.env.AGENT_CHAT_SCREENSHOT.replace('dark', 'zoom') : path.join(fixture, 'agent-chat-zoom.png') });
    await wheelInTranscript(10000, 2);
    await waitFor(async () => await zoom() === 75, { message: 'Minimum zoom is not bounded at 75%' });
    await click(cdp, zoomLabel);
    await waitFor(async () => await zoom() === 100, { message: 'Zoom reset did not restore 100%' });
    // Small trackpad deltas must accumulate across animation frames.
    for (let i = 0; i < 8; i++) {
      await wheelInTranscript(-1, 2);
      await evaluate(cdp, 'new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))');
    }
    await waitFor(async () => await zoom() > 100, { message: 'Small trackpad deltas were rounded away' });
    await click(cdp, zoomLabel);
    await click(cdp, '.theme-toggle');
    await waitFor(() => evaluate(cdp, 'document.documentElement.dataset.theme === "dark"'), { message: 'Dark theme did not apply' });
    assert.equal(await evaluate(cdp, 'getComputedStyle(document.querySelector(".agent-markdown a")).color'), 'rgb(99, 168, 248)');
    await click(cdp, '.agent-chat-sessions button');
    await send('stream-block');
    await waitText(cdp, '.agent-diagram-block pre', 'First branch');
    await click(cdp, '.agent-diagram-block .agent-block-toggle');
    await waitText(cdp, '.agent-block-toggle', '2 lines collapsed');
    await waitText(cdp, '.agent-block-toggle', '4 lines collapsed');
    await waitFor(() => evaluate(cdp, 'document.querySelector(".agent-chat").dataset.chatState === "idle"'), { message: 'Streaming block did not complete' });
    assert.equal(await evaluate(cdp, 'document.querySelector(".agent-block-toggle").getAttribute("aria-expanded")'), 'false', 'Streaming completion expanded the block');
    assert.equal(await evaluate(cdp, 'document.querySelectorAll(".agent-diagram-block pre").length'), 0);
    await click(cdp, '.agent-block-toggle');
    assert.equal(await evaluate(cdp, 'document.querySelector(".agent-diagram-block pre").textContent'), 'Root\nFirst branch\n\nLast branch');
    console.log('Agent Chat browser check passed: shared Search/LLM tabs, draft preservation, markdown, resize, reopen, approvals, questions, stop, reload, thread isolation, compact viewport, wheel zoom, wrapping and tool truncation, Codex typography, Codex lifecycle, grouping, lazy details, hidden-tab suspension, bounded history.');
  });
} finally {
  if (server && server.exitCode === null) { server.kill('SIGTERM'); await new Promise(resolve => server.once('exit', resolve)); }
  await rm(fixture, { recursive: true, force: true });
}
