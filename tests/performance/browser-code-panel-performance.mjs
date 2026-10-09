// Production CDP benchmark against an isolated snapshot of a running workspace.
// Build first: npm run build -- --sourcemap
// Run: node --import tsx tests/performance/browser-code-panel-performance.mjs
import assert from 'node:assert/strict';
import WebSocket from 'ws';
globalThis.WebSocket = WebSocket;
import { spawn } from 'node:child_process';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir, homedir } from 'node:os';
import { createServer } from 'node:net';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { diagramContentNodes } from '../../domain/core/diagrams/diagramContentNodes.ts';
import { handleNodeSelect } from '../../domain/mapping/code-panel/codePanel.ts';
import { upsertCodePanel } from '../../src/features/mapping/code-panel/codePanelState.ts';
import { displayGeometry } from '../../domain/mapping/workspace/displayModel.ts';
const { evaluate, waitFor, waitForSelector, withHeadlessBrowser, captureScreenshot } = await import(pathToFileURL(path.join(homedir(), '.codex/skills/front-end/browser-test.mjs')).href);
const origin = process.env.CODE_PERF_ORIGIN ?? 'http://localhost:5190';
const reportDir = path.resolve(process.env.CODE_PERF_REPORT ?? 'artifacts/code-panel-performance');
const counts = (process.env.CODE_PERF_COUNTS ?? '0,1,3,5').split(',').map(Number);
const trials = Number(process.env.CODE_PERF_TRIALS ?? 3);
const profile = process.env.CODE_PERF_PROFILE === '1';
const nodeDrag = process.env.CODE_PERF_NODE_DRAG === '1';
const snapshot = await (await fetch(`${origin}/api/mapping/workspace`)).json();
const { project, catalog } = await (await fetch(`${origin}/api/core/project/representations`)).json();
const temp = await mkdtemp(path.join(tmpdir(), 'code-panel-perf-'));
await mkdir(reportDir, { recursive: true });
const results = { origin, builtAt: new Date().toISOString(), workspaceBytes: JSON.stringify(snapshot).length,
  historyBytes: JSON.stringify(snapshot.documents.find(d => d.representationId === snapshot.activeDocumentId).history).length,
  viewport: { width: 2300, height: 1400 }, trials, profile, fixtures: [], measurements: [] };
