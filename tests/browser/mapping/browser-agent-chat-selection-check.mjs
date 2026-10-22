import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir, homedir } from 'node:os';
import path from 'node:path';
import { createServer } from 'node:net';
import { seedMappingFixture } from '../support/browser-mapping-fixture.mjs';
const { withHeadlessBrowser, evaluate, waitFor, waitForSelector } = await import(path.join(homedir(), '.codex/skills/front-end/browser-test.mjs'));
const root = path.resolve(new URL('../../..', import.meta.url).pathname);
const fixture = await mkdtemp(path.join(tmpdir(), 'agent-chat-selection-'));
let server;
try {
  await seedMappingFixture(fixture, { ascii: 'Root\n|-- Service\n|   `-- Worker\n`-- Other', nodes: [] });
  const port = await new Promise(resolve => { const s = createServer(); s.listen(0, '127.0.0.1', () => { const port = s.address().port; s.close(() => resolve(port)); }); });
  const base = `http://127.0.0.1:${port}`;
  server = spawn(process.execPath, ['scripts/dev/start-server.mjs', 'preview', '--pi', '--http', '--host', '127.0.0.1', '--port', String(port), '--strictPort'], {
    cwd: root, env: { ...process.env, NEW_DIAGRAM_PROJECT_ROOT: fixture, NEW_DIAGRAMS_DIR: path.join(fixture, '.diagrams'), NEW_DIAGRAM_AGENT: 'fake', NEW_DIAGRAM_CODEX_BIN: path.join(root, 'tests/support/codex-app-server.mjs') }, stdio: ['ignore', 'pipe', 'pipe']
  });
  let logs = ''; server.stdout.on('data', data => { logs += data; }); server.stderr.on('data', data => { logs += data; });
  await waitFor(async () => { if (server.exitCode !== null) throw Error(logs); return (await fetch(base).catch(() => null))?.ok; }, { timeoutMs: 20000 });
  await withHeadlessBrowser({ url: `${base}/mapping`, width: 1800, height: 1100, chromePath: process.env.CHROME_PATH,
    arguments: ['--disable-gpu', '--no-sandbox'] }, async ({ cdp }) => {
    const send = cdp.send.bind(cdp);
    cdp.send = (method, params) => {
      let timer;
      return Promise.race([send(method, params), new Promise((_, reject) => { timer = setTimeout(() => reject(Error(`CDP timeout: ${method} ${params?.expression?.slice(0, 120) ?? ''}`)), 15000); })]).finally(() => clearTimeout(timer));
    };
    await cdp.send('Page.enable'); await cdp.send('Runtime.enable');
    cdp.on('Page.javascriptDialogOpening', () => cdp.send('Page.handleJavaScriptDialog', { accept: true }));
    const errors = [];
    cdp.on('Runtime.exceptionThrown', event => errors.push(event.exceptionDetails.exception?.description || event.exceptionDetails.text));
    const mouse = async (point, modifiers = 0) => {
      await cdp.send('Input.dispatchMouseEvent', { type: 'mousePressed', ...point, button: 'left', buttons: 1, clickCount: 1, modifiers });
      await cdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', ...point, button: 'left', buttons: 0, clickCount: 1, modifiers });
    };
    const click = async selector => {
      await waitForSelector(cdp, selector);
      const scroll = await evaluate(cdp, `(() => { const el=document.querySelector(${JSON.stringify(selector)}), viewport=el?.closest('.agent-chat-timeline'); if(!viewport) return null; const r=el.getBoundingClientRect(), v=viewport.getBoundingClientRect(); return r.top < v.top+4 || r.bottom > v.bottom-4 ? {x:v.x+12,y:v.y+v.height/2,delta:r.y+r.height/2-v.y-v.height/2}:null; })()`);
      if (scroll) {
        await cdp.send('Input.dispatchMouseEvent', { type: 'mouseWheel', x: scroll.x, y: scroll.y, deltaX: 0, deltaY: scroll.delta });
        await waitFor(() => evaluate(cdp, `(() => { const el=document.querySelector(${JSON.stringify(selector)}),r=el.getBoundingClientRect(),v=el.closest('.agent-chat-timeline').getBoundingClientRect(); return r.top>=v.top && r.bottom<=v.bottom; })()`));
      }
      const point = await evaluate(cdp, `(() => { const el = document.querySelector(${JSON.stringify(selector)}); if (!el || el.disabled) throw Error('Unavailable: '+${JSON.stringify(selector)}); const r = el.getBoundingClientRect(); return {x:r.x+r.width/2,y:r.y+r.height/2}; })()`);
      await mouse(point);
    };
    const key = async (key, code, windowsVirtualKeyCode, modifiers = 0) => {
      await cdp.send('Input.dispatchKeyEvent', { type: 'keyDown', key, code, windowsVirtualKeyCode, modifiers });
      await cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', key, code, windowsVirtualKeyCode, modifiers });
    };
    const openChat = async () => {
      await waitForSelector(cdp, '[aria-label="Search diagrams"]'); await click('[aria-label="Search diagrams"]');
      await click('[role="tab"][id$="-chat"]');
      await waitFor(() => evaluate(cdp, `document.querySelector('[aria-label="Message Codex"]')?.isContentEditable === true`));
    };
    await openChat();
    // Hold the lazy highlighter's requests to exercise selecting completed code
    // before syntax highlighting arrives, as on a cold cache or slow connection.
    const highlightingRequests = [];
    const releaseHighlighting = cdp.on('Fetch.requestPaused', event => highlightingRequests.push(event.requestId));
    await cdp.send('Fetch.enable', { patterns: [{ urlPattern: '*', resourceType: 'Script', requestStage: 'Request' }] });
    await click('[aria-label="Message Codex"]');
    await cdp.send('Input.insertText', { text: 'copy-highlight' });
    await key('Enter', 'Enter', 13);
    await waitForSelector(cdp, '.agent-message-assistant h1');
    await waitFor(() => evaluate(cdp, 'document.querySelector(".agent-chat").dataset.chatState === "idle"'));
    await click('.agent-code-block pre code');
    const codePoints = await evaluate(cdp, `(() => { const el=document.querySelector('.agent-code-block pre code'), r=document.createRange();r.selectNodeContents(el);const b=r.getBoundingClientRect();return {x:b.left+1,y:b.top+b.height/2,end:b.right-1,text:el.textContent}; })()`);
    await cdp.send('Input.dispatchMouseEvent', {type:'mousePressed',x:codePoints.x,y:codePoints.y,button:'left',buttons:1,clickCount:1});
    await cdp.send('Input.dispatchMouseEvent', {type:'mouseMoved',x:codePoints.end,y:codePoints.y,button:'left',buttons:1});
    await cdp.send('Input.dispatchMouseEvent', {type:'mouseReleased',x:codePoints.end,y:codePoints.y,button:'left',buttons:0,clickCount:1});
    assert.equal(await evaluate(cdp, 'getSelection().toString()'), codePoints.text);
    await waitFor(() => highlightingRequests.length > 0);
    releaseHighlighting();
    await cdp.send('Fetch.disable');
    await waitForSelector(cdp, '.agent-code-block .shiki');
    assert.equal(await evaluate(cdp, 'getSelection().toString()'), codePoints.text, 'Syntax highlighting preserves selected code');
    assert.equal(await evaluate(cdp, '!!document.querySelector(".agent-code-block").querySelector(".shiki")'), false, 'Highlighting waits until the first block is deselected');
    await key('c','KeyC',67,2);
    await click('[aria-label="Message Codex"]');
    await key('a','KeyA',65,2);
    await key('v','KeyV',86,2);
    await waitFor(() => evaluate(cdp, `document.querySelector('[aria-label="Message Codex"]').textContent === ${JSON.stringify(codePoints.text)}`), {message:'Ctrl+C copied the selected code after highlighting'});
    await waitFor(() => evaluate(cdp, 'document.querySelectorAll(".agent-code-block .shiki").length === 2'), {message:'Clearing the selection applies the deferred highlighting'});
    const selector = '.agent-message-assistant h1';
    await click(selector);
    const node = await evaluate(cdp, `(() => { const el = [...document.querySelectorAll('[data-content-node-id][data-display-node-id]')].find(el => el.textContent.trim() === 'Service' && el.getBoundingClientRect().width); const r=el.getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2}; })()`);
    await mouse(node, 2);
    await waitFor(() => evaluate(cdp, `document.querySelectorAll('.agent-chat-composer .agent-chat-reference').length > 0`));
    const diagram = await evaluate(cdp, `(() => { const r=document.querySelector('[data-grid-box="overview"]').getBoundingClientRect(); return {x:r.x+2,y:r.bottom-6}; })()`);
    await cdp.send('Input.dispatchMouseEvent', {type:'mousePressed',...diagram,button:'left',buttons:1,clickCount:2,modifiers:2});
    await cdp.send('Input.dispatchMouseEvent', {type:'mouseReleased',...diagram,button:'left',buttons:0,clickCount:2,modifiers:2});
    await waitForSelector(cdp, '[data-grid-box="overview"][data-diagram-selected="true"]');
    const points = await evaluate(cdp, `(() => { const el=document.querySelector('${selector}'), r=document.createRange();r.selectNodeContents(el);const b=r.getBoundingClientRect(); return {x:b.left+1,y:b.top+b.height/2,end:b.right-1,text:el.textContent}; })()`);
    await cdp.send('Input.dispatchMouseEvent', {type:'mousePressed',x:points.x,y:points.y,button:'left',buttons:1,clickCount:1});
    for(let step=1;step<=10;step++) await cdp.send('Input.dispatchMouseEvent',{type:'mouseMoved',x:points.x+(points.end-points.x)*step/10,y:points.y,button:'left',buttons:1});
    await cdp.send('Input.dispatchMouseEvent',{type:'mouseReleased',x:points.end,y:points.y,button:'left',buttons:0,clickCount:1});
    assert.equal(await evaluate(cdp, 'getSelection().toString()'), points.text, 'Dragging assistant text selects it');
    await key('c','KeyC',67,2);
    await click('[aria-label="Message Codex"]');
    await key('a','KeyA',65,2);
    await key('v','KeyV',86,2);
    await waitFor(() => evaluate(cdp, `document.querySelector('[aria-label="Message Codex"]').textContent === ${JSON.stringify(points.text)}`), {message:'Ctrl+C copied selected output for pasting'});
    await key('a','KeyA',65,2);
    await key('x','KeyX',88,2);
    await waitFor(() => evaluate(cdp, `document.querySelector('[aria-label="Message Codex"]').textContent === ''`));
    assert.ok(await evaluate(cdp, '!!document.querySelector(\'[data-grid-box="overview"][data-diagram-selected="true"]\')'), 'Cutting chat text leaves the selected diagram intact');
    await key('v','KeyV',86,2);
    await waitFor(() => evaluate(cdp, `document.querySelector('[aria-label="Message Codex"]').textContent === ${JSON.stringify(points.text)}`), {message:'Cut chat text pastes back without canvas data'});
    await key('a','KeyA',65,2);
    await cdp.send('Input.insertText', {text:'stream-block'});
    await key('Enter','Enter',13);
    await waitForSelector(cdp, '.agent-diagram-block code');
    await waitFor(() => evaluate(cdp, `(() => { const el=document.querySelector('.agent-diagram-block code'), r=el.getBoundingClientRect(), v=el.closest('.agent-chat-timeline').getBoundingClientRect();return r.top >= v.top && r.bottom <= v.bottom; })()`));
    const streamPoint = await evaluate(cdp, `(() => { const el=document.querySelector('.agent-diagram-block code');const r=document.createRange();r.setStart(el.firstChild,0);r.setEnd(el.firstChild,4);const b=r.getBoundingClientRect();return {x:b.left+1,y:b.top+b.height/2,end:b.right-1}; })()`);
    await cdp.send('Input.dispatchMouseEvent', {type:'mousePressed',x:streamPoint.x,y:streamPoint.y,button:'left',buttons:1,clickCount:1});
    await cdp.send('Input.dispatchMouseEvent', {type:'mouseMoved',x:streamPoint.end,y:streamPoint.y,button:'left',buttons:1});
    await cdp.send('Input.dispatchMouseEvent', {type:'mouseReleased',x:streamPoint.end,y:streamPoint.y,button:'left',buttons:0,clickCount:1});
    assert.equal(await evaluate(cdp, 'getSelection().toString()'), 'Root');
    await waitFor(() => evaluate(cdp, 'document.querySelector(".agent-chat").dataset.chatState === "idle"'));
    assert.equal(await evaluate(cdp, 'getSelection().toString()'), 'Root', 'New streaming output preserves selected text');
    await key('c','KeyC',67,2);
    await click('[aria-label="Message Codex"]');
    await key('v','KeyV',86,2);
    await waitFor(() => evaluate(cdp, `document.querySelector('[aria-label="Message Codex"]').textContent === 'Root'`), {message:'Selected streaming output was copied'});
    await waitFor(() => evaluate(cdp, `document.querySelector('.agent-diagram-block code').textContent.includes('Last branch')`), {message:'Clearing the selection reveals all buffered output'});
    assert.deepEqual(errors, []);
    console.log('PASS: async highlighting preserves selection and Ctrl+C; selected canvas diagrams do not override text copying; streaming output remains copyable and catches up after deselection');
  });
} finally {
  if (server && server.exitCode === null) {
    const exited = new Promise(resolve => server.once('exit', resolve));
    server.kill('SIGTERM');
    let timer; await Promise.race([exited, new Promise(resolve => { timer = setTimeout(resolve, 2000); })]); clearTimeout(timer);
    if (server.exitCode === null) { server.kill('SIGKILL'); await exited; }
  }
  await rm(fixture, { recursive: true, force: true });
}
