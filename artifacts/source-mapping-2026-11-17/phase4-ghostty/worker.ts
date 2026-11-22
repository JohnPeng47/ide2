import {modelDescriptor} from './catalog';
import { MappingSubagents, readOnlyBash } from './subagents';
import {readFile,writeFile,mkdir,access,appendFile,copyFile,mkdtemp,rm} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import {randomUUID,createHash} from 'node:crypto';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {tmpdir} from 'node:os';
import assert from 'node:assert/strict';
import {isDeepStrictEqual} from 'node:util';
import {z} from 'zod';
import {mappingOutputSchema as schema,validateMappingRanges,mappingValidationTool,digest} from './validation';
import {AgentContext} from '../../../domain/core/agents/agentContext';
import {AgentContextLibrary} from '../../../application/mapping/agent/agentContextLibrary';
import {FileAgentContextRepository} from '../../../infrastructure/core/persistence/fileAgentContextRepository';
import {AgentContextEvalRuntime} from '../../../infrastructure/mapping/evals/agentContextEvalRuntime';
import {prepareRepositoryContext} from '../../../infrastructure/core/agents/repositoryContext';
import {JsonDirectoryStore} from '../../../infrastructure/mapping/evals/jsonDirectoryStore';
import {FileCanvasTimeline} from '../../../infrastructure/mapping/history/fileCanvasTimeline';
import {CanvasHistory,documentFromHistory} from '../../../domain/core/diagrams/canvasHistory';
import {importDiagramRevision} from '../../../domain/core/diagrams/diagramRevisionStore';
import {diagramContentNodes} from '../../../domain/core/diagrams/diagramContentNodes';
import {mappingContentNodeId} from '../../../domain/core/presentation/diagramText';
import {sourceBindingFromLocation} from '../../../domain/core/diagrams/diagram';
import {controller} from '../../../application/mapping/history/historyMaterializer';
import {summarizeEvalOutput} from '../../../domain/mapping/evals/evalOutputResult';
import {evalRunRequestSchema} from '../../../domain/mapping/evals/evalRun';
const dir=path.dirname(fileURLToPath(import.meta.url)),root=path.resolve(dir,'../../..'),storeRoot=path.join(root,'.diagrams-local/canvas-domain-model');
const read=async(f:string)=>JSON.parse(await readFile(f,'utf8'));
const write=async(f:string,v:any)=>writeFile(f,JSON.stringify(v,null,2)+'\n');
const exists=async(f:string)=>{try{await access(f);return true;}catch{return false;}};
const hash=(s:string)=>createHash('sha256').update(s).digest('hex');
const api=async(route:string,body?:any)=>{const r=await fetch('http://localhost:5191/api/mapping/evals'+route,body===undefined?{}:{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});const d=await r.json();if(!r.ok)throw Error(JSON.stringify(d));return d;};

