import { readFile, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { TraceMap, originalPositionFor } from '@jridgewell/trace-mapping';
const directory=path.resolve(process.argv[2]??'artifacts/code-panel-performance');
const maps=new Map(), results=[];
for(const file of (await readdir(directory)).filter(f=>f.endsWith('.cpuprofile'))) {
  const profile=JSON.parse(await readFile(path.join(directory,file),'utf8'));
  const parents=new Map(), labels=new Map();
  for(const node of profile.nodes) {
    for(const child of node.children??[])parents.set(child,node.id);
    const f=node.callFrame;
    let label=f.functionName||'(anonymous)';
    if(f.url.includes('/assets/')) {
      const basename=path.basename(new URL(f.url).pathname);
      if(!maps.has(basename))maps.set(basename,await readFile(path.join('dist/assets',basename+'.map'),'utf8').then(x=>new TraceMap(JSON.parse(x))).catch(()=>null));
      const map=maps.get(basename),original=map&&originalPositionFor(map,{line:f.lineNumber+1,column:f.columnNumber});
      if(original?.source)label=`${original.source.replace(/^\.\.\//,'')}:${original.line} ${original.name??label}`;
    }
    labels.set(node.id,label);
  }
  const self=new Map(),inclusive=new Map();let total=0;
  for(let i=0;i<profile.samples.length;i++) {
    const id=profile.samples[i],ms=profile.timeDeltas[i]/1000;total+=ms;
    self.set(labels.get(id),(self.get(labels.get(id))??0)+ms);
    const seen=new Set();let parent=id;
    while(parent){const label=labels.get(parent);if(!seen.has(label))inclusive.set(label,(inclusive.get(label)??0)+ms);seen.add(label);parent=parents.get(parent)}
  }
  const top=values=>[...values].sort((a,b)=>b[1]-a[1]).slice(0,45).map(([location,ms])=>({location,ms:Math.round(ms),percent:Math.round(ms/total*1000)/10}));
  results.push({file,totalMs:Math.round(total),self:top(self),inclusive:top(inclusive)});
}
await writeFile(path.join(directory,'profile-summary.json'),JSON.stringify(results,null,2));
console.log(JSON.stringify(results,null,2));
const traces=[];
for(const file of (await readdir(directory)).filter(f=>f.endsWith('.trace.json'))) {
  const {traceEvents}=JSON.parse(await readFile(path.join(directory,file),'utf8'));
  const main=traceEvents.find(e=>e.name==='thread_name'&&e.args?.name==='CrRendererMain');
  const totals=new Map();
  for(const e of traceEvents)if(e.ph==='X'&&e.tid===main?.tid&&e.pid===main?.pid) {
    const t=totals.get(e.name)??{name:e.name,ms:0,count:0,maxMs:0};
    t.ms+=(e.dur??0)/1000;t.count++;t.maxMs=Math.max(t.maxMs,(e.dur??0)/1000);totals.set(e.name,t);
  }
  traces.push({file,events:[...totals.values()].sort((a,b)=>b.ms-a.ms)});
}
await writeFile(path.join(directory,'trace-summary.json'),JSON.stringify(traces,null,2));
