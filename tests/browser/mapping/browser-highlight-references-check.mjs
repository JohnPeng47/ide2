import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir, homedir } from 'node:os';
import path from 'node:path';
import { createServer } from 'node:net';
import { seedMappingFixture } from '../support/browser-mapping-fixture.mjs';
const { withHeadlessBrowser, evaluate, waitFor, waitForSelector, captureScreenshot } = await import(path.join(homedir(), '.codex/skills/front-end/browser-test.mjs'));
const root = path.resolve(new URL('../../..', import.meta.url).pathname);
const fixture = await mkdtemp(path.join(tmpdir(), 'highlight-references-'));
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
    const nodeClick = async label => {
      await waitFor(() => evaluate(cdp, "!document.querySelector('.tl-hit-test-blocker:not(.tl-hit-test-blocker__hidden)')"));
      const point = await evaluate(cdp, `(() => { const el = [...document.querySelectorAll('[data-content-node-id][data-display-node-id]')].find(el => el.textContent.trim() === ${JSON.stringify(label)} && el.getBoundingClientRect().width); if(!el) throw Error('Missing node'); const r = el.getBoundingClientRect(); return {x:r.x+r.width/2,y:r.y+r.height/2}; })()`);
      await mouse(point, 2);
      await waitFor(() => evaluate(cdp, `document.querySelectorAll('.agent-chat-composer .agent-chat-reference').length > 0`));
    };
    const submit = async (text, label) => {
      await click('[aria-label="Message Codex"]'); await key('a', 'KeyA', 65, 2);
      await cdp.send('Input.insertText', { text });
      if (label) { await nodeClick(label); await click('[aria-label="Message Codex"]'); }
      await key('Enter', 'Enter', 13);
      await waitFor(() => evaluate(cdp, `document.querySelector('.agent-chat')?.dataset.chatState === 'idle' && document.querySelector('[aria-label="Message Codex"]').textContent === ''`), { timeoutMs: 20000, message: 'Highlight turn did not complete' });
    };
    const colors = () => evaluate(cdp, `Array.from(document.querySelectorAll('.diagram-content-node[data-highlight-id]')).map(el => ({id:el.dataset.highlightId,text:el.textContent,color:getComputedStyle(el).backgroundColor}))`);
    await openChat();
    await submit('Highlight selected ref blue', 'Service');
    try { await waitFor(() => evaluate(cdp, 'document.querySelectorAll(".diagram-content-node[data-highlight-id]").length >= 1')); }
    catch (error) { console.error(await evaluate(cdp, 'document.querySelector(".agent-chat")?.innerText'), errors); throw error; }
    assert.ok((await colors()).some(item => item.text === 'Service' && item.color === 'rgba(96, 165, 250, 0.333)'));
    await mouse({ x: 900, y: 800 }); await key('Escape', 'Escape', 27);
    await submit('Highlight selected ref pink', 'Other');
    assert.ok((await colors()).some(item => item.text === 'Other' && item.color === 'rgba(244, 114, 182, 0.333)'));
    const saved = await colors(); assert.equal(new Set(saved.map(item => item.id)).size, 3);
    await click('.agent-highlight-reference');
    try { await waitFor(() => evaluate(cdp, `document.querySelector('[data-jump-focus]')?.textContent === 'Service'`), { message: 'Marker did not focus its saved target' }); }
    catch (error) { console.error(await evaluate(cdp, `({focus:document.querySelector('[data-jump-focus]')?.outerHTML, text:document.body.innerText.slice(-4500), links:[...document.querySelectorAll('.agent-highlight-reference')].map(el=>{const r=el.getBoundingClientRect();return {text:el.textContent,html:el.outerHTML,hit:document.elementFromPoint(r.x+r.width/2,r.y+r.height/2)?.outerHTML.slice(0,300)};})})`)); throw error; }
    await captureScreenshot(cdp, { output: path.join(fixture, 'highlight-reference.png') });
    await cdp.send('Page.reload'); await openChat();
    await waitFor(async () => (await colors()).length === saved.length, { message: 'Highlights did not survive reload' });
    assert.deepEqual(await colors(), saved);
    await click('.agent-highlight-reference');
    await waitFor(() => evaluate(cdp, `document.querySelector('[data-jump-focus]')?.textContent === 'Service'`));
    await mouse({ x: 900, y: 800 }); await key('Escape', 'Escape', 27);
    await submit('Remove current highlights');
    await waitFor(async () => (await colors()).length === 0, { message: 'Removal left rendered highlights' });
    await click('.agent-highlight-reference');
    try { await waitFor(() => evaluate(cdp, `document.body.textContent.includes('This highlight was removed')`), { message: 'Removed marker did not report unavailable target' }); }
    catch (error) { console.error('Removed marker state:', await evaluate(cdp, `({text:document.body.innerText.slice(-5000), errors:[...document.querySelectorAll('[role=alert]')].map(el=>el.textContent), buttons:[...document.querySelectorAll('.agent-highlight-reference')].map(el=>{const r=el.getBoundingClientRect();return {text:el.textContent,x:r.x,y:r.y,hit:document.elementFromPoint(r.x+r.width/2,r.y+r.height/2)?.outerHTML.slice(0,400)};})})`)); throw error; }
    await cdp.send('Page.reload'); await openChat();
    assert.equal((await colors()).length, 0);
    await cdp.send('Network.enable');
    const publications = [];
    cdp.on('Network.requestWillBeSent', event => { if (event.request.url.endsWith('/api/mapping/diagrams/publish')) publications.push(event.request.postData); });
    await submit('Highlight canvas through MCP');
    try { await waitFor(async () => (await colors()).some(item => item.text === 'Root' && item.color === 'rgba(74, 222, 128, 0.333)')); }
    catch (error) { console.error(await evaluate(cdp, 'document.querySelector(".agent-chat")?.innerText'), logs); throw error; }
    await click('[aria-label="Menu"]');
    // Save with a real pointer event, then verify the publication request is a checkpoint receipt request.
    await waitFor(() => evaluate(cdp, '[...document.querySelectorAll(".mapping-submenu button")].some(b => b.textContent === "Save" && !b.disabled)'));
    const savePoint = await evaluate(cdp, '(() => { const b=[...document.querySelectorAll(".mapping-submenu button")].find(b=>b.textContent==="Save"); const r=b.getBoundingClientRect(); return {x:r.x+r.width/2,y:r.y+r.height/2}; })()');
    await mouse(savePoint);
    await waitFor(() => evaluate(cdp, 'document.querySelector(".mapping-submenu")?.textContent.includes("Saved")'), { message: 'Checkpoint Save did not finish' });
    assert.equal(publications.length, 1);
    assert.ok(Buffer.byteLength(publications[0]) < 2000);
    assert.ok(JSON.parse(publications[0]).checkpointId);
    assert.ok(!publications[0].includes('"history"'));
    await cdp.send('Page.reload'); await openChat();
    assert.ok((await colors()).some(item => item.text === 'Root'));
    // The existing MCP process must pick up the freshly rebound browser instance on the next turn.
    await submit('Publish canvas through MCP');
    await waitFor(() => evaluate(cdp, 'document.querySelector(".agent-chat")?.textContent.includes("MCP publication complete.")'));
    assert.deepEqual(errors, []);
    console.log('PASS: native chat tools save multiple colors; markers focus targets; reload preserves annotations; removal persists; removed references report unavailable targets; bound MCP highlights appear without reload; checkpoint Save and MCP publication survive browser rebind.');
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
