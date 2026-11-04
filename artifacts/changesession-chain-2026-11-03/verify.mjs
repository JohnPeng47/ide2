import fs from'node:fs/promises';import path from'node:path';import{fileURLToPath}from'node:url';
import{documentFromHistory}from'../../domain/core/diagrams/canvasHistory.ts';
import{diagramContentNodes}from'../../domain/core/diagrams/diagramContentNodes.ts';
const dir=path.dirname(fileURLToPath(import.meta.url));const read=async n=>JSON.parse(await fs.readFile(path.join(dir,n),'utf8'));
const state=await read('state.json');if(state.status!=='finished')throw Error('Chain is not complete');
const audits=[];let parentEdges;
for(const stage of['modify','c1','c2']){
 const run=await read(stage+'-run.json'),record=await read(stage+'-canvas.json');const d=documentFromHistory(record.history);
 const boxes=new Map();const visit=b=>b.kind==='container'?b.children.forEach(visit):boxes.set('grid:'+b.id,b);visit(d.scene.root);
 const endpoint=e=>{const box=boxes.get(e.displayNodeId);if(!box)throw Error('Unknown edge box');const diagram=d.scene.contents[box.contentId];const n=diagramContentNodes(diagram.content).find(x=>x.id===e.contentNodeId);if(!n)throw Error('Missing exact content anchor');return {diagram:box.id.replace(/^alt-/,''),line:n.line,text:diagram.content.ascii.split('\n')[n.line-1]};};
 const edges=d.edges.map(e=>({source:endpoint(e.source),target:endpoint(e.target),label:typeof e.appearance?.label==='object'?e.appearance.label.text:e.appearance?.label}));
 const signatures=edges.filter(e=>['api-interfaces','api-backend'].includes(e.source.diagram)&&['api-interfaces','api-backend'].includes(e.target.diagram)).map(e=>JSON.stringify(e));
 if(stage==='modify')parentEdges=signatures;else if(parentEdges.some(e=>!signatures.includes(e)))throw Error('Lost carried parent connection');
 const nodes=[...boxes.values()].map(b=>b.id.replace(/^alt-/,''));const reached=new Set([nodes[0]]);let changed=true;while(changed){changed=false;for(const e of edges){if(reached.has(e.source.diagram)&&!reached.has(e.target.diagram)){reached.add(e.target.diagram);changed=true;}if(reached.has(e.target.diagram)&&!reached.has(e.source.diagram)){reached.add(e.source.diagram);changed=true;}}}
 if(reached.size!==nodes.length)throw Error('Disconnected cluster');
 const previous=stage==='modify'?[]:stage==='c1'?['modify']:['modify','c1'];
 if((run.previousInputs??[]).length!==previous.length)throw Error('Incorrect predecessor count');
 previous.forEach((s,i)=>{const p=run.previousInputs[i].source;if(p.documentId!==state.stages[s].canvasId||p.checkpointId!==state.stages[s].checkpointId)throw Error('Predecessor checkpoint mismatch');});
 if(run.contexts.context.contentHash!==state.context.contentHash)throw Error('Context mismatch');
 audits.push({stage,runId:run.id,runNumber:run.number,canvasId:state.stages[stage].canvasId,checkpointId:state.stages[stage].checkpointId,diagrams:nodes.length,edges:edges.length,connected:true,carriedParentEdgesPreserved:true,pinnedPredecessorsVerified:true,contextHash:run.contexts.context.contentHash,edgeAnchors:edges});
}
const exp=await(await fetch('http://localhost:5191/api/mapping/evals/experiments/'+state.experimentId)).json();
if(exp.conditions.length!==1||exp.cases.length!==1||exp.samples.length!==1||exp.samples[0].outputs.length!==3)throw Error('Wrong experiment cardinality');
for(const a of audits){const out=exp.samples[0].outputs.find(o=>o.stageId===a.stage);const r=await read(a.stage+'-run.json');if(out.runId!==a.runId||out.cellKey!==r.cells[0].key)throw Error('Incorrect stage registration');}
await fs.writeFile(path.join(dir,'verification.json'),JSON.stringify({experimentId:exp.id,oneCaseConditionSample:true,allStagesRegistered:true,stages:audits},null,2)+'\n');
await fs.writeFile(path.join(dir,'experiment.json'),JSON.stringify(exp,null,2)+'\n');
delete state.error;await fs.writeFile(path.join(dir,'state.json'),JSON.stringify(state,null,2)+'\n');
console.log(JSON.stringify(audits.map(({edgeAnchors,...a})=>a),null,2));