const plan=await read(path.join(dir,await exists(path.join(dir,'resume-plan.json'))?'resume-plan.json':'plan.json')),projectId=plan.projectId;
const runs=new JsonDirectoryStore<any>(storeRoot,'eval-runs');
function materialize(c:any,raw:any){
 const output=schema.parse(typeof raw==='string'?JSON.parse(raw.replace(/^```(?:json)?\s*|\s*```$/g,'')):raw);
 assert.deepEqual(output.diagrams.map(d=>d.diagramId).sort(),c.diagrams.map((d:any)=>d.diagramId).sort(),'Output must include each diagram exactly once');
 const validation=validateMappingRanges(c,output);if(!validation.valid)throw Error(JSON.stringify(validation));
 const sourceFiles=new Map<string,string[]>();
 const ctrl=controller({id:c.key,name:c.key,history:structuredClone(c.history),diagramIds:{}});
 let ranges=0,sourceLines=0;const files=new Set<string>(),direct=new Set<string>();
 for(const out of output.diagrams){const d=c.diagrams.find((d:any)=>d.diagramId===out.diagramId),before=ctrl.getSnapshot().document.scene.contents[d.contentId],mappings:any[]=[],evidence:any={};
  for(const [index,m] of out.mappings.entries()){
   const node=d.nodes.find((n:any)=>n.ref===m.node);assert.ok(node,`Unknown node ${m.node}`);assert.ok(!path.isAbsolute(m.path)&&!m.path.split(/[\\/]/).includes('..')&&!m.path.includes('\\'),'Invalid path');assert.ok(m.endLine>=m.startLine,'Reversed source range');
   let lines=sourceFiles.get(m.path);
   if(!lines){
    const text=execFileSync('git',['show',c.repo.commit+':'+m.path],{cwd:c.repo.repositoryPath,encoding:'utf8',maxBuffer:20*1024*1024});
    lines=text.replace(/\n$/,'').split('\n');sourceFiles.set(m.path,lines);
   }
   assert.ok(m.endLine<=lines.length,`Range exceeds ${m.path}`);
   const id='m'+index,entityId='e'+index,rangeId='r'+index;
   evidence[entityId]={id:entityId,handle:node.label,label:node.label,category:'operation',summary:'Scope: '+out.nodes.find(n=>n.node===m.node)!.scope.join(', ')+' | Role: '+m.role.join(', '),sourceRanges:[{id:rangeId,path:m.path,startLine:m.startLine,endLine:m.endLine,originalLines:lines.slice(m.startLine-1,m.endLine)}]};
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
class RecordedRuntime extends AgentContextEvalRuntime {
 transcript?:string; pending=Promise.resolve(); children?:MappingSubagents; mainCost:Record<string,number>={}; generationController=new AbortController();
 constructor(private out:string,private mappingCase?:any,private job?:any,private prompt=''){super(root,true);}
 protected async model(id:string){return modelDescriptor(await this.runtime(),id);}
 async check(){const models=[];for(const id of ['gpt-6.2-sol','gpt-6.2-astra']){const m=await this.model(id);models.push({provider:m.provider,model:m.modelId});}return models;}
 protected async createSession(config:any,context?:AgentContext){
  if(this.mappingCase){
   assert.ok(context);this.children=new MappingSubagents({cwd:config.cwd,context,prompt:this.prompt,directory:path.join(this.out,'children'),model:this.job.childModel,effort:this.job.childEffort,concurrency:plan.childConcurrency,onFailure:error=>this.generationController.abort(error)});
   config={...config,tools:['read','bash','validate_source_mappings','delegate_subagents'],customTools:[readOnlyBash(config.cwd),this.children.tool(),mappingValidationTool(this.mappingCase,async result=>{await appendFile(path.join(this.out,'validation-checks.jsonl'),JSON.stringify(result)+'\n');})]};
  }
  const r=await super.createSession(config,context);
  if(this.mappingCase)assert.deepEqual(r.session.getActiveToolNames().sort(),['bash','delegate_subagents','read','validate_source_mappings']);
  this.transcript=r.session.sessionFile;
  await write(path.join(this.out,'session.json'),{id:r.session.sessionId,transcript:this.transcript,cwd:config.cwd,model:this.job?.model,effort:this.job?.effort,tools:r.session.getActiveToolNames()});
  r.session.subscribe((e:any)=>{
   if(['tool_execution_start','tool_execution_end','message_end'].includes(e.type))this.pending=this.pending.then(()=>appendFile(path.join(this.out,'events.jsonl'),JSON.stringify(e)+'\n'));
   if(e.type==='message_end'&&e.message.role==='assistant')for(const [key,value] of Object.entries(e.message.usage?.cost??{}))if(typeof value==='number')this.mainCost[key]=(this.mainCost[key]??0)+value;
  });return r;
 }
 async generate(input:Parameters<AgentContextEvalRuntime['generate']>[0]) {
  const abort=()=>{void this.children?.close();};input.signal.addEventListener('abort',abort,{once:true});
  try {
   const result=await super.generate({...input,signal:AbortSignal.any([input.signal,this.generationController.signal])});
   this.children?.assertHealthy(); assert.ok(result.execution);
   const mainUsage={...result.usage},usage={...mainUsage},cost={...this.mainCost};
   for(const child of this.children?.records??[]){for(const [key,value]of Object.entries(child.usage))if(typeof value==='number')usage[key]=(usage[key]??0)+value;for(const [key,value]of Object.entries(child.cost))if(typeof value==='number')cost[key]=(cost[key]??0)+value;}
   return {...result,usage,accounting:{mainUsage,mainCost:this.mainCost,totalCost:cost,children:this.children?.records.length??0},execution:{...result.execution,subagents:{model:this.job.childModel,effort:this.job.childEffort,concurrency:plan.childConcurrency,sessions:(this.children?.records??[]).map(({text,...record}:any)=>record)}}};
  } catch(error) { if(this.generationController.signal.aborted)throw Error('Subagent failure: '+String(this.generationController.signal.reason));throw error; }
  finally {input.signal.removeEventListener('abort',abort);await this.children?.close();}
 }
 async flush(){await this.pending;if(this.transcript&&await exists(this.transcript))await copyFile(this.transcript,path.join(this.out,'transcript.jsonl'));}
}

async function execute(j:any){const c=await read(path.join(dir,j.caseId+'-input.json')),id=j.runId,outDir=path.join(dir,'jobs',j.key);await mkdir(outDir,{recursive:true});let run=await runs.read(id);if(run.status==='finished')return;
 const responseFile=path.join(outDir,'response.json');if(await exists(path.join(outDir,'started.json'))&&!await exists(responseFile))throw Error(j.key+' already started without response; no automatic retry');
 const rt=new RecordedRuntime(outDir,c,j,run.prompts[0].stages.alternative);let phase='generation';
 try{let response=await exists(responseFile)?await read(responseFile):undefined;
 if(!response){await writeFile(path.join(outDir,'started.json'),JSON.stringify({at:new Date().toISOString(),model:j.model,effort:j.effort,contextHash:c.contentHash,scheduling:{mainConcurrency:plan.mainConcurrency,childConcurrency:plan.childConcurrency}}),{flag:'wx'});run.status='generating';Object.assign(run.cells[0],{status:'generating',startedAt:new Date().toISOString()});await runs.save(run);console.log(j.key+' started');response=await rt.generate({workflow:'alternatives',stage:'alternative',prompt:run.prompts[0].stages.alternative,schema,agentContext:c.snapshot,files:{},model:j.model,effort:j.effort,signal:new AbortController().signal});await write(responseFile,response);await rt.flush();}
 phase='validation';{const raw=typeof response.output==='string'?JSON.parse(response.output):response.output;const checks=(await readFile(path.join(outDir,'validation-checks.jsonl'),'utf8')).trim().split('\n').map(line=>JSON.parse(line));const verified=checks.find(check=>check.valid && (raw.validatedCandidate ? Object.keys(raw).length===1 && digest(check.candidate)===raw.validatedCandidate : isDeepStrictEqual(JSON.parse(check.candidate),raw)));assert.ok(verified,'Final must match a validated candidate');response={...response,output:JSON.parse(verified.candidate)};}const m=materialize(c,response.output);await write(path.join(outDir,'mapping.json'),m.output);await write(path.join(outDir,'metrics.json'),m.metrics);
 phase='persistence';const result=await persist(c,m.history,storeRoot,id);run=await runs.read(id);run.status='finished';delete run.error;delete run.cells[0].error;run.completedAt=new Date().toISOString();Object.assign(run.cells[0],{status:'finished',completedAt:run.completedAt,usage:response.usage,execution:response.execution,historyArtifact:{timelineId:id,stepId:'mapped'},output:summarizeEvalOutput(result),explanation:m.output.notes});await runs.save(run);
 const loaded=await api(`/runs/${id}/output-result?cell=${encodeURIComponent(run.cells[0].key)}`);assert.equal(loaded.canvases.length,1);await write(path.join(outDir,'status.json'),{status:'finished',...m.metrics,children:response.accounting?.children??0,usage:response.usage,accounting:response.accounting});console.log(j.key+' finished '+JSON.stringify(m.metrics));
 }catch(e){process.exitCode=1;const message=phase+': '+String(e);run=await runs.read(id);run.status='failed';run.error=message;Object.assign(run.cells[0],{status:'failed',error:message,completedAt:new Date().toISOString()});await runs.save(run);await write(path.join(outDir,'status.json'),{status:'failed',phase,error:String(e)});console.error(j.key+' '+message);}
 finally{await rt.flush();rt.dispose();}
}


if(process.argv[2]==='--preflight'){
 const rt=new RecordedRuntime(dir),model=await rt.check();rt.dispose();
 const temp=await mkdtemp(path.join(tmpdir(),'mapping-check-')),inputs=[];
 try {
  for(const spec of plan.cases){
   const c=await read(path.join(dir,spec.key+'-input.json'));
   const repo=await prepareRepositoryContext(AgentContext.fromSnapshot(c.snapshot));
   try {
    assert.equal(execFileSync('git',['rev-parse','HEAD'],{cwd:repo.cwd,encoding:'utf8'}).trim(),c.repo.commit);
    repo.context.toPiMessages();
    const candidate={diagrams:c.diagrams.map((d:any)=>({diagramId:d.diagramId,nodes:d.nodes.map((n:any)=>({node:n.ref,scope:['structure']})),mappings:[{node:d.nodes[0].ref,role:['declaration'],path:'src/App.zig',startLine:53,endLine:55}]})),notes:'Storage preflight fixture.'};
    const m=materialize(c,candidate),result=await persist(c,m.history,temp,c.key);
    assert.equal(result.canvases.length,1);
    const reopened=result.canvases[0].proposed.document;
    assert.deepEqual(reopened.scene.root,documentFromHistory(c.history).scene.root);
    for(const diagram of c.diagrams)assert.equal(reopened.scene.contents[diagram.contentId].content.ascii,diagram.ascii);
    for(const d of c.diagrams){const evidence=JSON.stringify(reopened.scene.contents[d.contentId]);assert.ok(evidence.includes('Scope: structure | Role: declaration'));}
    inputs.push(c.contentHash);
   } finally{await repo.close();}
  }
  await write(path.join(dir,'preflight.json'),{inputs,modelCalls:0,model});
 }finally{await rm(temp,{recursive:true,force:true});}
} else {
 const job=plan.jobs.find((j:any)=>j.key===process.argv[2]);assert.ok(job);
 assert.deepEqual((await read(path.join(dir,'preflight.json'))).inputs,plan.cases.map((c:any)=>c.contentHash));
 assert.ok((await readFile('/proc/self/mountinfo','utf8')).split('\n').some(line=>line.split(' ')[4]==='/tmp' && line.includes(' - tmpfs ')),'Worker requires a private /tmp');
 await execute(job);
}
