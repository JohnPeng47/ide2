import assert from 'node:assert/strict';
import { randomUUID, createHash } from 'node:crypto';
import { access, readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { JsonDirectoryStore } from '../../../infrastructure/mapping/evals/jsonDirectoryStore';
const dir=path.dirname(fileURLToPath(import.meta.url));
const plan=JSON.parse(await readFile(path.join(dir,'plan.json'),'utf8'));
const job=plan.jobs.find((j:any)=>j.caseId==='ghostty-v3-core-3' && j.model==='gpt-6.2-sol' && j.number===1);
const oldDir=path.join(dir,'jobs',job.key);
await access(path.join(oldDir,'started.json'));
assert(!existsSync(path.join(oldDir,'response.json')));
const store=new JsonDirectoryStore<any>(path.resolve(dir,'../../../.diagrams-local/canvas-domain-model'),'eval-runs');
const old=await store.read(job.runId);
const file=path.join(dir,'resume-plan.json');
const resume=existsSync(file)?JSON.parse(await readFile(file,'utf8')):{...plan,jobs:plan.jobs.map((j:any)=>j.key!==job.key?j:{...j,key:j.key+'-attempt-2',runId:randomUUID()})};
const retry=resume.jobs.find((j:any)=>j.key===job.key+'-attempt-2');
if(!existsSync(file))await writeFile(file,JSON.stringify(resume,null,2)+'\n',{flag:'wx'});
const now=new Date().toISOString(),error='Interrupted by user before submission.';
if(old.status==='generating'){
 old.status='failed';old.error=error;old.completedAt=now;
 Object.assign(old.cells[0],{status:'failed',error,completedAt:now});await store.save(old);
 await writeFile(path.join(oldDir,'status.json'),JSON.stringify({status:'failed',phase:'interrupted',error})+'\n');
}
assert.equal(old.error,error);
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
 const sample={...original,id:retry.runId,attempt:2,outputs:original.outputs.map((o:any)=>({...o,runId:retry.runId}))};
 const saved=await fetch(url,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({requestId:randomUUID(),experimentId:e.id,expectedRevision:e.revision,experiment:{name,description,workflow,tags,cases,inputLineage,conditions,phases,samples:[...samples,sample],comparisons}})});
 if(!saved.ok)throw Error(await saved.text());
}
console.log('Attached attempt 2 for interrupted Sol sample',retry.runId);
