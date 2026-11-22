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
const previous=await read('../phase2-ghostty/plan.json'),phaseId='phase-3',exp=await api('/experiments/'+previous.experimentId);
const ids=existsSync(path.join(dir,'ids.json'))?await read('ids.json'):{prompts:{},runs:{}};
const conditions=[{id:'sol-high_sol-medium',name:'Sol high · Sol medium children',model:'gpt-6-sol'},{id:'astra-high_sol-medium',name:'Astra high · Sol medium children',model:'gpt-6-astra'}];
const prompts:any={};
for(const kind of ['core','canvas']){
 const text=`Map each node ${kind==='core'?'in the provided diagram':'in every diagram on the provided canvas'} to the source code that implements or explains it.

Read each label in the context of its branch. A node can stand for a single fact, a component, or a flow. Follow it into the source until the code covers what the label describes. When a label names a function, type, or file, include its full declaration. Favor complete coverage over tight ranges; extra surrounding lines are fine, and precision is reviewed in a later step. A node can have several ranges across files.

For large diagrams, assign subtrees to subagents. Each subagent returns mappings for its own nodes. Combine them into one candidate, map any remaining nodes, then validate and submit it yourself. You decide whether and how to split. Use delegate_subagents with several assignments in one call to run them in parallel.

Inputs: the AgentContext contains the pinned, read-only repository checkout and diagram-data.json (ASCII and node references). No layout template or external reference examples are provided. ${kind==='core'?'Do not change diagram text or layout.':"Do not change any diagram’s text or the canvas layout."}

Output: return only JSON in this form:
{"diagrams":[{"diagramId":"d1","mappings":[{"node":"n1","path":"relative/file.ts","startLine":10,"endLine":20}]}],"notes":"Unsupported nodes or uncertainty"}
Each entry is one repository-relative, 1-based, inclusive range; repeat a node for multiple ranges. Include every diagram. If you can't support a node, leave it unmapped and say why in notes.

Read ranges with per-file line numbers (for example, nl -ba file) rather than inferring them from search hits. Before returning, call validate_source_mappings with your complete candidate and fix any errors. Your final JSON must match a candidate that passed.

If you receive a subagent assignment, map only the assigned nodes and return their partial mappings and notes using the same JSON shape. You have read/bash tools only; the main agent handles delegation, remaining nodes, validation and final submission.`;
 await writeFile(path.join(dir,kind+'-prompt-v4.txt'),text+'\n');
 const parent=previous.prompts[kind],prompt=await api('/prompts/'+parent.promptId);
 const v3=prompt.versions.find((v:any)=>v.version===3);assert.equal(v3.contentHash,parent.contentHash);
 let version=prompt.versions.find((v:any)=>v.version===4);
 if(version)assert.equal(version.stages.alternative,text,'Existing v4 differs; never overwrite');
 else {
  assert.equal(prompt.versions.at(-1).version,3);
  ids.prompts[kind]??=randomUUID();await write('ids.json',ids);
  const saved=await api('/prompts',{requestId:ids.prompts[kind],promptId:prompt.id,baseVersion:3,workflow:'alternatives',name:prompt.name,description:prompt.description,stages:{alternative:text},derivation:{parent:{promptId:prompt.id,version:3},kind:'variation',dimension:{id:'delegation-coverage',name:'Delegation and coverage',value:'Short coverage prompt with optional parallel subagents'}}});
  version=saved.versions.find((v:any)=>v.version===4);
 }
 assert.equal(version.derivation.parent.version,3);
 prompts[kind]={...version,promptId:prompt.id,name:prompt.name};
}
const cases:any[]=[],jobs:any[]=[];
for(const kind of ['core','canvas'])for(const number of [1,2]){
 const key=`ghostty-v3-${kind}-${number}`,c=await read('../phase2-ghostty/'+key+'-input.json');
 assert.equal(c.repo.commit,previous.commit);
 const registered=exp.cases.find((item:any)=>item.id===key);assert.equal(registered.agentContextId,c.agentContextId);assert.equal(registered.contentHash,c.contentHash);
 await copyFile(path.join(dir,'../phase2-ghostty',key+'-input.json'),path.join(dir,key+'-input.json'));cases.push(c);
 for(const condition of conditions)for(const sample of [1,2,3]){
  const jobKey=key+'-'+condition.id+'-'+sample,runId=ids.runs[jobKey]??=randomUUID();
  jobs.push({key:jobKey,caseId:key,conditionId:condition.id,number:sample,model:condition.model,effort:'high',childModel:'gpt-6-sol',childEffort:'medium',runId,kind,cellKey:prompts[kind].promptId+':1:alternative'});
 }
}
await write('ids.json',ids);
const plan={projectId:exp.projectId,experimentId:exp.id,phaseId,commit:previous.commit,mainConcurrency:6,childConcurrency:4,
 pilot:jobs.filter(j=>j.caseId==='ghostty-v3-canvas-1'&&j.number===1).map(j=>j.key),conditions,jobs,
 cases:cases.map(({key,kind,name,source,agentContextId,contentHash,diagrams})=>({key,kind,name,source,agentContextId,contentHash,diagramCount:diagrams.length,nodeCount:diagrams.reduce((n:number,d:any)=>n+d.nodes.length,0)})),
 prompts:Object.fromEntries(Object.entries(prompts).map(([k,v]:any)=>[k,{promptId:v.promptId,version:v.version,contentHash:v.contentHash}]))};