const percentile = (a, p) => [...a].sort((x,y)=>x-y)[Math.max(0, Math.ceil(a.length*p)-1)] ?? 0;
const metrics = async cdp => Object.fromEntries((await cdp.send('Performance.getMetrics')).metrics.map(m=>[m.name,m.value]));
async function settle(cdp) { await evaluate(cdp, 'window.__settled=false;requestAnimationFrame(()=>requestAnimationFrame(()=>window.__settled=true));void 0');await waitFor(()=>evaluate(cdp,'window.__settled'),{timeoutMs:10000,message:'Frames did not advance'}); }
async function instrument(cdp) {
  await evaluate(cdp, `(()=>{const s=window.__perf={frames:[],longTasks:[],mutations:0,last:performance.now()};
    s.observer=new PerformanceObserver(l=>s.longTasks.push(...l.getEntries().map(e=>e.duration)));s.observer.observe({type:'longtask'});
    s.mo=new MutationObserver(l=>s.mutations+=l.length);document.querySelectorAll('.source-code-content').forEach(e=>s.mo.observe(e,{subtree:true,childList:true,attributes:true,characterData:true}));
    const tick=t=>{s.frames.push(t-s.last);s.last=t;s.raf=requestAnimationFrame(tick)};s.raf=requestAnimationFrame(tick);})()`);
}
async function measure(cdp, count, trial, kind, p, end, requests) {
  await settle(cdp);
  await instrument(cdp);
  if(profile) { await cdp.send('Profiler.enable'); await cdp.send('Profiler.start'); if(kind!=='selection')await cdp.send('Tracing.start',{categories:'devtools.timeline',transferMode:'ReturnAsStream'}); }
  const before=await metrics(cdp), start=performance.now(), latencies=[], requestStart=requests.length;
  const mouse=async args=>{const t=performance.now();await cdp.send('Input.dispatchMouseEvent',args);latencies.push(performance.now()-t)};
  const selection=kind==='selection', button=selection?'left':'middle', buttons=selection?1:4, modifiers=selection?2:0;
  const transform=await evaluate(cdp,"document.querySelector('.diagram-canvas__surface').style.transform");
  await mouse({type:'mousePressed',...p,button,buttons,modifiers,clickCount:1});
  const downMs=performance.now()-start, motionStart=performance.now();
  for(let i=1;i<=40;i++) {
    const t=selection?i/40:(i<=20?i:40-i)/20;
    await mouse({type:'mouseMoved',x:p.x+(end.x-p.x)*t,y:p.y+(end.y-p.y)*t,button,buttons,modifiers});
    if(!selection&&i===20) assert.notEqual(await evaluate(cdp,"document.querySelector('.diagram-canvas__surface').style.transform"),transform);
    const delay=motionStart+i*1000/60-performance.now();
    if(delay>0) await new Promise(r=>setTimeout(r,delay));
  }
  await settle(cdp);
  const motionMs=performance.now()-motionStart, middle=await metrics(cdp);
  const motionFrames=await evaluate(cdp,'window.__perf.frames.slice(1)');
  const releaseStart=performance.now();
  await mouse({type:'mouseReleased',...(selection?end:p),button,buttons:0,modifiers,clickCount:1});
  await settle(cdp);
  const releasePaintMs=performance.now()-releaseStart;
  // Includes the 150ms autosave debounce and resulting main-thread serialization.
  if(selection) await new Promise(r=>setTimeout(r,350));
  await settle(cdp);
  const after=await metrics(cdp);
  const afterUI=await evaluate(cdp,`({panels:document.querySelectorAll('[data-code-panel]').length,selection:document.querySelector('.mapping-poc-selection-rect')?.outerHTML,summary:[...document.querySelectorAll('.code-panel-summary')].map(e=>e.textContent)})`);
  const obs=await evaluate(cdp,'(()=>{const s=window.__perf;cancelAnimationFrame(s.raf);s.observer.disconnect();s.mo.disconnect();return{longTasks:s.longTasks,sourceMutations:s.mutations,frames:s.frames.slice(1)}})()');
  if(profile) {
    await writeFile(path.join(reportDir,`${count}-${kind}-${trial}.cpuprofile`),JSON.stringify((await cdp.send('Profiler.stop')).profile));
    if(kind!=='selection') { const done=new Promise(resolve=>{const off=cdp.on('Tracing.tracingComplete',e=>{off();resolve(e.stream)})});await cdp.send('Tracing.end');const handle=await done;let data='',chunk;do{chunk=await cdp.send('IO.read',{handle});data+=chunk.base64Encoded?Buffer.from(chunk.data,'base64').toString():chunk.data}while(!chunk.eof);await cdp.send('IO.close',{handle});await writeFile(path.join(reportDir,`${count}-${kind}-${trial}.trace.json`),data); }
  }
  if(!selection) assert.equal(await evaluate(cdp,"document.querySelector('.diagram-canvas__surface').style.transform"),transform);
  const result={panels:count,trial,kind,downMs,motionMs,releasePaintMs,
    frameP95Ms:percentile(motionFrames,.95),frameMaxMs:Math.max(...motionFrames),framesOver25Ms:motionFrames.filter(n=>n>25).length,
    dispatchP95Ms:percentile(latencies,.95),dispatchMaxMs:Math.max(...latencies),
    motionMainThreadMs:(middle.TaskDuration-before.TaskDuration)*1000,
    releaseMainThreadMs:(after.TaskDuration-middle.TaskDuration)*1000,
    scriptMs:(after.ScriptDuration-before.ScriptDuration)*1000,layoutMs:(after.LayoutDuration-before.LayoutDuration)*1000,
    styleMs:(after.RecalcStyleDuration-before.RecalcStyleDuration)*1000,
    ...obs,afterUI,requests:requests.slice(requestStart)};
  results.measurements.push(result);console.log(JSON.stringify({...result,frames:undefined}));
  await writeFile(path.join(reportDir,profile?'profile-results.json':'results.json'),JSON.stringify(results,null,2));
}
let server;
try {
  for(const count of counts) {
    const store=path.join(temp,String(count));await mkdir(path.join(store,'representations'),{recursive:true});
    const workspace=structuredClone(snapshot), doc=workspace.documents.find(d=>d.representationId===workspace.activeDocumentId);
    doc.viewport={offset:{x:-100,y:20},scale:.65};
    doc.canvas.controls={...doc.canvas.controls,activeBoxId:'overview',selectionRect:null,selectedNodeIds:[],retainedSelectionId:null};
    const diagrams=Object.values(doc.document.scene.contents).filter(d=>d.sourceContext.mappings.length).filter(diagram=>{try{handleNodeSelect({diagram,projectId:workspace.projectId},diagramContentNodes(diagram.content).slice(0,1));return true}catch(error){console.log('MAPPING_ERROR',diagram.id,error.message);return false}});
    const files=[];
    for(let i=0;i<count;i++) {
      const diagram=diagrams[i];
      const mapped=diagramContentNodes(diagram.content).filter(n=>n.line===diagram.sourceContext.mappings[0].line).slice(0,1);
      assert.ok(mapped.length,'Fixture requires a mapped structural node');
      const panel=handleNodeSelect({diagram,projectId:workspace.projectId},mapped);
      assert.ok(panel.items.length,'Fixture panel must contain mapped source');
      const node=mapped[0],selection={...displayGeometry(),id:`perf-selection-${i}`,kind:'selection',childIds:[],expansion:'expanded',displayMode:'stacked',sourceBoxId:diagram.id,sourceContentId:diagram.id,sourceAscii:diagram.content.ascii,
        rect:{startLine:node.line,endLine:node.line,startColumn:node.startColumn,endColumn:node.endColumn},selectedIds:[]};
      doc.canvas.display=upsertCodePanel(doc.canvas.display,selection,panel);
      const pane=Object.values(doc.canvas.display.nodes).find(n=>n.content?.panel===panel);
      pane.position={x:1600+(i%3)*690,y:30+Math.floor(i/3)*700};pane.bounds={width:670,height:660};pane.geometryPolicy={placement:'manual',sizing:'fixed'};
      files.push(panel.items.map(x=>x.resource.target));
    }
    await writeFile(path.join(store,'project.json'),JSON.stringify(project));
    await writeFile(path.join(store,'representations/catalog.json'),JSON.stringify(catalog));
    await writeFile(path.join(store,'mapping-workspace.json'),JSON.stringify(workspace));
    const port=await new Promise(r=>{const s=createServer();s.listen(0,'127.0.0.1',()=>{const p=s.address().port;s.close(()=>r(p))})});
    const url=`http://127.0.0.1:${port}`;
    server=spawn(process.execPath,['scripts/dev/start-server.mjs', '--http','preview','--host','127.0.0.1','--port',String(port),'--strictPort'],{cwd:process.cwd(),env:{...process.env,NEW_DIAGRAM_PROJECT_ROOT:process.cwd(),NEW_DIAGRAMS_DIR:store,NEW_DIAGRAM_AGENT:'fake'},stdio:['ignore','ignore','pipe']});
    let errors='';server.stderr.on('data',d=>errors+=d);
    await waitFor(async()=>(await fetch(url).catch(()=>null))?.ok,{timeoutMs:30000,message:'Preview start failed'});
    await withHeadlessBrowser({url:`${url}/?diagram=${workspace.activeDocumentId}`,width:2300,height:1400,
      chromePath:process.env.CHROME_PATH??path.join(homedir(),'.cache/ms-playwright/chromium-1228/chrome-linux64/chrome'),arguments:['--no-sandbox','--disable-gpu']},async({cdp})=>{
      console.log('BROWSER',count);const exceptions=[];cdp.on('Runtime.exceptionThrown',e=>exceptions.push(e.exceptionDetails.exception?.description??e.exceptionDetails.text));const send=cdp.send;cdp.send=(method,args)=>new Promise((resolve,reject)=>{const timer=setTimeout(()=>{console.error('TIMEOUT',method,args);reject(Error('CDP timeout: '+method))},60000);send(method,args).then(value=>{clearTimeout(timer);resolve(value)},e=>{clearTimeout(timer);reject(e)});});await cdp.send('Runtime.enable');await cdp.send('Page.bringToFront');const requests=[];await cdp.send('Network.enable');cdp.on('Network.requestWillBeSent',e=>{if(e.request.url.includes('/api/'))requests.push({url:e.request.url.replace(url,''),method:e.request.method})});
      await cdp.send('Performance.enable');await cdp.send('Page.enable');
      await waitForSelector(cdp,'[data-content-node-id]',{timeoutMs:60000});
      await waitFor(async()=>await evaluate(cdp,`document.querySelectorAll('[data-code-panel]').length===${count}&&!document.querySelector('[data-resource-loading="true"]')&&!document.querySelector('[data-code-panel] .source-code-viewer[data-highlighted="false"]')`),{timeoutMs:60000,message:'Panels not ready'});
      await settle(cdp);
      const fixture=await evaluate(cdp,`(()=>{const labels=[...document.querySelectorAll('[data-content-node-id]')].filter(e=>{const r=e.getBoundingClientRect();return r.x>100&&r.right<850&&r.y>200&&r.y<600&&r.width>30&&e.contains(document.elementFromPoint(r.x+3,r.y+r.height/2))});
        const el=labels[0];if(!el)throw Error('No visible selectable node');const r=el.getBoundingClientRect();return{target:el.textContent,point:{x:r.x+3,y:r.y+r.height/2},nodes:document.querySelectorAll('*').length,sourceRows:document.querySelectorAll('.source-code-line').length,staleFiles:[...document.querySelectorAll('.code-panel-file')].filter(e=>e.textContent.includes('Mapped source has changed')).length,highlighted:document.querySelectorAll('[data-code-panel] .source-code-viewer[data-highlighted="true"]').length,panelText:[...document.querySelectorAll('.code-panel-file')].map(e=>e.textContent.slice(0,300))}})()`);
      results.fixtures.push({count,files,...fixture,exceptions});console.log('FIXTURE',JSON.stringify({count,...fixture}));
      await captureScreenshot(cdp,{output:path.join(reportDir,`${count}-panels.png`)});
      for(let trial=1;trial<=trials;trial++)await measure(cdp,count,trial,'drag',{x:850,y:1050},{x:930,y:1080},requests);
      if(nodeDrag) for(let trial=1;trial<=trials;trial++)await measure(cdp,count,trial,'node-drag',fixture.point,{x:fixture.point.x+80,y:fixture.point.y+30},requests);
      // Selection attempts to open a panel on release; reset the disposable workspace between trials.
      for(let trial=1;trial<=trials;trial++) {
        if(trial>1) {
          await writeFile(path.join(store,'mapping-workspace.json'),JSON.stringify(workspace));
          const loaded=new Promise(r=>{const off=cdp.on('Page.loadEventFired',()=>{off();r()})});await cdp.send('Page.reload',{ignoreCache:true});await loaded;
          await waitForSelector(cdp,'[data-content-node-id]',{timeoutMs:60000});
          await waitFor(async()=>await evaluate(cdp,`document.querySelectorAll('[data-code-panel]').length===${count}&&!document.querySelector('[data-resource-loading="true"]')&&!document.querySelector('[data-code-panel] .source-code-viewer[data-highlighted="false"]')`),{timeoutMs:60000});
          await settle(cdp);
        }
        await measure(cdp,count,trial,'selection',fixture.point,{x:fixture.point.x+180,y:fixture.point.y+60},requests);
      }
    });
    server.kill('SIGTERM');await new Promise(r=>server.once('exit',r));server=undefined;
  }
} finally {
  if(server&&server.exitCode===null){server.kill('SIGTERM');await new Promise(r=>server.once('exit',r))}
  await rm(temp,{recursive:true,force:true});
}
