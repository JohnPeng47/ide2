import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { publishJson } from '../../../infrastructure/core/persistence/immutableRecords';
import { validateConnectionAnchor } from '../../../domain/core/diagrams/diagramConnection';
import { single, report, validateCanvas, type Canvas } from './artifacts';
const directory=path.resolve(process.argv[2]??'artifacts/codebase-canvas-2026-11-11');
const state=JSON.parse(await readFile(path.join(directory,'state.json'),'utf8'));
const base=process.env.EVALS_BASE_URL??'http://127.0.0.1:5191';
const api=async(route:string)=>{const r=await fetch(base+'/api/mapping/evals'+route,{signal:AbortSignal.timeout(20000)});const value=await r.json();if(!r.ok)throw Error(`${route}: ${JSON.stringify(value)}`);return value;};
const file=path.join(directory,'confirmed-outputs.json');let audit:any={outputs:{}};
try{audit=JSON.parse(await readFile(file,'utf8'));}catch(e){if((e as NodeJS.ErrnoException).code!=='ENOENT')throw e;}
let added=0;
for(const job of state.jobs){
  if(!state.results?.[job.key]||audit.outputs[job.runId])continue;
  const run=await api(`/runs/${job.runId}`);if(run.status!=='finished')throw Error(`Completed state disagrees with API: ${job.key}`);
  const output=JSON.parse(await readFile(path.join(directory,'jobs',job.runId,'validated-output.json'),'utf8'));
  let expected:Canvas;
  if(job.stage==='tree')expected=single(output.ascii);
  else if(job.stage==='expand')expected=validateCanvas(output);
  else if(job.stage==='author')expected=report('Prompt authoring',output);
  else if(job.stage==='discover')expected=report('Selected epicenters',{summary:output.summary,points:output.points,reviewedFileCount:output.reviewedPaths.length,limitations:output.limitations});
  else if(job.stage==='select')expected=report('Selected variants',output);
  else {const input=JSON.parse(await readFile(path.join(directory,'jobs',job.runId,'judge-input.json'),'utf8'));expected=report(`Phase ${input.phase} critique`,output);}
  const result=await api(`/runs/${job.runId}/output-result?cell=${encodeURIComponent(run.cells[0].key)}`);
  if(result.canvases.length!==1)throw Error(`Expected one persisted output canvas: ${job.key}`);
  const document=result.canvases[0].proposed.document;
  for(const diagram of expected.diagrams){const saved=document.scene.contents[`${job.runId}-${diagram.id}`];if(saved?.content.ascii!==diagram.ascii)throw Error(`Saved text differs from validated output: ${job.key}/${diagram.id}`);}
  if(document.edges.length!==expected.edges.length)throw Error(`Saved edge count differs: ${job.key}`);
  for(const edge of document.edges){validateConnectionAnchor(document.scene,edge.source);validateConnectionAnchor(document.scene,edge.target);}
  audit.outputs[job.runId]={key:job.key,stage:job.stage,condition:job.condition,round:job.round,checkedAt:new Date().toISOString(),validatedOutputSha256:createHash('sha256').update(JSON.stringify(output)).digest('hex'),checks:['API run finished','output API loads','all diagram text matches validated output','edge count matches','all saved edge anchors resolve'],diagrams:expected.diagrams.length,edges:expected.edges.length};added++;
}
audit.updatedAt=new Date().toISOString();audit.runnerStatus=state.status;audit.totalConfirmed=Object.keys(audit.outputs).length;
await publishJson(file,audit);console.log(JSON.stringify({confirmed:audit.totalConfirmed,newlyConfirmed:added,runnerStatus:state.status,activeJob:state.activeJob}));
