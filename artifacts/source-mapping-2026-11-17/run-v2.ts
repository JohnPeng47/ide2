// Reproducible mapping-only experiment. Setup/preflight by default; --execute runs saved jobs.
import {readFile,writeFile,mkdir,access,appendFile,copyFile,mkdtemp,rm} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import {randomUUID,createHash} from 'node:crypto';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {tmpdir} from 'node:os';
import assert from 'node:assert/strict';
import {isDeepStrictEqual} from 'node:util';
import {z} from 'zod';
import {mappingOutputSchema as schema,validateMappingRanges,mappingValidationTool,sameMappingChoices} from './validation';
import {AgentContext} from '../../domain/core/agents/agentContext';
import {AgentContextLibrary} from '../../application/mapping/agent/agentContextLibrary';
import {FileAgentContextRepository} from '../../infrastructure/core/persistence/fileAgentContextRepository';
import {AgentContextEvalRuntime} from '../../infrastructure/mapping/evals/agentContextEvalRuntime';
import {prepareRepositoryContext} from '../../infrastructure/core/agents/repositoryContext';
import {JsonDirectoryStore} from '../../infrastructure/mapping/evals/jsonDirectoryStore';
import {FileCanvasTimeline} from '../../infrastructure/mapping/history/fileCanvasTimeline';
import {CanvasHistory,documentFromHistory} from '../../domain/core/diagrams/canvasHistory';
import {importDiagramRevision} from '../../domain/core/diagrams/diagramRevisionStore';
import {diagramContentNodes} from '../../domain/core/diagrams/diagramContentNodes';
import {mappingContentNodeId} from '../../domain/core/presentation/diagramText';
import {sourceBindingFromLocation} from '../../domain/core/diagrams/diagram';
import {controller} from '../../application/mapping/history/historyMaterializer';
import {summarizeEvalOutput} from '../../domain/mapping/evals/evalOutputResult';
import {evalRunRequestSchema} from '../../domain/mapping/evals/evalRun';
const dir=path.dirname(fileURLToPath(import.meta.url)),root=path.resolve(dir,'../..'),storeRoot=path.join(root,'.diagrams-local/canvas-domain-model');
const read=async(f:string)=>JSON.parse(await readFile(f,'utf8'));
const write=async(f:string,v:any)=>writeFile(f,JSON.stringify(v,null,2)+'\n');
const exists=async(f:string)=>{try{await access(f);return true;}catch{return false;}};
const hash=(s:string)=>createHash('sha256').update(s).digest('hex');
const api=async(route:string,body?:any)=>{const r=await fetch('http://localhost:5191/api/mapping/evals'+route,body===undefined?{}:{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});const d=await r.json();if(!r.ok)throw Error(JSON.stringify(d));return d;};

