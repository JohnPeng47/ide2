import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { JsonDirectoryStore } from '../../../infrastructure/mapping/evals/jsonDirectoryStore';
import type { EvalRun } from '../../../domain/mapping/evals/evalRun';
import { experimentDesignSchema } from '../../../domain/mapping/evals/experiment';
const directory=path.dirname(fileURLToPath(import.meta.url)),root=path.resolve(directory,'../../..');
const read=async(p:string)=>JSON.parse(await readFile(p,'utf8'));
const plan=await read(path.join(directory,'inputs.json')),config=await read(path.join(root,'artifacts/codebase-canvas-2026-11-11/config.json'));
const runs=new JsonDirectoryStore<EvalRun>(config.storeRoot,'eval-runs');
const api=async(route:string,body?:unknown)=>{const r=await fetch('http://localhost:5191/api/mapping/evals'+route,body===undefined?{}:{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)});const v=await r.json();if(!r.ok)throw Error(JSON.stringify(v));return v;};
const key='raw-generation:1:analysis';
for(const sample of plan.cases){
 const run=await runs.read(sample.runId);if(!run)throw Error('Run unavailable');
 const response=await read(path.join(directory,`sample-${sample.number}`,'response.json'));
 const ascii=response.output.ascii;
 if(!run.cells.some(c=>c.key===key)){run.cells.push({key,pass:1,stage:'analysis',status:'queued',candidateName:`Pi raw generation ${sample.number}`,explanation:'Exact saved model output; canvas validation failed with Expected one ASCII tree root. No repair generation or text normalization.'});await runs.save(run);}
 const markdown=`# Pi generation ${sample.number}\n\nThe model completed successfully. Canvas validation failed: \`Expected one ASCII tree root\`. Source/legend continuation lines below the title prevent the parser from recognizing the title as the root. The exact generated ASCII is preserved below; it has not been repaired or regenerated.\n\n\`\`\`text\n${ascii}\n\`\`\`\n`;
 await writeFile(path.join(directory,`sample-${sample.number}`,'raw-output.md'),markdown);
 await writeFile(path.join(directory,`sample-${sample.number}`,'diagram.ascii.txt'),ascii);
 await api(`/runs/${sample.runId}/output-result`,{cellKey:key,format:'markdown',markdown});
}
const experiment=await api(`/experiments/${plan.experimentId}`);
const design=experimentDesignSchema.parse(Object.fromEntries(['name','description','workflow','phases','cases','conditions','samples','comparisons'].filter(k=>experiment[k]!==undefined).map(k=>[k,experiment[k]])));
if(!design.workflow.stages.some(s=>s.id==='raw-output')){design.workflow.stages.push({id:'raw-output',name:'Raw generation',dependsOn:['tree']});design.workflow.version++;}
for(const sample of plan.cases){const saved=design.samples.find(s=>s.id===sample.sampleId)!;if(!saved.outputs.some(o=>o.stageId==='raw-output'))saved.outputs.push({stageId:'raw-output',runId:sample.runId,cellKey:key});}
const ids=await read(path.join(directory,'ids.json'));
if(!ids.rawAttachRequestId){const {randomUUID}=await import('node:crypto');ids.rawAttachRequestId=randomUUID();await writeFile(path.join(directory,'ids.json'),JSON.stringify(ids,null,2)+'\n');}
await api('/experiments',{requestId:ids.rawAttachRequestId,experimentId:experiment.id,expectedRevision:experiment.revision,experiment:design});
console.log('Attached exact raw generations; original canvas validation failures retained.');
