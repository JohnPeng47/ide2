import { compareWorkspaceFixture } from './compareWorkspace';
import { MappingDocumentController } from '../../domain/mapping/workspace/mappingDocumentController';
import type { DiagramChangeSession } from '../../domain/mapping/changes/diagramChangeSession';
import type { EvalRun } from '../../domain/mapping/evals/evalRun';

/** No model calls: a modified canvas (including addition/removal) and a new canvas. */
export function evalOutputFixture(projectId = 'test-project') {
  const source = compareWorkspaceFixture(projectId).documents[0];
  const baseline = structuredClone({ document: source.document, canvas: source.canvas });
  const controller = new MappingDocumentController(source.document, source.canvas);
  controller.applyUpdate(0, [{ method: 'replace', nodeId: 'grid:overview',
    ascii: 'Domain\n|-- Shared feature\n`-- New execution implementation', structureKind: 'tree' }]);
  const state = controller.getSnapshot();
  const proposed = structuredClone({ document: state.document, canvas: state.canvas });
  if (proposed.document.scene.root.kind === 'container') {
    proposed.document.scene.root.children = [...proposed.document.scene.root.children.filter(box => box.id !== 'relationships'),
      { id: 'detail', kind: 'diagram', contentId: 'persistence', collapsed: false, position: { row: 30, column: 0 } }];
  }
  const content = proposed.document.scene.contents.overview.content;
  proposed.document.jumps = [{ id: 'to-new-canvas', sourceDisplayNodeId: 'grid:overview',
    source: { revisionId: content.revisionId, contentHash: content.asciiSha256, line: 1, startColumn: 1, endColumn: 6 },
    target: { representationId: 'new-canvas', displayNodeId: 'grid:overview' } }];
  const at = '2026-11-07T12:00:00.000Z';
  const session: DiagramChangeSession = { schemaVersion: 1, id: 'execution-session', projectId, title: 'Executed plan', description: '',
    status: 'ready', version: 3, createdAt: at, updatedAt: at, receipts: {},
    documents: [
      { id: 'existing-canvas', representationId: 'original-canvas', name: 'Existing architecture', version: 2, baseline, proposed, past: [], future: [] },
      { id: 'new-canvas', name: 'New subsystem', version: 1, baseline: null, proposed: structuredClone(baseline), past: [], future: [] }
    ], changes: [
      { id: 'modify', title: 'Replace implementation', type: 4, reasons: [], documentId: 'existing-canvas', nodeId: 'grid:overview', dependsOn: [] },
      { id: 'detail', title: 'Add detail', type: 2, reasons: [], documentId: 'existing-canvas', nodeId: 'grid:detail', dependsOn: [] },
      { id: 'canvas', title: 'Add subsystem', type: 3, reasons: [], documentId: 'new-canvas', dependsOn: [] }
    ] };
  const run: EvalRun = { schemaVersion: 1, id: 'execution-result-run', projectId, requestHash: 'fixture', number: 1,
    request: { requestId: '00000000-0000-4000-8000-000000000001', workflow: 'diagram-change-proposal', prompts: [], inputs: {}, passes: 1, model: 'fixture', effort: 'high' },
    workflow: 'diagram-change-proposal', agentContextId: 'fixture-context', contextName: 'Plan execution fixture',
    prompts: [], inputs: {}, status: 'failed', createdAt: at,
    cells: [{ key: 'execution:1:proposal', status: 'failed', pass: 1, stage: 'proposal', error: 'Awaiting retained executor result' }] };
  return { run, session };
}
