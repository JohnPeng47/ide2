import assert from 'node:assert/strict';
import { randomUUID, createHash } from 'node:crypto';
import { access, readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { JsonDirectoryStore } from '../../../infrastructure/mapping/evals/jsonDirectoryStore';
const dir=path.dirname(fileURLToPath(import.meta.url));
const plan=JSON.parse(await readFile(path.join(dir,'resume-plan.json'),'utf8'));
const job=plan.jobs.find((j:any)=>j.key===process.argv[2]); assert(job);
const oldDir=path.join(dir,'jobs',job.key);
const events=(await readFile(path.join(oldDir,'events.jsonl'),'utf8')).trim().split('\n').map(line=>JSON.parse(line));
const messages=events.map(e=>e.message).filter(m=>m?.role==='assistant');
assert(messages.length && messages.every(m=>m.usage?.totalTokens===0) && messages.some(m=>m.errorMessage?.includes('servers are currently overloaded')));
assert(!existsSync(path.join(oldDir,'response.json')));
const store=new JsonDirectoryStore<any>(path.resolve(dir,'../../../.diagrams-local/canvas-domain-model'),'eval-runs');
const old=await store.read(job.runId); assert.equal(old.status,'failed');
const attempt=Number(job.key.match(/-attempt-(\d+)$/)?.[1]??1)+1;
const retry={...job,key:job.key.replace(/-attempt-\d+$/,'')+'-attempt-'+attempt,runId:randomUUID()};
const file=path.join(dir,'resume-plan.json');
const resume={...plan,jobs:plan.jobs.map((j:any)=>j.key===job.key?retry:j)};
const now=new Date().toISOString();
if(!await store.read(retry.runId)){
 const request={...old.request,requestId:retry.runId};
 const {startedAt,completedAt,error:runError,...base}=old;
 const {startedAt:cs,completedAt:ce,error:cellError,...cell}=base.cells[0];
 await store.save({...base,id:retry.runId,request,requestHash:createHash('sha256').update(JSON.stringify(request)).digest('hex'),createdAt:now,status:'queued',cells:[{...cell,status:'queued'}]});
}
const url='http://localhost:5191/api/mapping/evals/experiments';
const r=await fetch(url+'/'+plan.experimentId);assert(r.ok);const e=await r.json();
if(!e.samples.some((s:any)=>s.id===retry.runId)){
 const {name,description,workflow,tags,cases,inputLineage,conditions,phases,samples,comparisons}=e;
 const original=samples.find((s:any)=>s.id===job.runId);
 const sample={...original,id:retry.runId,attempt,outputs:original.outputs.map((o:any)=>({...o,runId:retry.runId}))};
 const saved=await fetch(url,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({requestId:randomUUID(),experimentId:e.id,expectedRevision:e.revision,experiment:{name,description,workflow,tags,cases,inputLineage,conditions,phases,samples:[...samples,sample],comparisons}})});
 if(!saved.ok)throw Error(await saved.text());
}
await writeFile(file,JSON.stringify(resume,null,2)+'\n');
console.log('Registered overload retry',retry.key,retry.runId);
