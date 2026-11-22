import { readFile, mkdir, open, rm } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { randomUUID, createHash } from 'node:crypto';
import path from 'node:path';
import { CodexEvalRuntime } from '../../../infrastructure/mapping/evals/evalRuntime';
import { FileCanvasTimeline } from '../../../infrastructure/mapping/history/fileCanvasTimeline';
import { JsonDirectoryStore } from '../../../infrastructure/mapping/evals/jsonDirectoryStore';
import { FileAgentContextRepository } from '../../../infrastructure/core/persistence/fileAgentContextRepository';
import { FileAgentContextSources } from '../../../infrastructure/core/persistence/fileAgentContextSources';
import { DiagramStore } from '../../../infrastructure/core/persistence/store';
import { AgentContextLibrary } from '../../../application/mapping/agent/agentContextLibrary';
import { publishJson } from '../../../infrastructure/core/persistence/immutableRecords';
import { historyPlanSchema, historyFillSchema, validateHistoryPlan, type HistoryPlan, type HistoryStep } from '../../../domain/mapping/history/diagramHistory';
import { canvasInput, controller, materializeHistoryStep, type HistoryCanvasSet } from '../../../application/mapping/history/historyMaterializer';
import { materializeDiagrams } from '../../../application/mapping/rollup/rollUpMaterializer';
import { summarizeEvalOutput } from '../../../domain/mapping/evals/evalOutputResult';
import { sha256 } from '../../../domain/core/sha256';
import { cellKey, type EvalRun } from '../../../domain/mapping/evals/evalRun';
import type { EvalPrompt } from '../../../domain/mapping/evals/evalPrompt';
import type { ExperimentDesign } from '../../../domain/mapping/evals/experiment';
import type { z } from 'zod';
import { preflightHistory } from './preflight';
import { validatedHistorySample } from './sample';

