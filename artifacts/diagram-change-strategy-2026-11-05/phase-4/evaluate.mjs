import fs from 'node:fs/promises';
import {createHash,randomUUID} from 'node:crypto';
import {judgeDiagramChangeTrees} from '../../../domain/mapping/evals/diagramChangeTree.ts';
import {experimentDesignSchema} from '../../../domain/mapping/evals/experiment.ts';
import {JsonDirectoryStore} from '../../../infrastructure/mapping/evals/jsonDirectoryStore.ts';
import {JudgementService} from '../../../application/mapping/evals/judgementService.ts';
const dir='artifacts/diagram-change-strategy-2026-11-05/phase-4',api='http://127.0.0.1:5191/api/mapping/evals',experimentId='f1ee9846-f13d-448d-9628-99e7c3bd6d1a';
const ids=JSON.parse(await fs.readFile(`${dir}/ids.json`));
const save=(name,x)=>fs.writeFile(`${dir}/${name}.json`,JSON.stringify(x,null,2)+'\n');
const call=async(p,b)=>{const r=await fetch(api+p,b?{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(b)}:undefined);const t=await r.text();if(!r.ok)throw Error(t);return JSON.parse(t)};
const before=await call(`/experiments/${experimentId}`),comparison=before.comparisons.find(c=>c.id==='phase-4-tree-parse');
const runs=await Promise.all(ids.runs.map(id=>call(`/runs/${id}`)));
if(runs.some(r=>r.cells.some(c=>!['finished','failed','cancelled','skipped'].includes(c.status))))throw Error('Wait for all outputs to reach terminal state.');
const completed=[],excluded=[];
for(const [i,r]of runs.entries())for(const c of r.cells){const row={context:i+1,sample:c.pass,runId:r.id,outputKey:c.key,status:c.status};if(c.status==='finished')completed.push({...row,text:c.proposalTree,usage:c.usage,source:{documentId:c.canvasId,checkpointId:c.checkpointId}});else excluded.push({...row,error:c.error,retainedTree:c.proposalTree??null});}
await save('completed-responses',completed);await save('excluded-responses',excluded);
if(!completed.length)throw Error('No completed outputs to evaluate.');
let judgementId=comparison.judgementIds[0]??ids.judgement;
if(!comparison.judgementIds.length){
 if(!excluded.length){const request={requestId:judgementId,expectedRevision:before.revision,comparisonId:comparison.id};await save('judgement-request',request);await call(`/experiments/${experimentId}/judge`,request);}
 else{
  const data=judgeDiagramChangeTrees(completed.map(({runId,outputKey,text})=>({runId,outputKey,text}))),now=new Date().toISOString();
  const store=new JsonDirectoryStore('.diagrams-local/canvas-domain-model','judgements');
  const service=new JudgementService({list:async()=>[],read:store.read.bind(store),save:store.save.bind(store)},null,null,null,null);
  await service.saveDeterministic({schemaVersion:1,id:judgementId,projectId:before.projectId,title:`Phase 4 · Partial assessment (${completed.length}/14 outputs; ${excluded.length} failed outputs excluded)`,createdAt:now,updatedAt:now,runIds:[...new Set(completed.map(c=>c.runId))],subjects:completed.map(({runId,outputKey,source})=>({runId,outputKey,source})),evaluator:comparison.evaluator,kind:'diagram-change-tree',status:'finished',canvases:[],source:{kind:'experiment',id:experimentId,fingerprint:createHash('sha256').update(JSON.stringify({comparisonId:comparison.id,evidence:completed})).digest('hex')},data});
  const design=Object.fromEntries(Object.keys(experimentDesignSchema.shape).filter(k=>k in before).map(k=>[k,structuredClone(before[k])]));
  design.comparisons.find(c=>c.id===comparison.id).judgementIds.push(judgementId);
  await call('/experiments',{requestId:randomUUID(),experimentId,expectedRevision:before.revision,experiment:design});
 }
}
const judgement=await call(`/judgements/${judgementId}`);await save('judgement',judgement);
const protectedFiles=JSON.parse(await fs.readFile(`${dir}/protected-files.json`));
for(const {path,sha256}of protectedFiles)if(createHash('sha256').update(await fs.readFile(path)).digest('hex')!==sha256)throw Error(`Protected evidence changed: ${path}`);
const {outputs,...totals}=judgement.data;
const receipt={judgementId,completed:completed.length,excluded:excluded.length,...totals,protectedFilesVerified:protectedFiles.length,perOutput:outputs.map(o=>{const c=completed.find(c=>c.runId===o.runId&&c.outputKey===o.outputKey);return {context:c.context,sample:c.sample,counts:o.counts,valid:o.valid,issues:o.issues}})};
await save('evaluation-receipt',receipt);console.log(JSON.stringify(receipt,null,2));
