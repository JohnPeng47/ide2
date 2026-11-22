import { readFile, writeFile, appendFile, copyFile, mkdir, access } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { CreateAgentSessionOptions } from '@earendil-works/pi-coding-agent';
import { AgentContext, agentContextRepositories } from '../../domain/core/agents/agentContext';
import { AgentContextEvalRuntime } from '../../infrastructure/mapping/evals/agentContextEvalRuntime';
import { prepareRepositoryContext } from '../../infrastructure/core/agents/repositoryContext';
import { AgentContextLibrary } from '../../application/mapping/agent/agentContextLibrary';
import { FileAgentContextRepository } from '../../infrastructure/core/persistence/fileAgentContextRepository';
import { JsonDirectoryStore } from '../../infrastructure/mapping/evals/jsonDirectoryStore';
import { FileCanvasTimeline } from '../../infrastructure/mapping/history/fileCanvasTimeline';
import type { EvalRun } from '../../domain/mapping/evals/evalRun';
import type { StoredExperiment } from '../../application/mapping/evals/experimentService';
import { summarizeEvalOutput } from '../../domain/mapping/evals/evalOutputResult';
import { treeSchema, validateTree, single, preflight, materialize } from '../../scripts/evals/from-scratch/artifacts';

const directory = path.dirname(fileURLToPath(import.meta.url)), root = path.resolve(directory, '../..');
const ids = JSON.parse(await readFile(path.join(directory,'ids.json'),'utf8'));
const eid = ids.experiment;
const hash = (value: string) => createHash('sha256').update(value).digest('hex');
const read = async (file: string) => JSON.parse(await readFile(file, 'utf8'));
const write = async (file: string, value: unknown) => writeFile(file, JSON.stringify(value, null, 2) + '\n');
const exists = async (file: string) => { try { await access(file); return true; } catch (e) { if ((e as NodeJS.ErrnoException).code === 'ENOENT') return false; throw e; } };
const api = async (route: string, body?: unknown) => {
  const response = await fetch('http://127.0.0.1:5191/api/mapping/evals' + route, body === undefined ? {} : {method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
  const result = await response.json(); if (!response.ok) throw Error(`${route}: ${response.status} ${JSON.stringify(result)}`); return result;
};
const config = await read(path.join(root, 'artifacts/codebase-canvas-2026-11-11/config.json'));
const contexts = new AgentContextLibrary(new FileAgentContextRepository(config.storeRoot));
const store = new JsonDirectoryStore<EvalRun>(config.storeRoot, 'eval-runs');
const experimentStore = new JsonDirectoryStore<StoredExperiment>(config.storeRoot, 'eval-experiments');
const experiment = (await experimentStore.read(eid))!;
const receipt = experiment;
const receipts = JSON.parse(await readFile(path.join(directory,'prompt-receipts.json'),'utf8'));
const promptKey = (id: string) => Object.keys(receipts).find(k => receipts[k].promptId === id)!;
const expectedIds = new Set(receipt.plannedRuns.map((p: any) => p.request.requestId));
const planned = experiment.preparedRuns!.filter(r => expectedIds.has(r.id));
if (planned.length !== 16 || experiment.plannedRuns!.length !== 16) throw Error('Unexpected run plan');
class RecordedRuntime extends AgentContextEvalRuntime {
  transcript?: string; events: Promise<unknown> = Promise.resolve();
  constructor(private artifactDirectory: string, private label: string) { super(root, true); }
  async checkModel() { const configured = await this.model('gpt-6-astra'); return {provider:configured.provider,model:configured.modelId}; }
  protected async createSession(configuration: Omit<CreateAgentSessionOptions, 'sessionManager'>, context?: AgentContext) {
    const result = await super.createSession(configuration, context); this.transcript = result.session.sessionFile;
    await write(path.join(this.artifactDirectory,'runtime-session.json'),{sessionId:result.session.sessionId,transcript:this.transcript,cwd:configuration.cwd,tools:configuration.tools,contextHash:context?.contentHash,model:'gpt-6-astra',effort:'high'});
    result.session.subscribe(event => {
      if (!['agent_start','agent_end','tool_execution_start','tool_execution_end','message_end'].includes(event.type)) return;
      this.events = this.events.then(() => appendFile(path.join(this.artifactDirectory,'events.jsonl'),JSON.stringify(event)+'\n'));
      if (event.type === 'tool_execution_start') console.log(JSON.stringify({repository:this.label,status:'inspecting',tool:event.toolName}));
      if (event.type === 'message_end' && event.message.role === 'assistant') console.log(JSON.stringify({repository:this.label,status:'model-turn',stopReason:event.message.stopReason}));
    }); return result;
  }
  async flush() { await this.events; if(this.transcript) await copyFile(this.transcript,path.join(this.artifactDirectory,'transcript.jsonl')); }
}
const checker = new RecordedRuntime(directory,'preflight'); const model = await checker.checkModel(); checker.dispose();
const entries = [];
for (const prepared of planned) {
  const plannedRun = experiment.plannedRuns!.find(p=>p.request.requestId===prepared.id)!;
  const sample = experiment.samples.find(s=>s.id===plannedRun.outputs[0].sampleId)!;
  const input = experiment.cases.find(c=>c.id===sample.caseId)!;
  const key = promptKey(prepared.prompts[0].promptId); if(!key) throw Error('Unknown prompt');
  const prompt = await readFile(path.join(directory,'prompts',key+'.txt'),'utf8');
  const label = `${input.name} · ${experiment.conditions.find(c=>c.id===sample.conditionId)!.name} · ${sample.number}`;
  const dir = path.join(directory,'runs',`${key}-${sample.number}`); await mkdir(dir,{recursive:true});
  const request = prepared.request;
  if(request.model!=='gpt-6-astra'||request.effort!=='high'||request.passes!==1||prepared.prompts.length!==1||prepared.prompts[0].stages.alternative!==prompt) throw Error('Reviewed settings changed');
  if(prepared.prompts[0].version!==1||plannedRun.outputs[0].cellKey!==`${prepared.prompts[0].promptId}:1:alternative`) throw Error('Wrong pinned prompt');
  const saved = await contexts.read(input.agentContextId,false), context = AgentContext.fromSnapshot(saved.snapshot);
  if(context.contentHash!==input.contentHash||prepared.contexts!.context.contentHash!==input.contentHash) throw Error('Pinned context changed');
  const descriptors = agentContextRepositories(context.toSnapshot().messages);
  if(descriptors.length!==1) throw Error('Expected one repository');
  const checkout = await prepareRepositoryContext(context);
  try {
    if(!checkout.cwd||checkout.tools.join(',')!=='read,bash') throw Error('Missing isolated checkout');
    const commit = execFileSync('git',['rev-parse','HEAD'],{cwd:checkout.cwd,encoding:'utf8'}).trim();
    if(commit!==descriptors[0].commit) throw Error('Wrong pinned commit');
    const probe = single(`Pinned source ${input.name}\n|\n|-- Commit ${commit}\n\`-- Context ${input.contentHash}`);
    await write(path.join(dir,'preflight.json'),{...await preflight(probe,experiment.projectId,hash(input.contentHash!+prompt)),model,commit,contextHash:input.contentHash,promptSha256:hash(prompt),tools:checkout.tools});
  } finally { await checkout.close(); }
  await write(path.join(dir,'context.json'),saved.snapshot);
  const run = (await store.read(prepared.id)) ?? {...structuredClone(prepared),coordinator:'canvas-discovery' as const,name:`Ghostty · ${label}`};
  if(await exists(path.join(dir,'model-started.json')) && !await exists(path.join(dir,'response.json'))) throw Error(`${input.name}: already started without saved response; refusing another generation`);
  entries.push({run,input,dir,saved,commit:descriptors[0].commit,prompt,label});
}
console.log(`All ${entries.length} pinned inputs and storage lifecycles passed preflight; zero model calls.`);
if(!process.argv.includes('--execute')) process.exit(0);
// The reviewed prompt requires the historical single-tree runner. Register those exact
// prepared jobs first; approve() then attaches them idempotently without launching the
// incompatible standard alternatives adapter. No experiment record is edited on disk.
for(const entry of entries) await store.save(entry.run);
if(experiment.generationReview!.status!=='started') {
  const approvalPath=path.join(directory,'approval-request.json');
  const approval=await exists(approvalPath)?await read(approvalPath):{requestId:randomUUID(),expectedRevision:experiment.revision};
  await write(approvalPath,approval); await write(path.join(directory,'approval-receipt.json'),await api(`/experiments/${eid}/approve`,approval));
}
const attached=await api(`/experiments/${eid}`);
if(attached.generationReview.status!=='started') throw Error('Approval not recorded');
for(const e of entries) if(!attached.samples.some((s:any)=>s.outputs.some((o:any)=>o.runId===e.run.id))) throw Error('Missing output attachment');
const stop = new AbortController();
async function generate(entry: typeof entries[number]) {
  const {run,input,dir,saved,commit,prompt,label}=entry, runtime=new RecordedRuntime(dir,label);
  if(run.status==='finished') return read(path.join(dir,'status.json'));
  let phase='orchestration';
  try {
    let response=await exists(path.join(dir,'response.json'))?await read(path.join(dir,'response.json')):undefined;
    if(!response) {
      stop.signal.throwIfAborted();
      await writeFile(path.join(dir,'model-started.json'),JSON.stringify({runId:run.id,at:new Date().toISOString(),model:'gpt-6-astra',effort:'high',authorization:'User: Okay lets run it, use astra-high for all of them. Oh and lets do 2x per run',promptSha256:hash(prompt),contextHash:input.contentHash}),{flag:'wx'});
      phase='generation';run.status='generating';Object.assign(run.cells[0],{status:'generating',startedAt:new Date().toISOString()});await store.save(run);
      await write(path.join(dir,'status.json'),{status:'generating',repository:label,runId:run.id});
      response=await runtime.generate({workflow:'alternatives',stage:'alternative',prompt,schema:treeSchema,agentContext:saved.snapshot,files:{},model:'gpt-6-astra',effort:'high',signal:stop.signal});
      await write(path.join(dir,'response.json'),response);await runtime.flush();
    }
    phase='validation';const output=treeSchema.parse(response.output),nodes=validateTree(output.ascii);
    await write(path.join(dir,'validated-output.json'),output);await writeFile(path.join(dir,'diagram.ascii.txt'),output.ascii);
    await write(path.join(dir,'output-preflight.json'),await preflight(single(output.ascii),experiment.projectId,hash(output.ascii)));
    phase='materialization';const timeline=new FileCanvasTimeline(config.storeRoot);
    let previous;try{previous=await timeline.read(run.id);}catch(e){if((e as NodeJS.ErrnoException).code!=='ENOENT')throw e;}
    if(!previous){
      const history=materialize(single(output.ascii),run.id);
      const ref={documentId:run.id,name:run.name!,viewId:history.canvasViews!.activeViewId!,checkpointId:history.headId};
      await timeline.append(run.id,experiment.projectId,0,{id:'output',phase:'execution',title:ref.name,commits:[commit],agentContextId:input.agentContextId,planId:run.prompts[0].promptId,runId:run.id,canvases:[ref]},{[run.id]:history});
    }
    const result=await timeline.result(run.id,'output');
    Object.assign(run.cells[0],{status:'finished',historyArtifact:{timelineId:run.id,stepId:'output'},output:summarizeEvalOutput(result),usage:response.usage,execution:response.execution,completedAt:new Date().toISOString()});
    run.status='finished';run.completedAt=run.cells[0].completedAt;delete run.error;delete run.cells[0].error;await store.save(run);
    const status={status:'finished',repository:label,runId:run.id,characters:output.ascii.length,lines:output.ascii.split('\n').length,nodes:nodes.length,usage:response.usage,execution:response.execution,outputUrl:`http://127.0.0.1:5191/evals?run=${run.id}&output=${encodeURIComponent(run.cells[0].key)}`};
    await write(path.join(dir,'status.json'),status);console.log(JSON.stringify(status));return status;
  }catch(error){
    const message=error instanceof Error?error.message:String(error);
    run.status='failed';run.error=message;Object.assign(run.cells[0],{status:'failed',error:message,completedAt:new Date().toISOString()});await store.save(run);
    await write(path.join(dir,'status.json'),{status:'failed',phase,repository:label,runId:run.id,error:message});throw error;
  }finally{await runtime.flush();runtime.dispose();}
}
const results=await Promise.allSettled(entries.map(generate));
const summary={status:results.every(r=>r.status==='fulfilled')?'finished':'partial',experimentId:eid,model:'gpt-6-astra',effort:'high',samples:await Promise.all(entries.map(e=>read(path.join(e.dir,'status.json'))))};
await write(path.join(directory,'status.json'),summary);console.log(JSON.stringify({status:summary.status,samples:summary.samples.map(s=>({repository:s.repository,status:s.status,runId:s.runId}))}));
if(results.some(r=>r.status==='rejected'))process.exitCode=1;
