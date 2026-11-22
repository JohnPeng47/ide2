import { readFile, writeFile, mkdir, access, mkdtemp, rm } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import { AgentContext } from '../../domain/core/agents/agentContext';
import { AgentContextLibrary } from '../../application/mapping/agent/agentContextLibrary';
import { FileAgentContextRepository } from '../../infrastructure/core/persistence/fileAgentContextRepository';
import { AgentContextEvalRuntime } from '../../infrastructure/mapping/evals/agentContextEvalRuntime';
import { JsonDirectoryStore } from '../../infrastructure/mapping/evals/jsonDirectoryStore';
import { FileCanvasTimeline } from '../../infrastructure/mapping/history/fileCanvasTimeline';
import { prepareRepositoryContext } from '../../infrastructure/core/agents/repositoryContext';
import { controller } from '../../application/mapping/history/historyMaterializer';
import { composePrompt, evalWorkflows } from '../../domain/mapping/evals/evalWorkflows';
import { materializeAlternative } from '../../application/mapping/evals/alternativeMaterializer';
import { alternativeOutputSchema } from '../../domain/mapping/evals/alternatives';
import { summarizeEvalOutput } from '../../domain/mapping/evals/evalOutputResult';
import { documentFromHistory } from '../../domain/core/diagrams/canvasHistory';
import { connectionBox, connectionContentNodes, getArrowLabel } from '../../domain/core/diagrams/diagramConnection';
const phase = process.argv[2];
assert(['p1','p2','p3'].includes(phase));
const d = import.meta.dirname, root = path.resolve(d,'../..'), storage = path.join(root,'.diagrams-local/canvas-domain-model');
const read = async (file:string) => JSON.parse(await readFile(file,'utf8'));
const write = (file:string, x:unknown) => writeFile(file,JSON.stringify(x,null,2)+'\n');
const exists = async (file:string) => access(file).then(()=>true,()=>false);
const ids = await read(path.join(d,'ids.json')), stage = ids.stages[phase];
const runs = new JsonDirectoryStore<any>(storage,'eval-runs');
const experiments = new JsonDirectoryStore<any>(storage,'eval-experiments');
const library = new AgentContextLibrary(new FileAgentContextRepository(storage));
const timeline = new FileCanvasTimeline(storage);
const seeds = await read(path.join(d,'../core-to-canvas-2026-11-17/contexts-receipt.json'));
const experiment = await experiments.read(ids.experiment);
const choices = phase === 'p3' ? (await read(path.join(d,'selection.json'))).selections : [];
if (phase === 'p3') assert.deepEqual(choices.map((c:any)=>c.repository).sort(),seeds.map((s:any)=>s.key).sort());
const time = () => new Date().toISOString();
const log = (message:string) => console.log(time(),phase,message);

