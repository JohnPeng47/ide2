import { readFile, writeFile, mkdir, open, rm } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { AgentContextLibrary } from '../../application/mapping/agent/agentContextLibrary';
import { FileAgentContextRepository } from '../../infrastructure/core/persistence/fileAgentContextRepository';
import { JsonDirectoryStore } from '../../infrastructure/mapping/evals/jsonDirectoryStore';
import { FileCanvasTimeline } from '../../infrastructure/mapping/history/fileCanvasTimeline';
import { publishJson } from '../../infrastructure/core/persistence/immutableRecords';
import { legacyPromptTemplateBase } from '../../domain/mapping/evals/promptTemplateBase';
import { summarizeEvalOutput } from '../../domain/mapping/evals/evalOutputResult';
import { modelCall } from '../../scripts/evals/from-scratch/model';
import { treeSchema, validateTree, single, materialize, preflight } from '../../scripts/evals/from-scratch/artifacts';
import { Mutex } from '../../scripts/evals/from-scratch/concurrency';

const dir=path.dirname(new URL(import.meta.url).pathname);
const read=async(file:string)=>JSON.parse(await readFile(path.join(dir,file),'utf8'));
const hash=(text:string)=>createHash('sha256').update(text).digest('hex');
const selection=await read('selection.json');
const config=JSON.parse(await readFile(path.resolve(dir,'../codebase-canvas-2026-11-11/config.json'),'utf8'));
const id=(label:string)=>{const h=hash(selection.experimentId+':round2:'+label);return `${h.slice(0,8)}-${h.slice(8,12)}-4${h.slice(13,16)}-a${h.slice(17,20)}-${h.slice(20,32)}`;};
const api=async(route:string,body?:unknown)=>{const response=await fetch('http://127.0.0.1:5191/api/mapping/evals'+route,{...(body?{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)}:{}),signal:AbortSignal.timeout(120000)});const value=await response.json();if(!response.ok)throw Error(`${route}: ${JSON.stringify(value)}`);return value;};
const ledger=new JsonDirectoryStore<any>(config.storeRoot,'eval-runs');
const prompts=new JsonDirectoryStore<any>(config.storeRoot,'eval-prompts');
const contexts=new AgentContextLibrary(new FileAgentContextRepository(config.storeRoot));
const timeline=new FileCanvasTimeline(config.storeRoot);
const abort=new AbortController();process.once('SIGTERM',()=>abort.abort());process.once('SIGINT',()=>abort.abort());
const lock=await open(path.join(dir,'round2.lock'),'wx');await lock.writeFile(JSON.stringify({pid:process.pid}));await lock.close();
const mutex=new Mutex();
const state:any={status:'preflight',model:'gpt-6-astra',effort:'high',passes:1,concurrency:4,jobs:[],pid:process.pid,startedAt:new Date().toISOString()};
const save=async()=>{const release=await mutex.acquire();try{await publishJson(path.join(dir,'round2-status.json'),state);}finally{release();}};
const log=(message:string)=>console.log(new Date().toISOString(),message);
try {
 const experiment=await api(`/experiments/${selection.experimentId}`),projectId=experiment.projectId;
 const prompt=await readFile(path.join(dir,'round2/prompt.txt'),'utf8');
 const changes=await read('round2/prompt-change.json');
 if(hash(prompt)!==changes.promptSha256)throw Error('Prompt hash differs from prepared variation');
 const parent=await prompts.read(changes.parent.promptId);
 const parentText=parent?.versions.find((v:any)=>v.version===changes.parent.version)?.stages.alternative;
 if(!parentText||hash(parentText)!==changes.parent.sha256)throw Error('Pinned parent prompt differs');
 const prefix='Example 1:',suffix='Use the examples as a varied pool';
 if(prompt.slice(0,prompt.indexOf(prefix))!==parentText.slice(0,parentText.indexOf(prefix))||prompt.slice(prompt.indexOf(suffix))!==parentText.slice(parentText.indexOf(suffix)))throw Error('Instructions outside few-shot examples changed');
 const references:any={};
 for(const example of changes.examples){
  const ascii=(await readFile(path.join(dir,'round2',example.file),'utf8')).trimEnd();
  if(hash(ascii)!==example.sha256)throw Error('Few-shot text changed');validateTree(ascii);
  if(!prompt.includes(ascii))throw Error('Few-shot example missing from prompt');
  references[example.file.replace('.txt','')]={name:example.file==='compiler.txt'?'Incremental compiler · 51 lines':'Telemetry ingestion · 106 lines',ascii,comment:'Synthetic style example, included verbatim in the generation prompt; not repository evidence.'};
 }
 const promptId=id('prompt'),stages={alternative:prompt};
 const pinned={version:1,createdAt:new Date().toISOString(),format:'explicit-v1',templateBase:legacyPromptTemplateBase(stages),stages,contentHash:hash(JSON.stringify(stages)),derivation:{parent:{promptId:changes.parent.promptId,version:changes.parent.version},kind:'variation',dimension:{id:'c1-fewshot-set',name:'Few-shot examples',value:'Two integrated diagrams: shortened compiler and telemetry ingestion'}},parents:[{promptId:changes.parent.promptId,version:changes.parent.version,relation:'variation'}]};
 const existingPrompt=await prompts.read(promptId);
 if(existingPrompt&&existingPrompt.versions[0].stages.alternative!==prompt)throw Error('Pinned prompt changed');
 if(!existingPrompt)await prompts.save({schemaVersion:1,id:promptId,projectId,workflow:'alternatives',name:'C1 · Two larger examples',description:'Phase 1 prompt with only its six few-shot examples replaced by a shortened compiler diagram and the telemetry diagram.',createdAt:pinned.createdAt,updatedAt:pinned.createdAt,versions:[pinned]});
 await publishJson(path.join(dir,'round2-prompt.json'),{promptId,...pinned});
 for(const selected of selection.selectedCases){
  const context=await contexts.read(selected.agentContextId);
  if(context.contentHash!==selected.contextContentHash)throw Error(`Context changed: ${selected.pointId}`);
  const blocks=context.snapshot.messages.flatMap(m=>m.content);
  if(context.snapshot.messages.length!==1||blocks.some(b=>b.type!=='text'))throw Error('Unexpected saved context structure');
  const body=blocks.map(b=>b.type==='text'?b.text:'').join('');
  if(!body.startsWith('FILE context.json\n'))throw Error('Missing saved input file');
  const input=body.slice('FILE context.json\n'.length);
  if(hash(input)!==selected.contextFileSha256)throw Error(`Saved context differs from baseline input: ${selected.pointId}`);
  if(Buffer.byteLength(body)>16*1024*1024)throw Error('Context exceeds limit');
  const runId=id(selected.pointId),jobDir=path.join(dir,'jobs',runId);await mkdir(jobDir,{recursive:true});
  const fingerprint=hash(JSON.stringify({prompt,contextHash:context.contentHash,model:state.model,effort:state.effort}));
  await publishJson(path.join(jobDir,'inputs.json'),{fingerprint,agentContextId:context.agentContextId,contentHash:context.contentHash,files:{'context.json':{sha256:hash(input),bytes:Buffer.byteLength(input)}}});
  const previousInput=await readFile(path.join(jobDir,'context.json'),'utf8').catch(()=>undefined);
  if(previousInput!==undefined&&previousInput!==input)throw Error('Pinned input changed');
  if(previousInput===undefined)await writeFile(path.join(jobDir,'context.json'),input,{flag:'wx'});
  const baseline=await read(`cases/${selected.pointId}/validated-output.json`);validateTree(baseline.ascii);
  await publishJson(path.join(jobDir,'preflight.json'),await preflight(single(baseline.ascii),projectId,fingerprint));
  const baselineRun=await ledger.read(selected.runId);
  if(!baselineRun)throw Error('Missing baseline run');
  const cellKey=`${promptId}:1:alternative`;
  const request={requestId:runId,workflow:'alternatives',prompts:[{promptId,version:1}],inputs:{context:{agentContextId:selected.agentContextId}},passes:1,model:'gpt-6-astra',effort:'high'};
  let run=await ledger.read(runId);
  if(!run){run={schemaVersion:1,id:runId,coordinator:'canvas-discovery',requestHash:hash(JSON.stringify(request)),request,projectId,workflow:'alternatives',agentContextId:selected.agentContextId,contextName:context.name,prompts:[{promptId,name:'C1 · Two larger examples',...pinned,references}],inputs:{},contexts:baselineRun.contexts,status:'queued',createdAt:new Date().toISOString(),name:`Two examples · ${selected.title}`,cells:[{key:cellKey,promptId,promptVersion:1,promptName:'C1 · Two larger examples',pass:1,stage:'alternative',status:'queued',candidateName:selected.title}]};await ledger.save(run);}
  if(run.status==='cancelled'||run.deletedAt)throw Error('Cancelled/deleted run requires a new attempt');
  state.jobs.push({...selected,runId,cellKey,jobDir,prompt:{promptId,version:1,stage:'alternative',sha256:hash(prompt)},status:run.status,fingerprint});
 }
 log('All four saved AgentContexts match baseline hashes; storage preflight passed. Zero model calls so far.');
 const design={...experiment};for(const key of ['schemaVersion','id','projectId','revision','createdAt','updatedAt','generationReview'])delete design[key];
 design.description='Two phases compare diagram prompting on four unchanged pinned C1 AgentContexts. Phase 1 retains the original baselines, the six-example 3+1/60-40 generations, and their collection critique. Phase 2 replaces only the few-shot block with two larger examples: a 51-line compiler and unchanged 106-line telemetry diagram. Astra/high, one new generation per case, four concurrent calls.';
 design.phases=[
  {id:'prompt-trial',name:'Phase 1 · Initial prompt study',description:'Previous work: four original C1 baseline references, four generations adding the verbatim 3+1 model and 60/40 wording with six short examples, and the saved collection critique.'},
  {id:'fewshot-trial',name:'Phase 2 · Two larger examples',description:'Four new generations using the same AgentContexts and Phase 1 instructions. Only the six-example block changes: 51-line compiler organized around dependency reuse, plus unchanged 106-line telemetry. Compare against Phase 1 six-example outputs. Open the variant prompt to inspect both pinned example texts.'}
 ];
 design.samples=design.samples.map((sample:any)=>({...sample,phaseId:sample.phaseId==='fewshot-trial'?'fewshot-trial':'prompt-trial'}));
 design.comparisons=design.comparisons.map((comparison:any)=>({...comparison,phaseId:comparison.phaseId==='fewshot-trial'?'fewshot-trial':'prompt-trial'}));
 design.conditions=design.conditions.map((c:any)=>c.id==='model-ratio'?{...c,name:'Six short examples · 3+1 and 60/40'}:c.id==='prompt-judge'?{...c,name:'Previous collection critique'}:c);
 if(!design.conditions.some((c:any)=>c.id==='two-examples'))design.conditions.push({id:'two-examples',name:'Two larger examples',description:'Replaces six short examples with a 51-line compiler and 106-line telemetry diagram. Same 3+1 model, 60/40 wording, usage guidance, output contract, contexts and model settings. Both examples are inspectable in the pinned prompt.'});
 for(const job of state.jobs)if(!design.samples.some((s:any)=>s.id===job.runId))design.samples.push({id:job.runId,phaseId:'fewshot-trial',caseId:job.pointId,conditionId:'two-examples',number:1,attempt:1,outputs:[{stageId:'tree',runId:job.runId,cellKey:job.cellKey}]});
 await publishJson(path.join(dir,'round2','experiment-before.json'),experiment);
 const updated=await api('/experiments',{requestId:id('register-round:'+experiment.revision),experimentId:experiment.id,expectedRevision:experiment.revision,experiment:design});
 await publishJson(path.join(dir,'round2','experiment-registered.json'),updated);
 await publishJson(path.join(dir,'round2-config.json'),{experimentId:experiment.id,promptId,promptVersion:1,promptHash:hash(prompt),model:state.model,effort:state.effort,concurrency:4,passes:1});
 if(process.argv.includes('--prepare-only')){state.status='ready';await save();log('Prepared and registered. No model calls made.');}else{
 state.status='generating';await save();
 const results=await Promise.allSettled(state.jobs.map(async(job:any)=>{
  const run=await ledger.read(job.runId);if(!run)throw Error('Missing run');
  const monitor=setInterval(()=>{void ledger.read(run.id).then(r=>{if(r?.status==='cancelled'||r?.deletedAt)abort.abort();}).catch(()=>{});},3000);
  try{
   if(run.status!=='finished'){
    run.status='generating';Object.assign(run.cells[0],{status:'generating',startedAt:new Date().toISOString()});await ledger.save(run);
    job.status='generating';await save();log(`${job.title}: Astra/high started`);
   }
   const response=await modelCall(job.jobDir,prompt,treeSchema,abort.signal);
   const output=treeSchema.parse(response.output);validateTree(output.ascii);
   await publishJson(path.join(job.jobDir,'validated-output.json'),output);
   await publishJson(path.join(job.jobDir,'output-preflight.json'),await preflight(single(output.ascii),projectId,hash(output.ascii)));
   const existing=await timeline.read(job.runId).catch((e:any)=>{if(e.code!=='ENOENT')throw e;});
   if(!existing){const history=materialize(single(output.ascii),job.runId),ref={documentId:job.runId,name:job.title,viewId:history.canvasViews!.activeViewId!,checkpointId:history.headId};await timeline.append(job.runId,projectId,0,{id:'output',phase:'execution',title:job.title,commits:[],agentContextId:job.agentContextId,planId:promptId,runId:job.runId,canvases:[ref]},{[job.runId]:history});}
   const result=await timeline.result(job.runId,'output');
   run.status='finished';run.completedAt=new Date().toISOString();delete run.error;
   Object.assign(run.cells[0],{status:'finished',historyArtifact:{timelineId:job.runId,stepId:'output'},output:summarizeEvalOutput(result),usage:response.usage,completedAt:run.completedAt});delete run.cells[0].error;await ledger.save(run);
   const loaded=await api(`/runs/${job.runId}/output-result?cell=${encodeURIComponent(job.cellKey)}`);
   if(loaded.canvases?.length!==1||loaded.canvases[0].proposed.document.scene.contents[`${job.runId}-central`]?.content.ascii!==output.ascii)throw Error('API output does not match generated text');
   job.status='finished';job.lines=output.ascii.split('\n').length;job.confirmedAt=new Date().toISOString();await save();log(`${job.title}: saved, reopened and API-confirmed (${job.lines} lines)`);
  }catch(error){job.status=abort.signal.aborted?'cancelled':'failed';job.error=String(error);abort.abort();if(run.status!=='finished'){run.status=job.status;run.error=job.error;Object.assign(run.cells[0],{status:job.status,error:job.error,completedAt:new Date().toISOString()});await ledger.save(run);}await save();throw error;}finally{clearInterval(monitor);}
 }));
 state.status=results.every(r=>r.status==='fulfilled')?'finished':'failed';state.completedAt=new Date().toISOString();await save();
 log(`Round ${state.status}: ${state.jobs.filter((j:any)=>j.status==='finished').length}/4 outputs confirmed.`);
 if(state.status!=='finished')process.exitCode=1;
 }
}catch(error){state.status='failed';state.error=String(error);await save();console.error(error);process.exitCode=1;}finally{await rm(path.join(dir,'round2.lock'),{force:true});}
