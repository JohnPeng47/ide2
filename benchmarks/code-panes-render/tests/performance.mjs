import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import { session, evaluate, waitFor, ready, settle, pane, viewer, point, click, positions, parameters, output, captureScreenshot } from './session.mjs';

const percentile=(values,q)=>[...values].sort((a,b)=>a-b)[Math.max(0,Math.ceil(values.length*q)-1)]??0;
const pause=ms=>new Promise(r=>setTimeout(r,ms));
const metrics=async cdp=>Object.fromEntries((await cdp.send('Performance.getMetrics')).metrics.map(m=>[m.name,m.value]));
const measurements=[];
await session('performance',async({cdp,destination,metadata})=>{
  const report={...metadata,parameters,measurements,notes:'Frame intervals are rAF observations, not compositor presentation. CPU metrics overlap. Rendering reopens a highlighted file with warm caches. CPU profiles are separate from timing trials.'};
  const save=()=>writeFile(path.join(output,'measurements.json'),JSON.stringify(report,null,2));
  async function measure(panes,gesture,trial,profile=false){
    if(gesture==='render'){await click(cdp,`${pane(panes)} [aria-label="Collapse pane"]`);await ready(cdp,panes-1);}
    await settle(cdp);
    const p=gesture==='render'?null:await point(cdp,viewer(1)),previous=await positions(cdp);
    const transform=await evaluate(cdp,`document.querySelector('.diagram-canvas.is-enabled .diagram-canvas__surface').style.transform`);
    await evaluate(cdp,`(()=>{const s=window.__benchmark={frames:[],longTasks:[],last:null};s.observer=new PerformanceObserver(l=>s.longTasks.push(...l.getEntries().map(e=>e.duration)));s.observer.observe({type:'longtask'});const tick=t=>{if(s.last!==null)s.frames.push(t-s.last);s.last=t;s.raf=requestAnimationFrame(tick)};s.raf=requestAnimationFrame(tick)})()`);
    if(profile){await cdp.send('Profiler.enable');await cdp.send('Profiler.start');}
    const before=await metrics(cdp),start=performance.now();
    if(gesture==='render'){await click(cdp,`${pane(panes)} [aria-label="Expand pane"]`);await ready(cdp,panes);}
    else {
      if(gesture==='pan')await cdp.send('Input.dispatchMouseEvent',{type:'mousePressed',...p,button:'middle',buttons:4,clickCount:1});
      let deadline=performance.now();
      for(let i=1;i<=parameters.steps;i++){
        deadline=Math.max(deadline+1000/60,performance.now());await pause(Math.max(0,deadline-performance.now()));
        if(gesture==='pan'){
          const fraction=i<=parameters.steps/2?i/(parameters.steps/2):(parameters.steps-i)/(parameters.steps/2);
          await cdp.send('Input.dispatchMouseEvent',{type:'mouseMoved',x:p.x+120*fraction,y:p.y+40*fraction,button:'middle',buttons:4});
          if(i===Math.floor(parameters.steps/2))assert.notEqual(await evaluate(cdp,`document.querySelector('.diagram-canvas.is-enabled .diagram-canvas__surface').style.transform`),transform,'Pan moves canvas');
        } else await cdp.send('Input.dispatchMouseEvent',{type:'mouseWheel',...p,deltaX:0,deltaY:10});
      }
      if(gesture==='pan')await cdp.send('Input.dispatchMouseEvent',{type:'mouseReleased',...p,button:'middle',buttons:0,clickCount:1});
      else await waitFor(async()=>(await positions(cdp))['source-1'].top>=previous['source-1'].top+parameters.steps*10-1);
      await settle(cdp);
    }
    const elapsedMs=performance.now()-start,after=await metrics(cdp);
    if(profile)await writeFile(path.join(destination,`${panes}-${gesture}.cpuprofile`),JSON.stringify((await cdp.send('Profiler.stop')).profile));
    const observation=await evaluate(cdp,`(()=>{const s=window.__benchmark;cancelAnimationFrame(s.raf);s.longTasks.push(...s.observer.takeRecords().map(e=>e.duration));s.observer.disconnect();return{frames:s.frames,longTasks:s.longTasks}})()`);
    assert.equal(await evaluate(cdp,`document.querySelector('.diagram-canvas.is-enabled .diagram-canvas__surface').style.transform`),transform,'Gesture preserves final camera');
    const next=await positions(cdp);
    if(gesture==='pan')assert.deepEqual(next,previous,'Panning preserves pane scroll');
    if(gesture==='scroll'){
      for(let i=2;i<=panes;i++)assert.deepEqual(next[`source-${i}`],previous[`source-${i}`],'Scrolling is local');
      // Return through real wheel input so trials start at the same source location.
      await cdp.send('Input.dispatchMouseEvent',{type:'mouseWheel',...p,deltaX:0,deltaY:previous['source-1'].top-next['source-1'].top});
      await waitFor(async()=>Math.abs((await positions(cdp))['source-1'].top-previous['source-1'].top)<1);
    }
    return {panes,gesture,trial,profile,elapsedMs,mainThreadMs:1000*(after.TaskDuration-before.TaskDuration),scriptMs:1000*(after.ScriptDuration-before.ScriptDuration),layoutMs:1000*(after.LayoutDuration-before.LayoutDuration),styleMs:1000*(after.RecalcStyleDuration-before.RecalcStyleDuration),frameP95Ms:percentile(observation.frames,.95),frameMaxMs:Math.max(0,...observation.frames),...observation};
  }
  let count=5;
  for(const panes of parameters.paneCounts){
    while(count>panes){await click(cdp,`${pane(count)} [aria-label="Collapse pane"]`);count--;}
    while(count<panes){count++;await click(cdp,`${pane(count)} [aria-label="Expand pane"]`);}
    await ready(cdp,panes);
    for(const gesture of ['render','pan','scroll']){
      await measure(panes,gesture,0); // Warm-up excluded from results.
      for(let trial=1;trial<=parameters.trials;trial++){
        const result=await measure(panes,gesture,trial);measurements.push(result);await save();console.log(JSON.stringify({...result,frames:undefined}));await pause(300);
      }
      if(process.env.BENCH_PROFILE==='1'){measurements.push(await measure(panes,gesture,0,true));await save();}
    }
    await captureScreenshot(cdp,{output:path.join(destination,`${panes}-panes.png`)});
  }
  await save();
});
