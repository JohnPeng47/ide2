import { expect, it } from 'vitest';
import { RevisionedDiagramService } from '../../../core/diagrams/diagramService';
import { diagramContentNodes } from '../../../core/diagrams/diagramContentNodes';
import { activeDiagramJumps } from '../../../core/diagrams/diagramJump';
import { patchDiagram } from '../../../core/diagrams/patchDiagram';
import { singleDiagramScene } from '../../../core/diagrams/projectDiagramCanvas';
import { MappingDocumentController } from '../mappingDocumentController';
import { mappingDocumentFromScene } from '../mappingDocument';
import { initialCanvasState } from '../mappingWorkspace';
import { defaultArrowAppearance } from '../../../core/diagrams/diagramConnection';

it('patches inclusive lines, preserves whitespace, deletes ranges and rejects invalid input', () => {
  const d = new RevisionedDiagramService().create({ id: 'x', revision: 0, ascii: 'Root\n|-- A  \n`-- B\n', structureKind: 'tree' }).diagram;
  expect(patchDiagram(d, 2, 2, '|-- X\r\n|-- Y').diagram.content.ascii).toBe('Root\n|-- X\n|-- Y\n`-- B\n');
  expect(patchDiagram(d, 2, 2, '').diagram.content.ascii).toBe('Root\n`-- B\n');
  expect(patchDiagram(d, 2, 2, '|-- A  ').diagram).toBe(d);
  for (const [start,end] of [[0,1],[2,1],[1,5],[1.5,2]]) expect(() => patchDiagram(d,start,end,'X')).toThrow('INVALID_PATCH_RANGE');
  expect(() => patchDiagram(d,1,4,'')).toThrow('Diagram must contain');
  expect(() => patchDiagram(d,1,1,'\t')).toThrow('ASCII');
});

it('shifts untouched mappings, jumps and repeated-instance anchors; keeps edited anchors stale; undo restores everything', () => {
  const scene = singleDiagramScene('Root\n|-- Old\n`-- Keep');
  scene.contents = { ...scene.contents, overview: new RevisionedDiagramService().create({ id: 'overview', revision: 0, ascii: scene.contents.overview.content.ascii, structureKind: 'tree',
    evidence: { e: { id:'e', handle:'e', label:'Evidence', category:'operation', summary:'', sourceRanges:[{id:'r',path:'x.ts',startLine:1,endLine:1,originalLines:['x']}] } },
    mappings: [{id:'old',entityId:'e',sourceRangeIndex:0,line:2,startColumn:5,endColumn:7},{id:'keep',entityId:'e',sourceRangeIndex:0,line:3,startColumn:5,endColumn:8}] }).diagram };
  if (scene.root.kind !== 'container') throw Error();
  scene.root.children = [...scene.root.children, { ...scene.root.children[0], id:'second',position:{column:30,row:1} }];
  const beforeContent = scene.contents.overview.content;
  const anchor = (line:number, box='overview') => ({kind:'content-node' as const, displayNodeId:`grid:${box}`, contentNodeId:diagramContentNodes(beforeContent).find(n=>n.line===line)!.id,revisionId:beforeContent.revisionId,side:'right' as const});
  scene.contents = { ...scene.contents, overview: new RevisionedDiagramService().revise(scene.contents.overview.revisionId, { kind: 'jumps', jumps: [2,3].map(line => ({id:`jump${line}`,source:{revisionId:beforeContent.revisionId,contentHash:beforeContent.asciiSha256,line,startColumn:5,endColumn:line===2?7:8},target:{representationId:'target'}})) }).diagram };
  const edges = [{id:'keep',source:anchor(3),target:anchor(3,'second'),appearance:defaultArrowAppearance}, {id:'old',source:anchor(2),target:{kind:'box' as const, displayNodeId:'grid:second',side:'left' as const},appearance:defaultArrowAppearance}];
  const c = new MappingDocumentController(mappingDocumentFromScene(scene,edges), initialCanvasState());
  const before = structuredClone(c.getSnapshot());
  c.transact(0,[{method:'patchDiagram',nodeId:'grid:overview',start:2,end:2,patch:'|-- New\n|-- Extra'}]);
  const after = c.getSnapshot(), d = after.document.scene.contents.overview;
  expect(d.sourceContext.mappings).toEqual([{...scene.contents.overview.sourceContext.mappings[1],line:4}]);
  expect(d.sourceContext.evidence).toEqual(scene.contents.overview.sourceContext.evidence);
  expect(activeDiagramJumps(d.content,d.jumps)).toMatchObject([{id:'jump3',source:{line:4,revisionId:d.content.revisionId}}]);
  expect(after.document.edges[0].source.revisionId).toBe(d.content.revisionId);
  expect(after.document.edges[0].target).toMatchObject({revisionId:d.content.revisionId});
  expect(after.document.edges[1].source).toEqual(edges[1].source);
  expect(c.nodes().filter(n=>n.layout==='grid' && n.kind==='diagram').map(n=>n.layout==='grid'&&n.content?.ascii)).toEqual([d.content.ascii,d.content.ascii]);
  c.undo(); expect(c.getSnapshot().document).toEqual(before.document); expect(c.getSnapshot().canvas).toEqual(before.canvas);
  c.undo(true); expect(c.getSnapshot().document).toEqual(after.document);
  const current=c.getSnapshot();
  expect(()=>c.transact(current.version,[{method:'patchDiagram',nodeId:'grid:overview',start:2,end:2,patch:'X'},{method:'patchDiagram',nodeId:'grid:overview',start:99,end:99,patch:'Y'}])).toThrow();
  expect(c.getSnapshot()).toBe(current);
});
