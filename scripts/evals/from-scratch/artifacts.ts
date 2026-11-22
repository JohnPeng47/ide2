import { z } from 'zod';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { alternativeOutputSchema } from '../../../domain/mapping/evals/alternatives';
import { parseAsciiTree } from '../../../domain/core/diagrams/asciiTree';
import { MappingDocumentController } from '../../../domain/mapping/workspace/mappingDocumentController';
import { initialCanvasState } from '../../../domain/mapping/workspace/mappingWorkspace';
import { documentFromHistory } from '../../../domain/core/diagrams/canvasHistory';
import { addEdges } from '../../../application/mapping/rollup/rollUpMaterializer';
import { FileCanvasTimeline } from '../../../infrastructure/mapping/history/fileCanvasTimeline';
import { controller } from '../../../application/mapping/history/historyMaterializer';
import type { HistoryStep } from '../../../domain/mapping/history/diagramHistory';

const id=z.string().regex(/^[A-Za-z][A-Za-z0-9_-]{0,39}$/);
export const discoverySchema=z.object({summary:z.string(),points:z.array(z.object({id,title:z.string().min(1).max(50),rationale:z.string(),sourcePaths:z.array(z.string()).min(1),relationships:z.array(z.object({pointId:id,label:z.string(),kind:z.enum(['dependency','call','ownership','related'])}).strict())}).strict()).min(1).max(20),reviewedPaths:z.array(z.string()),limitations:z.array(z.string())}).strict();
export type Discovery=z.infer<typeof discoverySchema>;
export const treeSchema=z.object({ascii:z.string().min(1)}).strict();
export const authorSchema=z.object({plain:z.string().min(1),model:z.string().min(1),rationale:z.string()}).strict();
export const selectionSchema=z.object({assessments:z.array(z.object({variantId:z.string(),strengths:z.string(),weaknesses:z.string(),improvementPotential:z.string()}).strict()).length(6),selectedVariantIds:z.array(z.string()).length(2),rationale:z.string()}).strict();
export const critiqueSchema=z.object({summary:z.string(),strengths:z.array(z.string()),issues:z.array(z.object({evidence:z.string(),impact:z.string(),recommendation:z.string()}).strict()),regenerationInstructions:z.string()}).strict();
export const canvasSchema=alternativeOutputSchema;
export type Canvas=z.infer<typeof canvasSchema>;
export function validateTree(ascii:string) {
  if(/[^\x20-\x7e\n]/.test(ascii))throw Error('Tree must use printable ASCII and LF newlines');
  const nodes=parseAsciiTree(ascii,'ascii-tree-2');
  if(!nodes.length||nodes.filter(n=>n.parentLine===undefined).length!==1)throw Error('Expected one ASCII tree root');
  return nodes;
}
export function validateDiscovery(raw:unknown,paths:Set<string>) {
  const out=discoverySchema.parse(raw), ids=new Set(out.points.map(p=>p.id));
  if(ids.size!==out.points.length)throw Error('Duplicate point IDs');
  for(const p of out.points) {
    if(new Set(p.sourcePaths).size!==p.sourcePaths.length||p.sourcePaths.some(f=>!paths.has(f)))throw Error(`Invalid source paths for ${p.id}`);
    if(p.relationships.some(r=>!ids.has(r.pointId)||r.pointId===p.id))throw Error(`Invalid point relationship for ${p.id}`);
  }
  if(out.reviewedPaths.some(f=>!paths.has(f)))throw Error('Unknown reviewed path');
  return out;
}
export function validateCanvas(raw:unknown) {
  const out=canvasSchema.parse(raw),ids=new Set(out.diagrams.map(d=>d.id));
  if(ids.size!==out.diagrams.length)throw Error('Duplicate diagram IDs');
  const nodes=new Map(out.diagrams.map(d=>[d.id,validateTree(d.ascii)]));
  for(const edge of out.edges)for(const a of [edge.source,edge.target])if(!nodes.get(a.diagram)?.some(n=>n.line===a.line))throw Error(`Invalid edge anchor ${a.diagram}:${a.line}`);
  const seen=new Set([out.diagrams[0].id]);let changed=true;
  while(changed){changed=false;for(const e of out.edges)if(seen.has(e.source.diagram)||seen.has(e.target.diagram)){for(const id of [e.source.diagram,e.target.diagram])if(!seen.has(id)){seen.add(id);changed=true;}}}
  if(seen.size!==ids.size)throw Error('Canvas diagrams must form a connected graph');
  const boxes=out.diagrams.map(d=>({...d.position,w:Math.max(...d.ascii.split('\n').map(l=>l.length)),h:d.ascii.split('\n').length}));
  for(let i=0;i<boxes.length;i++)for(let j=0;j<i;j++){const a=boxes[i],b=boxes[j];if(a.column<b.column+b.w&&b.column<a.column+a.w&&a.row<b.row+b.h&&b.row<a.row+a.h)throw Error('Generated diagram positions overlap');}
  return out;
}
export function materialize(raw:Canvas,prefix:string) {
  const out=validateCanvas(raw);
  const c=new MappingDocumentController({scene:{contents:{},root:{id:'root',kind:'container',position:{column:0,row:0},collapsed:false,layout:{collisionPolicy:'push-right',gap:3},children:[]}},edges:[],sections:{}},initialCanvasState());
  c.applyUpdate(0,out.diagrams.map(d=>({method:'diagram-create' as const,id:`${prefix}-${d.id}`,ascii:d.ascii,position:d.position,structureKind:'tree' as const})));
  addEdges(c,out.edges,new Map(out.diagrams.map(d=>[d.id,`grid:${prefix}-${d.id}`])),prefix);
  c.canvasView(c.getSnapshot().version,{operation:'create',name:'Generated output'});
  return c.exportHistory();
}
export function single(ascii:string):Canvas{return {explanation:'Single ASCII tree',diagrams:[{id:'central',ascii,position:{column:0,row:0}}],edges:[]};}
export function report(title:string,value:unknown):Canvas {
  const clean=(s:string)=>s.normalize('NFKD').replace(/[^\x20-\x7e]/g,'?');
  const lines=[clean(title)];
  const visit=(v:unknown,indent:string,label:string)=>{
    if(v&&typeof v==='object') {
      lines.push(`${indent}|-- ${clean(label)}`);
      for(const [k,x]of Object.entries(v))visit(x,indent+'|   ',k);
    } else {
      const text=clean(`${label}: ${String(v)}`);
      for(let i=0;i<text.length;i+=150)lines.push(`${indent}|-- ${text.slice(i,i+150)}`);
    }
  };
  for(const [k,v]of Object.entries(value as object))visit(v,'',k);
  // Reports may be lengthy. Each chunk is a complete tree; raw JSON remains authoritative.
  const chunks=[];for(let i=1;i<lines.length;i+=65)chunks.push([lines[0],...lines.slice(i,i+65)].join('\n'));
  // Chunk boundaries can bisect subtrees: normalize reports as flat rows for reliable inspection.
  const diagrams=(chunks.length?chunks:[lines[0]]).map((ascii,i)=>({id:`report${i+1}`,ascii:ascii.split('\n').map((l,j)=>j?`|-- ${l.replace(/^[| ]*\|-- /,'')}`:l).join('\n'),position:{column:0,row:i*70}}));
  return {explanation:'Deterministic inspection rendering of the saved JSON output; not an extra model sample.',diagrams,edges:diagrams.slice(1).map((d,i)=>({source:{diagram:diagrams[i].id,line:1},target:{diagram:d.id,line:1},label:'continues'}))};
}
export async function preflight(canvas:Canvas, projectId:string, inputHash:string) {
  const dir=await mkdtemp(path.join(tmpdir(),'canvas-discovery-preflight-'));
  try {
    const history=materialize(canvas,'probe'),timeline=new FileCanvasTimeline(dir);
    const ref={documentId:'probe',name:'Storage preflight',viewId:history.canvasViews!.activeViewId!,checkpointId:history.headId};
    const step:HistoryStep={id:'initial',phase:'execution',title:'Storage preflight',commits:[],agentContextId:'preflight',planId:inputHash,canvases:[ref]};
    await timeline.append('preflight',projectId,0,step,{probe:history});
    const reopened=new FileCanvasTimeline(dir),restored=await reopened.editingHistory('preflight',ref);
    const c=controller({id:'probe',name:'Probe',history:restored,diagramIds:{}});
    const before=documentFromHistory(restored);
    for(const d of Object.values(before.scene.contents))if(d.content.structure.kind==='tree')validateTree(d.content.ascii);
    c.canvasView(c.getSnapshot().version,{operation:'fork',viewId:ref.viewId,name:'Editing preflight'});
    const probeRow=Math.max(...canvas.diagrams.map(d=>d.position.row+d.ascii.split('\n').length))+10;
    c.applyUpdate(c.getSnapshot().version,[{method:'diagram-create',id:'editing-probe',ascii:'Editing check\n`-- Reopened successfully',structureKind:'tree',position:{column:0,row:probeRow}}]);
    c.canvasView(c.getSnapshot().version,{operation:'save'});
    const edited=c.exportHistory(),next={...ref,viewId:edited.canvasViews!.activeViewId!,checkpointId:edited.headId};
    await reopened.append('preflight',projectId,1,{...step,id:'edited',previousStepId:'initial',canvases:[next]},{probe:edited});
    await new FileCanvasTimeline(dir).editingHistory('preflight',next);
    const output=await new FileCanvasTimeline(dir).result('preflight','edited');
    if(output.canvases.length!==1)throw Error('Preflight output missing');
    return {inputHash,modelCalls:0,checks:['materialize','save','restore','reopen-for-editing','edit','save again','load output'],at:new Date().toISOString()};
  } finally {await rm(dir,{recursive:true,force:true});}
}
