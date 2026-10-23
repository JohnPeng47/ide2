import { expect, it } from 'vitest';
import { MappingWorkspaceService } from '../workspaceService';
import type { MappingWorkspaceRepository } from '../repository';
import { compileDiagramAgentContext, storeDiagramAgentContext } from '../../../../domain/core/diagrams/diagramAgentContext';
import { singleDiagramScene } from '../../../../domain/core/diagrams/projectDiagramCanvas';
import { MappingDocumentController } from '../../../../domain/mapping/workspace/mappingDocumentController';
import { mappingDocumentFromScene } from '../../../../domain/mapping/workspace/mappingDocument';
import { initialCanvasState } from '../../../../domain/mapping/workspace/mappingWorkspace';
import { serializeWorkspace } from '../../../../domain/mapping/workspace/mappingWorkspaceCodec';

it('exports disk-backed contexts as portable snapshots including undo history', async () => {
  const controller = new MappingDocumentController(mappingDocumentFromScene(singleDiagramScene('Source')), initialCanvasState());
  const base = controller.getSnapshot().document.scene.contents.overview;
  const saved = new Map<string, unknown>(), recordId = 'c'.repeat(64);
  const store = { put: async (snapshot: unknown) => { saved.set(recordId, snapshot); return recordId; },
    get: async (id: string) => saved.get(id) };
  const bound = await storeDiagramAgentContext(compileDiagramAgentContext(base), store);
  controller.applyUpdate(0, [{ method: 'diagram-context-set', nodeId: 'grid:overview', expectedRevisionId: base.revisionId, context: bound }]);
  controller.applyUpdate(1, [{ method: 'replace', nodeId: 'grid:overview', ascii: 'Changed' }]);
  const state = controller.getSnapshot();
  const workspace = { schemaVersion: 3 as const, projectId: 'project', documents: [{ representationId: 'draft-test',
    revisionId: '', name: 'Test', savedName: '', savedScene: JSON.stringify(singleDiagramScene('Source')),
    document: state.document, canvas: state.canvas, history: controller.exportHistory() }] };
  const service = new MappingWorkspaceService({ loadProject: async () => ({ id: 'project' }) } as any,
    {} as MappingWorkspaceRepository, store);
  const portable = await service.portableExport(workspace);
  const contexts = portable.documents[0].document.diagramContexts!;
  expect(contexts[base.diagramId]).toHaveProperty('snapshot');
  expect(contexts[base.diagramId]).not.toHaveProperty('backingRecordId');
  expect(portable.documents[0].history!.snapshots[portable.documents[0].history!.headId].document.diagramContexts?.[base.diagramId]).toHaveProperty('snapshot');
  expect(JSON.parse(serializeWorkspace(portable)).documents[0].document.diagramContexts[base.diagramId].snapshot.contentHash)
    .toBe(bound.contentHash);
  const imported = await service.prepareImport(JSON.parse(serializeWorkspace(portable)));
  expect(imported.documents[0].document.diagramContexts?.[base.diagramId]).toEqual(bound);
  expect(imported.documents[0].history!.snapshots[imported.documents[0].history!.headId].document.diagramContexts?.[base.diagramId]).toEqual(bound);
});
