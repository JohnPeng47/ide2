// Measure opening-time stalls without changing application scheduling or rendering.
import assert from 'node:assert/strict';
import WebSocket from 'ws';
globalThis.WebSocket = WebSocket;
import { spawn } from 'node:child_process';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir, homedir } from 'node:os';
import { createServer } from 'node:net';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { initialCanvasState } from '../../domain/mapping/workspace/mappingWorkspace.ts';
const { evaluate, waitFor, waitForSelector, withHeadlessBrowser } = await import(pathToFileURL(path.join(homedir(), '.codex/skills/front-end/browser-test.mjs')).href);
const origin=process.env.CODE_PERF_ORIGIN??'http://localhost:5190';
const reportDir=path.resolve(process.env.CODE_OPEN_REPORT??'artifacts/code-panel-opening-performance');
const trials=Number(process.env.CODE_OPEN_TRIALS??3), profile=process.env.CODE_OPEN_PROFILE==='1';
const [workspace,{project,catalog}]=await Promise.all([fetch(origin+'/api/mapping/workspace').then(r=>r.json()),fetch(origin+'/api/core/project/representations').then(r=>r.json())]);
const doc=workspace.documents.find(d=>d.name.startsWith('Canvas domain model'));
assert.ok(doc,'Canvas domain model fixture is required');
workspace.activeDocumentId=doc.representationId;
doc.canvas={...doc.canvas,display:initialCanvasState().display,controls:initialCanvasState().controls};
doc.viewport={offset:{x:-100,y:20},scale:.65};
const temp=await mkdtemp(path.join(tmpdir(),'code-panel-opening-'));
await mkdir(path.join(temp,'representations'));await mkdir(reportDir,{recursive:true});
await writeFile(path.join(temp,'project.json'),JSON.stringify(project));
await writeFile(path.join(temp,'representations/catalog.json'),JSON.stringify(catalog));
const seed=()=>writeFile(path.join(temp,'mapping-workspace.json'),JSON.stringify(workspace));await seed();
const port=await new Promise(r=>{const s=createServer();s.listen(0,'127.0.0.1',()=>{const p=s.address().port;s.close(()=>r(p))})});
const url=`http://127.0.0.1:${port}`;
const server=spawn(process.execPath,['scripts/dev/start-server.mjs','preview','--host','127.0.0.1','--port',String(port),'--strictPort'],{cwd:process.cwd(),env:{...process.env,NEW_DIAGRAM_PROJECT_ROOT:process.cwd(),NEW_DIAGRAMS_DIR:temp,NEW_DIAGRAM_AGENT:'fake'},stdio:['ignore','ignore','pipe']});
let serverErrors='';server.stderr.on('data',d=>serverErrors+=d);
const results={date:new Date().toISOString(),workspaceBytes:JSON.stringify(workspace).length,historyBytes:JSON.stringify(doc.history).length,trials,profile,measurements:[],network:[],exceptions:[]};
const pct=(a,p)=>[...a].sort((a,b)=>a-b)[Math.max(0,Math.ceil(a.length*p)-1)]??0;
try {
  await waitFor(async()=>(await fetch(url).catch(()=>null))?.ok,{timeoutMs:30000,message:'Preview startup: '+serverErrors});
  await withHeadlessBrowser({url:`${url}/?diagram=${workspace.activeDocumentId}`,width:2300,height:1400,chromePath:process.env.CHROME_PATH??path.join(homedir(),'.cache/ms-playwright/chromium-1228/chrome-linux64/chrome'),arguments:['--no-sandbox','--disable-gpu']},async({cdp})=>{
    await cdp.send('Page.enable');await cdp.send('Page.bringToFront');await cdp.send('Runtime.enable');await cdp.send('Performance.enable');await cdp.send('Network.enable',{maxPostDataSize:1});
    cdp.on('Runtime.exceptionThrown',e=>results.exceptions.push(e.exceptionDetails.exception?.description??e.exceptionDetails.text));
    const pending=new Set();
    cdp.on('Network.requestWillBeSent',e=>{if(e.request.url.includes('/api/')){if(!e.request.url.includes('/api/mapping/agent/')&&!e.request.url.includes('/live/'))pending.add(e.requestId);results.network.push({event:'start',id:e.requestId,url:e.request.url.replace(url,''),method:e.request.method,time:e.timestamp})}});
    cdp.on('Network.responseReceived',e=>{if(e.response.mimeType==='text/event-stream')pending.delete(e.requestId)});
    for(const method of ['Network.loadingFinished','Network.loadingFailed'])cdp.on(method,e=>{if(pending.delete(e.requestId))results.network.push({event:method,id:e.requestId,time:e.timestamp})});
    const metrics=async()=>Object.fromEntries((await cdp.send('Performance.getMetrics')).metrics.map(m=>[m.name,m.value]));
    const frames=()=>evaluate(cdp,'new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))).then(()=>true)');
    const ready=async(panel=false)=>{await waitForSelector(cdp,'[data-content-node-id]');await waitFor(async()=>!pending.size&&await evaluate(cdp,`${panel?'document.querySelectorAll("[data-code-panel]").length===1':'true'}&&!document.querySelector('[data-resource-loading="true"]')&&!document.querySelector('[data-code-panel] .source-code-viewer[data-highlighted="false"]')`),{timeoutMs:60000});await frames();};
    const escape=async()=>{await cdp.send('Input.dispatchKeyEvent',{type:'keyDown',key:'Escape',code:'Escape',windowsVirtualKeyCode:27});await cdp.send('Input.dispatchKeyEvent',{type:'keyUp',key:'Escape',code:'Escape',windowsVirtualKeyCode:27});};
    const close=async()=>{await escape();await waitFor(async()=>evaluate(cdp,'!document.querySelector("[data-code-panel]")'));await escape();await waitFor(async()=>evaluate(cdp,'!document.querySelector("[data-selection-root]")'));await ready();};
    async function measure(trial,kind,open=false){
      // This node belongs to MappingPocPage and maps into MappingPage.tsx.
      const point=await evaluate(cdp,`(()=>{const el=document.querySelector('[data-content-node-id][data-display-node-id="grid:overview"][data-source-line="7"]');const r=el.getBoundingClientRect();const p={x:r.x+5,y:r.y+r.height/2};if(!el.contains(document.elementFromPoint(p.x,p.y)))throw Error('Node is obscured');return p})()`);
      await evaluate(cdp,`(()=>{const s=window.__openingPerf={frames:[],tasks:[],last:performance.now(),start:performance.now()};s.observer=new PerformanceObserver(l=>s.tasks.push(...l.getEntries().map(e=>({start:e.startTime-s.start,duration:e.duration}))));s.observer.observe({type:'longtask'});const tick=t=>{s.frames.push({start:t-s.start,duration:t-s.last});s.last=t;s.raf=requestAnimationFrame(tick)};s.raf=requestAnimationFrame(tick)})()`);
      if(profile&&open){await cdp.send('Profiler.enable');await cdp.send('Profiler.start');}
      const before=await metrics(), start=performance.now(), dispatch=[];
      const mouse=async args=>{const t=performance.now();await cdp.send('Input.dispatchMouseEvent',args);dispatch.push({type:args.type,start:t-start,duration:performance.now()-t});};
      if(open){await mouse({type:'mousePressed',...point,button:'left',buttons:1,clickCount:1});await mouse({type:'mouseReleased',...point,button:'left',buttons:0,clickCount:1});}
      const openInputMs=performance.now()-start;
      const p={x:850,y:1050}, beforeTransform=await evaluate(cdp,"document.querySelector('.diagram-canvas__surface').style.transform");
      await mouse({type:'mousePressed',...p,button:'middle',buttons:4,clickCount:1});
      const motionStart=performance.now();
      for(let i=1;i<=40;i++){
        const t=(i<=20?i:40-i)/20;
        await mouse({type:'mouseMoved',x:p.x+80*t,y:p.y+30*t,button:'middle',buttons:4});
        if(i===20)assert.notEqual(await evaluate(cdp,"document.querySelector('.diagram-canvas__surface').style.transform"),beforeTransform);
        const delay=motionStart+i*1000/60-performance.now();if(delay>0)await new Promise(r=>setTimeout(r,delay));
      }
      await mouse({type:'mouseReleased',...p,button:'middle',buttons:0,clickCount:1});await frames();
      assert.equal(await evaluate(cdp,"document.querySelector('.diagram-canvas__surface').style.transform"),beforeTransform);
      const after=await metrics(), elapsedMs=performance.now()-start;
      const observed=await evaluate(cdp,`(()=>{const s=window.__openingPerf;cancelAnimationFrame(s.raf);s.observer.disconnect();return{frames:s.frames,longTasks:s.tasks,sourceRows:document.querySelectorAll('.source-code-line').length,panels:document.querySelectorAll('[data-code-panel]').length,loading:!!document.querySelector('[data-resource-loading="true"]'),stale:document.querySelector('[data-code-panel]')?.textContent.includes('Mapped source has changed')}})()`);
      if(profile&&open)await writeFile(path.join(reportDir,`${trial}-${kind}.cpuprofile`),JSON.stringify((await cdp.send('Profiler.stop')).profile));
      const result={trial,kind,openInputMs,elapsedMs,motionMs:performance.now()-motionStart,mainThreadMs:(after.TaskDuration-before.TaskDuration)*1000,scriptMs:(after.ScriptDuration-before.ScriptDuration)*1000,layoutMs:(after.LayoutDuration-before.LayoutDuration)*1000,styleMs:(after.RecalcStyleDuration-before.RecalcStyleDuration)*1000,frameP95Ms:pct(observed.frames.map(f=>f.duration),.95),frameMaxMs:Math.max(...observed.frames.map(f=>f.duration)),dispatchMaxMs:Math.max(...dispatch.map(d=>d.duration)),dispatch,...observed};
      assert.equal(result.panels,kind==='closed'?0:1,'The measured gesture must actually open its panel');
      results.measurements.push(result);console.log(JSON.stringify({...result,frames:undefined,dispatch:undefined}));
      await writeFile(path.join(reportDir,profile?'profile-results.json':'results.json'),JSON.stringify(results,null,2));
    }
    for(let trial=1;trial<=trials;trial++){
      if(trial>1){await seed();const loaded=new Promise(r=>{const off=cdp.on('Page.loadEventFired',()=>{off();r()})});await cdp.send('Page.reload',{ignoreCache:true});await loaded;}
      await ready();await waitFor(()=>evaluate(cdp,"document.body.innerText.includes('Editing history saved')"),{timeoutMs:60000});assert.equal(await evaluate(cdp,'document.querySelectorAll("[data-code-panel]").length'),0);
      await measure(trial,'closed');await measure(trial,'opening',true);await ready(true);
      assert.equal(await evaluate(cdp,'document.querySelectorAll("[data-diagram-selected=true]").length'),0);
      await measure(trial,'settled');await close();await measure(trial,'reopening',true);await ready(true);await close();
    }
    assert.deepEqual(results.exceptions,[]);
  });
}finally{if(server.exitCode===null){server.kill('SIGTERM');await new Promise(r=>server.once('exit',r))}await rm(temp,{recursive:true,force:true});}
