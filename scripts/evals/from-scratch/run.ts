import { readFile, writeFile, mkdir, open, rm, copyFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { z } from 'zod';
import { DiagramStore } from '../../../infrastructure/core/persistence/store';
import { JsonDirectoryStore } from '../../../infrastructure/mapping/evals/jsonDirectoryStore';
import { AgentContextLibrary } from '../../../application/mapping/agent/agentContextLibrary';
import { FileAgentContextRepository } from '../../../infrastructure/core/persistence/fileAgentContextRepository';
import { FileCanvasTimeline } from '../../../infrastructure/mapping/history/fileCanvasTimeline';
import { publishJson } from '../../../infrastructure/core/persistence/immutableRecords';
import { experimentDesignSchema, type ExperimentDesign } from '../../../domain/mapping/evals/experiment';
import type { StoredExperiment } from '../../../application/mapping/evals/experimentService';
import { type EvalRun, cellKey } from '../../../domain/mapping/evals/evalRun';
import type { EvalPrompt, PromptDerivation } from '../../../domain/mapping/evals/evalPrompt';
import { summarizeEvalOutput } from '../../../domain/mapping/evals/evalOutputResult';
import { legacyPromptTemplateBase } from '../../../domain/mapping/evals/promptTemplateBase';
import { modelCall } from './model';
import { fixtureOutput } from './fixtures';
import { Mutex, Pool, allSettledOrThrow } from './concurrency';
import { originalDiscovery, modelDescription, authorPrompt, discoveryWrapper, treePrompt, expansionPrompt, selectionPrompt, critiquePrompt, feedbackPrompt } from './prompts';
import { discoverySchema, treeSchema, authorSchema, selectionSchema, critiqueSchema, canvasSchema, validateDiscovery, validateCanvas, validateTree, materialize, single, report, preflight, type Discovery, type Canvas } from './artifacts';

const directory=path.resolve(process.argv[2]??'artifacts/codebase-canvas-2026-11-11');
const verifyOnly=process.argv.includes('--verify');
const hash=(value:string)=>createHash('sha256').update(value).digest('hex');
const read=async(file:string)=>JSON.parse(await readFile(path.join(directory,file),'utf8'));
const exists=async(file:string)=>{try{return JSON.parse(await readFile(file,'utf8'));}catch(e){if((e as NodeJS.ErrnoException).code!=='ENOENT')throw e;return undefined;}};
const config=await read('config.json'),index=await read('source-index.json');
const retryPlan=await exists(path.join(directory,'retry-plan.json'))??{};
const executionKey=(logical:string)=>retryPlan[logical]?`${logical}/retry-${retryPlan[logical].attempt}`:logical;
if(config.fixture && (!directory.startsWith('/tmp/canvas-discovery-smoke-') || !config.storeRoot.startsWith(directory+'/')))throw Error('Fixtures require isolated disposable storage');
const id=(label:string)=>{const h=hash(config.id+':'+label);return `${h.slice(0,8)}-${h.slice(8,12)}-4${h.slice(13,16)}-a${h.slice(17,20)}-${h.slice(20,32)}`;};
const store=new DiagramStore(config.root,config.storeRoot),project=config.fixture?{id:'smoke-project'}:await store.loadProject();if(!project)throw Error('Project unavailable');
const ledger=new JsonDirectoryStore<EvalRun>(config.storeRoot,'eval-runs');
const prompts=new JsonDirectoryStore<EvalPrompt>(config.storeRoot,'eval-prompts');
const experiments=new JsonDirectoryStore<StoredExperiment>(config.storeRoot,'eval-experiments');
const contexts=new AgentContextLibrary(new FileAgentContextRepository(config.storeRoot));
const timeline=new FileCanvasTimeline(config.storeRoot);
const signal=new AbortController();process.once('SIGINT',()=>signal.abort());process.once('SIGTERM',()=>signal.abort());
const log=(message:string)=>console.log(new Date().toISOString(),message);
const sourceMap=new Map<string,{path:string;text:string}>();
if(hash(await readFile(path.join(directory,'source-index.json'),'utf8'))!==config.sourceIndexSha256)throw Error('Source inventory changed');
for(const entry of index.files){const source=await read(`sources/${entry.file}`);if(source.path!==entry.path||hash(source.text)!==entry.sha256)throw Error(`Pinned source changed: ${entry.path}`);sourceMap.set(entry.path,source);}
const sourcePaths=new Set(sourceMap.keys());
const examples=JSON.parse(await readFile(path.join(config.root,'artifacts/synthetic-fewshot-examples-2026-11-10/examples.json'),'utf8'));
const expansionParent=JSON.parse(await readFile(path.join(config.root,'artifacts/shopify-canvas-expansion-2026-11-07/parent-prompt.json'),'utf8'));
// Pin supporting artifacts once; subsequent starts use the pinned copies exclusively.
for(const [file,value]of [['examples.json',examples],['expansion-parent.json',expansionParent]] as const){if(!await exists(path.join(directory,file)))await writeFile(path.join(directory,file),JSON.stringify(value,null,2),{flag:'wx'});}
const pinnedExamples=await read('examples.json'),pinnedParent=await read('expansion-parent.json');
const expansionTask=pinnedParent.stages.alternative.split('<task>')[1].split('</task>')[0];
const textTree=(title:string,paths:string[])=>`${title.replace(/[^\x20-\x7e]/g,'?')}\n`+paths.map((p,i)=>`${i===paths.length-1?'`--':'|--'} ${p}`).join('\n');
const probe:Canvas={explanation:'Deterministic probe from the actual pinned source inventory; not a model generation.',diagrams:[{id:'central',ascii:textTree('Pinned source',[index.files[0].path]),position:{column:0,row:0}},{id:'detail',ascii:textTree('Pinned source',[index.files.at(-1).path]),position:{column:400,row:0}}],edges:[{source:{diagram:'central',line:2},target:{diagram:'detail',line:1},label:'storage probe'}]};
await publishJson(path.join(directory,'preflight.json'),await preflight(probe,project.id,config.sourceIndexSha256));
log(`Pinned-input preflight passed: ${index.files.length} source files; no model calls.`);
if(verifyOnly){process.exit(0);}

const lock=path.join(directory,'runner.lock');
const oldLock=await exists(lock);if(oldLock){try{process.kill(oldLock.pid,0);throw Error(`Runner ${oldLock.pid} is already active`);}catch(e){if((e as NodeJS.ErrnoException).code!=='ESRCH')throw e;}await rm(lock);}
const owner=await open(lock,'wx');await owner.writeFile(JSON.stringify({pid:process.pid,at:new Date().toISOString()}));await owner.close();
let state=await exists(path.join(directory,'state.json'))??{status:'prepared',jobs:[],initial:{},branches:{}};
if(state.error){state.previousFailure=state.error;delete state.error;}
const save=async()=>publishJson(path.join(directory,'state.json'),{...state,pid:process.pid,updatedAt:new Date().toISOString()});
const jobs=state.jobs as {key:string;logicalKey?:string;attempt?:number;name:string;phase:string;condition:string;runId:string;caseId:string;context:any;stage:string;round:number;dependencies:string[];supersededReason?:string}[];
const mutationMutex=new Mutex(), pool=new Pool(Number(process.env.CANVAS_MODEL_CONCURRENCY??config.concurrency??4));
let stopError:unknown;
state.activeJobs=[];delete state.failedJob;delete state.failedError;
const refreshActive=()=>{state.activeJob=state.activeJobs[0];if(!state.activeJob)delete state.activeJob;state.status=state.activeJobs.length?'generating':'running';};
const phases=[{id:'phase-1',name:'Phase 1 · Identify epicenters',description:'Astra/high authors two variations, then three discovery conditions inspect the same pinned codebase. n=1 each; select important points rather than full coverage.'},{id:'phase-2',name:'Phase 2 · Generate trees',description:'Six conditions share three discovery outputs. One tree per point; paired minimal and verbatim 3+1 prompts use identical six synthetic examples.'},{id:'phase-3',name:'Phase 3 · Expand canvases',description:'Each seed and its backing source produce one connected central/peripheral canvas using the pinned extension task.'},{id:'phase-4',name:'Phase 4 · Judge and improve',description:'One selection judge chooses two variants. Each gets three independent phase-targeted branches, three critique/regeneration rounds per branch. Every judge evaluates the complete phase output and all final canvases for one variant. Exactly 18 phase critiques: two variants, three target phases, three rounds. No fourth terminal judge.'},...(jobs.some(j=>j.supersededReason)?[{id:'superseded-attempts',name:'Superseded attempts',description:'Archive of the incorrectly scoped per-point judges. Retained for provenance and cost accounting; excluded from the corrected Phase 4 improvement branches.'}]:[])];
async function sync() {
  if(!jobs.length)return;
  const old=await experiments.read(config.id),conditions=[...new Set(jobs.map(j=>j.condition))];
  const design:ExperimentDesign={name:'Codebase canvas discovery',description:`Pinned working-tree source at HEAD ${index.head}; ${index.files.length} files. All generation, prompt authoring and judges: gpt-6-astra/high, n=1. Six initial variants; judge selects two for three rounds at each phase. Status: ${state.status}.${state.error?' '+state.error:''}`,phases,
    workflow:{id:'canvas-discovery',name:'Codebase to canvases',version:1,stages:[{id:'author',name:'Prompt variations',dependsOn:[]},{id:'discover',name:'Selected points',dependsOn:[]},{id:'tree',name:'Single tree',dependsOn:['discover']},{id:'expand',name:'Expanded canvas',dependsOn:['tree']},{id:'select',name:'Select two variants',dependsOn:['expand']},{id:'critique',name:'Improvement critique',dependsOn:['expand']}]},
    cases:jobs.map(j=>({id:j.caseId,name:j.supersededReason?`Superseded · ${j.name}`.slice(0,120):j.name,agentContextId:j.context.agentContextId,contentHash:j.context.contentHash})),
    conditions:conditions.map(c=>({id:c,name:c,description:c.includes('-improve-')?'Independent feedback branch; upstream initial results remain frozen.':'Pinned initial condition; Astra/high.'})),
    samples:jobs.map(j=>({id:j.runId,phaseId:j.phase,caseId:j.caseId,conditionId:j.condition,number:1,attempt:j.attempt??1,outputs:[{stageId:j.stage,runId:j.runId,cellKey:cellKey(id(`prompt:${j.key}`),1,'alternative')}]})),comparisons:[]};
  experimentDesignSchema.parse(design);
  const now=new Date().toISOString();
  await experiments.save({...design,schemaVersion:1,id:config.id,projectId:project!.id,revision:(old?.revision??0)+1,createdAt:old?.createdAt??now,updatedAt:now,lastRequest:{id:id(`sync:${jobs.length}:${now}`),hash:hash(JSON.stringify(design))}});
  // A richer file-based tree retains exact dependencies/rounds alongside the existing UI records.
  const lines=['Codebase canvas discovery',...phases.flatMap(p=>[`|-- ${p.name}`,...jobs.filter(j=>j.phase===p.id).map(j=>`|   |-- ${j.condition} / ${j.name} [${state.results?.[j.key]?'finished':state.activeJob===j.key?state.status:state.activeJobs?.includes(j.key)?'generating':state.failedJob===j.key?'failed':'queued'}]`)])];
  await writeFile(path.join(directory,'overview.txt'),lines.join('\n')+'\n');
}
async function registerPrompt(key:string,name:string,text:string,parent?:{promptId:string;version:number},kind:PromptDerivation['kind']='variation') {
  const promptId=id(`prompt:${key}`),previous=await prompts.read(promptId);
  if(previous){if(previous.versions[0].stages.alternative!==text)throw Error('Pinned prompt changed');return previous;}
  const stages={alternative:text},now=new Date().toISOString();
  const derivation=parent?{parent,kind,dimension:kind==='variation'?{id:'canvas-discovery-prompt',name:'Prompt condition',value:name}:undefined}:undefined;
  const record:EvalPrompt={schemaVersion:1,id:promptId,projectId:project!.id,workflow:'alternatives',name:name.slice(0,120),createdAt:now,updatedAt:now,description:'Pinned from-scratch experiment prompt. All instructions and inputs are explicit.',versions:[{version:1,createdAt:now,format:'explicit-v1',templateBase:legacyPromptTemplateBase(stages),stages,contentHash:hash(JSON.stringify(stages)),...(derivation?{derivation,parents:[{...parent!,relation:kind}]}:{})}]};
  await prompts.save(record);return record;
}
async function runJob<T>(args:{key:string;name:string;stage:string;phase:string;condition:string;prompt:string;schema:z.ZodType<T>;files:Record<string,unknown>;sourceFiles?:boolean;validate?:(v:T)=>T;display:(v:T)=>Canvas;preflightCanvas?:Canvas;parentPrompt?:{promptId:string;version:number};round?:number;dependencies?:string[];critiqueKey?:string}) :Promise<T> {
  let release:(()=>void)|undefined=await mutationMutex.acquire();
  const unlock=()=>{release?.();release=undefined;};
  const relock=async()=>{if(!release)release=await mutationMutex.acquire();};
  let localRun:EvalRun|undefined;
  try {
  if(stopError)throw stopError;
  const logicalKey=args.key,recovery=retryPlan[logicalKey];
  const dependencies=[...new Set([...(args.dependencies??[]),...('critique.json' in args.files?[args.critiqueKey??logicalKey.slice(0,logicalKey.lastIndexOf('/'))+'/judge']:[]),...(args.stage==='discover'&&!args.round?['author']:[])])].map(executionKey);
  if(recovery)args={...args,key:executionKey(logicalKey),name:`${args.name} · Attempt ${recovery.attempt}`.slice(0,120),
    prompt:args.prompt+'\n\nRECOVERY ATTEMPT\nRead recovery.json for the previous attempt\'s execution or validation failure and any saved response. Produce a corrected complete response under the same task and output contract. Treat the previous response as a candidate, not source evidence. The original attempt remains saved.',
    files:{...args.files,'recovery.json':recovery.feedback},parentPrompt:{promptId:id(`prompt:${recovery.previousExecutionKey}`),version:1}};
  signal.signal.throwIfAborted();const dir=path.join(directory,'jobs',id(args.key));await mkdir(dir,{recursive:true});
  const files={...args.files};
  if(args.sourceFiles){files['source-index.json']=index;for(const entry of index.files)files[entry.file]=sourceMap.get(entry.path);}
  const serialized=Object.entries(files).map(([name,value])=>({name,content:JSON.stringify(value)}));
  const manifest=Object.fromEntries(serialized.map(f=>[f.name,{sha256:hash(f.content),bytes:Buffer.byteLength(f.content)}]));
  const fingerprint=hash(JSON.stringify({prompt:args.prompt,manifest,model:config.model,effort:config.effort}));
  const prior=await exists(path.join(dir,'inputs.json'));if(prior&&prior.fingerprint!==fingerprint)throw Error(`Pinned inputs changed: ${args.key}`);
  if(!prior){for(const f of serialized)await writeFile(path.join(dir,f.name),f.content,{flag:'wx'});await writeFile(path.join(dir,'inputs.json'),JSON.stringify({fingerprint,files:manifest,dependencies,round:args.round??0},null,2),{flag:'wx'});}
  const prompt=await registerPrompt(args.key,args.name,args.prompt,args.parentPrompt,args.round||recovery?'relaunch':'variation');
  let entry=jobs.find(j=>j.key===args.key);
  if(!entry){
    const body=serialized.map(f=>`FILE ${f.name}\n${f.content}`).join('\n\n');
    if(Buffer.byteLength(body)>16*1024*1024)throw Error('Inputs exceed AgentContext limit');
    const blocks=[];for(let i=0;i<body.length;i+=900000)blocks.push({type:'text',text:body.slice(i,i+900000)});
    const context=await contexts.create({requestId:id(`context:${args.key}`),name:args.name.slice(0,120),group:'Codebase canvas discovery',description:`Exact model input files; ${fingerprint}. Raw response and prompt under ${dir}.`,context:blocks});
    entry={key:args.key,logicalKey,attempt:recovery?.attempt??1,name:args.name,phase:args.phase,condition:args.condition,runId:id(args.key),caseId:id(`case:${args.key}`),context,stage:args.stage,round:args.round??0,dependencies};jobs.push(entry);await save();
  }
  let run=await ledger.read(entry.runId);
  if(!run){const request={requestId:entry.runId,workflow:'alternatives' as const,prompts:[{promptId:prompt.id,version:1}],inputs:{context:{agentContextId:entry.context.agentContextId}},passes:1,model:config.model,effort:'high' as const};run={schemaVersion:1,id:entry.runId,coordinator:'canvas-discovery',requestHash:hash(JSON.stringify(request)),request,projectId:project!.id,workflow:'alternatives',agentContextId:entry.context.agentContextId,contextName:entry.context.name,prompts:[{promptId:prompt.id,version:1,name:prompt.name,...prompt.versions[0]}],inputs:{},contexts:{context:entry.context},status:'queued',createdAt:new Date().toISOString(),name:args.name,cells:[{key:cellKey(prompt.id,1,'alternative'),promptId:prompt.id,promptVersion:1,promptName:prompt.name,pass:1,stage:'alternative',status:'queued',candidateName:args.name}]};await ledger.save(run);}
  if(run.deletedAt||run.status==='cancelled')throw Error(`Run cancelled or deleted: ${args.key}`);
  if(recovery&&!run.parentRunId){run.parentRunId=id(logicalKey);run.request.parentRunId=id(logicalKey);run.requestHash=hash(JSON.stringify(run.request));await ledger.save(run);}
  localRun=run;
  if(run.status==='finished'&&state.results?.[args.key]){const saved=await exists(path.join(dir,'response.json'));if(!saved)throw Error(`Finished run lacks raw response: ${args.key}`);const parsed=args.schema.parse(saved.output);return args.validate?args.validate(parsed):parsed;}
  state.activeJobs.push(args.key);state.maxActiveJobs=Math.max(state.maxActiveJobs??0,state.activeJobs.length);
  state.activeJob=args.key;state.status='preflight';await save();await sync();
  await publishJson(path.join(dir,'preflight.json'),await preflight(args.preflightCanvas??probe,project!.id,fingerprint));
  let response=await exists(path.join(dir,'response.json'));
  if(!response){
    state.status='generating';run.status='generating';Object.assign(run.cells[0],{status:'generating',startedAt:new Date().toISOString()});delete run.error;delete run.cells[0].error;await ledger.save(run);await save();await sync();
    log(`${args.name}: ${config.fixture?'deterministic fixture (zero model calls)':'Astra/high model call; n=1, automatic repair disabled'}`);
    const monitor=setInterval(()=>{void ledger.read(run!.id).then(r=>{if(r?.deletedAt||r?.status==='cancelled')signal.abort();}).catch(()=>{});},3000);
    unlock();
    try{if(config.fixture){if(config.fixtureDelayMs)await new Promise(resolve=>setTimeout(resolve,config.fixtureDelayMs));response={output:config.fixtureFailureKey===logicalKey&&!recovery?{invalid:'intentional fixture failure'}:fixtureOutput(args.stage,files,config.fixturePointCount??1)};await writeFile(path.join(dir,'response.json'),JSON.stringify(response),{flag:'wx'});}else response=await modelCall(dir,args.prompt,args.schema,signal.signal);}finally{clearInterval(monitor);await relock();}
  }
  const parsed=args.schema.parse(response.output),value=args.validate?args.validate(parsed):parsed;
  state.status='materializing';await save();
  const canvas=args.display(value);await preflight(canvas,project!.id,hash(JSON.stringify(value)));
  let existing;try{existing=await timeline.read(entry.runId);}catch(e){if((e as NodeJS.ErrnoException).code!=='ENOENT')throw e;}
  if(!existing){const history=materialize(canvas,entry.runId),ref={documentId:entry.runId,name:args.name,viewId:history.canvasViews!.activeViewId!,checkpointId:history.headId};await timeline.append(entry.runId,project!.id,0,{id:'output',phase:'execution',title:args.name,commits:[],agentContextId:entry.context.agentContextId,planId:prompt.id,runId:entry.runId,canvases:[ref]},{[entry.runId]:history});}
  const result=await timeline.result(entry.runId,'output');
  Object.assign(run.cells[0],{status:'finished',historyArtifact:{timelineId:entry.runId,stepId:'output'},output:summarizeEvalOutput(result),explanation:canvas.explanation,usage:response.usage,completedAt:new Date().toISOString()});run.status='finished';run.completedAt=run.cells[0].completedAt;delete run.error;delete run.cells[0].error;await ledger.save(run);
  await publishJson(path.join(dir,'validated-output.json'),value);
  (state.results??={})[args.key]={runId:entry.runId,outputFile:path.relative(directory,path.join(dir,'validated-output.json')),fingerprint};state.activeJobs=state.activeJobs.filter((key:string)=>key!==args.key);refreshActive();await save();await sync();
  log(`${args.name}: saved and reopened successfully`);return value;
  } catch(error) {
    await relock();
    if(!stopError){stopError=error;state.failedJob=args.key;state.failedError=error instanceof Error?error.message:String(error);}
    if(localRun&&localRun.status!=='finished'){
      localRun.status=signal.signal.aborted?'cancelled':'failed';localRun.error=error instanceof Error?error.message:String(error);
      Object.assign(localRun.cells[0],{status:localRun.status,error:localRun.error,completedAt:new Date().toISOString()});await ledger.save(localRun);
    }
    state.activeJobs=state.activeJobs.filter((key:string)=>key!==args.key);refreshActive();await save();
    throw error;
  } finally {unlock();}
}
function job<T>(args:Parameters<typeof runJob<T>>[0]):Promise<T>{return pool.run(()=>runJob(args));}

const baseKey=(condition:string)=>`initial/discover/${condition}`;
const pRef=(key:string)=>({promptId:id(`prompt:${executionKey(key)}`),version:1});
const pointInput=(point:Discovery['points'][number])=>({point,sources:point.sourcePaths.map(p=>sourceMap.get(p)),snapshot:{head:index.head,sourceIndexSha256:config.sourceIndexSha256}});
let discoveryPrompts:Record<string,string>={};
const treePrompts={minimal:treePrompt(false,pinnedExamples.examples),model:treePrompt(true,pinnedExamples.examples)};
const expandPrompt=expansionPrompt(expansionTask);
async function discover(key:string,condition:string,phase='phase-1',critique?:unknown,previous?:Discovery,round=0,previousKey?:string) {
  return job({key,name:round?`${condition} · Points · R${round}`:`${condition} · Select epicenters`,stage:'discover',phase,condition,prompt:discoveryPrompts[condition[0]]+(critique?feedbackPrompt:''),schema:discoverySchema,sourceFiles:true,files:critique?{'critique.json':critique,'previous-output.json':previous}:{},validate:v=>validateDiscovery(v,sourcePaths),display:v=>report('Selected epicenters',{summary:v.summary,points:v.points,reviewedFileCount:v.reviewedPaths.length,limitations:v.limitations}),parentPrompt:round?pRef(previousKey!):condition==='A'?undefined:pRef(baseKey('A')),round,dependencies:previousKey?[previousKey]:[]});
}
async function tree(key:string,condition:string,point:Discovery['points'][number],phase='phase-2',critique?:unknown,previous?:{ascii:string},round=0,previousKey?:string,discoveryKey=baseKey(condition[0]),critiqueKey?:string) {
  return job({key,name:`${condition} · ${point.title}${round?` · R${round}`:''}`.slice(0,120),stage:'tree',phase,condition,prompt:treePrompts[condition[1]==='2'?'model':'minimal']+(critique?feedbackPrompt:''),schema:treeSchema,files:{'context.json':pointInput(point),...(critique?{'critique.json':critique,'previous-output.json':previous}:{})},validate:v=>{validateTree(v.ascii);return v;},display:v=>single(v.ascii),preflightCanvas:previous?single(previous.ascii):undefined,parentPrompt:previousKey?pRef(previousKey):pRef(condition[1]==='2'?'template/tree-model':'template/tree-minimal'),round,critiqueKey,dependencies:[discoveryKey,...previousKey?[previousKey]:[]]});
}
async function expand(key:string,condition:string,point:Discovery['points'][number],seed:{ascii:string},phase='phase-3',critique?:unknown,previous?:Canvas,round=0,previousKey?:string,seedKey?:string,critiqueKey?:string) {
  return job({key,name:`${condition} · ${point.title}${round?` · R${round}`:''}`.slice(0,120),stage:'expand',phase,condition,prompt:expandPrompt+(critique?feedbackPrompt:''),schema:canvasSchema,files:{'context.json':pointInput(point),'seed.json':seed,...(critique?{'critique.json':critique,'previous-output.json':previous}:{})},validate:v=>{validateCanvas(v);if(v.diagrams.length<2||!v.diagrams.some(d=>d.id==='central'))throw Error('Expansion requires central and peripheral trees');return v;},display:v=>v,preflightCanvas:single(seed.ascii),parentPrompt:previousKey?pRef(previousKey):{promptId:pinnedParent.promptId,version:pinnedParent.version},round,critiqueKey,dependencies:[...previousKey?[previousKey]:[],...seedKey?[seedKey]:[]]});
}
async function critique(key:string,condition:string,phase:1|2|3,phaseOutput:unknown,canvases:unknown,round:number,dependencies:string[],pointTitle?:string) {
  return job({key,name:`${condition} · Critique R${round}${pointTitle?' · '+pointTitle:''}`.slice(0,120),stage:'critique',phase:'phase-4',condition,prompt:critiquePrompt(phase),schema:critiqueSchema,files:{'judge-input.json':phase===3?{phase,scope:'whole-phase',finalCanvases:canvases}:phase===2?{phase,scope:'whole-phase',phaseOutput,finalCanvases:canvases}:{phase,phaseOutput,finalCanvases:canvases}},display:v=>report(`Phase ${phase} critique`,v),round,dependencies});
}
async function descendants(prefix:string,variant:string,points:Discovery,phase:string,round=0) {
  return allSettledOrThrow(points.points.map(async point=>{
    const treeKey=`${prefix}/tree/${point.id}`,canvasKey=`${prefix}/expand/${point.id}`;
    const seed=await tree(treeKey,variant,point,phase,undefined,undefined,round,undefined,`${prefix}/discover`);
    const canvas=await expand(canvasKey,variant,point,seed,phase,undefined,undefined,round,undefined,treeKey);
    return {pointId:point.id,seed,canvas,treeKey,canvasKey};
  }));
}
try {
  await registerPrompt('template/tree-minimal','Single tree · Minimal',treePrompts.minimal);
  await registerPrompt('template/tree-model','Single tree · 3+1',treePrompts.model,pRef('template/tree-minimal'));
  // Publish the experiment before the first paid call.
  const authored=await job({key:'author',name:'Author discovery variations',stage:'author',phase:'phase-1',condition:'Prompt-authoring',prompt:authorPrompt,schema:authorSchema,files:{'author-input.json':{originalDiscovery,modelDescription}},validate:v=>{if(v.model.split(modelDescription).length!==2)throw Error('Author did not preserve the 3+1 description verbatim exactly once');return v;},display:v=>report('Prompt authoring',v)});
  discoveryPrompts={A:originalDiscovery+'\n\n'+discoveryWrapper,B:authored.plain+'\n\n'+discoveryWrapper,C:authored.model+'\n\n'+discoveryWrapper};
  await publishJson(path.join(directory,'generation-prompts.json'),{discovery:discoveryPrompts,trees:treePrompts,expansion:expandPrompt});
  const discoveries:Record<string,Discovery>={};
  await allSettledOrThrow(['A','B','C'].map(async c=>{discoveries[c]=await discover(baseKey(c),c);}));
  // Stage barriers preserve the agreed phase ordering; independent points overlap.
  const variants:any[]=await allSettledOrThrow(['A1','A2','B1','B2','C1','C2'].map(async variant=>{
    const discovery=discoveries[variant[0]];
    const outputs=await allSettledOrThrow(discovery.points.map(async point=>{
      const treeKey=`initial/${variant}/tree/${point.id}`;
      return {pointId:point.id,seed:await tree(treeKey,variant,point),treeKey};
    }));
    return {variantId:variant,discovery,outputs};
  }));
  await allSettledOrThrow(variants.flatMap(v=>v.outputs.map(async(o:any)=>{
    const point=v.discovery.points.find((p:any)=>p.id===o.pointId);o.canvasKey=`initial/${v.variantId}/expand/${o.pointId}`;
    o.canvas=await expand(o.canvasKey,v.variantId,point,o.seed,'phase-3',undefined,undefined,0,undefined,o.treeKey);
  })));
  await publishJson(path.join(directory,'initial-results.json'),variants);state.initialComplete=true;await save();
  const selection=await job({key:'select',name:'Select two variants',stage:'select',phase:'phase-4',condition:'Selection-judge',prompt:selectionPrompt,schema:selectionSchema,files:{'variants.json':variants.map(v=>({variantId:v.variantId,discovery:v.discovery,outputs:v.outputs.map((o:any)=>({pointId:o.pointId,tree:o.seed,canvas:o.canvas}))}))},validate:v=>{const ids=new Set(variants.map(x=>x.variantId));if(new Set(v.selectedVariantIds).size!==2||v.selectedVariantIds.some(x=>!ids.has(x))||new Set(v.assessments.map(a=>a.variantId)).size!==6||v.assessments.some(a=>!ids.has(a.variantId)))throw Error('Invalid selection judge output');return v;},display:v=>report('Selected variants',v),dependencies:variants.flatMap(v=>v.outputs.map((o:any)=>o.canvasKey))});
  state.selected=selection.selectedVariantIds;await publishJson(path.join(directory,'selection.json'),selection);await save();
  const branches:Promise<void>[]=[];
  for(const selected of selection.selectedVariantIds){
    const initial=variants.find(v=>v.variantId===selected)!;
    // Independent branches share only immutable initial outputs. Rounds remain ordered.
    branches.push((async()=>{
      let currentPoints:Discovery=initial.discovery,currentOutputs=initial.outputs,priorDiscoveryKey=baseKey(selected[0]);
      for(let round=1;round<=3;round++){
        const condition=`${selected}-improve-P1`,prefix=`feedback/${selected}/phase1/round${round}`,judge=await critique(`${prefix}/judge`,condition,1,currentPoints,currentOutputs.map((o:any)=>({pointId:o.pointId,canvas:o.canvas})),round,[priorDiscoveryKey,...currentOutputs.map((o:any)=>o.canvasKey)]);
        const discoveryKey=`${prefix}/discover`;currentPoints=await discover(discoveryKey,condition,'phase-4',judge,currentPoints,round,priorDiscoveryKey);
        currentOutputs=await descendants(prefix,condition,currentPoints,'phase-4',round);priorDiscoveryKey=discoveryKey;
        await publishJson(path.join(directory,`${selected}-P1-round${round}.json`),{discovery:currentPoints,outputs:currentOutputs});
      }
    })());
    branches.push((async()=>{
      let outputs=initial.outputs;
      for(let round=1;round<=3;round++){
        const condition=`${selected}-improve-P2`,prefix=`feedback/${selected}/phase2/round${round}`,judgeKey=`${prefix}/judge`;
        const judge=await critique(judgeKey,condition,2,outputs.map((o:any)=>({pointId:o.pointId,tree:o.seed})),outputs.map((o:any)=>({pointId:o.pointId,canvas:o.canvas})),round,outputs.flatMap((o:any)=>[o.treeKey,o.canvasKey]));
        outputs=await allSettledOrThrow(outputs.map(async(o:any)=>{
          const point:Discovery['points'][number]=initial.discovery.points.find((p:any)=>p.id===o.pointId),treeKey=`${prefix}/tree/${point.id}`,canvasKey=`${prefix}/expand/${point.id}`;
          const seed=await tree(treeKey,condition,point,'phase-4',judge,o.seed,round,o.treeKey,baseKey(selected[0]),judgeKey);
          const canvas=await expand(canvasKey,condition,point,seed,'phase-4',undefined,undefined,round,undefined,treeKey);
          return {pointId:point.id,seed,canvas,treeKey,canvasKey};
        }));
        await publishJson(path.join(directory,`${selected}-P2-round${round}.json`),{outputs});
      }
    })());
    branches.push((async()=>{
      let outputs=initial.outputs;
      for(let round=1;round<=3;round++){
        const condition=`${selected}-improve-P3`,prefix=`feedback/${selected}/phase3/round${round}`,judgeKey=`${prefix}/judge`;
        const judge=await critique(judgeKey,condition,3,undefined,outputs.map((o:any)=>({pointId:o.pointId,canvas:o.canvas})),round,outputs.map((o:any)=>o.canvasKey));
        outputs=await allSettledOrThrow(outputs.map(async(o:any)=>{
          const point:Discovery['points'][number]=initial.discovery.points.find((p:any)=>p.id===o.pointId),canvasKey=`${prefix}/expand/${point.id}`;
          const canvas=await expand(canvasKey,condition,point,o.seed,'phase-4',judge,o.canvas,round,o.canvasKey,o.treeKey,judgeKey);
          return {...o,canvas,canvasKey};
        }));
        await publishJson(path.join(directory,`${selected}-P3-round${round}.json`),{outputs});
      }
    })());
  }
  await allSettledOrThrow(branches);
  state.status='finished';delete state.activeJob;delete state.error;await save();await sync();log('All six initial variants and all selected improvement rounds complete.');
} catch(error) {
  state.status=signal.signal.aborted?'cancelled':'failed';state.error=error instanceof Error?error.message:String(error);
  if(state.failedJob)state.activeJob=state.failedJob;if(state.failedError)state.error=state.failedError;
  await save();await sync();log(`STOPPED: ${state.error}. Raw outputs retained; no automatic paid retry.`);process.exitCode=1;
} finally {await rm(lock,{force:true});}
