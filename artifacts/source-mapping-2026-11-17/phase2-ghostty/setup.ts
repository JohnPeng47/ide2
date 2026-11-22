import assert from 'node:assert/strict';
import { randomUUID, createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { AgentContextLibrary } from '../../../application/mapping/agent/agentContextLibrary';
import { FileAgentContextRepository } from '../../../infrastructure/core/persistence/fileAgentContextRepository';
import { JsonDirectoryStore } from '../../../infrastructure/mapping/evals/jsonDirectoryStore';
import { CanvasHistory, documentFromHistory } from '../../../domain/core/diagrams/canvasHistory';
import { importDiagramRevision } from '../../../domain/core/diagrams/diagramRevisionStore';
import { diagramContentNodes } from '../../../domain/core/diagrams/diagramContentNodes';
import { evalRunRequestSchema } from '../../../domain/mapping/evals/evalRun';
const dir=path.dirname(fileURLToPath(import.meta.url));
const storeRoot=path.resolve(dir,'../../../.diagrams-local/canvas-domain-model');
const read=async (name:string)=>JSON.parse(await readFile(path.join(dir,name),'utf8'));
const write=async(name:string,data:unknown)=>writeFile(path.join(dir,name),JSON.stringify(data,null,2)+'\n');
const exId='b8ad87a7-698a-45e9-9cc0-b640ede5efa6',phaseId='phase-2',model='gpt-6-sol';
async function api(route:string,body?:any) {
 const resp=await fetch('http://localhost:5191/api/mapping/evals'+route,body?{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)}:{});
 if(!resp.ok)throw Error(route+' '+await resp.text());return resp.json();
}
const library=new AgentContextLibrary(new FileAgentContextRepository(storeRoot)),runs=new JsonDirectoryStore<any>(storeRoot,'eval-runs');
const previous=await read('../prepared-fix.json'),repo=(await read('../core-ghostty-input.json')).repo;
const exp=await api('/experiments/'+exId);
const cases:any[]=[],jobs:any[]=[],prompts:any={};
const ids=existsSync(path.join(dir,'ids.json'))?await read('ids.json'):{contexts:{},runs:{}};
const specs=await read('sources.json');
for(const spec of specs) {
 const {kind,experimentId,stage,sampleIds}=spec;
 const prompt=await api('/prompts/'+previous.prompts[kind].promptId),version=prompt.versions.find((v:any)=>v.version===3);
 assert.equal(version.stages.alternative,(await readFile(path.join(dir,'../'+kind+'-prompt-v3.txt'),'utf8')).trimEnd());
 prompts[kind]={...version,promptId:prompt.id,name:prompt.name};
 const parent=await api('/experiments/'+experimentId);
 const overview=await api('/experiments/'+experimentId+'/overview');
 const rows:any[]=[];function collect(n:any){rows.push(n);n.children?.forEach(collect);}collect(overview.root);
 for(const [index,sampleId] of sampleIds.entries()){
  const sample=parent.samples.find((s:any)=>s.id===sampleId);
  const source=sample.outputs.find((o:any)=>o.stageId===stage);
  const run=await runs.read(source.runId),cell=run.cells.find((c:any)=>c.key===source.cellKey);
  assert.equal(cell.status,'finished');assert.equal(cell.execution.repositories[0].commit,repo.commit);
  assert.equal(cell.execution.repositories[0].repositoryPath,repo.repositoryPath);
  const row=rows.find(n=>n.source?.sampleId===sampleId && n.source?.stageId===stage && n.target?.runId===source.runId && n.target?.cellKey===source.cellKey);
  const refs=row.actions.find((a:any)=>a.label==='output').refs;
  const batch=await api('/experiments/'+experimentId+'/read',{refs});
  assert.equal(batch.results[0].status,'ok',JSON.stringify(batch.results[0].error));
  const pinnedKey='ghostty-v3-'+kind+'-'+(index+1);
  if(process.argv.includes('--attach')){
   const pinned=await read(pinnedKey+'-input.json');
   assert.equal(pinned.source.runId,source.runId);assert.equal(pinned.source.cellKey,source.cellKey);
   assert.equal(pinned.repo.commit,repo.commit);cases.push(pinned);
   for(const priorJob of (await read('plan.json')).jobs.filter((j:any)=>j.caseId===pinnedKey))jobs.push(priorJob);
   continue;
  }
  const result=batch.results[0].value.result;
  assert.equal(result.canvases.length,1);
  for(const rev of Object.values(result.diagramRevisions))importDiagramRevision(rev as any);
  const state=result.canvases[0].proposed,history=new CanvasHistory(state.document,state.canvas).export(true);
  const doc=documentFromHistory(history),diagrams:any[]=[];
  function walk(box:any){if(box.kind==='container'){box.children.forEach(walk);return;}
   const diagram=doc.scene.contents[box.contentId];diagrams.push({diagramId:'d'+(diagrams.length+1),displayNodeId:'grid:'+box.id,contentId:box.contentId,ascii:diagram.content.ascii,nodes:diagramContentNodes(diagram.content).map((n,i)=>({ref:'n'+(i+1),...n}))});
  }
  walk(doc.scene.root); assert.ok(kind==='core'?diagrams.length===1:diagrams.length>1);
  const key='ghostty-v3-'+kind+'-'+(index+1),name='Ghostty · '+(kind==='core'?'Central diagram ':'Expanded canvas ')+(index+1);
  const data=diagrams.map(d=>({diagramId:d.diagramId,ascii:d.ascii,nodes:d.nodes.map((n:any)=>({node:n.ref,label:n.label,line:n.line}))}));
  ids.contexts[key]??=randomUUID();await write('ids.json',ids);
  const receipt=await library.create({requestId:ids.contexts[key],name,group:'Source mapping effort',description:'Phase 2 input from '+parent.name+', sample '+sampleId,context:[{...repo,task:version.stages.alternative.split('\n')[0]},{type:'section',name:'diagram-data.json',content:[{type:'text',text:JSON.stringify(data)}]}]});
  const ctx=await library.read(receipt.agentContextId,false);
  const upstream={experimentId,runId:source.runId,cellKey:source.cellKey,label:name,...(cell.checkpointId?{checkpointId:cell.checkpointId}:{})};
  const c={key,kind,name,repo,source:upstream,agentContextId:ctx.agentContextId,contentHash:ctx.contentHash,diagrams,history,snapshot:ctx.snapshot};
  await write(key+'-input.json',c);cases.push(c);
  for(const effort of ['low','medium','high'])for(const number of [1,2,3]){
   const jobKey=key+'-'+effort+'-'+number,runId=ids.runs[jobKey]??=randomUUID();
   jobs.push({key:jobKey,caseId:key,number,effort,runId,kind,cellKey:prompt.id+':1:alternative'});
  }
 }
}
assert.equal(cases.length,6);assert.equal(new Set(cases.map(c=>c.source.runId+':'+c.source.cellKey)).size,6);assert.equal(jobs.length,54);
await write('ids.json',ids);
const plan={projectId:exp.projectId,experimentId:exId,phaseId,model,commit:repo.commit,jobs,cases:cases.map(({key,kind,name,source,agentContextId,contentHash,diagrams})=>({key,kind,name,source,agentContextId,contentHash,diagramCount:diagrams.length,nodeCount:diagrams.reduce((s:number,d:any)=>s+d.nodes.length,0)})),prompts:Object.fromEntries(Object.entries(prompts).map(([k,v]:[string,any])=>[k,{promptId:v.promptId,version:v.version,contentHash:v.contentHash}]))};
await write('plan.json',plan);
if(!process.argv.includes('--attach'))process.exit(0);
assert.deepEqual((await read('preflight.json')).inputs,plan.cases.map(c=>c.contentHash));
for(const j of jobs){
 const c=cases.find(c=>c.key===j.caseId),p=prompts[j.kind],now=new Date().toISOString();
 const request=evalRunRequestSchema.parse({requestId:j.runId,workflow:'alternatives',prompts:[{promptId:p.promptId,version:p.version}],inputs:{context:{agentContextId:c.agentContextId}},passes:1,model,effort:j.effort});
 const requestHash=createHash('sha256').update(JSON.stringify(request)).digest('hex'),existing=await runs.read(j.runId);
 if(existing){assert.equal(existing.requestHash,requestHash);continue;}
 await runs.save({schemaVersion:1,id:j.runId,coordinator:'canvas-discovery',name:c.name+' · '+j.effort+' '+j.number,projectId:exp.projectId,request,requestHash,workflow:'alternatives',agentContextId:c.agentContextId,contextName:c.name,inputs:{},contexts:{context:{agentContextId:c.agentContextId,name:c.name,contentHash:c.contentHash}},prompts:[p],passes:1,status:'queued',createdAt:now,cells:[{key:j.cellKey,promptId:p.promptId,promptVersion:3,promptName:p.name,pass:1,stage:'alternative',status:'queued'}]});
}
if(!exp.phases.some((p:any)=>p.id===phaseId)){
 const {name,description,workflow,tags,conditions,comparisons}=exp;
 await api('/experiments',{requestId:randomUUID(),experimentId:exId,expectedRevision:exp.revision,experiment:{name,description,workflow,tags,conditions,comparisons,phases:[...exp.phases,{id:phaseId,name:'Phase 2 · Ghostty source coverage',description:'Source mapping v3 on three Ghostty central diagrams and three expanded canvases. Three repeats at each Sol effort level per input.'}],cases:[...exp.cases,...cases.map(c=>({id:c.key,name:c.name,agentContextId:c.agentContextId,contentHash:c.contentHash}))],inputLineage:[...(exp.inputLineage??[]),...cases.map(c=>({caseId:c.key,agentContextId:c.agentContextId,sources:[c.source]}))],samples:[...exp.samples,...jobs.map(j=>({id:j.runId,phaseId,caseId:j.caseId,conditionId:j.effort,number:j.number,attempt:1,outputs:[{stageId:'mapping',runId:j.runId,cellKey:j.cellKey}]}))]}});
}
const saved=await api('/experiments/'+exId);
assert.deepEqual(saved.samples.filter((s:any)=>s.phaseId===phaseId).map((s:any)=>s.id).sort(),jobs.map(j=>j.runId).sort());
console.log('Attached',jobs.length,'Phase 2 samples at revision',saved.revision);
