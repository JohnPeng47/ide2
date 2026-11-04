import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const dir = path.dirname(fileURLToPath(import.meta.url));
const original = JSON.parse(await fs.readFile(path.join(dir, 'manifest.json'), 'utf8'));
const proposal = original.proposals[0];
const file = path.join(dir, 'first-corrected-run.json');
let state = await fs.readFile(file, 'utf8').then(JSON.parse).catch(e => { if(e.code !== 'ENOENT') throw e; return { createdAt: new Date().toISOString(), agentContextId: proposal.context.agentContextId, contentHash: proposal.context.contentHash, createRequestId: crypto.randomUUID(), viewRequestId: crypto.randomUUID(), generationRequestId: crypto.randomUUID() }; });
const save = () => fs.writeFile(file, JSON.stringify(state, null, 2));
async function request(route, body) {
  const r = await fetch('http://127.0.0.1:5191' + route, { ...(body === undefined ? {} : { method:'POST', headers:{'content-type':'application/json'}, body:JSON.stringify(body) }), signal: AbortSignal.timeout(90000) });
  const value = await r.json(); if(!r.ok) throw Error(JSON.stringify(value)); return value;
}
const tool = (name, body) => request('/api/mapping/agent/tools/' + name, body);
const read = async () => (await tool('exec', { sessionId: state.attachment.sessionId, requestId:crypto.randomUUID(), code:'return canvas.read({level:"small"});' })).value;
const stage = process.argv[2] ?? 'status';
if(stage === 'launch') {
  await save();
  const context = await tool('read-agent-context', { agentContextId: state.agentContextId });
  if(context.contentHash !== state.contentHash) throw Error('Context changed');
  const canvases = (await tool('exec', { requestId:crypto.randomUUID(), code:'return canvas.list();' })).value;
  const workspace = canvases.find(c=>c.stableWorkspaceId===original.stableWorkspaceId);
  if(!workspace) throw Error('Workspace unavailable');
  state.workspaceId=workspace.canvasId;
  if(!state.attachment) {
    const existing = workspace.documents.find(d=>d.documentId===proposal.attachment.documentId);
    const code = existing ? `return canvas.attach(${JSON.stringify({canvasId:workspace.canvasId,documentId:existing.documentId})});`
      : `return canvas.createDocument(${JSON.stringify({canvasId:workspace.canvasId,repositoryId:original.repositoryId,name:proposal.canvasName})});`;
    state.attachment=(await tool('exec',{requestId:state.createRequestId,code})).value;
    if(existing) state.baseViewId=proposal.baseViewId;
    await save();
  }
  if(!state.baseViewId) {
    const current=await read();
    state.baseRequest ??= {sessionId:state.attachment.sessionId,requestId:state.viewRequestId,expectedVersion:current.version,operation:'create',name:'Blank baseline'};
    await save();
    state.baseViewId=(await tool('canvas-view',state.baseRequest)).activeViewId;
    if(!state.baseViewId) throw Error('Missing baseline view');
    await save();
  }
  if(!state.generation) {
    state.input ??= {canvas:{workspaceInstanceId:state.workspaceId,documentId:state.attachment.documentId},viewId:state.baseViewId,agentContextId:state.agentContextId,
      prompt:await fs.readFile(path.join(dir,'first-corrected-prompt.txt'),'utf8'),
      alternatives:[{name:'Central ASCII tree - corrected prompt',prompt:`Feature 1: ${proposal.title}\n\nCover: ${proposal.features}\n\nGenerate only the single central ASCII tree diagram for this feature, using the supplied AgentContext. Replace the starter diagram; do not add side diagrams.`}],requestId:state.generationRequestId};
    await save();state.generation=await request(`/api/mapping/agent-chat/sessions/${original.parentChatId}/gen-alternatives`,state.input);await save();
  }
  console.log(JSON.stringify({agentContextId:state.agentContextId,documentId:state.attachment.documentId,...state.generation}));
} else if(stage==='status') {
  const chat=await request(`/api/mapping/agent-chat/sessions/${state.generation.candidates[0].chatId}`);
  console.log(JSON.stringify({status:chat.status,generation:chat.generation.metadata.status,error:chat.error,pending:chat.pending,last:chat.items.filter(i=>i.kind==='assistant').at(-1)?.text}));
} else if(stage==='verify') {
  const statuses=await request('/api/mapping/agent-chat/generations?'+new URLSearchParams({workspaceInstanceId:state.workspaceId,documentId:state.attachment.documentId}));
  const candidate=state.generation.candidates[0], status=statuses.find(x=>x.viewId===candidate.viewId);
  if(status?.status!=='finished'||status.pendingSave) throw Error(JSON.stringify(status));
  if(!state.opened) {
    const current=await read();state.openRequest??={sessionId:state.attachment.sessionId,requestId:crypto.randomUUID(),expectedVersion:current.version,operation:'open',viewId:candidate.viewId};await save();
    await tool('canvas-view',state.openRequest);state.opened=true;await save();
  }
  const result=await read(), diagrams=result.nodes.filter(n=>n.kind==='diagram'&&n.content);
  if(diagrams.length!==1||diagrams[0].content.structure.kind!=='tree') throw Error('Expected exactly one parsed ASCII tree');
  const ascii=diagrams[0].content.ascii;
  if(ascii.length<100||!/[+|]--/.test(ascii)||!ascii.includes('`--')) throw Error('Missing ASCII tree branches');
  await fs.writeFile(path.join(dir,'first-corrected-diagram.txt'),ascii+'\n');
  state.verified={at:new Date().toISOString(),diagramCount:1,structureKind:'tree',lines:ascii.split('\n').length};await save();
  console.log(JSON.stringify({title:proposal.title,...state.verified}));
} else throw Error('Unknown stage');