const runs=new JsonDirectoryStore<any>(storeRoot,'eval-runs');
const original=await read(path.join(dir,'plan.json')),oldIds=await read(path.join(dir,'ids.json')),prepared=await read(path.join(dir,'prepared-fix.json'));
const projectId=original.projectId,cases=await Promise.all(original.cases.map((c:any)=>read(path.join(dir,c.key+'-input.json'))));
const idFile=path.join(dir,'v2-ids.json'),ids=await exists(idFile)?await read(idFile):{runs:{},experimentId:original.experimentId};
const jobs=original.jobs.map((j:any)=>({...j,key:j.key+'-v2',previousRunId:j.runId}));
const prompts:any={};for(const kind of ['core','canvas']){const p=await api('/prompts/'+prepared.prompts[kind].promptId),v=p.versions.find((v:any)=>v.version===prepared.prompts[kind].version);assert.equal(v.contentHash,prepared.prompts[kind].contentHash);prompts[kind]={...v,promptId:p.id,name:p.name};}
for(const j of jobs)ids.runs[j.key]??=randomUUID();await write(idFile,ids);
for(const j of jobs){const c=cases.find((c:any)=>c.key===j.caseId),p=prompts[c.kind],id=ids.runs[j.key];if(await runs.read(id))continue;
 const request=evalRunRequestSchema.parse({requestId:id,workflow:'alternatives',prompts:[{promptId:p.promptId,version:p.version}],inputs:{context:{agentContextId:c.agentContextId}},passes:1,model:'gpt-6-sol',effort:j.effort});
 await runs.save({schemaVersion:1,id,coordinator:'canvas-discovery',request,requestHash:hash(JSON.stringify(request)),projectId,workflow:'alternatives',agentContextId:c.agentContextId,contextName:c.key,prompts:[p],inputs:{},contexts:{context:{agentContextId:c.agentContextId,name:c.key,contentHash:c.contentHash}},name:`${c.name} ${c.kind} · Sol ${j.effort} · ${j.number} · v2`,status:'queued',createdAt:new Date().toISOString(),cells:[{key:p.promptId+':1:alternative',promptId:p.promptId,promptVersion:p.version,promptName:p.name,pass:1,stage:'alternative',status:'queued'}]});
}
if(!ids.attached){
 const ex=await api('/experiments/'+ids.experimentId),oldSamples=ex.samples.filter((s:any)=>s.id in {}||Object.values(oldIds.runs).includes(s.id));
 const retained=[];for(const sample of oldSamples){const run=await runs.read(sample.id);if(run.status==='queued'){run.status='cancelled';run.completedAt=new Date().toISOString();Object.assign(run.cells[0],{status:'cancelled',completedAt:run.completedAt,error:'Superseded before execution by prompt v2. Zero model calls.'});await runs.save(run);}else retained.push({...sample,phaseId:'baseline-v1'});}
 const {name,tags,workflow,conditions,comparisons}=ex;
 await api('/experiments',{requestId:randomUUID(),experimentId:ex.id,expectedRevision:ex.revision,experiment:{name,tags,workflow,conditions,comparisons,cases:ex.cases,description:'Four matched core diagrams and four canvases; gpt-6-sol low/medium/high × three samples = 72 v2 outputs. Same pinned inputs throughout. v2 adds per-file verification and a source-range validation tool within each sample. Six v1 attempts retained separately; 66 unstarted v1 records superseded without model calls. User authorized a single low-effort pilot until validation succeeds, then the full comparison.',phases:[{id:'baseline-v1',name:'Initial validation failures'},{id:'core',name:'Core diagrams · v2'},{id:'canvas',name:'Full canvases · v2'}],samples:[...retained,...jobs.map((j:any)=>({id:ids.runs[j.key],phaseId:cases.find((c:any)=>c.key===j.caseId).kind,caseId:j.caseId,conditionId:j.effort,number:j.number,attempt:2,...(retained.some((s:any)=>s.id===j.previousRunId)?{relaunchedFrom:{sampleId:j.previousRunId,stageId:'mapping'}}:{}),outputs:[{stageId:'mapping',runId:ids.runs[j.key],cellKey:prompts[cases.find((c:any)=>c.key===j.caseId).kind].promptId+':1:alternative'}]}))]}});ids.attached=true;await write(idFile,ids);
}
await write(path.join(dir,'v2-plan.json'),{...original,promptVersion:2,jobs:jobs.map((j:any)=>({...j,runId:ids.runs[j.key]}))});
function materialize(c:any,raw:any){
 const output=schema.parse(typeof raw==='string'?JSON.parse(raw.replace(/^```(?:json)?\s*|\s*```$/g,'')):raw);
 assert.deepEqual(output.diagrams.map(d=>d.diagramId).sort(),c.diagrams.map((d:any)=>d.diagramId).sort(),'Output must include each diagram exactly once');
 const validation=validateMappingRanges(c,output);if(!validation.valid)throw Error(JSON.stringify(validation));
 const ctrl=controller({id:c.key,name:c.key,history:structuredClone(c.history),diagramIds:{}});
 let mapped=0,ranges=0,sourceLines=0;const files=new Set<string>(),direct=new Set<string>();
 for(const out of output.diagrams){const d=c.diagrams.find((d:any)=>d.diagramId===out.diagramId),before=ctrl.getSnapshot().document.scene.contents[d.contentId],mappings:any[]=[],evidence:any={};
  for(const [index,m] of out.mappings.entries()){
   const node=d.nodes.find((n:any)=>n.ref===m.node);assert.ok(node,`Unknown node ${m.node}`);assert.ok(!path.isAbsolute(m.path)&&!m.path.split(/[\\/]/).includes('..')&&!m.path.includes('\\'),'Invalid path');assert.ok(m.endLine>=m.startLine,'Reversed source range');
   const text=execFileSync('git',['show',`${c.repo.commit}:${m.path}`],{cwd:c.repo.repositoryPath,encoding:'utf8',maxBuffer:20*1024*1024}),lines=text.replace(/\n$/,'').split('\n');
   assert.ok(m.endLine<=lines.length,`Range exceeds ${m.path}`);
   const id='m'+index,entityId='e'+index,rangeId='r'+index;
   evidence[entityId]={id:entityId,handle:node.label,label:node.label,category:'operation',summary:'Source support selected by mapping experiment.',sourceRanges:[{id:rangeId,path:m.path,startLine:m.startLine,endLine:m.endLine,originalLines:lines.slice(m.startLine-1,m.endLine)}]};
   mappings.push({id,entityId,sourceRangeIndex:0,sourceRangeId:rangeId,line:node.line,startColumn:node.startColumn,endColumn:node.endColumn});
   assert.equal(mappingContentNodeId(before.content,mappings.at(-1)),node.id,'Mapping must resolve to chosen node');
   direct.add(d.diagramId+':'+node.ref);ranges++;sourceLines+=m.endLine-m.startLine+1;files.add(m.path);
  }
  ctrl.applyUpdate(ctrl.getSnapshot().version,[{method:'setSourceMappings',nodeId:d.displayNodeId,expectedContentHash:before.content.asciiSha256,mappings,evidence,source:sourceBindingFromLocation({checkoutRoot:c.repo.repositoryPath,repositoryIdentity:c.repo.repositoryPath,gitRevision:c.repo.commit})}]);
 }
 const after=ctrl.getSnapshot().document,before=documentFromHistory(c.history);
 assert.deepEqual(after.scene.root,before.scene.root,'Layout changed');assert.deepEqual(after.edges,before.edges,'Edges changed');
 for(const [id,d]of Object.entries(before.scene.contents) as any)assert.deepEqual(after.scene.contents[id].content,d.content,'Content changed');
 ctrl.canvasView(ctrl.getSnapshot().version,{operation:'create',name:'Source mappings'});
 return {history:ctrl.exportHistory(),output,metrics:{nodes:c.diagrams.reduce((n:number,d:any)=>n+d.nodes.length,0),mappedNodes:direct.size,ranges,sourceLines,files:files.size,diagrams:c.diagrams.length}};
}
async function persist(c:any,history:any,store:string,id:string){const timeline=new FileCanvasTimeline(store),ref={documentId:c.key,name:c.name,viewId:history.canvasViews.activeViewId,checkpointId:history.headId};await timeline.append(id,projectId,0,{id:'mapped',phase:'execution',title:'Source mappings',commits:[],agentContextId:c.agentContextId,planId:c.contentHash,canvases:[ref]},{[c.key]:history});const reopened=new FileCanvasTimeline(store);const restored=await reopened.editingHistory(id,ref);controller({id:c.key,name:c.name,history:restored,diagramIds:{}});return reopened.result(id,'mapped');}
class RecordedRuntime extends AgentContextEvalRuntime{
 transcript?:string;pending=Promise.resolve();constructor(private out:string,private mappingCase?:any){super(root,true);}
 async check(){const m=await this.model('gpt-6-sol');return {provider:m.provider,model:m.modelId};}
 protected async createSession(config:any,context?:AgentContext){if(this.mappingCase)config={...config,tools:[...config.tools,'validate_source_mappings'],customTools:[mappingValidationTool(this.mappingCase,async result=>{await appendFile(path.join(this.out,'validation-checks.jsonl'),JSON.stringify(result)+'\n');})]};const r=await super.createSession(config,context);if(this.mappingCase)assert.ok(r.session.getActiveToolNames().includes('validate_source_mappings'),'Validation tool must be available before model call');this.transcript=r.session.sessionFile;await write(path.join(this.out,'session.json'),{id:r.session.sessionId,transcript:this.transcript,cwd:config.cwd});r.session.subscribe((e:any)=>{if(['tool_execution_start','tool_execution_end','message_end'].includes(e.type))this.pending=this.pending.then(()=>appendFile(path.join(this.out,'events.jsonl'),JSON.stringify(e)+'\n'));});return r;}
 async flush(){await this.pending;if(this.transcript&&await exists(this.transcript))await copyFile(this.transcript,path.join(this.out,'transcript.jsonl'));}
}
let stopped=false;
async function execute(j:any){const c=cases.find(c=>c.key===j.caseId),id=ids.runs[j.key],outDir=path.join(dir,'jobs',j.key);await mkdir(outDir,{recursive:true});let run=await runs.read(id);if(run.status==='finished')return;
 const responseFile=path.join(outDir,'response.json');if(await exists(path.join(outDir,'started.json'))&&!await exists(responseFile))throw Error(j.key+' already started without response; no automatic retry');
 const rt=new RecordedRuntime(outDir,run.prompts[0].version>=2?c:undefined);let phase='generation';
 try{let response=await exists(responseFile)?await read(responseFile):undefined;
 if(!response){await writeFile(path.join(outDir,'started.json'),JSON.stringify({at:new Date().toISOString(),model:'gpt-6-sol',effort:j.effort,contextHash:c.contentHash}),{flag:'wx'});run.status='generating';Object.assign(run.cells[0],{status:'generating',startedAt:new Date().toISOString()});await runs.save(run);console.log(j.key+' started');response=await rt.generate({workflow:'alternatives',stage:'alternative',prompt:run.prompts[0].stages.alternative,schema,agentContext:c.snapshot,files:{},model:'gpt-6-sol',effort:j.effort,signal:new AbortController().signal});await write(responseFile,response);await rt.flush();}
 phase='validation';if(run.prompts[0].version>=2){const raw=typeof response.output==='string'?JSON.parse(response.output):response.output;const checks=(await readFile(path.join(outDir,'validation-checks.jsonl'),'utf8')).trim().split('\n').map(line=>JSON.parse(line));assert.ok(checks.some(check=>check.valid&&sameMappingChoices(JSON.parse(check.candidate),raw)),'Final mappings must match a validated candidate');}const m=materialize(c,response.output);await write(path.join(outDir,'mapping.json'),m.output);await write(path.join(outDir,'metrics.json'),m.metrics);
 phase='persistence';const result=await persist(c,m.history,storeRoot,id);run=await runs.read(id);run.status='finished';delete run.error;delete run.cells[0].error;run.completedAt=new Date().toISOString();Object.assign(run.cells[0],{status:'finished',completedAt:run.completedAt,usage:response.usage,execution:response.execution,historyArtifact:{timelineId:id,stepId:'mapped'},output:summarizeEvalOutput(result),explanation:m.output.notes});await runs.save(run);
 const loaded=await api(`/runs/${id}/output-result?cell=${encodeURIComponent(run.cells[0].key)}`);assert.equal(loaded.canvases.length,1);await write(path.join(outDir,'status.json'),{status:'finished',...m.metrics});console.log(j.key+' finished '+JSON.stringify(m.metrics));
 }catch(e){stopped=true;const message=phase+': '+String(e);run=await runs.read(id);run.status='failed';run.error=message;Object.assign(run.cells[0],{status:'failed',error:message,completedAt:new Date().toISOString()});await runs.save(run);await write(path.join(outDir,'status.json'),{status:'failed',phase,error:String(e)});console.error(j.key+' '+message);}
 finally{await rt.flush();rt.dispose();}
}

const pilot=jobs.find((j:any)=>j.key==='core-mapping-low-1-v2');
if(process.argv.includes('--only'))await execute(jobs.find((j:any)=>j.key===process.argv[process.argv.indexOf('--only')+1]));
else if(process.argv.includes('--pilot'))await execute(pilot);
else if(process.argv.includes('--all')){assert.equal((await runs.read(ids.runs[pilot.key])).status,'finished','Pilot must pass before full run');const skip=process.argv.includes('--skip')?process.argv[process.argv.indexOf('--skip')+1]:undefined;const queue=jobs.filter((j:any)=>j.key!==skip);await Promise.all(Array.from({length:6},async()=>{while(queue.length&&!stopped)await execute(queue.shift());}));console.log(JSON.stringify({stopped,remaining:queue.length}));}
else console.log('Prepared only; use --pilot or --all');