function asInput(history:any) {
  const doc = documentFromHistory(history);
  const diagrams = doc.scene.root.children.map(box=>{
    assert.equal(box.kind,'diagram');
    return {id:box.id.replace(/^alt-/,''),ascii:doc.scene.contents[box.contentId].content.ascii,position:box.position};
  });
  const endpoint=(anchor:any)=>{
    const box=connectionBox(doc.scene,anchor.displayNodeId);
    assert(box?.kind==='diagram');
    const node=connectionContentNodes(doc.scene.contents[box.contentId].content).find(n=>n.id===anchor.contentNodeId);
    assert(node);
    return {diagram:box.id.replace(/^alt-/,''),line:node.line};
  };
  const edges=doc.edges.map(edge=>({source:endpoint(edge.source),target:endpoint(edge.target),label:getArrowLabel(edge.appearance).text}));
  return {diagrams,edges};
}
async function saveHistory(store:FileCanvasTimeline,runId:string,name:string,history:any,metadata:any) {
  const ref={documentId:runId,name,viewId:history.canvasViews.activeViewId,checkpointId:history.headId};
  await store.append(runId,experiment.projectId,0,{id:'output',phase:'execution',title:name,canvases:[ref],...metadata},{[runId]:history});
  return ref;
}
async function prepare(seed:any) {
  const previousPhase=phase==='p1'?'core':phase==='p2'?'p1':'p2';
  const choice=choices.find((c:any)=>c.repository===seed.key);
  const sample=phase==='p3'?choice.sample:1;
  const seedLabel=phase==='p1'?'core tree':previousPhase.toUpperCase()+' sample '+sample;
  assert(Number.isInteger(sample) && sample>=1 && sample<=3);
  const runId=ids.stages[previousPhase].runs[seed.key][sample-1];
  const run=await runs.read(runId);
  assert.equal(run.status,'finished');
  const ref=(await timeline.read(runId)).steps[0].canvases[0];
  if(choice){assert.equal(choice.runId,runId);assert.equal(choice.checkpointId,ref.checkpointId);}
  const baseline=await timeline.editingHistory(runId,ref);
  const snapshot=asInput(baseline);
  let payload:string,tag:string,task:string;
  if(phase==='p1'){
    assert.equal(snapshot.diagrams.length,1);
    payload=snapshot.diagrams[0].ascii;
    assert.equal(payload,(await read(path.join(d,seed.key,'response.json'))).output.ascii);
    tag='core-component-diagram';
    task='Use this checkout to double-check the supplied core component diagram while restructuring it into a canvas. Verify the containment, ownership and relationships you rely on, and correct anything the source contradicts.';
  }else{
    const replay=materializeAlternative({explanation:'Seed round trip',...snapshot});
    assert.deepEqual(asInput(replay.history),snapshot);
    payload=JSON.stringify(snapshot,null,2);tag='current-canvas';
    task='Use this checkout to double-check the supplied canvas while restructuring it. Verify the containment, ownership and relationships you rely on, and correct anything the source contradicts.';
  }
  const name=seed.name.split(' · ')[0];
  const parent=await library.read(seed.parent,false);
  const repo=parent.snapshot.messages[0].content.find(b=>b.type==='repository')!;
  assert.equal(repo.commit,seed.commit);
  const receipt=await library.create({requestId:stage.contexts[seed.key],group:'Breadth-first core to canvas',name:name+' · '+seedLabel,
    description:'Pinned '+previousPhase+' sample '+sample+' from run '+run.id+' at checkpoint '+ref.checkpointId+'.',
    context:[{type:'text',text:'<'+tag+' repository="'+name+'" commit="'+seed.commit+'">\n'+payload+'\n</'+tag+'>'},{...repo,task}]});
  const saved=await library.read(receipt.agentContextId,false);
  assert.equal(saved.contentHash,receipt.contentHash);
  const checkout=await prepareRepositoryContext(AgentContext.fromSnapshot(saved.snapshot));
  try {
    assert.deepEqual(checkout.tools,['read','bash']);
    assert.equal(execFileSync('git',['rev-parse','HEAD'],{cwd:checkout.cwd,encoding:'utf8'}).trim(),seed.commit);
    checkout.context.toPiMessages();
  }finally{await checkout.close();}
  const temp=await mkdtemp(path.join(tmpdir(),'canvas-phase-preflight-'));
  try{
    const probeStore=new FileCanvasTimeline(temp);
    const probe=await saveHistory(probeStore,'probe',name,baseline,{commits:[seed.commit],planId:run.prompts[0].promptId,agentContextId:receipt.agentContextId});
    const reopened=await probeStore.editingHistory('probe',probe);
    assert.deepEqual(asInput(reopened),snapshot);
    const editor=controller({id:'probe',name,history:reopened,diagramIds:{}});
    editor.canvasView(editor.getSnapshot().version,{operation:'fork',viewId:probe.viewId,name:'Editing preflight'});
    editor.canvasView(editor.getSnapshot().version,{operation:'save'});
    assert.equal((await probeStore.result('probe','output')).canvases.length,1);
  }finally{await rm(temp,{recursive:true,force:true});}
  return {...receipt,source:{experimentId:ids.experiment,runId,cellKey:run.cells[0].key,checkpointId:ref.checkpointId,label:name+' · '+seedLabel}};
}

if(process.argv[3]==='prepare'){
  const result=await Promise.all(seeds.map(prepare));
  await write(path.join(d,phase+'-contexts.json'),result);
  log('Verified four input checkpoints and pinned repositories');
  process.exit(0);
}

