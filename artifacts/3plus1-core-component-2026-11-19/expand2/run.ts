import { readFile, writeFile, mkdir, access, mkdtemp, rm } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import { AgentContext } from '../../../domain/core/agents/agentContext';
import { AgentContextLibrary } from '../../../application/mapping/agent/agentContextLibrary';
import { FileAgentContextRepository } from '../../../infrastructure/core/persistence/fileAgentContextRepository';
import { AgentContextEvalRuntime } from '../../../infrastructure/mapping/evals/agentContextEvalRuntime';
import { JsonDirectoryStore } from '../../../infrastructure/mapping/evals/jsonDirectoryStore';
import { FileCanvasTimeline } from '../../../infrastructure/mapping/history/fileCanvasTimeline';
import { prepareRepositoryContext } from '../../../infrastructure/core/agents/repositoryContext';
import { controller } from '../../../application/mapping/history/historyMaterializer';
import { composePrompt, evalWorkflows } from '../../../domain/mapping/evals/evalWorkflows';
import { materializeAlternative } from '../../../application/mapping/evals/alternativeMaterializer';
import { alternativeOutputSchema } from '../../../domain/mapping/evals/alternatives';
import { summarizeEvalOutput } from '../../../domain/mapping/evals/evalOutputResult';
import { documentFromHistory } from '../../../domain/core/diagrams/canvasHistory';
import { connectionBox, connectionContentNodes, getArrowLabel } from '../../../domain/core/diagrams/diagramConnection';
const mode = process.argv[2]; assert(['prepare','check','execute'].includes(mode));
const d = import.meta.dirname, root = path.resolve(d,'../../..'), storage = path.join(root,'.diagrams-local/canvas-domain-model');
const read = async (file:string) => JSON.parse(await readFile(file,'utf8'));
const write = (file:string, x:unknown) => writeFile(file,JSON.stringify(x,null,2)+'\n');
const exists = async (file:string) => access(file).then(()=>true,()=>false);
const ids = await read(path.join(d,'ids.json')), coreIds = await read(path.join(d,'../ids.json')), names = await read(path.join(d,'../expand/names.json')), r1 = await read(path.join(d,'../expand/ids.json'));
const seeds:[string,number][] = [['modular',1],['modular',2],['call',1],['call',2],['ownership',1],['data',1],['data',2]];
const keys = ['modular','call','ownership','data'];
const runs = new JsonDirectoryStore<any>(storage,'eval-runs');
const experiments = new JsonDirectoryStore<any>(storage,'eval-experiments');
const library = new AgentContextLibrary(new FileAgentContextRepository(storage));
const timeline = new FileCanvasTimeline(storage);
const experiment = await experiments.read(coreIds.experiment);
const time = () => new Date().toISOString();
const log = (m:string) => console.log(time(),m);
const REPO_CONTEXT='saved-agent-context-29fbdd95-72d4-4dc1-ad7c-a1b0f8cd7da6', COMMIT='ea8b12a8a9894b5259c441eadd8f6f0c65e215af';
const checks:Record<string,string>={
  modular:'Verify the module boundaries, visibility and dependencies you rely on',
  call:'Verify the call paths, ordering and hand-offs you rely on',
  ownership:'Verify the owners, lifetimes and references you rely on',
  data:'Verify the inputs, computations and derived values you rely on'};
