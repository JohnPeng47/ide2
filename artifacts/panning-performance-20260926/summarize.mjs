import {readFile,writeFile,readdir} from 'node:fs/promises';
const dir=process.argv[2];const read=async name=>JSON.parse(await readFile(`${dir}/${name}`,'utf8'));const r=await read('results.json');
const pct=(a,p)=>[...a].sort((x,y)=>x-y)[Math.max(0,Math.ceil(a.length*p)-1)]??0;
const summary={groups:[],coverage:[],traces:[],profiles:[]};
for(const group of ['saved-zoom','full-zoom','control']) {
const runs=r.runs.filter(x=>x.id.startsWith(group)),frames=runs.flatMap(x=>x.frames);
summary.groups.push({group,drags:runs.length,frames:frames.length,p50Ms:pct(frames,.5),p95Ms:pct(frames,.95),maxMs:Math.max(...frames),over25:frames.filter(x=>x>25).length,over50:frames.filter(x=>x>50).length,longTasks:runs.flatMap(x=>x.longTasks),mainThreadMedianMs:pct(runs.map(x=>x.mainThreadMs),.5),scriptMedianMs:pct(runs.map(x=>x.scriptMs),.5),layoutTotalMs:runs.reduce((s,x)=>s+x.layoutMs,0),styleMedianMs:pct(runs.map(x=>x.styleMs),.5)});
for(const b of r.worldBoxes) {
const rects=runs.map(x=>x.visibleWorld).map(v=>({l:Math.max(b.x,v.left),r:Math.min(b.x+b.width,v.right),t:Math.max(b.y,v.top),b:Math.min(b.y+b.height,v.bottom)})).filter(v=>v.r>v.l&&v.b>v.t);
const xs=[...new Set(rects.flatMap(v=>[v.l,v.r]))].sort((a,b)=>a-b);let area=0;
for(let i=1;i<xs.length;i++){const ys=rects.filter(v=>v.l<=xs[i-1]&&v.r>=xs[i]).map(v=>[v.t,v.b]).sort((a,b)=>a[0]-b[0]);let length=0,end=-Infinity;for(const [a,b] of ys){length+=Math.max(0,b-Math.max(end,a));end=Math.max(end,b);}area+=(xs[i]-xs[i-1])*length;}
summary.coverage.push({group,id:b.id,percent:100*area/(b.width*b.height)});
}}
for(const file of (await readdir(dir)).filter(f=>f.endsWith('.cpuprofile'))) {
const p=await read(file),parents=new Map(),labels=new Map();for(const n of p.nodes){for(const child of n.children??[])parents.set(child,n.id);const f=n.callFrame;labels.set(n.id,`${f.functionName||'(anonymous)'}${f.url?' @ '+f.url.split('?')[0]:''}`);}
// CPU samples can contain out-of-order timestamps; sort before assigning intervals.
let time=p.startTime;const samples=p.samples.map((id,i)=>({id,time:time+=p.timeDeltas[i]})).sort((a,b)=>a.time-b.time);
const self=new Map(),inclusive=new Map();for(let i=0;i<samples.length;i++){const a=samples[i],ms=((samples[i+1]?.time??p.endTime)-a.time)/1000;self.set(labels.get(a.id),(self.get(labels.get(a.id))??0)+ms);const seen=new Set();let id=a.id;while(id){const label=labels.get(id);if(!seen.has(label))inclusive.set(label,(inclusive.get(label)??0)+ms);seen.add(label);id=parents.get(id);}}
const top=m=>[...m].sort((a,b)=>b[1]-a[1]).slice(0,25).map(([name,ms])=>({name,ms}));summary.profiles.push({file,totalMs:(p.endTime-p.startTime)/1000,self:top(self),inclusive:top(inclusive),hotReloadSamples:p.nodes.filter(n=>/performReactRefresh|scheduleRefresh|importUpdatedModule|queueUpdate/.test(n.callFrame.functionName)).map(n=>n.callFrame.functionName)});
}
for(const file of (await readdir(dir)).filter(f=>f.endsWith('.trace.json'))) {
const {traceEvents:t}=await read(file),m=t.find(e=>e.name==='thread_name'&&e.args?.name==='CrRendererMain');
const starts=t.filter(e=>e.cat==='blink.user_timing'&&e.name.endsWith(':start'));
for(const start of starts){const end=t.find(e=>e.name===start.name.replace(':start',':end'));if(!end)continue;const events=new Map();let dropped=0,rasterMs=0,rasterCount=0;const longTasks=[];
for(const e of t){if(e.pid!==m.pid||e.ts<start.ts||e.ts>=end.ts)continue;if(e.name==='DroppedFrame')dropped++;if(e.name==='RasterTask'&&e.ph==='X'){rasterMs+=(e.dur??0)/1000;rasterCount++;}if(e.tid!==m.tid||e.ph!=='X')continue;const duration=Math.min(e.dur??0,end.ts-e.ts)/1000;const v=events.get(e.name)??{name:e.name,count:0,totalMs:0,maxMs:0};v.count++;v.totalMs+=duration;v.maxMs=Math.max(v.maxMs,duration);events.set(e.name,v);if(e.name==='RunTask'&&duration>50)longTasks.push({ms:duration,ts:e.ts});}
summary.traces.push({id:start.name.replace(':start',''),droppedFrameEvents:dropped,rasterMs,rasterCount,longTasks,events:[...events.values()].sort((a,b)=>b.totalMs-a.totalMs)});
}}
await writeFile(`${dir}/summary.json`,JSON.stringify(summary,null,2));console.log(JSON.stringify({groups:summary.groups,coverage:summary.coverage,hotReloadProfiles:summary.profiles.filter(x=>x.hotReloadSamples.length).map(x=>x.file)},null,2));
