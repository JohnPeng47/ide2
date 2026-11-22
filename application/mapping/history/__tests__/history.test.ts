import { afterEach, expect, it } from 'vitest';
import { mkdtemp, rm, readFile, readdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { materializeDiagrams } from '../../rollup/rollUpMaterializer';
import { controller, materializeHistoryStep, type HistoryCanvasSet } from '../historyMaterializer';
import { FileCanvasTimeline } from '../../../../infrastructure/mapping/history/fileCanvasTimeline';
import { validateHistoryPlan, type HistoryBatch, type HistoryStep } from '../../../../domain/mapping/history/diagramHistory';
import { CanvasHistory, documentFromHistory } from '../../../../domain/core/diagrams/canvasHistory';
import { preflightHistory } from '../../../../scripts/evals/history/preflight';
import { historyBaseline } from '../historyBaseline';
import { canvasInput } from '../historyMaterializer';
import { connectionContentNodes, validateConnectionAnchor } from '../../../../domain/core/diagrams/diagramConnection';
const roots:string[]=[];afterEach(async()=>{await Promise.all(roots.splice(0).map(p=>rm(p,{recursive:true,force:true})));});
const commits=['a'.repeat(40),'b'.repeat(40),'c'.repeat(40),'d'.repeat(40)];
function fixture(){
  const set:HistoryCanvasSet={C:{id:'base-C',name:'Original',history:materializeDiagrams([{id:'D',ascii:'Original\n`-- Child',position:{column:0,row:0}}],[],'base-C'),diagramIds:{D:'base-C-D'}}};
  const c=controller(set.C);c.canvasView(0,{operation:'create',name:'Baseline'});set.C.history=c.exportHistory();
  return set;
}
const batch:HistoryBatch={id:'step1',title:'New responsibility',commits:commits.slice(0,2),rationale:'A coherent change',dependsOn:[],futureDependencies:[{commit:commits[2],reason:'Uses the new component'}],sourcePaths:['domain/example.ts'],tree:'Proposed diagram changes',
  changes:[{canvasId:'C',canvasName:'Original',newCanvas:false,diagrams:[{diagramId:'new',title:'New',newDiagram:true,operation:'2',instruction:'Add the new owner',position:{column:100,row:0},targetNodes:2}]}],
  edges:[{sourceCanvas:'C',sourceDiagram:'D',targetCanvas:'C',targetDiagram:'new',sourceLabel:null,targetLabel:null,label:'owns'}]};
const fill={explanation:'New owner',diagrams:[{canvasId:'C',diagramId:'new',ascii:'New\n`-- State',position:null}],edges:batch.edges};
const ref=(set:HistoryCanvasSet)=>Object.values(set).map(c=>({documentId:c.id,name:c.name,viewId:c.history.canvasViews!.activeViewId!,checkpointId:c.history.headId}));
const histories=(set:HistoryCanvasSet)=>Object.fromEntries(Object.values(set).map(c=>[c.id,c.history]));
const step=(id:string,set:HistoryCanvasSet,previousStepId?:string):HistoryStep=>({id,previousStepId,phase:'execution',title:id,commits:[],agentContextId:'context',planId:'plan',canvases:ref(set)});
function connectedFixture() {
 const history=materializeDiagrams([
   {id:'a',ascii:'Source\n`-- Child',position:{column:20,row:13}},
   {id:'b',ascii:'Target\n`-- State',position:{column:183,row:21}},
 ],[{source:{diagram:'a',line:2},target:{diagram:'b',line:2},label:'updates'}],'saved');
 return {C:{id:'saved',name:'Saved layout',history,diagramIds:{a:'saved-a',b:'saved-b'}}};
}
it('recovers exact baseline geometry and edge identities, rejecting mismatched evidence',()=>{
 const set=connectedFixture(), doc=documentFromHistory(set.C.history);
 const capture={key:'C',name:'Saved layout',documentId:'saved',diagrams:Object.entries(set.C.diagramIds).map(([key,id])=>({key:`C/${key}`,ascii:doc.scene.contents[id].content.ascii,asciiSha256:doc.scene.contents[id].content.asciiSha256})),edges:{edges:doc.edges}};
 const documents=[{representationId:'saved',history:set.C.history}];
 const recovered=historyBaseline([capture],documents,'isolated').canvases;
 expect(documentFromHistory(recovered.C.history)).toEqual(doc);
 expect(recovered.C.id).toBe('isolated-C');
 expect(canvasInput(recovered)[0].diagrams.map(d=>[d.position.column,d.position.row])).toEqual([[20,13],[183,21]]);
 expect(()=>historyBaseline([{...capture,edges:{edges:[]}}],documents,'bad')).toThrow('connections changed');
 expect(()=>historyBaseline([{...capture,diagrams:[{...capture.diagrams[0],ascii:'Changed'},capture.diagrams[1]]}],documents,'bad')).toThrow('hash mismatch');
});
it('retains internal attachment labels when edited nodes move to different lines',()=>{
 const set=connectedFixture();
 const edit={...batch,changes:[{canvasId:'C',canvasName:'Saved layout',newCanvas:false,diagrams:[{...batch.changes[0].diagrams[0],diagramId:'a',newDiagram:false}]}],edges:[]};
 const output={explanation:'Add internal state',diagrams:[{canvasId:'C',diagramId:'a',ascii:'Source\n+-- Added\n`-- Child',position:null}],edges:[]};
 const after=materializeHistoryStep(set,edit,'edit','execute',output);
 const doc=documentFromHistory(after.C.history), edge=doc.edges[0];
 validateConnectionAnchor(doc.scene,edge.source);
 expect(connectionContentNodes(doc.scene.contents['saved-a'].content).find(n=>n.id===edge.source.contentNodeId)).toMatchObject({line:3,label:'Child'});
 expect(edge.id).toBe(documentFromHistory(set.C.history).edges[0].id);
 expect(()=>materializeHistoryStep(set,edit,'bad','execute',{...output,diagrams:[{...output.diagrams[0],ascii:'Source\n`-- Different'}]})).toThrow('attachment text');
});
it('requires an explicit unique semantic mapping when an attached label changes',()=>{
 const set=connectedFixture();
 const edit={...batch,changes:[{canvasId:'C',canvasName:'Saved',newCanvas:false,diagrams:[{...batch.changes[0].diagrams[0],diagramId:'a',newDiagram:false}]}],edges:[]};
 const output={explanation:'Rename concept',diagrams:[{canvasId:'C',diagramId:'a',ascii:'Source\n`-- Renamed child',position:null}],edges:[],attachmentMappings:[{canvasId:'C',diagramId:'a',previousLabel:'Child',nextLabel:'Renamed child'}]};
 const after=materializeHistoryStep(set,edit,'edit','execute',output), doc=documentFromHistory(after.C.history);
 expect(connectionContentNodes(doc.scene.contents['saved-a'].content).find(n=>n.id===doc.edges[0].source.contentNodeId)?.label).toBe('Renamed child');
 expect(()=>materializeHistoryStep(set,edit,'edit','execute',{...output,attachmentMappings:[]})).toThrow('attachment text');
 expect(()=>materializeHistoryStep(set,edit,'edit','execute',{...output,attachmentMappings:[{...output.attachmentMappings[0],previousLabel:'Unknown'}]})).toThrow('Unknown previous');
 expect(()=>materializeHistoryStep(set,edit,'edit','execute',{...output,attachmentMappings:[{...output.attachmentMappings[0],nextLabel:'Missing'}]})).toThrow('identify one node');
});
it('retains the semantic source and target of cross-canvas navigation after edits',()=>{
 const original=connectedFixture();
 const set={...original,Other:{...structuredClone(original.C),id:'other'}};
 const edges=[{sourceCanvas:'C',sourceDiagram:'a',targetCanvas:'Other',targetDiagram:'b',sourceLabel:'Child',targetLabel:'State',label:'updates'}];
 const linked=materializeHistoryStep(set,{...batch,changes:[],edges},'link','execute',{explanation:'Link',diagrams:[],edges});
 const edit={...batch,changes:[['C','a'],['Other','b']].map(([canvasId,diagramId])=>({canvasId,canvasName:'Saved',newCanvas:false,diagrams:[{...batch.changes[0].diagrams[0],diagramId,newDiagram:false}]})),edges:[]};
 const after=materializeHistoryStep(linked,edit,'edit','execute',{explanation:'Extend',diagrams:[{canvasId:'C',diagramId:'a',ascii:'Source\n+-- Added\n`-- Child',position:null},{canvasId:'Other',diagramId:'b',ascii:'Target\n+-- Added\n`-- State',position:null}],edges:[]});
 const doc=documentFromHistory(after.C.history), target=documentFromHistory(after.Other.history), jump=doc.jumps![0];
 expect(jump.source.line).toBe(3);
 expect(jump.source.revisionId).toBe(doc.scene.contents['saved-a'].content.revisionId);
 expect(connectionContentNodes(target.scene.contents['saved-b'].content).find(n=>n.id===jump.target.contentNodeId)).toMatchObject({line:3,label:'State'});
});
it('validates exact chronological multi-commit batches and downstream evidence',()=>{
 const later={...batch,id:'step2',commits:commits.slice(2),dependsOn:['step1'],futureDependencies:[],changes:[],edges:[]};
 expect(validateHistoryPlan({explanation:'Plan',batches:[batch,later]},commits,{C:['D']},true).batches).toHaveLength(2);
 expect(()=>validateHistoryPlan({explanation:'Plan',batches:[later,batch]},commits,{C:['D']},true)).toThrow('partition');
 expect(()=>validateHistoryPlan({explanation:'Plan',batches:[{...batch,commits:[commits[0]]}]},[commits[0]],{C:['D']},true)).toThrow();
 expect(()=>validateHistoryPlan({explanation:'Plan',batches:[{...batch,futureDependencies:[{commit:commits[0],reason:'Wrong'}]},later]},commits,{C:['D']},true)).toThrow('Lookahead');
});
it('fills pinned scaffold identities, preserves baseline and rejects structural drift',()=>{
 const before=fixture(), baseline=JSON.stringify(before);
 const scaffold=materializeHistoryStep(before,batch,'history','scaffold',undefined,undefined,true);
 const complete=materializeHistoryStep(before,batch,'history','execute',fill,scaffold,true);
 const a=documentFromHistory(scaffold.C.history).scene.contents['history-C-new'];
 const b=documentFromHistory(complete.C.history).scene.contents['history-C-new'];
 expect(a.diagramId).toBe(b.diagramId);expect(a.content.ascii).toContain('[2 nodes]');expect(b.content.ascii).toBe('New\n`-- State');
 expect(documentFromHistory(complete.C.history).edges).toHaveLength(1);expect(JSON.stringify(before)).toBe(baseline);
 expect(()=>materializeHistoryStep(before,batch,'history','execute',{...fill,edges:[]},scaffold,true)).toThrow('edges');
 expect(()=>materializeHistoryStep(before,batch,'history','execute',{...fill,diagrams:[{...fill.diagrams[0],ascii:'New'}]},scaffold,true)).toThrow('tree nodes');
});
it('publishes complete sets as references, retains previous states after reload and resumes editing',async()=>{
 const root=await mkdtemp(path.join(tmpdir(),'canvas-timeline-'));roots.push(root);const store=new FileCanvasTimeline(root);
 const before=fixture(), scaffold=materializeHistoryStep(before,batch,'history','scaffold',undefined,undefined,true),after=materializeHistoryStep(before,batch,'history','execute',fill,scaffold,true);
 const a=step('baseline',before),b=step('scaffold',scaffold,'baseline'),c=step('execution',after,'baseline');
 await store.append('test','project',0,a,histories(before));await store.append('test','project',1,b,histories(scaffold));await store.append('test','project',2,c,histories(after));
 const restarted=new FileCanvasTimeline(root);
 expect((await restarted.result('test','baseline')).canvases[0].proposed.document.scene.contents['base-C-D'].content.ascii).toBe('Original\n`-- Child');
 expect((await restarted.result('test','execution')).canvases[0].proposed.document.scene.contents['history-C-new'].content.ascii).toBe('New\n`-- State');
 const restored=await restarted.editingHistory('test',c.canvases[0]);expect(controller({...after.C,history:restored}).getSnapshot().document.scene.contents['history-C-new'].content.ascii).toBe('New\n`-- State');
 expect(await preflightHistory(restarted,'test',after,'execution')).toMatchObject({canvases:1,modelCalls:0});
 expect(JSON.parse(await readFile(path.join(root,'canvas-timelines/test.json'),'utf8')).documents['base-C'].items).toBeDefined();
 expect(await readFile(path.join(root,'canvas-timelines/test.json'),'utf8')).not.toContain('`-- State');
 const blobs=await readdir(path.join(root,'canvas-timelines/records'));
 await restarted.append('test','project',3,step('unchanged',after,'execution'),{});
 expect(await readdir(path.join(root,'canvas-timelines/records'))).toEqual(blobs);
 await expect(restarted.append('test','project',1,step('stale',after,'execution'),{})).rejects.toThrow('VERSION_CONFLICT');
 const old=await readFile(path.join(root,'canvas-timelines/test.json'),'utf8');
 await expect(restarted.append('test','project',4,{...step('bad',after,'execution'),canvases:[{...c.canvases[0],checkpointId:'missing'}]},{})).rejects.toThrow('Unpersisted');
 expect(await readFile(path.join(root,'canvas-timelines/test.json'),'utf8')).toBe(old);
 const corrupt=structuredClone(after);corrupt.C.history.snapshots[corrupt.C.history.headId].document.sections={bad:[]};
 await expect(new FileCanvasTimeline(root).append('test','project',4,step('corrupt',corrupt,'execution'),histories(corrupt))).rejects.toThrow('Immutable checkpoint');
 expect(await readFile(path.join(root,'canvas-timelines/test.json'),'utf8')).toBe(old);
});
it('round-trips a cropped revisioned baseline through preflight and rejects explicit corrupt boundaries',async()=>{
 const root=await mkdtemp(path.join(tmpdir(),'history-boundary-'));roots.push(root);
 const set=fixture(), c=controller(set.C);
 c.applyUpdate(c.getSnapshot().version,[{method:'replace',nodeId:'grid:base-C-D',ascii:'Original\n+-- Added\n`-- Child',structureKind:'tree'}]);
 const h=c.exportHistory(), cropped=new CanvasHistory(documentFromHistory(h),h.snapshots[h.headId].view);
 cropped.canvasView({operation:'create',name:'Pinned starting view'});set.C.history=cropped.export();
 expect(Object.keys(set.C.history.revisionBoundary??{}).length).toBeGreaterThan(0);
 const store=new FileCanvasTimeline(root), initial=step('baseline',set);
 await store.append('test','project',0,initial,histories(set));
 const reopened=await new FileCanvasTimeline(root).editingHistory('test',initial.canvases[0]);
 expect(reopened.revisionBoundary).toEqual(set.C.history.revisionBoundary);
 const mapping={C:{id:set.C.id,name:set.C.name,diagramIds:set.C.diagramIds}};
 expect(await preflightHistory(new FileCanvasTimeline(root),'test',mapping)).toMatchObject({canvases:1,modelCalls:0});
 const file=path.join(root,'canvas-timelines/test.json'), manifest=JSON.parse(await readFile(file,'utf8'));
 delete manifest.documents[set.C.id].revisionBoundary;
 await writeFile(file,JSON.stringify(manifest)); // Compatibility with the original timeline format.
 expect((await new FileCanvasTimeline(root).editingHistory('test',initial.canvases[0])).revisionBoundary).toEqual(set.C.history.revisionBoundary);
 manifest.documents[set.C.id].revisionBoundary={};
 await writeFile(file,JSON.stringify(manifest));
 await expect(preflightHistory(new FileCanvasTimeline(root),'test',mapping)).rejects.toThrow('Invalid diagram revision parent');
});
