import assert from 'node:assert/strict';
import { randomUUID, createHash } from 'node:crypto';
import { readFile, writeFile, copyFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { JsonDirectoryStore } from '../../../infrastructure/mapping/evals/jsonDirectoryStore';
import { evalRunRequestSchema } from '../../../domain/mapping/evals/evalRun';
const dir=path.dirname(fileURLToPath(import.meta.url)),storeRoot=path.resolve(dir,'../../../.diagrams-local/canvas-domain-model');
const read=async(name:string)=>JSON.parse(await readFile(path.join(dir,name),'utf8'));
const write=async(name:string,data:any)=>writeFile(path.join(dir,name),JSON.stringify(data,null,2)+'\n');
const api=async(route:string,body?:any)=>{const r=await fetch('http://localhost:5191/api/mapping/evals'+route,body?{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)}:{});if(!r.ok)throw Error(route+' '+await r.text());return r.json();};
const previous=await read('../phase2-ghostty/plan.json'),phaseId='phase-4',exp=await api('/experiments/'+previous.experimentId);
const ids=existsSync(path.join(dir,'ids.json'))?await read('ids.json'):{prompts:{},runs:{}};
const conditions=['astra','sol'].map(family=>({id:family+'-6-2-high-scoped',name:(family==='sol'?'Sol':'Astra')+' 6.2 · high',model:'gpt-6.2-'+family}));
const prompts:any={};
for(const kind of ['core','canvas']){
 const text=(await readFile(path.join(dir,'prompt.txt'),'utf8')).trimEnd();
 const parent=previous.prompts[kind],prompt=await api('/prompts/'+parent.promptId);
 const v3=prompt.versions.find((v:any)=>v.version===3);assert.equal(v3.contentHash,parent.contentHash);
 let version=prompt.versions.find((v:any)=>v.version===5);
 if(version)assert.equal(version.stages.alternative,text,'Existing v5 differs; never overwrite');
 else {
  assert.equal(prompt.versions.at(-1).version,4);
  ids.prompts[kind]??=randomUUID();await write('ids.json',ids);
  const saved=await api('/prompts',{requestId:ids.prompts[kind],promptId:prompt.id,baseVersion:4,workflow:'alternatives',name:prompt.name,description:prompt.description,stages:{alternative:text},derivation:{parent:{promptId:prompt.id,version:3},kind:'variation',dimension:{id:'scope-role',name:'Mapping scope and range role',value:'Explicit scope and role with bottom-up coverage'}}});
  version=saved.versions.find((v:any)=>v.version===5);
 }
 assert.equal(version.derivation.parent.version,3);
 prompts[kind]={...version,promptId:prompt.id,name:prompt.name};
}
const cases:any[]=[],jobs:any[]=[];
for(const kind of ['core','canvas'])for(const number of [kind==='core'?3:1]){
 const key=`ghostty-v3-${kind}-${number}`,c=await read('../phase2-ghostty/'+key+'-input.json');
 assert.equal(c.repo.commit,previous.commit);
 const registered=exp.cases.find((item:any)=>item.id===key);assert.equal(registered.agentContextId,c.agentContextId);assert.equal(registered.contentHash,c.contentHash);
 await copyFile(path.join(dir,'../phase2-ghostty',key+'-input.json'),path.join(dir,key+'-input.json'));cases.push(c);
 for(const condition of conditions)for(const sample of [1,2]){
  const jobKey=key+'-'+condition.id+'-'+sample,runId=ids.runs[jobKey]??=randomUUID();
  jobs.push({key:jobKey,caseId:key,conditionId:condition.id,number:sample,model:condition.model,effort:'high',childModel:condition.model,childEffort:'high',runId,kind,cellKey:prompts[kind].promptId+':1:alternative'});
 }
}
await write('ids.json',ids);
const plan={projectId:exp.projectId,experimentId:exp.id,phaseId,commit:previous.commit,mainConcurrency:2,childConcurrency:2,
 pilot:jobs.filter(j=>j.caseId==='ghostty-v3-canvas-1'&&j.number===1).map(j=>j.key),conditions,jobs,
 cases:cases.map(({key,kind,name,source,agentContextId,contentHash,diagrams})=>({key,kind,name,source,agentContextId,contentHash,diagramCount:diagrams.length,nodeCount:diagrams.reduce((n:number,d:any)=>n+d.nodes.length,0)})),
 prompts:Object.fromEntries(Object.entries(prompts).map(([k,v]:any)=>[k,{promptId:v.promptId,version:v.version,contentHash:v.contentHash}]))};
assert.equal(jobs.length,8);assert.equal(plan.pilot.length,2);await write('plan.json',plan);
if(!process.argv.includes('--attach'))process.exit(0);
assert.deepEqual((await read('preflight.json')).inputs,plan.cases.map(c=>c.contentHash));
const runs=new JsonDirectoryStore<any>(storeRoot,'eval-runs');
for(const j of jobs){
 const c=cases.find(c=>c.key===j.caseId),p=prompts[j.kind],now=new Date().toISOString();
 const request=evalRunRequestSchema.parse({requestId:j.runId,workflow:'alternatives',prompts:[{promptId:p.promptId,version:5}],inputs:{context:{agentContextId:c.agentContextId}},passes:1,model:j.model,effort:j.effort});
 const requestHash=createHash('sha256').update(JSON.stringify(request)).digest('hex'),existing=await runs.read(j.runId);
 if(existing){assert.equal(existing.requestHash,requestHash);continue;}
 await runs.save({schemaVersion:1,id:j.runId,coordinator:'canvas-discovery',name:c.name+' · '+j.conditionId+' '+j.number,projectId:exp.projectId,request,requestHash,workflow:'alternatives',agentContextId:c.agentContextId,contextName:c.name,inputs:{},contexts:{context:{agentContextId:c.agentContextId,name:c.name,contentHash:c.contentHash}},prompts:[p],passes:1,status:'queued',createdAt:now,cells:[{key:j.cellKey,promptId:p.promptId,promptVersion:5,promptName:p.name,pass:1,stage:'alternative',status:'queued'}]});
}
if(!exp.phases.some((p:any)=>p.id===phaseId)){
 const {name,description,workflow,tags,cases:existingCases,inputLineage,comparisons}=exp;
 await api('/experiments',{requestId:randomUUID(),experimentId:exp.id,expectedRevision:exp.revision,experiment:{name,description,workflow,tags,cases:existingCases,inputLineage,comparisons,
  conditions:[...exp.conditions,...conditions.map(c=>({id:c.id,name:c.name,description:`${c.model}/high lead; optional children use the same model and high effort. Two independent repeats on each pinned input. Node scope and range role recorded.`}))],
  phases:[...exp.phases,{id:phaseId,name:'Phase 4 · Source mapping scope and role',description:'Ghostty central diagram 3 (the original seed) and first expansion canvas 1. Astra 6.2 high and Sol 6.2 high, twice per input, eight samples total.'}],
  samples:[...exp.samples,...jobs.map(j=>({id:j.runId,phaseId,caseId:j.caseId,conditionId:j.conditionId,number:j.number,attempt:1,outputs:[{stageId:'mapping',runId:j.runId,cellKey:j.cellKey}]}))]}});
}
const saved=await api('/experiments/'+exp.id);
assert.deepEqual(saved.samples.filter((s:any)=>s.phaseId===phaseId).map((s:any)=>s.id).sort(),jobs.map(j=>j.runId).sort());
await write('attached.json',{experimentId:saved.id,revision:saved.revision,samples:8});
console.log('Attached 8 Phase 4 samples at revision',saved.revision);
