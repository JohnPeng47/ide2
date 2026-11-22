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
import {validateMappingRanges,mappingValidationTool,sameMappingChoices} from './validation';
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
const library=new AgentContextLibrary(new FileAgentContextRepository(storeRoot)),runs=new JsonDirectoryStore<any>(storeRoot,'eval-runs');
const idsFile=path.join(dir,'ids.json'),ids=await exists(idsFile)?await read(idsFile):{experimentRequestId:randomUUID(),prompts:{core:randomUUID(),canvas:randomUUID()},contexts:{},runs:{}};
const saveIds=()=>write(idsFile,ids);
await saveIds();
if(process.argv.includes('--execute')&&await exists(path.join(dir,'pause.json'))&&(await read(path.join(dir,'pause.json'))).paused)throw Error('EXPERIMENT_PAUSED: explicit user resume is required before any generation.');
const schema=z.object({diagrams:z.array(z.object({diagramId:z.string(),mappings:z.array(z.object({node:z.string(),path:z.string(),startLine:z.number().int().positive(),endLine:z.number().int().positive()}).strict())}).strict()),notes:z.string()}).strict();
const prompt=(canvas:boolean)=>`Map the provided ${canvas?'canvas’s diagram nodes':'diagram’s nodes'} to the source-code line ranges that explain or implement them.

Inspect the source code and choose the smallest meaningful ranges that support each node. A node may map to multiple ranges across multiple files. Leave nodes unmapped when you cannot find supporting code.

Register the mappings, preserving ${canvas?'every diagram’s content and the canvas layout':'the diagram’s content and layout'}.

Inputs and submission: the saved AgentContext contains the pinned repository checkout and diagram-data.json (ASCII and node references). Use the available read/bash tools to inspect that checkout. No layout template or examples are used. Return only JSON: {"diagrams":[{"diagramId":"d1","mappings":[{"node":"n1","path":"relative/file.ts","startLine":10,"endLine":20}]}],"notes":"Any unsupported nodes or uncertainty"}. Include every supplied diagram, using an empty mappings array if needed. Each entry maps one supplied node reference to one repository-relative, 1-based inclusive source range; repeat the node for multiple ranges. Do not change diagram text or layout.

The runner registers these exact node/range choices through the setSourceMappings operation underlying nodes.setSourceMappings. It resolves the supplied node references to their current diagram spans and fills evidence.originalLines from the pinned source. It does not choose, widen or repair source ranges. The checkout is read-only; no canvas tools are exposed inside this evaluation session.`;
const prompts:any={};
for(const kind of ['core','canvas']){
 const text=prompt(kind==='canvas');await writeFile(path.join(dir,kind+'-prompt.txt'),text);
 const p=ids.promptIds?.[kind]?await api('/prompts/'+ids.promptIds[kind]):await api('/prompts',{requestId:ids.prompts[kind],name:kind==='core'?'Source mapping · Core diagram':'Source mapping · Full canvas',workflow:'alternatives',stages:{alternative:text},...(kind==='canvas'?{derivation:{parent:{promptId:prompts.core.id,version:1},kind:'variation',dimension:{id:'mapping-input-shape',name:'Input shape',value:'full-canvas'}}}:{})});
 ids.promptIds??={};ids.promptIds[kind]=p.id;await saveIds();prompts[kind]=p;assert.equal(p.versions[0].stages.alternative,text);
}
const seeds=await read(path.join(root,'artifacts/core-to-canvas-2026-11-17/contexts-receipt.json'));
const sourceIds={core:'08ccc7fa-8ea6-4cfa-b0b7-8819b7fcbf35',canvas:'7821c7da-cfcd-446d-8d7f-43b26df049fe'};
const sourceData:any={};
for(const kind of ['core','canvas']){
 const overview=await api('/experiments/'+sourceIds[kind]+'/overview');
 const nodes:any[]=[];const walk=(n:any)=>{nodes.push(n);(n.children??[]).forEach(walk);};walk(overview.root);
 const selected=seeds.map((s:any)=>nodes.find(n=>n.target?.kind==='output'&&(kind==='core'?n.target.runId===s.runId&&n.id.endsWith('/tree'):n.id===`output/${s.key}/split`)));
 assert.ok(selected.every(Boolean));
 const refs=selected.flatMap(n=>n.actions.filter((a:any)=>['output','inputs'].includes(a.label)).flatMap((a:any)=>a.refs));
 const batch=await api('/experiments/'+sourceIds[kind]+'/read',{refs});
 await write(path.join(dir,kind+'-source-read.json'),batch);
 sourceData[kind]={overview,selected,batch};
}
const projectId=(await api('/experiments/'+sourceIds.core)).projectId;
const cases:any[]=[];
function initialHistory(result:any){Object.values(result.diagramRevisions).forEach((r:any)=>importDiagramRevision(r));const s=result.canvases[0].proposed;return new CanvasHistory(s.document,s.canvas).export(true);}
for(const kind of ['core','canvas'])for(let i=0;i<seeds.length;i++){
 const seed=seeds[i],key=kind+'-'+seed.key,selected=sourceData[kind].selected[i];
 const result=sourceData[kind].batch.results.find((r:any)=>r.ref===selected.id).value.result;
 assert.equal(result.canvases.length,1);
 const parent=await library.read(seed.parent,false),repo=parent.snapshot.messages.flatMap((m:any)=>m.content).find((b:any)=>b.type==='repository');
 assert.equal(repo.commit,seed.commit);
 const history=initialHistory(result),doc=documentFromHistory(history),diagrams:any[]=[];
 const walk=(box:any)=>{if(box.kind==='container')return box.children.forEach(walk);const d=doc.scene.contents[box.contentId];diagrams.push({diagramId:'d'+(diagrams.length+1),displayNodeId:'grid:'+box.id,contentId:box.contentId,ascii:d.content.ascii,nodes:diagramContentNodes(d.content).map((n:any,i:number)=>({ref:'n'+(i+1),...n}))});};walk(doc.scene.root);
 if(kind==='core')assert.equal(diagrams[0].ascii,await readFile(path.join(root,'artifacts/core-to-canvas-2026-11-17/seeds',seed.key+'.txt'),'utf8'));
 const data=diagrams.map(d=>({diagramId:d.diagramId,ascii:d.ascii,nodes:d.nodes.map((n:any)=>({node:n.ref,label:n.label,line:n.line}))}));
 ids.contexts[key]??=randomUUID();await saveIds();
 const created=await library.create({requestId:ids.contexts[key],name:`${seed.key} · ${kind} mappings`,group:'Source mapping effort',description:`Pinned ${kind} from ${sourceIds[kind]}, run ${selected.target.runId}; repository ${repo.commit}.`,context:[{...repo,task:prompt(kind==='canvas').split('\n\n')[0]},{type:'section',name:'diagram-data.json',content:[{type:'text',text:JSON.stringify(data)}]}]});
 const ctx=await library.read(created.agentContextId,false);
 const c={key,kind,repoKey:seed.key,name:seed.key[0].toUpperCase()+seed.key.slice(1),repo,source:{experimentId:sourceIds[kind],...selected.target},history,diagrams,agentContextId:ctx.agentContextId,contentHash:ctx.contentHash,snapshot:ctx.snapshot};
 cases.push(c);await write(path.join(dir,key+'-input.json'),c);
}
const jobs=cases.flatMap(c=>['low','medium','high'].flatMap(effort=>[1,2,3].map(number=>({caseId:c.key,effort,number,key:`${c.key}-${effort}-${number}`}))));
for(const j of jobs){ids.runs[j.key]??=randomUUID();}await saveIds();
for(const j of jobs){const c=cases.find(c=>c.key===j.caseId),p=prompts[c.kind],id=ids.runs[j.key],cellKey=p.id+':1:alternative';if(await runs.read(id))continue;
 const request=evalRunRequestSchema.parse({requestId:id,workflow:'alternatives',prompts:[{promptId:p.id,version:1}],inputs:{context:{agentContextId:c.agentContextId}},passes:1,model:'gpt-6-sol',effort:j.effort});
 await runs.save({schemaVersion:1,id,coordinator:'canvas-discovery',request,requestHash:hash(JSON.stringify(request)),projectId,workflow:'alternatives',agentContextId:c.agentContextId,contextName:c.key,prompts:[{...p.versions[0],promptId:p.id,name:p.name}],inputs:{},contexts:{context:{agentContextId:c.agentContextId,name:c.key,contentHash:c.contentHash}},name:`${c.name} ${c.kind} · Sol ${j.effort} · ${j.number}`,status:'queued',createdAt:new Date().toISOString(),cells:[{key:cellKey,promptId:p.id,promptVersion:1,promptName:p.name,pass:1,stage:'alternative',status:'queued'}]});
}
if(!ids.experimentId){const ex=await api('/experiments',{requestId:ids.experimentRequestId,experiment:{name:'Source mapping · Effort comparison',tags:['source-mapping'],description:'Four matched core diagrams and four canvases from Core component discovery and Core component → canvas. gpt-6-sol low/medium/high, three independent samples per case and effort (72 total). Identical pinned repository commits and starting diagrams across efforts. Simple mapping prompt; canvas variation changes only input scope. Model chooses node/range pairs; deterministic registration fills source text and preserves geometry. No automatic model repair calls.',phases:[{id:'core',name:'Core diagrams'},{id:'canvas',name:'Full canvases'}],workflow:{id:'source-mapping',name:'Register source mappings',version:1,stages:[{id:'mapping',name:'Mapped canvas',dependsOn:[]}]},cases:cases.map(c=>({id:c.key,name:c.name,agentContextId:c.agentContextId,contentHash:c.contentHash})),conditions:['low','medium','high'].map(e=>({id:e,name:'Sol/'+e,description:`gpt-6-sol/${e}, three samples per case.`})),samples:jobs.map(j=>({id:ids.runs[j.key],phaseId:cases.find(c=>c.key===j.caseId).kind,caseId:j.caseId,conditionId:j.effort,number:j.number,attempt:1,outputs:[{stageId:'mapping',runId:ids.runs[j.key],cellKey:prompts[cases.find(c=>c.key===j.caseId).kind].id+':1:alternative'}]})),comparisons:[]}});ids.experimentId=ex.id;await saveIds();}
await write(path.join(dir,'plan.json'),{experimentId:ids.experimentId,projectId,model:'gpt-6-sol',jobs:jobs.map(j=>({...j,runId:ids.runs[j.key]})),cases:cases.map(({snapshot,history,diagrams,...c})=>c)});

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
if(!await exists(path.join(dir,'preflight.json'))){
 const temp=await mkdtemp(path.join(tmpdir(),'mapping-preflight-')),checks:any[]=[];
 try{const rt=new RecordedRuntime(dir),model=await rt.check();rt.dispose();
 for(const c of cases){const prepared=await prepareRepositoryContext(AgentContext.fromSnapshot(c.snapshot));try{assert.equal(execFileSync('git',['rev-parse','HEAD'],{cwd:prepared.cwd!,encoding:'utf8'}).trim(),c.repo.commit);prepared.context.toPiMessages();const files=execFileSync('git',['ls-tree','-r','--name-only',c.repo.commit],{cwd:c.repo.repositoryPath,encoding:'utf8',maxBuffer:30*1024*1024}).trim().split('\n');const file=files.find(f=>/\.(ts|zig|tsx)$/.test(f))!;const out={diagrams:c.diagrams.map((d:any)=>({diagramId:d.diagramId,mappings:[{node:d.nodes[0].ref,path:file,startLine:1,endLine:1}]})),notes:'Deterministic storage preflight; not a model sample.'};const m=materialize(c,out),result=await persist(c,m.history,temp,c.key);assert.equal(result.canvases.length,1);checks.push({caseId:c.key,commit:c.repo.commit,metrics:m.metrics,checks:['restore pinned input','register mappings','preserve ASCII/layout/edges','save','reopen for editing','load output']});}finally{await prepared.close();}}
 await write(path.join(dir,'preflight.json'),{modelCalls:0,model,checks});
 }finally{await rm(temp,{recursive:true,force:true});}
}
console.log(JSON.stringify({experimentId:ids.experimentId,preflight:'passed',jobs:jobs.length}));
if(!process.argv.includes('--execute'))process.exit(0);
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
const queue=[...jobs];await Promise.all(Array.from({length:6},async()=>{while(queue.length&&!stopped){const j=queue.shift();await execute(j);}}));console.log(JSON.stringify({stopped,remaining:queue.length}));
