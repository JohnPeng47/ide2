import { readFile, writeFile, mkdir, mkdtemp, rm, open } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import assert from 'node:assert/strict';
import { z } from 'zod';
import { AgentContextLibrary } from '../../application/mapping/agent/agentContextLibrary';
import { FileAgentContextRepository } from '../../infrastructure/core/persistence/fileAgentContextRepository';
import { JsonDirectoryStore } from '../../infrastructure/mapping/evals/jsonDirectoryStore';
import { EvalRunService } from '../../application/mapping/evals/evalRunService';
import { legacyPromptTemplateBase } from '../../domain/mapping/evals/promptTemplateBase';
import { modelCall } from '../../scripts/evals/from-scratch/model';

const root=path.dirname(new URL(import.meta.url).pathname),dir=path.join(root,'judge-round1');
const read=async(file:string)=>JSON.parse(await readFile(path.join(root,file),'utf8'));
const hash=(s:string)=>createHash('sha256').update(s).digest('hex');
const selection=await read('selection.json'),round=await read('round1-status.json'),generation=await read('round1-config.json');
const config=JSON.parse(await readFile(path.resolve(root,'../codebase-canvas-2026-11-11/config.json'),'utf8'));
const id=(name:string)=>{const h=hash(selection.experimentId+':judge-round1:'+name);return `${h.slice(0,8)}-${h.slice(8,12)}-4${h.slice(13,16)}-a${h.slice(17,20)}-${h.slice(20,32)}`;};
const api=async(route:string,body?:unknown)=>{const r=await fetch('http://127.0.0.1:5191/api/mapping/evals'+route,{...(body?{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)}:{}),signal:AbortSignal.timeout(120000)});const v=await r.json();if(!r.ok)throw Error(`${route}: ${JSON.stringify(v)}`);return v;};
const ledger=new JsonDirectoryStore<any>(config.storeRoot,'eval-runs'),prompts=new JsonDirectoryStore<any>(config.storeRoot,'eval-prompts');
const contexts=new AgentContextLibrary(new FileAgentContextRepository(config.storeRoot));
const controller=new AbortController();process.once('SIGTERM',()=>controller.abort());process.once('SIGINT',()=>controller.abort());
const runId=id('run'),promptId=id('prompt'),cellKey=`${promptId}:1:alternative`;
const state:any={status:'preflight',runId,promptId,model:'gpt-6-astra',effort:'high',scope:'all-four-outputs',startedAt:new Date().toISOString(),pid:process.pid};
const save=()=>writeFile(path.join(dir,'status.json'),JSON.stringify(state,null,2)+'\n');
const immutable=async(file:string,text:string)=>{try{await writeFile(path.join(dir,file),text,{flag:'wx'});}catch(e:any){if(e.code!=='EEXIST')throw e;assert.equal(await readFile(path.join(dir,file),'utf8'),text,`Pinned ${file} changed`);}};
const lock=await open(path.join(dir,'runner.lock'),'wx');await lock.writeFile(JSON.stringify({pid:process.pid}));await lock.close();
let monitor:ReturnType<typeof setInterval>|undefined;
try {
 assert.equal(round.status,'finished');assert.equal(round.jobs.length,4);
 const experiment=await api(`/experiments/${selection.experimentId}`),projectId=experiment.projectId;
 const outputs=[];let generationPrompt='';
 for(const job of round.jobs){
  const run=await api(`/runs/${job.runId}`),cell=run.cells.find((c:any)=>c.key===job.cellKey);
  assert.equal(cell.status,'finished');
  const pinned=run.prompts.find((p:any)=>p.promptId===generation.promptId&&p.version===generation.promptVersion);
  assert.ok(pinned);const text=pinned.stages[cell.stage];assert.equal(hash(text),generation.promptHash);
  if(generationPrompt)assert.equal(text,generationPrompt);generationPrompt=text;
  const expected=JSON.parse(await readFile(path.join(job.jobDir,'validated-output.json'),'utf8'));
  const result=await api(`/runs/${job.runId}/output-result?cell=${encodeURIComponent(job.cellKey)}`);
  const ascii=result.canvases[0].proposed.document.scene.contents[`${job.runId}-central`].content.ascii;
  assert.equal(ascii,expected.ascii);
  outputs.push({caseId:job.pointId,title:job.title,runId:job.runId,cellKey:job.cellKey,ascii,numberedLines:ascii.split('\n').map((text:string,i:number)=>({line:i+1,text}))});
 }
 const input=JSON.stringify({scope:'whole-collection',generationPrompt:{promptId:generation.promptId,version:generation.promptVersion,sha256:generation.promptHash,text:generationPrompt},outputs},null,2);
 const prompt=await readFile(path.join(dir,'judge-prompt.txt'),'utf8');
 await immutable('judge-input.json',input);
 await immutable('inputs.json',JSON.stringify({fingerprint:hash(prompt+'\n'+input),files:{'judge-input.json':{sha256:hash(input),bytes:Buffer.byteLength(input)}}},null,2));
 const context=await contexts.create({requestId:id('context'),name:'C1 · Four-output judge context',group:'C1 prompt style study',description:'Exact generation prompt and all four saved outputs; original repository sources and baseline outputs are excluded.',context:[{type:'text',text:'FILE judge-input.json\n'+input}]});
 const stages={alternative:prompt},now=new Date().toISOString(),version={version:1,createdAt:now,format:'explicit-v1',templateBase:legacyPromptTemplateBase(stages),stages,contentHash:hash(JSON.stringify(stages))};
 const oldPrompt=await prompts.read(promptId);if(oldPrompt)assert.equal(oldPrompt.versions[0].stages.alternative,prompt);else await prompts.save({schemaVersion:1,id:promptId,projectId,workflow:'alternatives',name:'Judge · Prompt-linked critique',description:'One judge reviews all four diagrams together and connects each finding to exact generation-prompt wording.',createdAt:now,updatedAt:now,versions:[version]});
 const request={requestId:runId,workflow:'alternatives',prompts:[{promptId,version:1}],inputs:{context:{agentContextId:context.agentContextId}},passes:1,model:'gpt-6-astra',effort:'high'};
 let run=await ledger.read(runId);
 if(!run){run={schemaVersion:1,id:runId,coordinator:'canvas-discovery',requestHash:hash(JSON.stringify(request)),request,projectId,workflow:'alternatives',agentContextId:context.agentContextId,contextName:context.name,prompts:[{promptId,name:'Judge · Prompt-linked critique',...version}],contexts:{context},inputs:{},status:'queued',createdAt:now,name:'Prompt-linked critique',cells:[{key:cellKey,promptId,promptVersion:1,promptName:'Judge · Prompt-linked critique',pass:1,stage:'alternative',status:'queued',candidateName:'Four-diagram critique'}]};}
 if(run.deletedAt||run.status==='cancelled')throw Error('Cancelled/deleted judge needs a new attempt');
 // Exercise the same Markdown capture and reload methods in disposable storage before generation.
 const temporary=await mkdtemp(path.join(tmpdir(),'c1-judge-preflight-'));
 try{
  const store=new JsonDirectoryStore<any>(temporary,'eval-runs');
  const fixture={...structuredClone(run),status:'queued',cells:[{...run.cells[0],status:'queued'}]};delete fixture.outputResults;delete fixture.cells[0].output;
  await store.save(fixture);
  const service=()=>new EvalRunService({} as any,{} as any,{} as any,{} as any,{} as any,{} as any,store,{} as any);
  const first=service(),markdown=outputs.map(o=>`- ${o.title}\n  - Pinned output: ${o.runId}; ${o.numberedLines.length} lines.\n`).join('\n');
  await first.captureOutputResult(runId,{cellKey,format:'markdown',markdown});first.dispose();
  const reopened=service(),loaded=await reopened.outputResult(runId,cellKey);assert.equal(loaded.format,'markdown');assert.equal((loaded as any).markdown,markdown);reopened.dispose();
  await immutable('preflight.json',JSON.stringify({modelCalls:0,inputHash:hash(input),checks:['four output API texts match saved generations','same pinned prompt verified for every output','Markdown capture','store reopen','output service load','exact Markdown preserved']}));
 }finally{await rm(temporary,{recursive:true,force:true});}
 await ledger.save(run);
 const design={...experiment};for(const key of ['schemaVersion','id','projectId','revision','createdAt','updatedAt','generationReview'])delete design[key];
 if(!design.phases.some((p:any)=>p.id==='judge'))design.phases.push({id:'judge',name:'Judge · Prompt-linked critique',description:'One Astra/high judge reviews all four new diagrams together with their exact generation prompt. Hierarchical bulleted critique connects output evidence to prompt wording. No regeneration.'});
 if(!design.workflow.stages.some((s:any)=>s.id==='critique'))design.workflow.stages.push({id:'critique',name:'Prompt-linked critique',dependsOn:['tree']});
 if(!design.cases.some((c:any)=>c.id==='judge-collection'))design.cases.push({id:'judge-collection',name:'All four generated diagrams',agentContextId:context.agentContextId,contentHash:context.contentHash});
 if(!design.conditions.some((c:any)=>c.id==='prompt-judge'))design.conditions.push({id:'prompt-judge',name:'Astra/high · Collection judge',description:'One critique of all four outputs, grounded in quoted output and prompt evidence.'});
 if(!design.samples.some((s:any)=>s.id===runId))design.samples.push({id:runId,phaseId:'judge',caseId:'judge-collection',conditionId:'prompt-judge',number:1,attempt:1,outputs:[{stageId:'critique',runId,cellKey}]});
 await api('/experiments',{requestId:id('register'),experimentId:experiment.id,expectedRevision:experiment.revision,experiment:design});
 if(run.status!=='finished'){run.status='generating';Object.assign(run.cells[0],{status:'generating',startedAt:new Date().toISOString()});await ledger.save(run);}
 state.status='generating';state.inputHash=hash(input);state.agentContextId=context.agentContextId;await save();console.log('Preflight passed. One Astra/high judge started with all four outputs.');
 monitor=setInterval(()=>{void ledger.read(runId).then(r=>{if(r?.deletedAt||r?.status==='cancelled')controller.abort();}).catch(()=>{});},3000);
 const schema=z.object({markdown:z.string().min(1).max(60000)}).strict();
 const response=await modelCall(dir,prompt,schema,controller.signal),output=schema.parse(response.output);
 assert.match(output.markdown,/^\s*[-*+] /);assert.match(output.markdown,/\n {2,}[-*+] /,'Expected hierarchical bullets');
 await immutable('validated-output.json',JSON.stringify(output,null,2));
 await immutable('critique.md',output.markdown+'\n');
 run=await ledger.read(runId);run.cells[0].usage=response.usage;await ledger.save(run);
 await api(`/runs/${runId}/output-result`,{cellKey,format:'markdown',markdown:output.markdown});
 const confirmed=await api(`/runs/${runId}/output-result?cell=${encodeURIComponent(cellKey)}`);assert.equal(confirmed.format,'markdown');assert.equal(confirmed.markdown,output.markdown);
 assert.equal((await api(`/runs/${runId}`)).status,'finished');
 state.status='finished';state.completedAt=new Date().toISOString();state.outputUrl=`http://localhost:5191/evals?run=${runId}&output=${encodeURIComponent(cellKey)}`;state.markdownSha256=hash(output.markdown);await save();console.log(JSON.stringify(state));
}catch(error){state.status=controller.signal.aborted?'cancelled':'failed';state.error=String(error);await save();const run=await ledger.read(runId);if(run&&run.status!=='finished'){run.status=state.status;run.error=state.error;Object.assign(run.cells[0],{status:state.status,error:state.error});await ledger.save(run);}console.error(error);process.exitCode=1;}finally{if(monitor)clearInterval(monitor);await rm(path.join(dir,'runner.lock'),{force:true});}