function asInput(history:any) {
  const doc = documentFromHistory(history);
  const diagrams = doc.scene.root.children.map(box=>{ assert.equal(box.kind,'diagram');
    return {id:box.id.replace(/^alt-/,''),ascii:doc.scene.contents[box.contentId].content.ascii,position:box.position}; });
  const endpoint=(anchor:any)=>{ const box=connectionBox(doc.scene,anchor.displayNodeId); assert(box?.kind==='diagram');
    const node=connectionContentNodes(doc.scene.contents[box.contentId].content).find(n=>n.id===anchor.contentNodeId); assert(node);
    return {diagram:box.id.replace(/^alt-/,''),line:node.line}; };
  return {diagrams,edges:doc.edges.map(edge=>({source:endpoint(edge.source),target:endpoint(edge.target),label:getArrowLabel(edge.appearance).text}))};
}
async function saveHistory(store:FileCanvasTimeline,runId:string,name:string,history:any,metadata:any) {
  const ref={documentId:runId,name,viewId:history.canvasViews.activeViewId,checkpointId:history.headId};
  await store.append(runId,experiment.projectId,0,{id:'output',phase:'execution',title:name,canvases:[ref],...metadata},{[runId]:history});
  return ref;
}
async function prepare([key,n]:[string,number]) {
  const runId=r1.runs[key][n-1], run=await runs.read(runId);
  assert.equal(run.status,'finished');
  const ref=(await timeline.read(runId)).steps[0].canvases[0];
  const baseline=await timeline.editingHistory(runId,ref), snapshot=asInput(baseline);
  assert(snapshot.diagrams.length>1);
  const replay=materializeAlternative({explanation:'Seed round trip',...snapshot}); assert.deepEqual(asInput(replay.history),snapshot);
  const payload=JSON.stringify(snapshot,null,2), name=`Ghostty · ${names[key]} · expand ${n}`;
  const parent=await library.read(REPO_CONTEXT,false);
  const repo=parent.snapshot.messages[0].content.find((b:any)=>b.type==='repository')!; assert.equal(repo.commit,COMMIT);
  const task=`Use this checkout to double-check the supplied canvas while restructuring it. ${checks[key]}, and correct anything the source contradicts.`;
  const receipt=await library.create({requestId:ids.contexts[`${key}-${n}`],group:'3+1 Model Core Component',name,
    description:`Pinned expand sample ${n} from run ${runId} at checkpoint ${ref.checkpointId}.`,
    context:[{type:'text',text:`<current-canvas repository="Ghostty" commit="${COMMIT}">\n${payload}\n</current-canvas>`},{...repo,task}]});
  const saved=await library.read(receipt.agentContextId,false); assert.equal(saved.contentHash,receipt.contentHash);
  const checkout=await prepareRepositoryContext(AgentContext.fromSnapshot(saved.snapshot));
  try { assert.deepEqual(checkout.tools,['read','bash']);
    assert.equal(execFileSync('git',['rev-parse','HEAD'],{cwd:checkout.cwd,encoding:'utf8'}).trim(),COMMIT); checkout.context.toPiMessages();
  } finally { await checkout.close(); }
  const temp=await mkdtemp(path.join(tmpdir(),'expand2-preflight-'));
  try { const probeStore=new FileCanvasTimeline(temp);
    const probe=await saveHistory(probeStore,'probe',name,baseline,{commits:[COMMIT],planId:run.prompts[0].promptId,agentContextId:receipt.agentContextId});
    const reopened=await probeStore.editingHistory('probe',probe); assert.deepEqual(asInput(reopened),snapshot);
    const editor=controller({id:'probe',name,history:reopened,diagramIds:{}});
    editor.canvasView(editor.getSnapshot().version,{operation:'fork',viewId:probe.viewId,name:'Editing preflight'});
    editor.canvasView(editor.getSnapshot().version,{operation:'save'});
    assert.equal((await probeStore.result('probe','output')).canvases.length,1);
  } finally { await rm(temp,{recursive:true,force:true}); }
  return [`${key}-${n}`,{...receipt,diagrams:snapshot.diagrams.length,edges:snapshot.edges.length,source:{experimentId:coreIds.experiment,runId,cellKey:run.cells[0].key,checkpointId:ref.checkpointId,label:name}}];
}
if(mode==='prepare'){ await write(path.join(d,'contexts.json'),Object.fromEntries(await Promise.all(seeds.map(prepare)))); log('Verified seven expand checkpoints, contexts and storage lifecycle; zero model calls.'); process.exit(0); }
const plan=await read(path.join(d,'plan.json')), receipts=await read(path.join(d,'../expand/prompt-receipts.json')), contexts=await read(path.join(d,'contexts.json'));
const list:any[]=[];
for(const [key,n] of seeds){ const id=ids.runs[`${key}-${n}`], i=n-1;
  const prepared=experiment.preparedRuns.find((r:any)=>r.id===id); assert(prepared,'missing prepared '+id);
  assert.equal(prepared.request.model,'gpt-6-astra'); assert.equal(prepared.request.effort,'high'); assert.equal(prepared.request.passes,1);
  assert.equal(prepared.prompts[0].promptId,receipts[key].promptId); assert.equal(prepared.prompts[0].version,1);
  assert.equal(prepared.prompts[0].stages.alternative,await readFile(path.join(d,'../expand',key+'.txt'),'utf8'));
  assert.equal(prepared.agentContextId,contexts[`${key}-${n}`].agentContextId);
  const jobDir=path.join(d,'runs',`${key}-${i+1}`); await mkdir(jobDir,{recursive:true});
  const run=(await runs.read(id))??{...prepared,name:`Ghostty · ${names[key]} · expand ${n} → round 2`,coordinator:'canvas-discovery'};
  const input=await library.read(run.agentContextId,false); assert.equal(input.contentHash,run.contexts.context.contentHash);
  if(await exists(path.join(jobDir,'started.json'))&&!await exists(path.join(jobDir,'response.json'))) throw Error('Already launched '+id+'; no saved response');
  list.push({run,input,jobDir});
}
assert.equal(list.length,7);
log('All 7 prepared runs match pinned prompts, contexts and settings; zero model calls.');
if(mode==='check') process.exit(0);
for(const job of list) await runs.save(job.run);
if(experiment.generationReview.status!=='started'){
  const response=await fetch(`http://127.0.0.1:5191/api/mapping/evals/experiments/${coreIds.experiment}/approve`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({requestId:ids.approval,expectedRevision:plan.revision})});
  const receipt=await response.json(); assert(response.ok,JSON.stringify(receipt)); assert.equal(receipt.generationReview.status,'started');
}
async function generate({run,input,jobDir}:any){
  if(run.status==='finished') return;
  const runtime=new AgentContextEvalRuntime(root,true), cell=run.cells[0]; let step='generation';
  try{
    const outputFile=path.join(jobDir,'response.json'), pinned=run.prompts[0];
    const prompt=composePrompt(evalWorkflows.alternatives,'alternative',pinned.stages.alternative,{},pinned.templateBase);
    let response;
    if(await exists(outputFile)) response=await read(outputFile);
    else {
      await writeFile(path.join(jobDir,'started.json'),JSON.stringify({runId:run.id,at:time(),model:'gpt-6-astra',effort:'high',authorization:'User: Okay lets generate a second round of expansion, so take whatever was generated from the last step and then expand it again'}),{flag:'wx'});
      run.status='generating'; cell.status='generating'; cell.startedAt=time(); await runs.save(run); log('Started '+run.name);
      response=await runtime.generate({workflow:'alternatives',stage:'alternative',model:'gpt-6-astra',effort:'high',signal:new AbortController().signal,prompt,schema:alternativeOutputSchema,
        files:{'context.json':{name:input.name,description:input.description,snapshot:input.snapshot}}});
      await write(outputFile,response);
    }
    step='validation'; const {output,history}=materializeAlternative(response.output);
    step='persistence';
    const editor=controller({id:run.id,name:run.name,history,diagramIds:{}});
    editor.canvasView(editor.getSnapshot().version,{operation:'create',name:run.name});
    const resultHistory=editor.exportHistory();
    if(!await exists(path.join(storage,'canvas-timelines',run.id+'.json')))
      await saveHistory(timeline,run.id,run.name,resultHistory,{commits:[COMMIT],agentContextId:run.agentContextId,planId:pinned.promptId,runId:run.id});
    const result=await timeline.result(run.id,'output');
    Object.assign(cell,{status:'finished',completedAt:time(),explanation:output.explanation,output:summarizeEvalOutput(result),historyArtifact:{timelineId:run.id,stepId:'output'},execution:response.execution,usage:response.usage});
    delete cell.error; delete run.error; run.status='finished'; run.completedAt=cell.completedAt; await runs.save(run);
    await write(path.join(jobDir,'status.json'),{status:'finished',runId:run.id,diagrams:output.diagrams.length,edges:output.edges.length,characters:output.diagrams.reduce((n:number,x:any)=>n+x.ascii.length,0)});
    log(`Finished ${run.name} (${output.diagrams.length} diagrams, ${output.edges.length} edges)`);
  }catch(e){
    const error=String(e);
    Object.assign(cell,{status:'failed',completedAt:time(),error}); Object.assign(run,{status:'failed',completedAt:cell.completedAt,error}); await runs.save(run);
    await write(path.join(jobDir,'failure.json'),{step,error}); log('Failed '+run.name+' '+error); throw e;
  }finally{ runtime.dispose(); }
}
const results=await Promise.allSettled(list.map(generate));
if(results.some(r=>r.status==='rejected')) process.exitCode=1;
