import { describe, expect, it } from 'vitest';
import { singleDiagramScene } from '../../../core/diagrams/projectDiagramCanvas';
import { composeScene, resolveScene, flattenGrid } from '../../../core/diagrams/lineGrid';
import { diagramProjection } from '../diagramViewState';
import { MappingDocumentController } from '../mappingDocumentController';
import { mappingDocumentFromScene } from '../mappingDocument';
import { initialCanvasState } from '../mappingWorkspace';
import { deserializeWorkspace, serializeWorkspace } from '../mappingWorkspaceCodec';
import { displayGeometry } from '../displayModel';
import { layoutFloatingSelections } from '../floatingBoxLayout';

const ascii = 'Content\n+-- structure\n|   +-- tree\n|   |   `-- nodes\n|   `-- diagram\n`-- footer';
const setup = () => {
  const scene = singleDiagramScene(ascii);
  scene.contents.overview.structureKind = 'tree';
  return new MappingDocumentController(mappingDocumentFromScene(scene, {}), initialCanvasState());
};
const target = (controller: MappingDocumentController, line: number) => controller.nodes().find(n => n.id === 'grid:overview')!.collapsible.subtrees.find(t => t.line === line)!;
const collapse = (controller: MappingDocumentController, line: number, collapsed = true) => controller.transact(controller.getSnapshot().version, [{method:'collapse',nodeId:'grid:overview',contentNodeId:target(controller,line).contentNodeId,collapsed}]);
const projection = (controller: MappingDocumentController) => {
  const {document,canvas} = controller.getSnapshot();
  return diagramProjection(document.scene,'overview','overview',canvas.diagramViews);
};
describe('diagram subtree view state', () => {
  it('preserves source and allocated geometry; projects rows and nested expansion through the DisplayNode interface', () => {
    const c = setup(), before = c.getSnapshot().document;
    collapse(c,3); collapse(c,2);
    expect(projection(c).sourceLines).toEqual([1,2,6]);
    expect(target(c,3)).toMatchObject({expansion:'collapsed',visibleRow:undefined});
    collapse(c,2,false);
    expect(projection(c).sourceLines).toEqual([1,2,3,5,6]);
    expect(projection(c).rowForLine(6)).toBe(4);
    expect(projection(c).lineForRow(4)).toBe(6);
    expect(projection(c).rect({startLine:3,endLine:5,startColumn:1,endColumn:4})).toBeUndefined();
    const {document,canvas}=c.getSnapshot();
    expect(document).toEqual(before);
    const rendered=composeScene(document.scene,(content,box)=>diagramProjection(document.scene,box.id,content.id,canvas.diagramViews).ascii);
    expect(rendered.split('\n').length).toBe(ascii.split('\n').length);
    expect(rendered).not.toContain('nodes');
    expect(resolveScene(document.scene)).toEqual(resolveScene(before.scene));
    c.undo(); expect(projection(c).sourceLines).toEqual([1,2,6]);
    c.undo(true); expect(projection(c).sourceLines).toEqual([1,2,3,5,6]);
  });
  it('rejects stale, leaf, and wrong-owner targets atomically; resets view state on source replacement and restores it on undo', () => {
    const c=setup(); collapse(c,2);
    const state=c.getSnapshot(), id=target(c,2).contentNodeId;
    expect(()=>c.transact(state.version,[{method:'collapse',nodeId:'grid:root',contentNodeId:id,collapsed:true}])).toThrow('diagram DisplayNode');
    expect(()=>c.transact(state.version,[{method:'collapse',nodeId:'grid:overview',contentNodeId:'old-revision',collapsed:true}])).toThrow('STALE_CONTENT_NODE');
    expect(()=>c.transact(state.version,[{method:'collapse',nodeId:'grid:overview',contentNodeId:id.replace('line-2','line-4'),collapsed:true}])).toThrow('no children');
    expect(c.getSnapshot()).toBe(state);
    c.transact(state.version,[{method:'replace',nodeId:'grid:overview',ascii:'New\n`-- child',structureKind:'tree'}]);
    expect(c.getSnapshot().canvas.diagramViews).toEqual({});
    c.undo(); expect(projection(c).sourceLines).toEqual([1,2,6]);
  });
  it('round-trips workspace state, accepts older workspaces and rejects invalid saved targets', () => {
    const c=setup();collapse(c,2);const s=c.getSnapshot();
    const workspace={schemaVersion:3 as const,projectId:'project',documents:[{representationId:'diagram',revisionId:'revision',name:'Test',savedName:'Test',savedScene:JSON.stringify(s.document.scene),document:s.document,canvas:s.canvas}]};
    expect(deserializeWorkspace(serializeWorkspace(workspace)).documents[0].canvas.diagramViews).toEqual(s.canvas.diagramViews);
    const old=structuredClone(workspace);delete old.documents[0].canvas.diagramViews;
    expect(deserializeWorkspace(old).documents[0].canvas.diagramViews).toBeUndefined();
    const bad=structuredClone(workspace);bad.documents[0].canvas.diagramViews!['grid:overview'].collapsedContentNodeIds.push('missing');
    expect(()=>deserializeWorkspace(bad)).toThrow('stale diagram view');
  });
  it('keeps two instances independent and prunes a removed owner', () => {
    const c=setup(),s=c.getSnapshot();
    if(s.document.scene.root.kind!=='container') throw new Error('fixture');
    c.commitDocument({...s.document,scene:{...s.document.scene,root:{...s.document.scene.root,children:[...s.document.scene.root.children,{id:'copy',kind:'diagram',contentId:'overview',position:{column:40,row:0},collapsed:false}]}}});
    collapse(c,2);
    expect(c.nodes().find(n=>n.id==='grid:copy')!.collapsible.subtrees.every(t=>t.expansion==='expanded')).toBe(true);
    c.transact(c.getSnapshot().version,[{method:'remove',nodeId:'grid:overview'}]);
    expect(c.getSnapshot().canvas.diagramViews).toEqual({});
  });
  it('moves a retained source attachment to its visible row without changing its source rectangle', () => {
    const c=setup();collapse(c,2);const {document,canvas}=c.getSnapshot();
    const rect={startLine:6,endLine:6,startColumn:1,endColumn:5};
    const state={rootIds:['selection'],nodes:{selection:{...displayGeometry(),id:'selection',kind:'selection' as const,childIds:[],expansion:'expanded' as const,sourceBoxId:'overview',sourceContentId:'overview',sourceAscii:ascii,rect,selectedIds:[],displayMode:'stacked' as const}}};
    const result=layoutFloatingSelections(state,flattenGrid(resolveScene(document.scene)),document.scene,{width:8,height:18},canvas.diagramViews);
    expect(result.nodes.selection.position).toEqual({x:0,y:36});
    expect(result.nodes.selection).toMatchObject({rect});
  });
});
