import { readFile, writeFile, mkdir, copyFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { randomUUID, createHash } from 'node:crypto';
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
const previous=await read(path.join(directory,'../pi-astra-high-03/inputs.json'));
const promptRecord=await read(path.join(directory,'prompt-record.json')),pinned=promptRecord.versions.at(-1);
if(pinned.version!==4)throw Error('Expected approved prompt v4');
const prompt=await readFile(path.join(directory,'prompt.txt'),'utf8');
let ids;try{ids=await read(path.join(directory,'ids.json'));}catch(e){if((e as NodeJS.ErrnoException).code!=='ENOENT')throw e;ids={attachRequestId:randomUUID(),repositories:{pi:{contextRequestId:randomUUID(),attachRequestId:randomUUID(),coverageAttachRequestId:randomUUID(),cases:Array.from({length:3},(_,i)=>({number:i+1,runId:randomUUID(),sampleId:randomUUID()}))},opencode:{contextRequestId:randomUUID(),attachRequestId:randomUUID(),coverageAttachRequestId:randomUUID(),cases:Array.from({length:3},(_,i)=>({number:i+1,runId:randomUUID(),sampleId:randomUUID()}))}}};await write(path.join(directory,'ids.json'),ids);}
const config=await read(path.join(root,'artifacts/codebase-canvas-2026-11-11/config.json'));
const contexts=new AgentContextLibrary(new FileAgentContextRepository(config.storeRoot));
const runs=new JsonDirectoryStore<EvalRun>(config.storeRoot,'eval-runs');
const experiment=await api(`/experiments/${previous.experimentId}`);
const design=experimentDesignSchema.parse(Object.fromEntries(['name','description','workflow','phases','cases','conditions','samples','comparisons'].filter(k=>experiment[k]!==undefined).map(k=>[k,experiment[k]])));
const phase=design.phases!.find(p=>p.id==='pi')!;phase.name='Phase 2 · Repository discovery';phase.description='Pi and OpenCode: three independent Astra/high samples per repository using prompt v4 with explicit single-root tree formatting. Prior Pi v2 attempts are retained. Source coverage aggregates include read and bash output.';
let changed=false;
for(const spec of [{slug:'pi',name:'Pi',commit:previous.sourceCommit},{slug:'opencode',name:'OpenCode',commit:'fe3552441192ccbea91d117668e7f3a9eb097baf'}]){
 const repositoryPath=`/home/john/softwarez/${spec.slug}`,repoIds=ids.repositories[spec.slug];
 const actual=execFileSync('git',['rev-parse','--verify',`${spec.commit}^{commit}`],{cwd:repositoryPath,encoding:'utf8'}).trim();if(actual!==spec.commit)throw Error('Snapshot unavailable');
 const destination=path.join(directory,`../${spec.slug}-astra-high-v4-03`);await mkdir(destination,{recursive:true});
 let saved;
 if(spec.slug==='pi')saved=await contexts.read(previous.agentContextId,false);
 else{
  const inherited=(await contexts.read(previous.agentContextId,false)).snapshot.messages[0].content[0];
  if(inherited.type!=='repository')throw Error('Expected repository descriptor');
  const exclusions=[...inherited.exclusions,'.opencode/**','.vscode/**','.zed/**','**/e2e/**','**/__snapshots__/**','specs/**','script/**','bun.lock','patches/**','salesforce/**'].sort();
  const created=await contexts.create({requestId:repoIds.contextRequestId,name:'OpenCode · core discovery',group:'Core component discovery',description:`Repository discovery at ${spec.commit}; source-only scope excluding tests and reference documentation.`,context:[{...inherited,repositoryPath,commit:spec.commit,exclusions}]});
  saved=await contexts.read(created.agentContextId,false);
 }
 const descriptor=saved.snapshot.messages[0].content[0];if(descriptor.type!=='repository'||descriptor.commit!==spec.commit)throw Error('Wrong source context');
 const paths=execFileSync('git',['ls-tree','-rz','--name-only',spec.commit],{cwd:repositoryPath,encoding:'utf8',maxBuffer:16*1024*1024}).split('\0').filter(Boolean);
 const eligible=paths.filter(p=>!descriptor.exclusions.some(pattern=>path.posix.matchesGlob(p,pattern))).sort();
 const caseId=spec.slug==='pi'?'pi-source':'opencode-source';
 const plan={model:'gpt-6-astra',effort:'high',samples:3,conditionId:`${spec.slug}-astra-high-v4`,conditionName:`${spec.name} · Astra/high v4`,repositoryName:spec.name,phaseId:'pi',caseId,experimentId:previous.experimentId,promptId:promptRecord.id,promptVersion:4,promptSha256:hash(prompt),savedPromptContentHash:pinned.contentHash,agentContextId:saved.agentContextId,contextHash:saved.contentHash,sourceCommit:spec.commit,repositoryPath,eligibleFiles:eligible.length,...repoIds};
 await write(path.join(destination,'inputs.json'),plan);await write(path.join(destination,'context.json'),saved.snapshot);await write(path.join(destination,'eligible-paths.json'),eligible);await copyFile(path.join(directory,'prompt.txt'),path.join(destination,'prompt.txt'));
 if(!design.cases.some(c=>c.id===caseId))design.cases.push({id:caseId,name:spec.name,agentContextId:saved.agentContextId,contentHash:saved.contentHash});
 if(!design.conditions.some(c=>c.id===plan.conditionId))design.conditions.push({id:plan.conditionId,name:plan.conditionName,description:`Three independent gpt-6-astra/high sessions at ${spec.name} ${spec.commit.slice(0,7)}, using prompt v4 with the approved generic tree validation rule. Source coverage includes all source returned by read and bash tools.`});
 const key=cellKey(plan.promptId,1,'alternative');
 for(const sample of plan.cases){
  const request=evalRunRequestSchema.parse({requestId:sample.runId,workflow:'alternatives',prompts:[{promptId:plan.promptId,version:4}],inputs:{context:{agentContextId:saved.agentContextId}},passes:1,model:plan.model,effort:plan.effort});
  if(!await runs.read(sample.runId))await runs.save({schemaVersion:1,id:sample.runId,coordinator:'canvas-discovery',request,requestHash:hash(JSON.stringify(request)),projectId:experiment.projectId,workflow:'alternatives',agentContextId:saved.agentContextId,contextName:saved.name,prompts:[{...pinned,promptId:promptRecord.id,name:promptRecord.name}],inputs:{},contexts:{context:{agentContextId:saved.agentContextId,name:saved.name,contentHash:saved.contentHash}},name:`${spec.name} discovery · Astra ${sample.number}`,status:'queued',createdAt:new Date().toISOString(),cells:[{key,promptId:plan.promptId,promptVersion:4,promptName:promptRecord.name,pass:1,stage:'alternative',status:'queued',candidateName:`${spec.name} core · Astra ${sample.number}`}]});
  if(!design.samples.some(s=>s.id===sample.sampleId)){design.samples.push({id:sample.sampleId,phaseId:'pi',caseId,conditionId:plan.conditionId,number:sample.number,attempt:spec.slug==='pi'?2:1,...(spec.slug==='pi'?{relaunchedFrom:{sampleId:previous.cases[sample.number-1].sampleId,stageId:'tree'}}:{}),outputs:[{stageId:'tree',runId:sample.runId,cellKey:key}]});changed=true;}
 }
 console.log(JSON.stringify({repository:spec.name,sourceCommit:spec.commit,eligibleFiles:eligible.length,promptVersion:4,samples:3}));
}
if(changed)await api('/experiments',{requestId:ids.attachRequestId,experimentId:experiment.id,expectedRevision:experiment.revision,experiment:design});
