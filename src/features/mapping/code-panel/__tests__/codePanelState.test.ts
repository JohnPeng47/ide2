import { expect, it } from 'vitest';
import { upsertCodePanel } from '../codePanelState';
import { handleNodeSelect } from '../../../../../domain/mapping/code-panel/codePanel';
import { RevisionedDiagramService } from '../../../../../domain/core/diagrams/diagramService';
import { diagramContentNodes } from '../../../../../domain/core/diagrams/diagramContentNodes';
import { emptyDisplayState, displayGeometry, setExpansion, type DisplayState, type ProjectedPane, type SelectionRegion } from '../../../../../domain/mapping/workspace/displayModel';
import { initialCanvasState, type MappingWorkspaceSnapshot } from '../../../../../domain/mapping/workspace/mappingWorkspace';
import { initialMappingGrid } from '../../../../../domain/mapping/workspace/mappingGrid';
import { deserializeWorkspace, serializeWorkspace } from '../../../../../domain/mapping/workspace/mappingWorkspaceCodec';

const diagram = new RevisionedDiagramService().create({id:'diagram',revision:1,ascii:'Root\n`-- Child',structureKind:'tree'}).diagram;
const nodes = diagramContentNodes(diagram.content);
const content = handleNodeSelect({diagram,projectId:'project'}, [nodes[1]]);
const root: SelectionRegion = { ...displayGeometry(), id:'selection', kind:'selection', sourceBoxId:'overview',sourceContentId:diagram.id,
  sourceAscii:diagram.content.ascii,rect:{startLine:2,endLine:2,startColumn:5,endColumn:9},selectedIds:[],childIds:[],expansion:'expanded',displayMode:'chained' };
it('reuses panel and selection ownership while restoring collapsed geometry and retaining scroll',()=>{
  let state = upsertCodePanel(emptyDisplayState(), root, content);
  const id=state.nodes.selection.childIds[0];
  const pane=state.nodes[id] as ProjectedPane;
  if(pane.content.kind!=='code-panel')throw Error();
  pane.content.scroll={top:123,left:4};
  pane.position={x:500,y:50};
  state=setExpansion(state,id,'collapsed');
  state=upsertCodePanel(state,root,handleNodeSelect({diagram,projectId:'project'},[nodes[0]]));
  expect(state.rootIds).toEqual(['selection']);
  expect(state.nodes.selection).toMatchObject({displayMode:'chained',childIds:[id]});
  expect(state.nodes[id]).toMatchObject({expansion:'expanded',position:{x:500,y:50},bounds:{width:860,height:640},content:{scroll:{top:123,left:4}}});
});
it('persists CodePanel and rejects unsupported resource types',()=>{
  const document=initialMappingGrid(),canvas=initialCanvasState();canvas.display=upsertCodePanel(emptyDisplayState(),root,content);
  const snapshot:MappingWorkspaceSnapshot={schemaVersion:3,projectId:'project',documents:[{representationId:'diagram',name:'Diagram',revisionId:'revision',savedName:'Diagram',savedScene:JSON.stringify(document.scene),document,canvas}]};
  expect(deserializeWorkspace(serializeWorkspace(snapshot))).toEqual(snapshot);
  const bad=structuredClone(snapshot);const pane=Object.values(bad.documents[0].canvas.display.nodes).find(node=>node.kind==='projection') as ProjectedPane;
  if(pane.content.kind!=='code-panel')throw Error();
  (pane.content.panel as any).mappedResourceType='unknown';expect(()=>deserializeWorkspace(bad)).toThrow(/mapped resource type/);
});

it('opens each retained selection independently and does not duplicate an existing owner or pane', () => {
  const next: SelectionRegion = { ...root, id: 'next',
    rect: { startLine: 1, endLine: 1, startColumn: 1, endColumn: 4 } };
  let state: DisplayState = { rootIds: [root.id, next.id], nodes: { [root.id]: root, [next.id]: next } };
  state = upsertCodePanel(state, root, content);
  state = upsertCodePanel(state, next, content);
  expect(state.rootIds).toEqual([root.id, next.id]);
  expect(Object.values(state.nodes).filter(node => node.kind === 'projection')).toHaveLength(2);
  expect((state.nodes[root.id] as SelectionRegion).rect).toEqual(root.rect);
  const paneId = state.nodes[next.id].childIds[0];
  state = upsertCodePanel(state, next, content);
  expect(state.rootIds).toEqual([root.id, next.id]);
  expect(state.nodes[next.id].childIds).toEqual([paneId]);
});