const directory = path.resolve(process.argv[2] ?? 'artifacts/diagram-history-2026-11-10'), mode = process.argv[3];
if (!['history','structure-first'].includes(mode)) throw Error('Usage: run.ts <prepared-directory> history|structure-first');
const read = async (file: string) => JSON.parse(await readFile(path.join(directory, file), 'utf8'));
const config = await read('config.json'), setup = config.experiments[mode], structure = mode === 'structure-first';
const experimentId = setup.experimentId ?? setup.id;
const executionBatchLimit = config.executionBatchLimit ?? 1;
if (!Number.isInteger(executionBatchLimit) || executionBatchLimit < 1) throw Error('Invalid executionBatchLimit');
let activeRunId: string | undefined;
const work = path.join(directory, mode); await mkdir(work, { recursive: true });
const lock = path.join(work, 'runner.lock');
try {
  const old = JSON.parse(await readFile(lock, 'utf8'));
  try { process.kill(old.pid, 0); throw Error(`History runner ${old.pid} is already active`); } catch (e) { if ((e as NodeJS.ErrnoException).code !== 'ESRCH') throw e; }
  await rm(lock);
} catch (e) { if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e; }
const handle = await open(lock, 'wx'); await handle.writeFile(JSON.stringify({pid:process.pid,startedAt:new Date().toISOString()})); await handle.close();
const log = (message: string) => console.log(new Date().toISOString(), mode, message);
const ids = (label: string) => { const s = createHash('sha256').update(setup.id+':'+label).digest('hex'); return `${s.slice(0,8)}-${s.slice(8,12)}-4${s.slice(13,16)}-a${s.slice(17,20)}-${s.slice(20,32)}`; };
const timeline = new FileCanvasTimeline(config.storeRoot), ledger = new JsonDirectoryStore<EvalRun>(config.storeRoot,'eval-runs');
const store = new DiagramStore(config.root, config.storeRoot), sources = new FileAgentContextSources(config.storeRoot, async () => ({kind:'git-worktree',root:config.root}));
const contexts = new AgentContextLibrary(new FileAgentContextRepository(config.storeRoot), sources);
const promptRecord: EvalPrompt = await read(`${mode}-prompt.json`), version = promptRecord.versions.find(v=>v.version===setup.promptVersion)!;
const prompt = {promptId:setup.promptId,version:setup.promptVersion,name:promptRecord.name,...version};
const runtime = new CodexEvalRuntime(true), signal = new AbortController();
process.once('SIGTERM',()=>signal.abort());process.once('SIGINT',()=>signal.abort());
const api = async (route: string, body?: unknown) => {const response=await fetch(`${process.env.EVALS_BASE_URL??'http://127.0.0.1:5191'}/api/mapping/evals${route}`,body===undefined?undefined:{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)});const value=await response.json();if(!response.ok)throw Error(`${route}: ${JSON.stringify(value)}`);return value;};
const git = (...args:string[])=>execFileSync('git',args,{cwd:config.root,encoding:'utf8',maxBuffer:100*1024*1024,stdio:['ignore','pipe','pipe']});
const stateFile=path.join(work,'state.json');
let state:any;try{state=JSON.parse(await readFile(stateFile,'utf8'));}catch(e){if((e as NodeJS.ErrnoException).code!=='ENOENT')throw e;state={status:'starting',batches:{}};}
const saveState=async()=>publishJson(stateFile,{...state,updatedAt:new Date().toISOString(),pid:process.pid});
const artifact = async (step:HistoryStep,set:HistoryCanvasSet,timelineId=setup.id)=>{
  let current;try{current=await timeline.read(timelineId);}catch(e){if((e as NodeJS.ErrnoException).code!=='ENOENT')throw e;}
  const prior=current?.steps.find(s=>s.id===step.id); if(prior)return prior;
  step.canvases=Object.values(set).map(c=>({documentId:c.id,name:c.name,viewId:c.history.canvasViews!.activeViewId!,checkpointId:c.history.headId}));
  await timeline.append(timelineId,config.projectId,current?.revision??0,step,Object.fromEntries(Object.values(set).map(c=>[c.id,c.history])));return step;
};
const restore = async (stepId:string):Promise<HistoryCanvasSet>=>{
  const t=await timeline.read(setup.id),step=t.steps.find(s=>s.id===stepId)!;
  const mapping=structuredClone(config.baseline);
  if(state.plan)for(const batch of (state.plan as HistoryPlan).batches){
    if(stepId==='baseline')break;
    for(const c of batch.changes){mapping[c.canvasId]??={id:`h-${setup.id.slice(0,12)}-${c.canvasId}`,name:c.canvasName,diagramIds:{}};
      for(const d of c.diagrams)if(d.newDiagram)mapping[c.canvasId].diagramIds[d.diagramId]=`h-${setup.id.slice(0,12)}-${c.canvasId}-${d.diagramId}`;}
    if(stepId===`scaffold-${batch.id}`||stepId===`execute-${batch.id}`)break;
  }
  const result:HistoryCanvasSet={};for(const [key,value]of Object.entries(mapping) as [string,any][]){const ref=step.canvases.find(c=>c.documentId===value.id);if(ref)result[key]={...value,history:await timeline.editingHistory(setup.id,ref)};}return result;
};
const makeRun=async(label:string,stage:'plan'|'execute',context:any,name:string)=>{
  const labelWithAttempt=stage==='execute'&&setup.executionAttempt?`${label}-attempt-${setup.executionAttempt}`:label;
  const parentRunId=labelWithAttempt!==label&&(await ledger.read(ids(label)))?ids(label):undefined;
  const id=ids(labelWithAttempt),old=await ledger.read(id);if(old)return old;
  const request={requestId:id,workflow:'diagram-history' as const,prompts:[{promptId:setup.promptId,version:setup.promptVersion}],inputs:{context:{agentContextId:context.agentContextId}},passes:1,model:'gpt-6-astra',effort:'high' as const,...(parentRunId?{parentRunId}:{})};
  const run:EvalRun={schemaVersion:1,id,...(parentRunId?{parentRunId}:{}),coordinator:'diagram-history',requestHash:sha256(JSON.stringify(request)),request,projectId:config.projectId,workflow:'diagram-history',agentContextId:context.agentContextId,contextName:context.name,prompts:[prompt],inputs:{},contexts:{context},status:'queued',createdAt:new Date().toISOString(),name,cells:[{key:cellKey(setup.promptId,1,stage),promptId:setup.promptId,promptVersion:setup.promptVersion,promptName:prompt.name,pass:1,stage,status:'queued'}]};await ledger.save(run);return run;
};
const publishRun=async(run:EvalRun,step:HistoryStep,timelineId=setup.id)=>{
  const result=await timeline.result(timelineId,step.id),cell=run.cells[0];
  Object.assign(cell,{status:'finished',historyArtifact:{timelineId,stepId:step.id},output:summarizeEvalOutput(result),completedAt:new Date().toISOString()});run.status='finished';run.completedAt=cell.completedAt;delete run.error;delete cell.error;await ledger.save(run);
};
const generate=async<T>(run:EvalRun,files:Record<string,unknown>,schema:z.ZodType,validate:(value:unknown)=>T):Promise<T>=>{
  const outFile=path.join(work,`${run.id}-output.json`);
  try{return validate(JSON.parse(await readFile(outFile,'utf8')));}catch(e){if((e as NodeJS.ErrnoException).code!=='ENOENT')throw e;}
  run.status='generating';Object.assign(run.cells[0],{status:'generating',startedAt:new Date().toISOString()});delete run.cells[0].error;await ledger.save(run);
  return validatedHistorySample({
    readSaved: async () => {
      try { return JSON.parse(await readFile(path.join(work,`${run.id}-attempt-1.json`),'utf8')); }
      catch(e) { if((e as NodeJS.ErrnoException).code!=='ENOENT')throw e; }
    },
    generate: async () => {
      log(`${run.name}: model call (single attempt; automatic repair disabled)`);
      const monitor=setInterval(()=>{void ledger.read(run.id).then(saved=>{if(saved?.deletedAt||saved?.status==='cancelled')signal.abort();}).catch(()=>{});},2000);
      try { return await runtime.generate({workflow:'diagram-history',stage:run.cells[0].stage,prompt:prompt.stages[run.cells[0].stage],schema,files,model:'gpt-6-astra',effort:'high',signal:signal.signal}); }
      finally { clearInterval(monitor); }
    },
    save: async generated => {
      await publishJson(path.join(work,`${run.id}-attempt-1.json`),generated);
      run.cells[0].usage=generated.usage;await ledger.save(run);
    },
    validate: raw => validate(raw)
  }).then(async value => {
    const saved=JSON.parse(await readFile(path.join(work,`${run.id}-attempt-1.json`),'utf8'));
    await publishJson(outFile,saved.output);return value;
  });
};
const syncExperiment=async()=>{
  const global=state.globalRun as EvalRun;
  const design:ExperimentDesign={name:`History · ${structure?'structure first':'standard'}`,description:`Same pinned range ${config.base}..${config.head}; full-sequence multi-commit batching, n=1, gpt-6-astra/high. Phase 1 plans upfront${structure?' and emits fixed viewable scaffolds':''}; Phase 2 executes ${executionBatchLimit} multi-commit batch(es) serially, reusing completed steps. ${config.baselineNote} Runner: ${state.status}.`,
    phases:[{id:'phase-1',name:'Phase 1 · Plan',description:structure?'Whole-sequence planning, ordered AgentContexts and pinned blank-rectangle scaffolds.':'Whole-sequence planning and ordered AgentContexts.'},{id:'phase-2',name:executionBatchLimit===1?'Phase 2 · First batch':'Phase 2 · Execute',description:executionBatchLimit===1?'Execute only the first pinned multi-commit range. Later batches are planned but not scheduled.':`Execute all ${executionBatchLimit} planned batches in order, each from the preceding completed canvas state. Finished outputs are reused; every new input state passes storage preflight.`}],
    workflow:{id:'diagram-history',name:'Progressive diagram history',version:1,stages:[{id:'plan',name:'Plan / scaffold',dependsOn:[]},{id:'execute',name:'Execute',dependsOn:['plan']}]},
    cases:[{id:'sequence',name:config.context.name,agentContextId:config.context.agentContextId,contentHash:config.context.contentHash}],conditions:[{id:'condition',name:structure?'Structure first':'Standard planning',description:'One sample per step; astra/high.'}],
    samples:[{id:'planning',phaseId:'phase-1',caseId:'sequence',conditionId:'condition',number:1,attempt:1,outputs:[{stageId:'plan',runId:global.id,cellKey:global.cells[0].key}]}],comparisons:[]};
  for(const batch of state.plan?.batches??[]){const entry=state.batches[batch.id];if(!entry?.context)continue;design.cases.push({id:batch.id,name:batch.title,agentContextId:entry.context.agentContextId,contentHash:entry.context.contentHash});
    for(const stage of ['scaffold','execute']){const run=entry[`${stage}Run`] as EvalRun|undefined;if(!run)continue;design.samples.push({id:`${stage}-${batch.id}`,phaseId:stage==='scaffold'?'phase-1':'phase-2',caseId:batch.id,conditionId:'condition',number:1,attempt:1,outputs:[{stageId:stage==='scaffold'?'plan':'execute',runId:run.id,cellKey:run.cells[0].key}]});}}
  let old;try{old=await api(`/experiments/${experimentId}`);}catch(e){if(!String(e).includes('Experiment not found'))throw e;}
  await api('/experiments',{requestId:old?randomUUID():experimentId,...(old?{experimentId,expectedRevision:old.revision}:{}),experiment:design});
};
try{
  const pinnedSteps=(await timeline.read(setup.id)).steps;
  let preflightedStepId='baseline';
  for(const batch of state.plan?.batches.slice(0,executionBatchLimit)??[]) {
    if(!pinnedSteps.some(s=>s.id===`execute-${batch.id}`))break;
    preflightedStepId=`execute-${batch.id}`;
  }
  const preflightInput=await restore(preflightedStepId);
  log(`Preflight: restoring, editing, saving and reopening ${preflightedStepId} in disposable storage`);
  const preflight=await preflightHistory(timeline,setup.id,preflightInput,preflightedStepId);
  await publishJson(path.join(work,'preflight.json'),{...preflight,checkedAt:new Date().toISOString()});
  log(`Preflight passed for ${preflight.canvases} canvases; no model calls`);
  state.status='planning';delete state.error;state.globalRun=await makeRun('plan','plan',config.context,'Complete sequence plan');activeRunId=state.globalRun.id;await saveState();await syncExperiment();
  let baseline=await restore('baseline');
  if(!state.plan){
    const files:Record<string,unknown>={'context.json':await contexts.read(config.context.agentContextId)};
    for(const file of ['first-batch.json','commits.json','canvases.json','baseline-evidence.json','base-sources.json',...config.commits.map((c:any)=>c.file)])files[file]=await read(file);
    state.plan=await generate(state.globalRun,files,historyPlanSchema,raw=>{
      const plan=validateHistoryPlan(raw,config.commits.map((c:any)=>c.commit),Object.fromEntries(Object.entries(config.baseline).map(([k,v]:[string,any])=>[k,Object.keys(v.diagramIds)])),structure);
      if (JSON.stringify(plan.batches[0].commits) !== JSON.stringify(config.firstBatchCommits)) throw Error('The first batch must match first-batch.json exactly');
      for(const b of plan.batches)for(const p of b.sourcePaths){if(!/^(application|domain|infrastructure|src|scripts|tests)\//.test(p)||p.includes('..'))throw Error(`Invalid source path ${p}`);try{git('cat-file','-e',`${b.commits.at(-1)}:${p}`);}catch{throw Error(`Source ${p} does not exist at batch ${b.id}'s endpoint`);}}
      if(structure){let preview=baseline;for(const b of plan.batches)preview=materializeHistoryStep(preview,b,`h-${setup.id.slice(0,12)}`,'scaffold',undefined,undefined,true);}
      return plan;
    });await publishJson(path.join(work,'plan.json'),state.plan);await saveState();
  }
  const plan:HistoryPlan=state.plan;
  const tree='Progressive diagram history\n'+plan.batches.map((b,i)=>`${i===plan.batches.length-1?'`--':'|--'} ${b.title}\n${b.tree.split('\n').map(l=>'    '+l).join('\n')}`).join('\n');
  const planCanvas:HistoryCanvasSet={plan:{id:`plan-${setup.id}`,name:'Complete ordered update plan',history:materializeDiagrams([{id:'plan',ascii:tree,position:{column:0,row:0}}],[],`plan-${setup.id}`),diagramIds:{plan:`plan-${setup.id}-plan`}}};
  const pc=controller(planCanvas.plan);pc.canvasView(0,{operation:'create',name:'Phase 1 plan'});planCanvas.plan.history=pc.exportHistory();
  const planStep=await artifact({id:'plan',phase:'baseline',title:'Complete ordered plan',commits:config.commits.map((c:any)=>c.commit),agentContextId:config.context.agentContextId,planId:`${state.globalRun.cells[0].promptId}:${state.globalRun.cells[0].promptVersion}`,runId:state.globalRun.id,canvases:[]},planCanvas,`${setup.id}-plan`);
  state.globalRun.cells[0].proposalTree=tree;await publishRun(state.globalRun,planStep,`${setup.id}-plan`);await saveState();
  let scaffold=baseline,previousScaffold='baseline',previousCommit=config.base;
  for(const batch of plan.batches){
    const entry=state.batches[batch.id]??={};
    if(!entry.context){
      const patch=git('diff','--no-ext-diff','--unified=3',previousCommit,batch.commits.at(-1)!,'--','application','domain','infrastructure','src','scripts','tests');
      const blocks:any[]=[{type:'text',text:JSON.stringify({batch,previousCommit,endCommit:batch.commits.at(-1),futureDependencies:batch.futureDependencies,fullPlan:plan})}];
      for(let i=0;i<patch.length;i+=900000)blocks.push({type:'text',text:patch.slice(i,i+900000)});
      for(const p of batch.sourcePaths)blocks.push({type:'sourceFile',sourceId:'repo-ce67f2af4410036fce1ce12f',path:p,revision:batch.commits.at(-1)});
      for(const future of batch.futureDependencies){const file=config.commits.find((c:any)=>c.commit===future.commit).file,ev=await read(file);blocks.push({type:'text',text:JSON.stringify({label:'FUTURE EVIDENCE — not implemented in this batch',commit:future.commit,reason:future.reason,diff:ev.diff}).slice(0,999999)});}
      entry.context=await contexts.create({requestId:ids(`context-${batch.id}`),name:`${mode} · ${batch.title}`.slice(0,120),group:'Diagram history experiments',description:`Commits ${previousCommit}..${batch.commits.at(-1)}. Planned from full sequence; downstream evidence labelled.`,context:blocks});
      await saveState();
    }
    if(structure){
      entry.scaffoldRun=await makeRun(`scaffold-${batch.id}`,'plan',entry.context,`Phase 1 · Scaffold · ${batch.title}`);
      activeRunId=entry.scaffoldRun.id;
      const existing=(await timeline.read(setup.id)).steps.find(s=>s.id===`scaffold-${batch.id}`);
      if(existing)scaffold=await restore(existing.id);
      else {scaffold=materializeHistoryStep(scaffold,batch,`h-${setup.id.slice(0,12)}`,'scaffold',undefined,undefined,true);}
      const step=existing??await artifact({id:`scaffold-${batch.id}`,previousStepId:previousScaffold,phase:'scaffold',title:batch.title,commits:batch.commits,agentContextId:entry.context.agentContextId,planId:`${state.globalRun.cells[0].promptId}:${state.globalRun.cells[0].promptVersion}`,runId:entry.scaffoldRun.id,canvases:[]},scaffold);
      entry.scaffoldRun.cells[0].explanation='Deterministic viewable scaffold from the single Phase 1 plan; no additional model sample.';await publishRun(entry.scaffoldRun,step);previousScaffold=step.id;
    }
    if (plan.batches.indexOf(batch) < executionBatchLimit) entry.executeRun=await makeRun(`execute-${batch.id}`,'execute',entry.context,batch.title);previousCommit=batch.commits.at(-1)!;await saveState();
  }
  state.status='executing';await saveState();await syncExperiment();
  let current=baseline,previousStep='baseline';
  for(const batch of plan.batches.slice(0, executionBatchLimit)){
    signal.signal.throwIfAborted();const entry=state.batches[batch.id],run:EvalRun=await ledger.read(entry.executeRun.id)??entry.executeRun;
    activeRunId=run.id;
    if(run.deletedAt||run.status==='cancelled')throw Error('Execution stopped because a queued step was cancelled or deleted.');
    const existing=(await timeline.read(setup.id)).steps.find(s=>s.id===`execute-${batch.id}`);
    if(existing){current=await restore(existing.id);await publishRun(run,existing);previousStep=existing.id;continue;}
    if(preflightedStepId!==previousStep) {
      log(`Preflight: validating input ${previousStep} before ${batch.id}`);
      const checked=await preflightHistory(timeline,setup.id,current,previousStep);
      await publishJson(path.join(work,`${batch.id}-preflight.json`),{...checked,inputStepId:previousStep,checkedAt:new Date().toISOString()});
      preflightedStepId=previousStep;
    }
    run.historyInput={timelineId:setup.id,stepId:previousStep,batchId:batch.id,...(structure?{scaffoldStepId:`scaffold-${batch.id}`}:{})};await ledger.save(run);
    const pinnedScaffold=structure?await restore(`scaffold-${batch.id}`):undefined;
    // Sources are already supplied separately; avoid expanding them twice.
    const context=await contexts.read(entry.context.agentContextId, false);
    const sourceText=Object.fromEntries(batch.sourcePaths.map(p=>[p,git('show',`${batch.commits.at(-1)}:${p}`)]));
    const files={'context.json':context,'plan.json':plan,'batch.json':batch,'canvases.json':canvasInput(current),'sources.json':{revision:batch.commits.at(-1),files:sourceText},...(pinnedScaffold?{'scaffold.json':canvasInput(pinnedScaffold)}:{})};
    // Save exact file hashes and full input context identities for later independent evals.
    await publishJson(path.join(work,`${batch.id}-inputs.json`),{historyInput:run.historyInput,agentContextId:entry.context.agentContextId,files:Object.fromEntries(Object.entries(files).map(([k,v])=>[k,sha256(JSON.stringify(v))]))});
    const next=await generate(run,files,historyFillSchema,raw=>materializeHistoryStep(current,batch,`h-${setup.id.slice(0,12)}`,'execute',raw,pinnedScaffold,structure));
    const step=await artifact({id:`execute-${batch.id}`,previousStepId:previousStep,phase:'execution',title:batch.title,commits:batch.commits,agentContextId:entry.context.agentContextId,planId:`${state.globalRun.cells[0].promptId}:${state.globalRun.cells[0].promptVersion}`,runId:run.id,canvases:[]},next);
    await publishRun(run,step);entry.executeRun=run;current=next;previousStep=step.id;await saveState();log(`Completed ${batch.id}: ${step.canvases.length} canvases`);
  }
  state.status='finished';await saveState();await syncExperiment();log(`Planning complete; completed ${Math.min(executionBatchLimit,plan.batches.length)} batch(es)`);
}catch(e){state.status='failed';state.error=e instanceof Error?e.message:String(e);await saveState();log(`FAILED: ${state.error}`);
  for(const run of [state.globalRun,...Object.values(state.batches).flatMap((b:any)=>[b.scaffoldRun,b.executeRun])].filter(Boolean) as EvalRun[]){const saved=await ledger.read(run.id);if(saved&&['queued','generating'].includes(saved.status)){const failed=saved.id===activeRunId;saved.status=failed?'failed':'cancelled';saved.error=failed?state.error:'Not attempted: an upstream step failed';for(const cell of saved.cells)if(['queued','generating'].includes(cell.status))Object.assign(cell,{status:failed?'failed':'skipped',error:saved.error});await ledger.save(saved);}}
  if(state.globalRun)try{await syncExperiment();}catch(error){log(String(error));}process.exitCode=1;
}finally{await rm(lock,{force:true});}
