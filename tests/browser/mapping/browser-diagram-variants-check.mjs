// Run after npm run build, with CHROME_PATH set to a local Chromium executable.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir, homedir } from 'node:os';
import { createServer } from 'node:net';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { seedMappingFixture } from '../support/browser-mapping-fixture.mjs';
const { evaluate, waitFor, waitForSelector, withHeadlessBrowser, captureScreenshot } = await import(pathToFileURL(path.join(homedir(), '.codex/skills/front-end/browser-test.mjs')).href);
const root = await mkdtemp(path.join(tmpdir(), 'diagram-variants-ui-'));
let server;
try {
  await seedMappingFixture(root, { ascii: 'Shop\n|-- Payment\n|   |-- Authorize\n|   `-- Capture\n`-- Cart', nodes: [] });
  const port = await new Promise(resolve => { const s = createServer(); s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => resolve(p)); }); });
  const url = `http://127.0.0.1:${port}`;
  server = spawn(process.execPath, ['scripts/dev/start-server.mjs', 'preview', '--http', '--pi', '--host', '127.0.0.1', '--port', String(port), '--strictPort'],
    { detached: true, env: { ...process.env, NEW_DIAGRAM_PROJECT_ROOT: root, NEW_DIAGRAMS_DIR: path.join(root, '.diagrams'), NEW_DIAGRAM_AGENT: 'fake' }, stdio: ['ignore', 'ignore', 'pipe'] });
  let errors = ''; server.stderr.on('data', c => { errors += c; });
  await waitFor(async () => (await fetch(url).catch(() => null))?.ok, { timeoutMs: 20000 }).catch(e => { throw Error(`${e}\n${errors}`); });
  await withHeadlessBrowser({ url: `${url}/mapping?diagram=representation-overview`, width: 1800, height: 1300,
    chromePath: process.env.CHROME_PATH, arguments: ['--no-sandbox', '--disable-gpu'] }, async ({ cdp }) => {
    const browserErrors = [];
    await cdp.send('Page.enable'); await cdp.send('Runtime.enable');
    cdp.on('Runtime.exceptionThrown', event => browserErrors.push(event.exceptionDetails));
    cdp.on('Page.javascriptDialogOpening', () => void cdp.send('Page.handleJavaScriptDialog', { accept: true }));
    const mouse = async (type, p, clickCount = 1, modifiers = 0) => cdp.send('Input.dispatchMouseEvent', { type, ...p, button: 'left', buttons: type === 'mouseReleased' ? 0 : 1, clickCount, modifiers });
    const click = async (selector, text) => {
      for (let attempt = 0; attempt < 15; attempt++) {
        const scroll = await evaluate(cdp, `(() => { const e=[...document.querySelectorAll(${JSON.stringify(selector)})].find(e=>!${JSON.stringify(text)} || e.textContent.trim()===${JSON.stringify(text)}); const panel=document.querySelector('.llm-panel'); if(!e || !panel || !panel.contains(e)) return null; const r=e.getBoundingClientRect(), p=panel.getBoundingClientRect(); if(r.top>=p.top && r.bottom<=p.bottom) return null; return {x:p.right-20,y:p.top+40,deltaY:r.top<p.top?-300:300,deltaX:0}; })()`);
        if (!scroll) break;
        const before = await evaluate(cdp,"document.querySelector('.llm-panel').scrollTop");
        await cdp.send('Input.dispatchMouseEvent',{type:'mouseWheel',...scroll});
        await waitFor(async()=>await evaluate(cdp,"document.querySelector('.llm-panel').scrollTop")!==before);
      }
      const p = await evaluate(cdp, `(() => { const e=[...document.querySelectorAll(${JSON.stringify(selector)})].find(e=>!${JSON.stringify(text)} || e.textContent.trim()===${JSON.stringify(text)}); if (!e || e.disabled) throw Error('Unavailable: '+${JSON.stringify(text ?? selector)}); const r=e.getBoundingClientRect(); const p={x:r.x+r.width/2,y:r.y+r.height/2}; if(!e.contains(document.elementFromPoint(p.x,p.y))) throw Error('Occluded: '+${JSON.stringify(text ?? selector)}+' '+JSON.stringify(r)); return p; })()`);
      await mouse('mousePressed', p); await mouse('mouseReleased', p);
    };
    const key = async (value, modifiers = 0) => {
      await cdp.send('Input.dispatchKeyEvent', { type: 'keyDown', key: value, code: ['Escape','End','Enter','ArrowDown'].includes(value) ? value : `Key${value.toUpperCase()}`, modifiers, windowsVirtualKeyCode: ({Escape:27,End:35,Enter:13,ArrowDown:40})[value] ?? value.toUpperCase().charCodeAt(0) });
      await cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', key: value, modifiers });
    };
    const nodeClick = async label => {
      await waitFor(async()=>await evaluate(cdp,"!document.querySelector('.tl-hit-test-blocker:not(.tl-hit-test-blocker__hidden)')"));
      const p = await evaluate(cdp, `(() => { const e=[...document.querySelectorAll('[data-content-node-id][data-display-node-id]')].find(e=>e.textContent.trim()===${JSON.stringify(label)} && e.getBoundingClientRect().width>0); if(!e)throw Error('Missing node'); const r=e.getBoundingClientRect(); return {x:r.x+r.width/2,y:r.y+r.height/2}; })()`);
      await mouse('mousePressed', p, 2, 2); await mouse('mouseReleased', p, 2, 2);
    };
    const text = () => evaluate(cdp, "[...document.querySelectorAll('[data-native-node] .mapping-poc-ascii')].map(el => el.textContent).join('\\n')");
    const idle = () => waitFor(async()=>await evaluate(cdp,"!document.querySelector('.variant-review button:disabled')"));
    const open = async () => { await key('b', 2); await key('l'); await waitForSelector(cdp,'.llm-panel .prompt-body-text'); };
    try {
      await waitForSelector(cdp, '[data-grid-box=overview]');
      await nodeClick('Payment'); await open();
      await click('[aria-label="Generate variants for review"]');
      await click('[aria-label="Variant count"]'); await key('ArrowDown'); await key('Enter');
      assert.equal(await evaluate(cdp,"document.querySelector('[aria-label=\"Variant count\"]').value"),'2');
      await click('.prompt-body-text'); await cdp.send('Input.insertText',{text:'Improve payment'});
      const original = await text();
      await click('.llm-panel button[type=submit]');
      await waitForSelector(cdp,'[data-edit-status=completed]',{timeoutMs:20000});
      await waitForSelector(cdp,'.variant-review');
      assert.equal(await evaluate(cdp,"document.querySelectorAll('[aria-label=\"Review variant\"] option').length"),2);
      assert.equal(await text(),original,'Generating variants leaves the live diagram unchanged');
      await click('.variant-review summary');
      assert.match(await evaluate(cdp,"document.querySelector('.variant-review pre').textContent"),/Payment \[edited:/);
      await click('.variant-review li button','Accept'); await idle();
      await click('.variant-review button','Apply reviewed changes'); await idle();
      await waitFor(async()=>(await text()).includes('Payment [edited:'));
      assert.ok((await text()).includes('Cart'));
      assert.ok(await evaluate(cdp,"(()=>{const p=document.querySelector('.llm-panel');return p.scrollWidth<=p.clientWidth+1})()"),'Long candidate text scrolls within its preview, without widening the panel');
      await captureScreenshot(cdp,{output:process.env.VARIANT_SCREENSHOT_PATH ?? path.join(root,'review.png')});
      console.log('PASS generate two saved subtree variants, preview, accept one node and apply');
      const loaded = new Promise(resolve => { const off=cdp.on('Page.loadEventFired',()=>{off();resolve();}); });
      await cdp.send('Page.reload',{ignoreCache:true}); await loaded;
      await waitFor(async()=>(await text()).includes('Payment [edited:'));
      await nodeClick('Cart'); await open();
      await waitForSelector(cdp,'.variant-review');
      assert.equal(await evaluate(cdp,"document.querySelectorAll('[aria-label=\"Review variant\"] option').length"),2);
      await click('.variant-review button','Reject all'); await idle();
      await click('.variant-review button','Apply reviewed changes'); await idle();
      await waitFor(async()=>(await text())===original);
      console.log('PASS reload retains both variants and decisions; rejecting the applied change rolls it back');
      await click('[aria-label="Close Workspace tools"]');
      await key('z',2); await waitFor(async()=>(await text()).includes('Payment [edited:'));
      await key('y',2); await waitFor(async()=>(await text())===original);
      assert.deepEqual(browserErrors,[]);
      console.log('PASS undo/redo restores application and rollback without losing variants');
    } catch(error) {
      console.error(await evaluate(cdp,"document.querySelector('.llm-panel')?.innerText"));
      await captureScreenshot(cdp,{output:path.join(root,'failure.png')});
      throw error;
    }
  });
} finally {
  if(server) { try { process.kill(-server.pid,'SIGTERM'); } catch {} }
  await rm(root,{recursive:true,force:true});
}
