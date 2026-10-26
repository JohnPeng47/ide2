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
const root = await mkdtemp(path.join(tmpdir(), 'canvas-views-ui-'));
let server;
try {
  await seedMappingFixture(root, { ascii: 'Shop\n|-- Payment\n|   |-- Authorize\n|   `-- Capture\n`-- Cart', nodes: [] });
  const port = await new Promise(resolve => { const s = createServer(); s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => resolve(p)); }); });
  const url = `http://127.0.0.1:${port}`;
  server = spawn(process.execPath, ['scripts/dev/start-server.mjs', 'preview', '--http', '--pi', '--host', '127.0.0.1', '--port', String(port), '--strictPort'],
    { detached: true, env: { ...process.env, NEW_DIAGRAM_PROJECT_ROOT: root, NEW_DIAGRAMS_DIR: path.join(root, '.diagrams'), NEW_DIAGRAM_AGENT: 'fake', NEW_DIAGRAM_CODEX_BIN: path.resolve('tests/support/codex-app-server.mjs') }, stdio: ['ignore', 'ignore', 'pipe'] });
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
      const panelExpression = `(() => { const e=[...document.querySelectorAll(${JSON.stringify(selector)})].find(e=>e.getBoundingClientRect().height>0 && (!${JSON.stringify(text)} || e.textContent.trim()===${JSON.stringify(text)})); let panel=e?.parentElement; while(panel && !(panel.scrollHeight>panel.clientHeight && /auto|scroll/.test(getComputedStyle(panel).overflowY))) panel=panel.parentElement; return panel; })()`;
      for (let attempt = 0; attempt < 15; attempt++) {
        const scroll = await evaluate(cdp, `(() => { const e=[...document.querySelectorAll(${JSON.stringify(selector)})].find(e=>e.getBoundingClientRect().height>0 && (!${JSON.stringify(text)} || e.textContent.trim()===${JSON.stringify(text)})); const panel=${panelExpression}; if(!e || !panel) return null; const r=e.getBoundingClientRect(), p=panel.getBoundingClientRect(); if(r.top>=p.top && r.bottom<=p.bottom) return null; return {x:p.right-20,y:Math.max(0,p.top)+40,deltaY:r.top<p.top?-300:300,deltaX:0}; })()`);
        if (!scroll) break;
        const before = await evaluate(cdp,`(${panelExpression})?.scrollTop`);
        await cdp.send('Input.dispatchMouseEvent',{type:'mouseWheel',...scroll});
        await waitFor(async()=>await evaluate(cdp,`(${panelExpression})?.scrollTop`)!==before);
      }
      const p = await evaluate(cdp, `(() => { const e=[...document.querySelectorAll(${JSON.stringify(selector)})].find(e=>e.getBoundingClientRect().height>0 && (!${JSON.stringify(text)} || e.textContent.trim()===${JSON.stringify(text)})); if (!e || e.disabled) throw Error('Unavailable: '+${JSON.stringify(text ?? selector)}); const r=e.getBoundingClientRect(); const p={x:r.x+r.width/2,y:r.y+r.height/2}; if(!e.contains(document.elementFromPoint(p.x,p.y))) throw Error('Occluded: '+${JSON.stringify(text ?? selector)}+' '+JSON.stringify(r)); return p; })()`);
      await mouse('mousePressed', p); await mouse('mouseReleased', p);
    };
    const key = async (value, modifiers = 0) => {
      await cdp.send('Input.dispatchKeyEvent', { type: 'keyDown', key: value, code: ['Escape','End','Enter','ArrowDown','ArrowRight','ArrowLeft','ArrowUp'].includes(value) ? value : `Key${value.toUpperCase()}`, modifiers, windowsVirtualKeyCode: ({Escape:27,End:35,Enter:13,ArrowDown:40,ArrowRight:39,ArrowLeft:37,ArrowUp:38})[value] ?? value.toUpperCase().charCodeAt(0) });
      await cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', key: value, modifiers });
    };
    const nodeClick = async label => {
      await waitFor(async()=>await evaluate(cdp,"!document.querySelector('.tl-hit-test-blocker:not(.tl-hit-test-blocker__hidden)')"));
      const p = await evaluate(cdp, `(() => { const e=[...document.querySelectorAll('[data-content-node-id][data-display-node-id]')].find(e=>e.textContent.trim()===${JSON.stringify(label)} && e.getBoundingClientRect().width>0); if(!e)throw Error('Missing node'); const r=e.getBoundingClientRect(); return {x:r.x+r.width/2,y:r.y+r.height/2}; })()`);
      await mouse('mousePressed', p, 2, 2); await mouse('mouseReleased', p, 2, 2);
    };
    const text = () => evaluate(cdp, "[...document.querySelectorAll('[data-native-node] .mapping-poc-ascii')].map(el => el.textContent).join('\\n')");
    const reload = async () => {
      const before = await evaluate(cdp, 'performance.timeOrigin');
      await cdp.send('Page.reload', { ignoreCache: true });
      await waitFor(async () => { try { return await evaluate(cdp, `performance.timeOrigin !== ${before} && document.readyState === 'complete'`); } catch { return false; } });
    };
    const open = async () => { await key('b', 2); await key('l'); await waitForSelector(cdp,'.llm-panel .prompt-body-text'); };
    try {
      await waitForSelector(cdp, '[aria-label="Explorer mode"]');
      const openViews = async () => { await click('[aria-label="Explorer mode"] button', 'Canvas'); await waitForSelector(cdp, '[aria-label="Canvas panels"]'); };
      const viewClick = async label => { await click(`.canvas-view-controls button[aria-label="${label}"]`); await viewIdle(); };
      await click('[aria-label="Search diagrams"]');
      await waitForSelector(cdp, '[role="tab"][id$="-chat"]'); await click('[role="tab"][id$="-chat"]');
      await waitFor(async () => await evaluate(cdp, `document.querySelector('[aria-label="Message Codex"]')?.isContentEditable`));
      await click('[aria-label="Message Codex"]'); await cdp.send('Input.insertText', { text: 'Seed evaluation context' });
      await click('.agent-chat-send');
      await waitFor(async () => await evaluate(cdp, `document.querySelector('.agent-chat')?.dataset.chatState === 'idle' && !!document.querySelector('.agent-message-assistant')`));
      await click('[aria-label="Close Agent Chat"]');
      await openViews();
      const name = async (value, opener) => {
        const button = `.canvas-view-controls button[aria-label="${opener}"]`;
        await waitFor(async () => await evaluate(cdp, `document.querySelector(${JSON.stringify(button)})?.disabled === false`)); await click(button);
        await waitForSelector(cdp, '[aria-label="Canvas view name"]');
        await click('[aria-label="Canvas view name"]'); await key('a', 2);
        await cdp.send('Input.insertText', { text: value });
      };
      const viewIdle = () => waitFor(async () => await evaluate(cdp, "!document.querySelector('.canvas-view-controls fieldset').disabled"));
      const openView = async value => { await click(`[role="treeitem"][aria-label="${value}"] > .canvas-view-row`); await viewIdle(); };
      const collapsed = () => evaluate(cdp, "!!document.querySelector('[aria-label=\"Expand subtree Payment\"]')");
      const treeNames = () => evaluate(cdp, "[...document.querySelectorAll('.canvas-view-tree [role=treeitem]')].map(e=>e.getAttribute('aria-label'))");
      const current = () => evaluate(cdp, "document.querySelector('.canvas-view-current')?.textContent");
      await name('A', 'New view…'); await viewClick('Save as view');
      await waitFor(async () => (await current())?.includes('Editing A'));
      await click('[aria-label="Collapse subtree Payment"]'); await waitFor(collapsed);
      await viewClick('Save view');
      await waitFor(async () => (await current())?.endsWith('Saved'));
      await click('.canvas-view-controls button[aria-label="Generate alternatives…"]');
      await waitFor(async () => await evaluate(cdp, `!!document.querySelector('[aria-label="Source AgentChat"]')?.value`));
      const fill = async (selector, value) => { await click(selector); await key('a', 2); await cdp.send('Input.insertText', { text: value }); };
      await fill('[aria-label="Shared generation prompt"]', 'Generate three independently evaluated layouts');
      for (let i = 1; i <= 3; i++) await fill(`[aria-label="Alternative ${i} prompt"]`, `Explore layout ${i}`);
      if (process.env.CANVAS_VIEW_SCREENSHOT_PATH) await captureScreenshot(cdp, { output: process.env.CANVAS_VIEW_SCREENSHOT_PATH.replace('.png', '-form.png') });
      await click('.canvas-generation-form button', 'Generate alternatives');
      await waitForSelector(cdp, '[data-generation-status="queued"], [data-generation-status="generating"]');
      assert.equal((await current()).includes('Editing A ·'), true, 'Generation must not switch the live view');
      await click('[role="treeitem"][aria-label="A.1"] > .canvas-view-row');
      if (process.env.CANVAS_VIEW_SCREENSHOT_PATH) await captureScreenshot(cdp, { output: process.env.CANVAS_VIEW_SCREENSHOT_PATH.replace('.png', '-running.png') });
      await waitFor(async () => await evaluate(cdp, `document.querySelectorAll('[data-generation-status="finished"]').length === 3`), { timeoutMs: 30000 });
      const sessions = await (await fetch(`${url}/api/mapping/agent-chat/sessions`)).json();
      const parent = sessions.find(item => !item.parentChatId);
      const children = await Promise.all(sessions.filter(item => item.parentChatId === parent.id).map(item => fetch(`${url}/api/mapping/agent-chat/sessions/${item.id}`).then(response => response.json())));
      assert.equal(children.length, 3);
      for (const child of children) {
        assert.equal(child.settings.model, parent.settings.model);
        assert.equal(child.settings.effort, parent.settings.effort || 'high');
        assert.equal(child.generation.metadata.usage.totalTokens, 140);
        assert.equal(child.generation.metadata.triggerPrompt, 'Generate three independently evaluated layouts');
        assert.equal(child.generation.history, undefined, 'Do not send private checkpoint archives to the chat UI');
      }

      assert.deepEqual(await treeNames(), ['A', 'A.1', 'A.2', 'A.3']);
      await click('[aria-label="Collapse view A"]');
      assert.deepEqual(await treeNames(), ['A']);
      await key('ArrowRight'); // The tree item retains focus after folding.
      await waitFor(async () => (await treeNames()).length === 4);
      await key('ArrowDown'); await key('Enter'); await viewIdle();
      await waitFor(async () => (await current())?.includes('Editing A.1'));
      await waitFor(async () => !await collapsed());
      await waitFor(async () => (await text()).includes('Generated A.1'));
      await click('.canvas-generation-details button', 'Open generation chat');
      await waitFor(async () => await evaluate(cdp, `document.querySelector('.agent-chat')?.textContent.includes('Generate this single canvas alternative')`));
      await click('[aria-label="Close Agent Chat"]');
      await click('[aria-label="Collapse subtree Payment"]'); await waitFor(collapsed);
      await openView('A.2'); await waitFor(async () => !await collapsed());
      await viewClick('Next view'); await waitFor(async () => (await current())?.includes('Editing A.3'));
      await waitFor(async () => !await collapsed());
      await viewClick('Previous view'); await waitFor(async () => (await current())?.includes('Editing A.2'));
      await openView('A.1'); await waitFor(collapsed);
      await waitFor(async () => (await current())?.includes('Unsaved changes'));
      await reload();
      await waitForSelector(cdp, '[aria-label="Explorer mode"]'); await openViews();
      await waitFor(async () => (await current())?.includes('Editing A.1'));
      await waitFor(collapsed);
      await openView('A.3'); await waitFor(async () => !await collapsed());
      await openView('A.1'); await waitFor(collapsed);
      await viewClick('Keep this alternative');
      assert.deepEqual(await treeNames(), ['A', 'A.1']);
      await waitFor(async () => (await current())?.endsWith('Saved'));
      await openView('A'); await waitFor(collapsed);
      await waitFor(async () => (await text()).includes('Shop'));
      await openView('A.1'); await waitFor(collapsed);
      await name('A.1 child', 'Fork view…'); await viewClick('Fork view');
      assert.deepEqual(await treeNames(), ['A', 'A.1', 'A.1 child']);
      await waitFor(async () => (await current())?.includes('Editing A.1 child'));
      await key('s', 2); await viewIdle(); // Ctrl+S saves the active view.
      await waitFor(async () => (await evaluate(cdp, "document.querySelector('.canvas-view-notice')?.textContent")) === 'Saved A.1 child.');
      await captureScreenshot(cdp, { output: process.env.CANVAS_VIEW_SCREENSHOT_PATH ?? path.join(root, 'canvas-views.png') });
      await reload();
      await waitForSelector(cdp, '[aria-label="Explorer mode"]'); await openViews();
      await waitFor(async () => (await treeNames()).length === 3);
      assert.deepEqual(await treeNames(), ['A', 'A.1', 'A.1 child']);
      await viewClick('Discard view');
      assert.deepEqual(await treeNames(), ['A', 'A.1']);
      assert.deepEqual(browserErrors, []);
      console.log('PASS parallel generation with inherited chat settings and tokens; save, independent alternatives, parent/child explorer, keyboard navigation, preserved drafts, cycling, keep/discard, fork, and reload');

    } catch(error) {
      console.error(await evaluate(cdp,"document.querySelector('.canvas-view-controls')?.innerText"));
      await captureScreenshot(cdp,{output:process.env.CANVAS_VIEW_SCREENSHOT_PATH ?? path.join(root,'failure.png')});
      throw error;
    }
  });
} finally {
  if(server) { try { process.kill(-server.pid,'SIGTERM'); } catch {} }
  await rm(root,{recursive:true,force:true});
}
