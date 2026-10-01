import assert from 'node:assert/strict';
import path from 'node:path';
import { writeFile } from 'node:fs/promises';
import { session, evaluate, waitFor, ready, pane, viewer, point, click, positions, captureScreenshot } from './session.mjs';

await session('correctness',async({cdp,url,destination,metadata})=>{
  assert.equal(await evaluate(cdp,`document.querySelectorAll('.source-code-line').length`),15000,'All five 3,000-line files render');
  assert(await evaluate(cdp,`document.querySelector('.source-token[style*="color"]')!==null`),'Syntax highlighting is visible');
  const before=await positions(cdp),p=await point(cdp,viewer(1));
  await cdp.send('Input.dispatchMouseEvent',{type:'mouseWheel',...p,deltaX:0,deltaY:300});
  await waitFor(async()=>(await positions(cdp))['source-1'].top>=before['source-1'].top+299);
  const scrolled=await positions(cdp);
  for(let i=2;i<=5;i++)assert.deepEqual(scrolled[`source-${i}`],before[`source-${i}`],'Scroll stays local to pane 1');
  await click(cdp,`${pane(1)} [aria-label="Collapse pane"]`);await ready(cdp,4);
  await click(cdp,`${pane(1)} [aria-label="Expand pane"]`);await ready(cdp,5);
  assert.equal((await positions(cdp))['source-1'].top,scrolled['source-1'].top,'Reopening preserves scroll');
  await click(cdp,'.mapping-workspace-actions button:first-child');
  await waitFor(async()=>{const w=await(await fetch(`${url}/api/mapping/workspace`)).json();return w.documents[0].canvas.display.nodes['source-1'].content.scroll?.top===scrolled['source-1'].top;});
  const loaded=new Promise((resolve,reject)=>{
    const timer=setTimeout(()=>{off();reject(new Error('Reload timed out'));},30000);
    const off=cdp.on('Page.loadEventFired',()=>{clearTimeout(timer);off();resolve();});
  });
  await cdp.send('Page.reload',{ignoreCache:true});await loaded;await ready(cdp,5);
  await waitFor(async()=>(await positions(cdp))['source-1']?.top===scrolled['source-1'].top,{message:'Saved scroll restored after reload'});
  await captureScreenshot(cdp,{output:path.join(destination,'five-panes.png')});
  await writeFile(path.join(destination,'result.json'),JSON.stringify({passed:true,...metadata,checks:['15,000 source rows','syntax highlighting','independent scroll','collapse/expand','save/reload scroll']},null,2));
  console.log('Passed rendering, highlighting, independent scrolling, collapse/expand and persisted scroll checks.');
});
