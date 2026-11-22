// Read-only production check against saved Evals data. No model calls or application writes.
// npm run build && EVAL_OUTPUT_URL='http://localhost:5191/evals?run=...&output=...' node tests/performance/browser-eval-reader.mjs
// EVAL_READER_BASELINE=1 records the unfixed behavior without regression assertions.
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile, writeFile, rm } from 'node:fs/promises';
import { homedir, tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { chromium } from '@playwright/test';
const { withHeadlessBrowser, evaluate, waitFor, waitForSelector, captureScreenshot } = await import(pathToFileURL(path.join(homedir(), '.codex/skills/front-end/browser-test.mjs')).href);
assert.ok(process.env.EVAL_OUTPUT_URL, 'Set EVAL_OUTPUT_URL to a saved Markdown output URL.');
const original = new URL(process.env.EVAL_OUTPUT_URL);
const baseline = process.env.EVAL_READER_BASELINE === '1';
let changedExperiment = false;
// Serve the built frontend; proxy only reads to the existing backend. Migration is a no-op.
const server=createServer(async(req,res)=>{
 try{
  const url=new URL(req.url,'http://localhost');
  if(url.pathname.startsWith('/api/')){
   if(req.method!=='GET'){
    if(url.pathname==='/api/mapping/evals/migrate'){res.setHeader('content-type','application/json');res.end('{"migrated":0}');return;}
    res.writeHead(405);res.end();return;
   }
   const reply=await fetch(new URL(req.url,original.origin));res.writeHead(reply.status,{'content-type':reply.headers.get('content-type')??'application/json'});
   if(changedExperiment && url.pathname==='/api/mapping/evals/experiments') {
    const experiments=await reply.json();
    const selected=experiments.find(e=>e.samples.some(s=>s.outputs.some(o=>o.runId===original.searchParams.get('run'))));
    if(selected)selected.name='Polling update verified';
    res.end(JSON.stringify(experiments));
   }else res.end(Buffer.from(await reply.arrayBuffer()));
   return;
  }
  const file=url.pathname==='/evals'||url.pathname==='/'?'index.html':decodeURIComponent(url.pathname).slice(1);
  if(file.includes('..')){res.writeHead(400);res.end();return;}
  const data=await readFile(path.join(process.cwd(),'dist',file));
  res.setHeader('content-type',({'.js':'application/javascript','.css':'text/css','.html':'text/html','.svg':'image/svg+xml','.woff2':'font/woff2'})[path.extname(file)]??'application/octet-stream');res.end(data);
 }catch(e){res.writeHead(500);res.end(String(e));}
});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const url=`http://127.0.0.1:${server.address().port}${original.pathname}${original.search}`;
const screenshot=path.join(tmpdir(),`eval-reader-${process.pid}.png`);
try{
 await withHeadlessBrowser({url:'about:blank',width:1440,height:1000,chromePath:process.env.BROWSER_EXECUTABLE_PATH??chromium.executablePath(),arguments:['--no-sandbox']},async({cdp})=>{
  const errors=[];let refreshes=0;
  await cdp.send('Runtime.enable');await cdp.send('Network.enable');await cdp.send('Performance.enable');
  cdp.on('Runtime.exceptionThrown',e=>errors.push(e.exceptionDetails.text));
  cdp.on('Network.responseReceived',e=>{if(new URL(e.response.url).pathname==='/api/mapping/evals/runs')refreshes++;});
  await cdp.send('Page.navigate',{url});
  await waitForSelector(cdp,'.output-markdown[data-rendered-markdown]',{timeoutMs:60000});
  await waitForSelector(cdp,'.experiment-explorer',{timeoutMs:60000});
  await evaluate(cdp,'new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))');
  const metric=async()=>Object.fromEntries((await cdp.send('Performance.getMetrics')).metrics.map(x=>[x.name,x.value]));
  const point=async(selector)=>evaluate(cdp,`(()=>{const r=document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect();return{x:r.x+r.width/2,y:r.y+r.height/2}})()`);
  const click=async(selector)=>{const p=await point(selector);await cdp.send('Input.dispatchMouseEvent',{type:'mousePressed',...p,button:'left',buttons:1,clickCount:1});await cdp.send('Input.dispatchMouseEvent',{type:'mouseReleased',...p,button:'left',buttons:0,clickCount:1});};
  const begin=async()=>{
   await evaluate(cdp,`(()=>{const s=window.__readerPerf={storageWrites:0,htmlWrites:0,layoutReads:0,frames:[],longTasks:[],last:performance.now()};
    s.setItem=Storage.prototype.setItem;Storage.prototype.setItem=function(k,v){if(k==='evals-nav-width')s.storageWrites++;return s.setItem.call(this,k,v)};
    s.html=Object.getOwnPropertyDescriptor(Element.prototype,'innerHTML');Object.defineProperty(Element.prototype,'innerHTML',{...s.html,set(v){if(this.matches('.output-markdown'))s.htmlWrites++;return s.html.set.call(this,v)}});
    s.rect=Element.prototype.getBoundingClientRect;Element.prototype.getBoundingClientRect=function(){if(this.matches('.evals-layout'))s.layoutReads++;return s.rect.call(this)};
    s.po=new PerformanceObserver(l=>s.longTasks.push(...l.getEntries().map(e=>e.duration)));s.po.observe({type:'longtask'});
    const frame=t=>{s.frames.push(t-s.last);s.last=t;s.raf=requestAnimationFrame(frame)};s.raf=requestAnimationFrame(frame);
   })()`);return metric();
  };
  const end=async(before)=>{
   const after=await metric();const stats=await evaluate(cdp,`(()=>{const s=window.__readerPerf;cancelAnimationFrame(s.raf);s.po.disconnect();Storage.prototype.setItem=s.setItem;Object.defineProperty(Element.prototype,'innerHTML',s.html);Element.prototype.getBoundingClientRect=s.rect;return{storageWrites:s.storageWrites,htmlWrites:s.htmlWrites,layoutReads:s.layoutReads,frames:s.frames.slice(1),longTasks:s.longTasks}})()`);
   const frames=stats.frames.sort((a,b)=>a-b);delete stats.frames;
   return{...stats,frameP95Ms:frames[Math.floor(frames.length*.95)],maxFrameMs:Math.max(...frames),mainThreadMs:(after.TaskDuration-before.TaskDuration)*1000,scriptMs:(after.ScriptDuration-before.ScriptDuration)*1000,layoutMs:(after.LayoutDuration-before.LayoutDuration)*1000};
  };
  const before=await begin(),divider=await point('[aria-label="Resize sidebar"]'),start=performance.now();
  await cdp.send('Input.dispatchMouseEvent',{type:'mousePressed',...divider,button:'left',buttons:1,clickCount:1});
  for(let step=1;step<=180;step++){
   await cdp.send('Input.dispatchMouseEvent',{type:'mouseMoved',x:divider.x+100*Math.sin(step/20),y:divider.y,button:'left',buttons:1});
   const delay=start+step*1000/60-performance.now();if(delay>0)await new Promise(r=>setTimeout(r,delay));
  }
  const resizeDuring=await evaluate(cdp,'({writes:window.__readerPerf.storageWrites})');
  await cdp.send('Input.dispatchMouseEvent',{type:'mouseReleased',x:divider.x+100*Math.sin(9),y:divider.y,button:'left',buttons:0,clickCount:1});
  const resize=await end(before);
  const width=await evaluate(cdp,`document.querySelector('[aria-label="Resize sidebar"]').getAttribute('aria-valuenow')`);
  assert.notEqual(Number(width),300,'Drag must change width');
  assert.equal(await evaluate(cdp,`localStorage.getItem('evals-nav-width')`),width,'Final width persisted');
  // Check listener mode directly: ordinary reader scrolling must not wait for a cancelable handler.
  const obj=await cdp.send('Runtime.evaluate',{expression:`document.querySelector('.experiment-output-panel > .window-panel')`});
  const listeners=await cdp.send('DOMDebugger.getEventListeners',{objectId:obj.result.objectId});
  const blockingWheel=listeners.listeners.filter(l=>l.type==='wheel'&&!l.passive).length;
  const scrollBefore=await begin(),scrollPoint=await point('.experiment-output-scroll'),refreshesBefore=refreshes,scrollStart=performance.now();
  for(let step=0;step<120;step++){
   await cdp.send('Input.dispatchMouseEvent',{type:'mouseWheel',...scrollPoint,deltaX:0,deltaY:step<20?110:step%2?65:-65});
   const delay=scrollStart+(step+1)*200-performance.now();if(delay>0)await new Promise(r=>setTimeout(r,delay));
  }
  const scroll=await end(scrollBefore);
  assert.ok(await evaluate(cdp,`document.querySelector('.experiment-output-scroll').scrollTop > 0`),'Native wheel scroll moves the document');
  assert.ok(refreshes>refreshesBefore,'Scroll spans a background refresh');
  assert.deepEqual(errors,[]);
  const result={mode:baseline?'baseline':'fixed',resizeDuring,resize,scroll,blockingWheel,backgroundRefreshes:refreshes-refreshesBefore};
  console.log(JSON.stringify(result,null,2));
  if(process.env.EVAL_READER_METRICS)await writeFile(process.env.EVAL_READER_METRICS,JSON.stringify(result,null,2));
  await captureScreenshot(cdp,{output:screenshot});
  if(!baseline){
   changedExperiment=true;
   await waitFor(()=>evaluate(cdp,`document.querySelector('.experiment-explorer')?.textContent.includes('Polling update verified')`),{timeoutMs:30000});
  }
  // Real keyboard controls and persistence after reload must survive the optimization.
  await click('[aria-label="Resize sidebar"]');
  await cdp.send('Input.dispatchKeyEvent',{type:'keyDown',key:'ArrowRight',code:'ArrowRight',windowsVirtualKeyCode:39});
  await cdp.send('Input.dispatchKeyEvent',{type:'keyUp',key:'ArrowRight',code:'ArrowRight',windowsVirtualKeyCode:39});
  if(!baseline)await waitFor(()=>evaluate(cdp,`Number(document.querySelector('[aria-label="Resize sidebar"]').getAttribute('aria-valuenow')) === ${Number(width)+16}`));
  const keyboardWidth=await evaluate(cdp,`document.querySelector('[aria-label="Resize sidebar"]').getAttribute('aria-valuenow')`);
  if(!baseline)assert.equal(Number(keyboardWidth),Number(width)+16);
  await cdp.send('Page.enable');
  let reloaded=false;const offLoad=cdp.on('Page.loadEventFired',()=>{reloaded=true;});
  await cdp.send('Page.reload');await waitFor(()=>reloaded,{timeoutMs:60000});offLoad();
  await waitForSelector(cdp,'.output-markdown[data-rendered-markdown]',{timeoutMs:60000});
  assert.equal(await evaluate(cdp,`document.querySelector('[aria-label="Resize sidebar"]').getAttribute('aria-valuenow')`),keyboardWidth);
  if(!baseline){assert.equal(resizeDuring.writes,0,'Persist once when the drag ends');assert.equal(resize.storageWrites,1,'One final persisted width');assert.ok(resize.layoutReads<=1,'Read the layout boundary once, not once per pointer event');assert.equal(blockingWheel,0,'Reader wheel scrolling must stay passive');assert.equal(resize.htmlWrites,0,'Resize must not rebuild Markdown DOM');assert.equal(scroll.htmlWrites,0,'Polling during scroll must not rebuild Markdown DOM');}
  console.log('PASS: real sidebar drag, keyboard resize, reload persistence, Markdown wheel scroll through polling, changed poll result still updates; no application writes.');
 });
}finally{server.closeAllConnections();await new Promise(r=>server.close(r));await rm(screenshot,{force:true});}
