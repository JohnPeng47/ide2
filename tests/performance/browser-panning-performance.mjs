// Profile a spatial sweep of an existing canvas using real CDP pan gestures.
// PAN_URL, PAN_REPORT and CHROME_PATH may override the defaults below.
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import path from 'node:path';
import WebSocket from 'ws';
globalThis.WebSocket = WebSocket;
const { withHeadlessBrowser, evaluate, waitForSelector, captureScreenshot } = await import(path.join(homedir(), '.codex/skills/front-end/browser-test.mjs'));
const url = process.env.PAN_URL ?? 'http://localhost:5190/?diagram=representation-b697fd11-5c8d-49e7-a6b5-b12030f2f79a';
const directory = path.resolve(process.env.PAN_REPORT ?? 'artifacts/panning-performance-20260926');
const stage = '.diagram-canvas.is-enabled', surface = `${stage} .diagram-canvas__surface`;
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
const percentile = (values, p) => [...values].sort((a,b) => a-b)[Math.max(0, Math.ceil(values.length*p)-1)] ?? 0;
const stats = values => ({ count: values.length, p50: percentile(values,.5), p95: percentile(values,.95), max: Math.max(0,...values), over25: values.filter(x=>x>25).length, over50: values.filter(x=>x>50).length });
const report = { url, startedAt: new Date().toISOString(), runs: [], errors: [], requests: [], hotReloads: [] };
let activeGesture = null;
await mkdir(directory, {recursive:true});
const save = () => writeFile(path.join(directory,'results.json'),JSON.stringify(report,null,2));
await withHeadlessBrowser({url,width:1920,height:1080,chromePath:process.env.CHROME_PATH ?? path.join(homedir(),'.cache/ms-playwright/chromium-1228/chrome-linux64/chrome'),arguments:['--no-sandbox']}, async ({cdp}) => {
  await cdp.send('Runtime.enable'); await cdp.send('Page.enable'); await cdp.send('Performance.enable'); await cdp.send('Network.enable');
  await cdp.send('Emulation.setDeviceMetricsOverride',{width:1920,height:1080,deviceScaleFactor:1,mobile:false});
  cdp.on('Runtime.exceptionThrown',e=>report.errors.push(e.exceptionDetails));
  cdp.on('Network.requestWillBeSent',e=>{if(e.request.url.includes('/api/'))report.requests.push({url:e.request.url,method:e.request.method,time:e.timestamp});});
  cdp.on('Network.webSocketFrameReceived',e=>{
    try { const message=JSON.parse(e.response.payloadData); if(['update','full-reload'].includes(message.type))report.hotReloads.push({gesture:activeGesture,time:e.timestamp,message}); } catch { /* Non-JSON application frames. */ }
  });
  await waitForSelector(cdp,`${stage} [data-grid-box]:not([data-grid-box="root"])`,{timeoutMs:60000});
  const settle = () => evaluate(cdp,'new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))');
  await evaluate(cdp,'document.fonts.ready.then(()=>true)'); await settle();
  const read = () => evaluate(cdp,`(()=>{const stage=document.querySelector('${stage}'),surface=document.querySelector('${surface}'),s=stage.getBoundingClientRect(),m=new DOMMatrixReadOnly(getComputedStyle(surface).transform);const rect=e=>{const r=e.getBoundingClientRect();return{x:r.x,y:r.y,width:r.width,height:r.height}};return{offset:{x:m.e,y:m.f},scale:m.a,stage:rect(stage),boxes:[...stage.querySelectorAll('[data-grid-box]:not([data-grid-box="root"])')].map(e=>({id:e.dataset.gridBox,...rect(e)})),domNodes:document.querySelectorAll('*').length,contentNodes:stage.querySelectorAll('[data-content-node-id]').length,panels:stage.querySelectorAll('[data-code-panel]').length}})()`);
  const initial = await read(); report.initial = initial;
  report.browser = await cdp.send('Browser.getVersion');
  report.environment = await evaluate(cdp,`({width:innerWidth,height:innerHeight,dpr:devicePixelRatio,hardwareConcurrency:navigator.hardwareConcurrency,buildMode:document.querySelector('script[src*="/@vite/client"]')?'Vite development':'bundled',renderer:(()=>{const gl=document.createElement('canvas').getContext('webgl');if(!gl)return null;const e=gl.getExtension('WEBGL_debug_renderer_info');return e?gl.getParameter(e.UNMASKED_RENDERER_WEBGL):gl.getParameter(gl.RENDERER)})()})`);
  const worldBoxes = initial.boxes.map(b=>({id:b.id,x:(b.x-initial.stage.x-initial.offset.x)/initial.scale,y:(b.y-initial.stage.y-initial.offset.y)/initial.scale,width:b.width/initial.scale,height:b.height/initial.scale}));
  report.worldBoxes = worldBoxes;
  const bounds={left:Math.min(...worldBoxes.map(b=>b.x)),top:Math.min(...worldBoxes.map(b=>b.y)),right:Math.max(...worldBoxes.map(b=>b.x+b.width)),bottom:Math.max(...worldBoxes.map(b=>b.y+b.height))};
  report.worldBounds = bounds;
  const s=initial.stage, safe={left:s.x+350,top:s.y+45,right:s.x+s.width-50,bottom:s.y+s.height-55};
  const center={x:(safe.left+safe.right)/2,y:(safe.top+safe.bottom)/2};
  report.unobscuredViewport = safe;
  const mouse = args => cdp.send('Input.dispatchMouseEvent',args);
  const metrics = async () => Object.fromEntries((await cdp.send('Performance.getMetrics')).metrics.map(m=>[m.name,m.value]));
  const mark = name => evaluate(cdp,`performance.mark(${JSON.stringify(name)})`);
  async function gesture(dx,dy,{id,profile=false,record=false,button='middle'}={}) {
    activeGesture = id ?? 'positioning';
    const before=await read();
    let p={x:center.x-dx/2,y:center.y-dy/2},end={x:center.x+dx/2,y:center.y+dy/2};
    assert.ok(p.x>=safe.left&&p.x<=safe.right&&end.x>=safe.left&&end.x<=safe.right&&p.y>=safe.top&&p.y<=safe.bottom&&end.y>=safe.top&&end.y<=safe.bottom,'Gesture stays within unobscured canvas');
    if(button==='left') {
      const blocked=await evaluate(cdp,`Boolean(document.elementFromPoint(${p.x},${p.y})?.closest("button,a,input,textarea,select,[contenteditable='true'],[data-diagram-canvas-static-ui]"))`);
      if(blocked)button='middle';
    }
    const buttons=button==='left'?1:4;
    await mouse({type:'mouseMoved',...p}); await settle();
    if(record)await evaluate(cdp,`(()=>{const p=window.__panPerf={frames:[],longTasks:[],last:null};p.observer=new PerformanceObserver(l=>p.longTasks.push(...l.getEntries().map(e=>({start:e.startTime,duration:e.duration}))));p.observer.observe({type:'longtask'});const tick=t=>{if(p.last!==null)p.frames.push({time:t,dt:t-p.last});p.last=t;p.raf=requestAnimationFrame(tick)};p.raf=requestAnimationFrame(tick)})()`);
    if(profile)await cdp.send('Profiler.start');
    if(record)await mark(`${id}:start`);
    const baseline=await metrics(),started=performance.now(),latencies=[];
    const startTime=await evaluate(cdp,'performance.now()');
    await mouse({type:'mousePressed',...p,button,buttons,clickCount:1});
    const downMs=performance.now()-started;
    const motionStart=performance.now();
    let deadline=motionStart;
    const steps=record?60:12;
    for(let i=1;i<=steps;i++) {
      deadline=Math.max(deadline+(record?1000/60:8),performance.now());
      await pause(Math.max(0,deadline-performance.now()));
      const t=performance.now();
      await mouse({type:'mouseMoved',x:p.x+dx*i/steps,y:p.y+dy*i/steps,button,buttons});
      latencies.push(performance.now()-t);
    }
    const motionMs=performance.now()-motionStart;
    const releaseTime=await evaluate(cdp,'performance.now()');
    await mouse({type:'mouseReleased',...end,button,buttons:0,clickCount:1});
    await settle(); const afterPaint=performance.now(),afterMetrics=await metrics();
    if(record)await mark(`${id}:end`);
    if(profile)await writeFile(path.join(directory,`${id}.cpuprofile`),JSON.stringify((await cdp.send('Profiler.stop')).profile));
    let observation;
    if(record)observation=await evaluate(cdp,`(()=>{const p=window.__panPerf;cancelAnimationFrame(p.raf);p.observer.disconnect();return{frames:p.frames,longTasks:p.longTasks}})()`);
    const after=await read();
    assert.ok(Math.abs(after.offset.x-before.offset.x-dx)<1&&Math.abs(after.offset.y-before.offset.y-dy)<1,`Pan changed camera by requested distance: ${id}`);
    assert.ok(Math.abs(after.scale-before.scale)<.00001,'Pan preserves zoom');
    if(!record){activeGesture=null;return;}
    const frames=observation.frames.filter(f=>f.time>=startTime&&f.time<=releaseTime).map(f=>f.dt);
    const result={id,profile,button,delta:{x:dx,y:dy},from:before.offset,to:after.offset,scale:after.scale,downMs,motionMs,releaseToPaintMs:afterPaint-motionStart-motionMs,dispatch:stats(latencies),frame:stats(frames),frames,mainThreadMs:1000*(afterMetrics.TaskDuration-baseline.TaskDuration),scriptMs:1000*(afterMetrics.ScriptDuration-baseline.ScriptDuration),layoutMs:1000*(afterMetrics.LayoutDuration-baseline.LayoutDuration),styleMs:1000*(afterMetrics.RecalcStyleDuration-baseline.RecalcStyleDuration),longTasks:observation.longTasks,visibleWorld:{left:(safe.left-s.x-after.offset.x)/after.scale,right:(safe.right-s.x-after.offset.x)/after.scale,top:(safe.top-s.y-after.offset.y)/after.scale,bottom:(safe.bottom-s.y-after.offset.y)/after.scale}};
    report.runs.push(result);await save();
    activeGesture=null;
    console.log(JSON.stringify({id,button,motionMs:Math.round(motionMs),frame:result.frame,mainThreadMs:Math.round(result.mainThreadMs),longTasks:result.longTasks.length}));
    return result;
  }
  async function go(offset, options={}) {
    const current=await read(),dx=offset.x-current.offset.x,dy=offset.y-current.offset.y;
    const segments=Math.max(1,Math.ceil(Math.abs(dx)/(safe.right-safe.left-20)),Math.ceil(Math.abs(dy)/(safe.bottom-safe.top-20)));
    for(let i=1;i<=segments;i++)await gesture(dx/segments,dy/segments,{...options,id:segments===1?options.id:`${options.id}-part${i}`});
  }
  async function zoom(scale) {
    const current=await read();
    if(Math.abs(scale-current.scale)<.00001)return;
    await mouse({type:'mouseWheel',...center,deltaX:0,deltaY:-Math.log(scale/current.scale)/.0015,modifiers:2});
    await settle();
    assert.ok(Math.abs((await read()).scale-scale)<.001,'Wheel sets requested zoom');
  }
  async function stopTrace(name) {
    const done=new Promise(resolve=>{const off=cdp.on('Tracing.tracingComplete',e=>{off();resolve(e.stream)})});
    await cdp.send('Tracing.end');const handle=await done;let data='',chunk;
    do{chunk=await cdp.send('IO.read',{handle});data+=chunk.base64Encoded?Buffer.from(chunk.data,'base64').toString():chunk.data}while(!chunk.eof);
    await cdp.send('IO.close',{handle});await writeFile(path.join(directory,`${name}.trace.json`),data);
  }
  await cdp.send('Profiler.enable'); await cdp.send('Profiler.setSamplingInterval',{interval:1000});
  try {
    for(const [name,scale,profile] of [['saved-zoom',initial.scale,true],['full-zoom',1,true],['control',initial.scale,false]]) {
      await zoom(scale);
      // Fifteen overlapping waypoints in a three-column, five-row serpentine sweep.
      const marginX=Math.min(350/scale,(bounds.right-bounds.left)/4),marginY=Math.min(350/scale,(bounds.bottom-bounds.top)/4);
      const points=[];
      for(let row=0;row<5;row++)for(let n=0;n<3;n++) {
        const col=row%2?2-n:n;
        const x=bounds.left+marginX+(bounds.right-bounds.left-2*marginX)*col/2;
        const y=bounds.top+marginY+(bounds.bottom-bounds.top-2*marginY)*row/4;
        points.push({x:center.x-s.x-x*scale,y:center.y-s.y-y*scale,row,col});
      }
      // Warm up just outside the first waypoint; all 15 measured gestures move.
      await go({x:points[0].x-140,y:points[0].y+90});await settle();await pause(600);
      if(profile)await cdp.send('Tracing.start',{categories:'devtools.timeline,blink.user_timing,toplevel,cc,gpu,disabled-by-default-devtools.timeline.frame',transferMode:'ReturnAsStream'});
      for(let i=0;i<points.length;i++) {
        await go(points[i],{id:`${name}-${String(i+1).padStart(2,'0')}`,record:true,profile,button:i%3===0?'left':'middle'});
        // Capture outside each measured interval; leave a gap between gestures.
        if(profile)await captureScreenshot(cdp,{output:path.join(directory,`${name}-${String(i+1).padStart(2,'0')}.png`)});
        await pause(600);
      }
      if(profile)await stopTrace(name);
    }
  } finally {
    await zoom(initial.scale);await go(initial.offset);await settle();
    report.restored=await read();report.finishedAt=new Date().toISOString();await save();
    await captureScreenshot(cdp,{output:path.join(directory,'restored.png')});
  }
});