const plan=await read(path.join(d,phase+'-plan.json'));
const list=[];
for(const seed of seeds){
  for(const [i,id] of stage.runs[seed.key].entries()){
    const prepared=experiment.preparedRuns.find((r:any)=>r.id===id);
    assert.equal(prepared.request.model,'gpt-6-astra');
    assert.equal(prepared.request.effort,'high');
    assert.equal(prepared.prompts[0].version,plan.version);
    assert.equal(prepared.prompts[0].promptId,plan.promptId);
    assert.equal(prepared.agentContextId,'saved-agent-context-'+stage.contexts[seed.key]);
    const jobDir=path.join(d,phase,seed.key+'-'+(i+1));
    await mkdir(jobDir,{recursive:true});
    const run=(await runs.read(id))??{...prepared,name:seed.name.split(' · ')[0]+' · '+phase.toUpperCase()+' sample '+(i+1),coordinator:'canvas-discovery'};
    const input=await library.read(run.agentContextId,false);
    assert.equal(input.contentHash,run.contexts.context.contentHash);
    if(await exists(path.join(jobDir,'started.json'))&&!await exists(path.join(jobDir,'response.json')))throw Error('Already launched '+id+'; no saved response available');
    list.push({run,input,commit:seed.commit,jobDir});
  }
}
assert.equal(list.length,12);
for(const job of list)await runs.save(job.run);
if(experiment.generationReview.status!=='started'){
  const response=await fetch('http://127.0.0.1:5191/api/mapping/evals/experiments/'+ids.experiment+'/approve',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({requestId:stage.approval,expectedRevision:plan.revision})});
  const receipt=await response.json();assert(response.ok,JSON.stringify(receipt));assert.equal(receipt.generationReview.status,'started');
}
async function generate({run,input,commit,jobDir}:any){
  if(run.status==='finished')return;
  const runtime=new AgentContextEvalRuntime(root,true),cell=run.cells[0];
  let step='generation';
  try{
    const outputFile=path.join(jobDir,'response.json');
    const pinned=run.prompts[0],prompt=composePrompt(evalWorkflows.alternatives,'alternative',pinned.stages.alternative,{},pinned.templateBase);
    let response;
    if(await exists(outputFile)) response=await read(outputFile);
    else {
      await writeFile(path.join(jobDir,'started.json'),JSON.stringify({runId:run.id,at:time()}),{flag:'wx'});
      run.status='generating';cell.status='generating';cell.startedAt=time();await runs.save(run);
      log('Started '+run.name);
      // Match E14's repository context and metadata delivery. Each independent sample makes one generation.
      response=await runtime.generate({workflow:'alternatives',stage:'alternative',model:'gpt-6-astra',effort:'high',signal:new AbortController().signal,prompt,schema:alternativeOutputSchema,
        files:{'context.json':{name:input.name,description:input.description,snapshot:input.snapshot}}});
      await write(outputFile,response);
    }
    step='validation';
    const {output,history}=materializeAlternative(response.output);
    step='persistence';
    const editor=controller({id:run.id,name:run.name,history,diagramIds:{}});
    editor.canvasView(editor.getSnapshot().version,{operation:'create',name:run.name});
    const resultHistory=editor.exportHistory();
    if(!await exists(path.join(storage,'canvas-timelines',run.id+'.json')))
      await saveHistory(timeline,run.id,run.name,resultHistory,{commits:[commit],agentContextId:run.agentContextId,planId:pinned.promptId,runId:run.id});
    const result=await timeline.result(run.id,'output');
    Object.assign(cell,{status:'finished',completedAt:time(),explanation:output.explanation,output:summarizeEvalOutput(result),historyArtifact:{timelineId:run.id,stepId:'output'},execution:response.execution,usage:response.usage});
    delete cell.error;delete run.error;run.status='finished';run.completedAt=cell.completedAt;await runs.save(run);
    log('Finished '+run.name+' ('+output.diagrams.length+' diagrams)');
  }catch(e){
    const error=String(e);
    Object.assign(cell,{status:'failed',completedAt:time(),error});Object.assign(run,{status:'failed',completedAt:cell.completedAt,error});await runs.save(run);
    await write(path.join(jobDir,'failure.json'),{step,error});log('Failed '+run.name+' '+error);
    throw e;
  }finally{runtime.dispose();}
}
const results=await Promise.allSettled(list.map(generate));
if(results.some(r=>r.status==='rejected'))process.exitCode=1;
