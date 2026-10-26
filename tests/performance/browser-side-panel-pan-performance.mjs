// Compare panel rasterization with and without temporary pan compositing, using an isolated saved canvas.
// The saved active canvas must have an alternatives panel visible. No timing threshold: results depend on hardware.
// PAN_STORE is required; PAN_MODE=dev profiles source modules, otherwise use npm run build first.
import { cp, mkdtemp, rm, writeFile, mkdir } from 'node:fs/promises';
import { tmpdir, homedir } from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import assert from 'node:assert/strict';
const { withHeadlessBrowser, evaluate, waitForSelector, waitFor, captureScreenshot } = await import(path.join(homedir(), '.codex/skills/front-end/browser-test.mjs'));
if (!process.env.PAN_STORE) throw Error('Set PAN_STORE to the saved canvas directory to copy');
const root = await mkdtemp(path.join(tmpdir(), 'mapping-native-pan-'));
const output = process.env.PAN_REPORT ?? path.join(root, 'report');
let server;
try {
  await cp(process.env.PAN_STORE, path.join(root, 'store'), {recursive:true});
  await mkdir(output, {recursive:true});
  const port = await new Promise(resolve => { const socket=createServer(); socket.listen(0,'127.0.0.1',()=>{const port=socket.address().port;socket.close(()=>resolve(port));}); });
  const url=`http://127.0.0.1:${port}`;
  server=spawn(process.execPath,['scripts/dev/start-server.mjs', '--http',...(process.env.PAN_MODE==='dev'?[]:['preview']),'--host','127.0.0.1','--port',String(port),'--strictPort'],
    {env:{...process.env,NEW_DIAGRAM_PROJECT_ROOT:root,NEW_DIAGRAMS_DIR:path.join(root,'store')},stdio:['ignore','ignore','pipe']});
  let errors='';server.stderr.on('data',chunk=>errors+=chunk);
  await waitFor(async()=>(await fetch(url).catch(()=>null))?.ok,{timeoutMs:30000}).catch(error=>{throw Error(`${error}\n${errors}`)});
  await withHeadlessBrowser({url:`${url}/mapping${process.env.PAN_DIAGRAM ? `?diagram=${encodeURIComponent(process.env.PAN_DIAGRAM)}` : ''}`,width:1800,height:1100,
    chromePath:process.env.CHROME_PATH ?? path.join(homedir(),'.cache/ms-playwright/chromium-1228/chrome-linux64/chrome'),arguments:['--no-sandbox']},async({cdp})=>{
    await cdp.send('Runtime.enable');await cdp.send('Network.enable');
    const errors=[],requests=[];
    cdp.on('Runtime.exceptionThrown',e=>errors.push(e.exceptionDetails));
    cdp.on('Network.requestWillBeSent',e=>{if(e.request.url.includes('/api/'))requests.push({url:e.request.url,time:e.timestamp});});
    await waitForSelector(cdp,'.mapping-document-view:not([hidden]) [data-native-node^="grid:"] pre',{timeoutMs:60000});
    await evaluate(cdp,'document.fonts.ready.then(()=>true)');
    await waitForSelector(cdp,'.mapping-document-view:not([hidden]) [data-side-panel]');
    await evaluate(cdp, `(()=>{const style=document.createElement('style');style.id='panel-pan-baseline';document.head.append(style)})()`);
    let trace=[];
    cdp.on('Tracing.dataCollected', event=>trace.push(...event.value));
    const surface='.mapping-document-view:not([hidden]) .mapping-editor-overlay';
    const read=()=>evaluate(cdp,`(()=>{const m=new DOMMatrixReadOnly(getComputedStyle(document.querySelector('${surface}')).transform);return{x:m.e,y:m.f,z:m.a}})()`);
    const runs=[];
    for(let trial=0;trial<6;trial++){
      // Let startup/previous autosave finish before the measured interaction.
      await new Promise(resolve=>setTimeout(resolve,1500));
      const composited=trial%2===1;
      await evaluate(cdp, `document.getElementById('panel-pan-baseline').textContent=${JSON.stringify(composited ? '' : '[data-side-panel] { will-change: auto !important; }')}`);
      trace=[];
      await cdp.send('Tracing.start',{categories:'devtools.timeline,cc',transferMode:'ReportEvents'});
      await evaluate(cdp,`(()=>{const p=window.__panPerf={frames:[],tasks:[],last:performance.now(),start:performance.now()};p.observer=new PerformanceObserver(l=>p.tasks.push(...l.getEntries().map(e=>({start:e.startTime-p.start,duration:e.duration}))));p.observer.observe({type:'longtask'});const tick=t=>{p.frames.push({start:t-p.start,dt:t-p.last});p.last=t;p.raf=requestAnimationFrame(tick)};p.raf=requestAnimationFrame(tick)})()`);
      const before=await read(),requestStart=requests.length;
      const mouse=params=>cdp.send('Input.dispatchMouseEvent',params);
      const origin=await evaluate(cdp, `(()=>{for(let y=180;y<800;y+=40)for(let x=400;x<1300;x+=40){const hit=document.elementFromPoint(x,y);if(hit?.closest('[data-side-panel] pre')&&!hit.closest('button,input,select'))return{x,y};}})()`);
      assert.ok(origin,'Unobstructed canvas gesture origin');
      await mouse({type:'mouseMoved',...origin});
      await mouse({type:'mousePressed',...origin,button:'middle',buttons:4,clickCount:1});
      const started=performance.now();
      let midpoint;
      for(let i=1;i<=120;i++){
        await new Promise(resolve=>setTimeout(resolve,Math.max(0,started+i*1000/60-performance.now())));
        await mouse({type:'mouseMoved',x:origin.x+180*Math.sin(i/120*Math.PI*2),y:origin.y+120*(1-Math.cos(i/120*Math.PI*2)),button:'middle',buttons:4});
        if(i===60) midpoint=await read();
      }
      const held=await read();
      const durationMs=performance.now()-started;
      assert.ok(Math.abs(midpoint.y-before.y)>100, 'The gesture pans the active canvas');
      await mouse({type:'mouseReleased',...origin,button:'middle',buttons:0,clickCount:1});
      const observation=await evaluate(cdp,`(()=>{const p=window.__panPerf;cancelAnimationFrame(p.raf);p.observer.disconnect();return{frames:p.frames,tasks:p.tasks}})()`);
      const complete=new Promise(resolve=>cdp.on('Tracing.tracingComplete',resolve));
      await cdp.send('Tracing.end'); await complete;
      const rasterMs=trace.filter(e=>e.ph==='X'&&e.name==='RasterTask').reduce((sum,e)=>sum+(e.dur??0)/1000,0);
      const paintMs=trace.filter(e=>e.ph==='X'&&e.name==='Paint').reduce((sum,e)=>sum+(e.dur??0)/1000,0);
      const summarize=frames=>({count:frames.length,max:Math.max(0,...frames.map(f=>f.dt)),over25:frames.filter(f=>f.dt>25).length,over50:frames.filter(f=>f.dt>50).length});
      const result={trial,composited,rasterMs,paintMs,before,held,durationMs,firstSecond:summarize(observation.frames.filter(f=>f.start<1000)),secondSecond:summarize(observation.frames.filter(f=>f.start>=1000)),...observation,requests:requests.slice(requestStart)};
      runs.push(result);console.log(JSON.stringify({trial,composited,rasterMs,paintMs,firstSecond:result.firstSecond,secondSecond:result.secondSecond,tasks:observation.tasks}));
    }
    await captureScreenshot(cdp,{output:path.join(output,'canvas.png')});
    await writeFile(path.join(output,'results.json'),JSON.stringify({runs,errors},null,2));
    assert.deepEqual(errors,[]);
  });
}finally{
  if(server){server.kill('SIGTERM');await new Promise(resolve=>server.once('exit',resolve));}
  await rm(root,{recursive:true,force:true});
}
