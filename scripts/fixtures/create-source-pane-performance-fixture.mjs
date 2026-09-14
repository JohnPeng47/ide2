import { createHash } from 'node:crypto';
import { writeFile } from 'node:fs/promises';
import { tsImport } from 'tsx/esm/api';
import { sourceText } from '../../tests/fixtures/source-pane-performance/source.mjs';

const { singleDiagramScene } = await tsImport('../../domain/core/diagrams/projectDiagramCanvas.ts', import.meta.url);
const { initialCanvasState } = await tsImport('../../domain/mapping/workspace/mappingWorkspace.ts', import.meta.url);
const { displayGeometry } = await tsImport('../../domain/mapping/workspace/displayModel.ts', import.meta.url);
const { serializeWorkspace } = await tsImport('../../domain/mapping/workspace/mappingWorkspaceCodec.ts', import.meta.url);
const scene = singleDiagramScene('Source pane performance fixture');
const canvas = initialCanvasState();
const files = [{ sourceFile: 'src/large.ts', sourceSha256: createHash('sha256').update(sourceText).digest('hex'),
  ascii: 'large.ts\n+-- first operation\n\\-- distant operation', selectedLineCount: 2,
  rows: [
    { treeLine: 1, selected: false, sourceRanges: [{ startLine: 1, endLine: 3000 }] },
    { treeLine: 2, selected: true, sourceRanges: [{ startLine: 12, endLine: 15 }] },
    { treeLine: 3, selected: true, sourceRanges: [{ startLine: 2962, endLine: 2965 }] }
  ] }];
for (let index = 0; index < 5; index++) {
  const id = `source-${index + 1}`, owner = `selection-${index + 1}`;
  canvas.display.rootIds.push(owner);
  canvas.display.nodes[owner] = { ...displayGeometry({ x: 360, y: 10 + index * 30 }, { width: 30, height: 20 }),
    geometryPolicy: { placement: 'manual', sizing: 'fixed' }, id: owner, kind: 'selection', childIds: [id],
    expansion: 'expanded', sourceBoxId: 'overview', sourceContentId: 'overview', sourceAscii: scene.contents.overview.ascii,
    rect: { startLine: 1, endLine: 1, startColumn: 1, endColumn: 1 }, selectedIds: [], displayMode: 'chained' };
  canvas.display.nodes[id] = { ...displayGeometry({ x: 420 + (index % 3) * 560, y: 70 + Math.floor(index / 3) * 540 }, { width: 530, height: 490 }),
    geometryPolicy: { placement: 'manual', sizing: 'fixed' }, id, kind: 'projection', title: 'src/large.ts',
    childIds: [], expansion: 'expanded', content: { kind: 'source-code', projectId: 'performance-fixture', files,
      sourceFile: 'src/large.ts', showCompactions: false, rangeIndex: 0, scroll: { top: 0, left: 0 } } };
}
const workspace = { schemaVersion: 3, projectId: 'performance-fixture', activeDocumentId: 'source', documents: [{
  representationId: 'source', name: 'Source pane performance', savedName: 'Source pane performance', revisionId: 'revision-source',
  savedScene: JSON.stringify(scene), document: { scene, nodes: {}, sections: {} }, canvas,
  viewport: { offset: { x: 0, y: 0 }, scale: 1 }
}] };
await writeFile(new URL('../../tests/fixtures/source-pane-performance/workspace.json', import.meta.url), serializeWorkspace(workspace));