assert.equal(jobs.length,24);assert.equal(plan.pilot.length,2);await write('plan.json',plan);
if(!process.argv.includes('--attach'))process.exit(0);
assert.deepEqual((await read('preflight.json')).inputs,plan.cases.map(c=>c.contentHash));
const runs=new JsonDirectoryStore<any>(storeRoot,'eval-runs');
for(const j of jobs){
 const c=cases.find(c=>c.key===j.caseId),p=prompts[j.kind],now=new Date().toISOString();
 const request=evalRunRequestSchema.parse({requestId:j.runId,workflow:'alternatives',prompts:[{promptId:p.promptId,version:4}],inputs:{context:{agentContextId:c.agentContextId}},passes:1,model:j.model,effort:j.effort});
 const requestHash=createHash('sha256').update(JSON.stringify(request)).digest('hex'),existing=await runs.read(j.runId);
 if(existing){assert.equal(existing.requestHash,requestHash);continue;}
 await runs.save({schemaVersion:1,id:j.runId,coordinator:'canvas-discovery',name:c.name+' · '+j.conditionId+' '+j.number,projectId:exp.projectId,request,requestHash,workflow:'alternatives',agentContextId:c.agentContextId,contextName:c.name,inputs:{},contexts:{context:{agentContextId:c.agentContextId,name:c.name,contentHash:c.contentHash}},prompts:[p],passes:1,status:'queued',createdAt:now,cells:[{key:j.cellKey,promptId:p.promptId,promptVersion:4,promptName:p.name,pass:1,stage:'alternative',status:'queued'}]});
}
if(!exp.phases.some((p:any)=>p.id===phaseId)){
 const {name,description,workflow,tags,cases:existingCases,inputLineage,comparisons}=exp;
 await api('/experiments',{requestId:randomUUID(),experimentId:exp.id,expectedRevision:exp.revision,experiment:{name,description,workflow,tags,cases:existingCases,inputLineage,comparisons,
  conditions:[...exp.conditions,...conditions.map(c=>({id:c.id,name:c.name,description:`${c.model}/high lead; gpt-6-sol/medium children. Short v4 coverage prompt; main agent chooses delegation. Six concurrent main jobs; up to four concurrent children per job, further assignments queue. Same pinned Phase 2 inputs; three samples each.`}))],
  phases:[...exp.phases,{id:phaseId,name:'Phase 3 · Delegated source mapping',description:'Four existing Ghostty inputs: central diagrams 1 and 2, expanded canvases 1 and 2. Two lead/child model pairings × three samples = 24. Pilot: canvas 1, sample 1 per condition; successful pilot samples count in the 24.'}],
  samples:[...exp.samples,...jobs.map(j=>({id:j.runId,phaseId,caseId:j.caseId,conditionId:j.conditionId,number:j.number,attempt:1,outputs:[{stageId:'mapping',runId:j.runId,cellKey:j.cellKey}]}))]}});
}
const saved=await api('/experiments/'+exp.id);
assert.deepEqual(saved.samples.filter((s:any)=>s.phaseId===phaseId).map((s:any)=>s.id).sort(),jobs.map(j=>j.runId).sort());
await write('attached.json',{experimentId:saved.id,revision:saved.revision,samples:24});
console.log('Attached 24 Phase 3 samples at revision',saved.revision);
