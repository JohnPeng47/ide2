import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir, homedir } from 'node:os';
import path from 'node:path';
import { createServer } from 'node:net';
import { seedMappingFixture } from '../support/browser-mapping-fixture.mjs';
const { withHeadlessBrowser, evaluate, waitFor, waitForSelector } = await import(path.join(homedir(), '.codex/skills/front-end/browser-test.mjs'));
const root = path.resolve(new URL('../../..', import.meta.url).pathname);
const fixture = await mkdtemp(path.join(tmpdir(), 'agent-chat-node-selection-'));
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
    const mouse = async (point, modifiers = 0, clickCount = 1) => {
      await cdp.send('Input.dispatchMouseEvent', { type: 'mousePressed', ...point, button: 'left', buttons: 1, clickCount, modifiers });
      await cdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', ...point, button: 'left', buttons: 0, clickCount, modifiers });
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
    await cdp.send('Network.enable');
    const sent = [];
    cdp.on('Network.requestWillBeSent', event => {
      if (event.request.url.endsWith('/send') && event.request.postData) sent.push(JSON.parse(event.request.postData));
    });
    const nodePoint = async label => evaluate(cdp, `(() => {
      const el = [...document.querySelectorAll('[data-content-node-id][data-display-node-id]')].find(el => el.textContent.trim() === ${JSON.stringify(label)} && el.getBoundingClientRect().width);
      if (!el) throw Error('Missing node: '+${JSON.stringify(label)});
      const r = el.getBoundingClientRect(); return {x:r.x+r.width/2,y:r.y+r.height/2};
    })()`);
    const labels = () => evaluate(cdp, `[...document.querySelectorAll('[data-native-node] [data-content-node-id].is-selected')].map(el => el.textContent.trim()).sort()`);
    const refs = () => evaluate(cdp, `document.querySelectorAll('.agent-chat-composer .agent-chat-reference').length`);
    const expectSelection = async (expected, count) => {
      await waitFor(async () => JSON.stringify(await labels()) === JSON.stringify(expected) && await refs() === count,
        { message: `Expected selection ${expected} and ${count} refs`, timeoutMs: 6000 }).catch(async error => {
          console.error({ labels: await labels(), refs: await refs() }); throw error;
        });
    };
    const nodeClick = async (label, double = false) => {
      const p = await nodePoint(label);
      await mouse(p, 2);
      if (double) await mouse(p, 2, 2);
    };
    await mouse(await nodePoint('Service'));
    assert.deepEqual(await labels(), [], 'Plain click leaves nodes unselected');
    assert.equal(await refs(), 0, 'Plain click inserts no reference');
    await nodeClick('Service');
    await expectSelection(['Service'], 1);
    await nodeClick('Service');
    await expectSelection([], 0);

    // A real double click includes its first click, which must not remain attached.
    await nodeClick('Service', true);
    await expectSelection(['Service', 'Worker'], 1);
    assert.equal(await evaluate(cdp, `!!document.querySelector('[data-grid-box=overview][data-diagram-selected=true]')`), false, 'Node double click does not select the whole diagram');
    const chipId = await evaluate(cdp, `document.querySelector('.agent-chat-composer [data-reference-id]').dataset.referenceId`);
    await nodeClick('Worker');
    await expectSelection(['Service'], 1);
    assert.equal(await evaluate(cdp, `document.querySelector('.agent-chat-composer [data-reference-id]').dataset.referenceId`), chipId, 'Membership edits update the existing automatic reference');
    await key('z', 'KeyZ', 90, 2);
    await expectSelection(['Service', 'Worker'], 1);
    await key('y', 'KeyY', 89, 2);
    await expectSelection(['Service'], 1);
    await key('Escape', 'Escape', 27);
    await expectSelection([], 0);

    await click('[aria-label="Collapse subtree Service"]');
    await nodeClick('Service', true);
    await expectSelection(['Service'], 1);
    await click('[aria-label="Expand subtree Service"]');
    await expectSelection(['Service', 'Worker'], 1);
    await nodeClick('Other');
    await expectSelection(['Other', 'Service', 'Worker'], 2);
    await key('Escape', 'Escape', 27);
    await expectSelection(['Service', 'Worker'], 1);
    await nodeClick('Service', true);
    await expectSelection([], 0);

    // A manually removed automatic chip stays removed until deselection/reselection.
    await nodeClick('Service');
    await expectSelection(['Service'], 1);
    await click('.agent-chat-composer .agent-chat-reference button');
    await expectSelection(['Service'], 0);
    await nodeClick('Other');
    await expectSelection(['Other', 'Service'], 1);
    await nodeClick('Other');
    await expectSelection(['Service'], 0);
    await nodeClick('Service');
    await expectSelection([], 0);
    await nodeClick('Service', true);
    await expectSelection(['Service', 'Worker'], 1);
    await click('[aria-label="Message Codex"]');
    await cdp.send('Input.insertText', { text: 'Explain selected subtree' });
    await key('Enter', 'Enter', 13);
    await waitFor(() => sent.length === 1, { message: 'Selected references were not submitted' });
    assert.equal(sent[0].references.length, 1, 'Only the final subtree reference is sent');
    assert.equal(sent[0].references[0].reference.kind, 'nodes');
    assert.equal(sent[0].references[0].reference.nodeIds.length, 2);
    assert.match(sent[0].references[0].ascii, /Service/);
    assert.match(sent[0].references[0].ascii, /Worker/);
    assert.doesNotMatch(sent[0].references[0].ascii, /Other/);
    await waitFor(() => evaluate(cdp, 'document.querySelector(".agent-chat").dataset.chatState === "idle"'));
    assert.equal(await refs(), 0, 'Sending does not reinsert the still-selected reference');
    assert.deepEqual(errors, []);
    console.log('PASS: plain click ignored; Ctrl single-node and double-click subtree toggles; folded descendants; automatic refs follow membership, undo/redo and Escape; dismissal and exact submitted references');
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
