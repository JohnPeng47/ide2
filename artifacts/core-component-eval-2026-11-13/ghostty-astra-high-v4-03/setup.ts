import { readFile, writeFile, copyFile } from 'node:fs/promises';
import { createHash, randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { AgentContextLibrary } from '../../../application/mapping/agent/agentContextLibrary';
import { FileAgentContextRepository } from '../../../infrastructure/core/persistence/fileAgentContextRepository';
import { JsonDirectoryStore } from '../../../infrastructure/mapping/evals/jsonDirectoryStore';
import { experimentDesignSchema } from '../../../domain/mapping/evals/experiment';
import { cellKey, evalRunRequestSchema, type EvalRun } from '../../../domain/mapping/evals/evalRun';
const directory=path.dirname(fileURLToPath(import.meta.url)),root=path.resolve(directory,'../../..');
const read=async(p:string)=>JSON.parse(await readFile(p,'utf8'));
const write=async(p:string,v:unknown)=>writeFile(p,JSON.stringify(v,null,2)+'\n');
const hash=(s:string)=>createHash('sha256').update(s).digest('hex');
const api=async(route:string,body?:unknown)=>{const r=await fetch('http://localhost:5191/api/mapping/evals'+route,body===undefined?{}:{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)});const v=await r.json();if(!r.ok)throw Error(JSON.stringify(v));return v;};
const baseline=await read(path.join(directory,'../pi-astra-high-v4-03/inputs.json'));
let ids;try{ids=await read(path.join(directory,'ids.json'));}catch(e){if((e as NodeJS.ErrnoException).code!=='ENOENT')throw e;ids={contextRequestId:randomUUID(),attachRequestId:randomUUID(),coverageAttachRequestId:randomUUID(),cases:Array.from({length:3},(_,i)=>({number:i+1,runId:randomUUID(),sampleId:randomUUID()}))};await write(path.join(directory,'ids.json'),ids);}
const config=await read(path.join(root,'artifacts/codebase-canvas-2026-11-11/config.json'));
const contexts=new AgentContextLibrary(new FileAgentContextRepository(config.storeRoot));
const parent=await contexts.read(baseline.agentContextId,false);
const inherited=parent.snapshot.messages[0].content[0];if(inherited.type!=='repository')throw Error('Expected repository context');
const repositoryPath='/home/john/softwarez/ghostty',sourceCommit='ea8b12a8a9894b5259c441eadd8f6f0c65e215af';
const exclusions=[...inherited.exclusions,'.agents/**','vendor/**','deps/**','images/**','po/**','example/**','flatpak/**','snap/**','**/Tests/**','**/benchmark/**'].sort();
const created=await contexts.create({requestId:ids.contextRequestId,name:'Ghostty · core discovery',group:'Core component discovery',description:`Source-only incremental discovery at ${sourceCommit}; documentation, standalone tests, examples, and vendored dependencies excluded.`,context:[{...inherited,repositoryPath,commit:sourceCommit,exclusions}]});
const saved=await contexts.read(created.agentContextId,false);
const descriptor=saved.snapshot.messages[0].content[0];if(descriptor.type!=='repository'||descriptor.commit!==sourceCommit)throw Error('Wrong source snapshot');
const actual=execFileSync('git',['rev-parse','--verify',`${sourceCommit}^{commit}`],{cwd:repositoryPath,encoding:'utf8'}).trim();if(actual!==sourceCommit)throw Error('Pinned commit unavailable');
const paths=execFileSync('git',['ls-tree','-rz','--name-only',sourceCommit],{cwd:repositoryPath,encoding:'utf8',maxBuffer:16*1024*1024}).split('\0').filter(Boolean);
const eligible=paths.filter(p=>!exclusions.some(pattern=>path.posix.matchesGlob(p,pattern))).sort();
const promptRecord=await api(`/prompts/${baseline.promptId}`),pinned=promptRecord.versions.find((v:{version:number})=>v.version===4);
if(!pinned)throw Error('Prompt v4 unavailable');
const prompt=pinned.stages.alternative;
const plan={model:'gpt-6-astra',effort:'high',samples:3,conditionId:'ghostty-astra-high-v4',conditionName:'Ghostty · Astra/high v4',repositoryName:'Ghostty',phaseId:'pi',caseId:'ghostty-source',experimentId:baseline.experimentId,promptId:baseline.promptId,promptVersion:4,promptSha256:hash(prompt),savedPromptContentHash:pinned.contentHash,agentContextId:saved.agentContextId,contextHash:saved.contentHash,sourceCommit,repositoryPath:descriptor.repositoryPath,eligibleFiles:eligible.length,...ids};
await write(path.join(directory,'inputs.json'),plan);await write(path.join(directory,'context.json'),saved.snapshot);await writeFile(path.join(directory,'prompt.txt'),prompt);await write(path.join(directory,'eligible-paths.json'),eligible);
const experiment=await api(`/experiments/${plan.experimentId}`);
const design=experimentDesignSchema.parse(Object.fromEntries(['name','description','workflow','phases','cases','conditions','samples','comparisons'].filter(k=>experiment[k]!==undefined).map(k=>[k,experiment[k]])));
if(!design.cases.some(c=>c.id===plan.caseId))design.cases.push({id:plan.caseId,name:'Ghostty',agentContextId:saved.agentContextId,contentHash:saved.contentHash});
const input=design.cases.find(c=>c.id===plan.caseId);if(!input||input.agentContextId!==saved.agentContextId||input.contentHash!==saved.contentHash)throw Error('Ghostty input case mismatch');
const runs=new JsonDirectoryStore<EvalRun>(config.storeRoot,'eval-runs'),key=cellKey(plan.promptId,1,'alternative');
if(!design.conditions.some(c=>c.id===plan.conditionId))design.conditions.push({id:plan.conditionId,name:plan.conditionName,description:'Three independent Astra/high samples at Ghostty ea8b12a using prompt v4, with aggregate read/bash source coverage.'});
let changed=false;
for(const sample of plan.cases){
 const request=evalRunRequestSchema.parse({requestId:sample.runId,workflow:'alternatives',prompts:[{promptId:plan.promptId,version:4}],inputs:{context:{agentContextId:saved.agentContextId}},passes:1,model:plan.model,effort:plan.effort});
 if(!await runs.read(sample.runId))await runs.save({schemaVersion:1,id:sample.runId,coordinator:'canvas-discovery',request,requestHash:hash(JSON.stringify(request)),projectId:experiment.projectId,workflow:'alternatives',agentContextId:saved.agentContextId,contextName:saved.name,prompts:[{...pinned,promptId:plan.promptId,name:promptRecord.name}],inputs:{},contexts:{context:{agentContextId:saved.agentContextId,name:saved.name,contentHash:saved.contentHash}},name:`Ghostty discovery · Astra ${sample.number}`,status:'queued',createdAt:new Date().toISOString(),cells:[{key,promptId:plan.promptId,promptVersion:4,promptName:promptRecord.name,pass:1,stage:'alternative',status:'queued',candidateName:`Ghostty core · Astra ${sample.number}`}]});
 if(!design.samples.some(s=>s.id===sample.sampleId)){design.samples.push({id:sample.sampleId,phaseId:'pi',caseId:plan.caseId,conditionId:plan.conditionId,number:sample.number,attempt:1,outputs:[{stageId:'tree',runId:sample.runId,cellKey:key}]});changed=true;}
}
design.phases!.find(p=>p.id==='pi')!.description='Astra/high core discovery across Mapping, Pi, OpenCode and Ghostty, with pinned prompts/snapshots and per-repository source coverage. Failed attempts have been deleted.';
if(changed)await api('/experiments',{requestId:ids.attachRequestId,experimentId:experiment.id,expectedRevision:experiment.revision,experiment:design});
console.log(JSON.stringify({sourceCommit:plan.sourceCommit,promptVersion:4,agentContextId:plan.agentContextId,samples:3,phaseId:'pi'}));
