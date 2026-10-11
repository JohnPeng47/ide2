import { expect, it, vi } from 'vitest';
import { DiagramEditService } from '../../../../application/mapping/agent/diagramEditService';
import { RevisionedDiagramService, type DiagramGenerationRequest, type DiagramGenerator } from '../../../../domain/core/diagrams/diagramService';
import { singleDiagramScene } from '../../../../domain/core/diagrams/projectDiagramCanvas';
import type { DiagramCreation, PromptReference } from '../../../../domain/mapping/agent/diagramEdit';
import { findBox } from '../../../../domain/mapping/workspace/canvasDisplayNode';
import { MappingDocumentController, type DiagramOperation } from '../../../../domain/mapping/workspace/mappingDocumentController';
import { mappingDocumentFromScene } from '../../../../domain/mapping/workspace/mappingDocument';
import { initialCanvasState } from '../../../../domain/mapping/workspace/mappingWorkspace';
import { DiagramRevisionReceiver } from '../../../../src/features/mapping/agent/diagramRevisionReceiver';

function fixture(generate: DiagramGenerator['generate'] = async () => ({ ascii: 'Generated' })) {
  const generator = { generate: vi.fn(generate) };
  const controller = new MappingDocumentController(mappingDocumentFromScene(singleDiagramScene('Original\n+-- Child')), initialCanvasState());
  const base = controller.getSnapshot().document.scene.contents.overview, receiver = new DiagramRevisionReceiver();
  const create = vi.fn(async (_session: string, input: { requestId: string; expectedVersion: number; diagrams: DiagramCreation[] }) =>
    ({ version: controller.applyUpdate(input.expectedVersion, input.diagrams.map(diagram => ({ method: 'diagram-create', id: diagram.id,
      parentId: diagram.parentId, position: diagram.position, ...structuredClone(diagram.content) }) as Extract<DiagramOperation, { method: 'diagram-create' }>)).version }));
  const service = new DiagramEditService(new RevisionedDiagramService(generator), {
    snapshot: async () => structuredClone({ ...controller.getSnapshot(), history: controller.exportHistory(), name: 'Test' }),
    apply: async (_session, input) => receiver.apply('doc', structuredClone(input), controller, async () => {}), create
  });
  const input = { sessionId: 'session', requestId: 'prompt', expectedVersion: 0, baseRevisionId: base.revisionId, nodeId: 'grid:overview', prompt: 'Use [ref 1]' };
  return { generator, controller, base, create, service, input };
}
const settled = async (service: DiagramEditService, runId: string, status: string) => {
  await vi.waitFor(() => expect(service.get(runId).status).toBe(status));
  return service.get(runId);
};

it('renders the chosen template and resolves references to their pinned revision text', async () => {
  const f = fixture(), pinned = f.base;
  f.controller.applyUpdate(0, [{ method: 'replace', nodeId: 'grid:overview', ascii: 'Changed later' }]);
  const current = f.controller.getSnapshot().document.scene.contents.overview;
  const references: PromptReference[] = [
    { kind: 'diagram', label: 'Before', diagramId: pinned.diagramId, revisionId: pinned.revisionId },
    { kind: 'nodes', label: 'Child', diagramId: pinned.diagramId, revisionId: pinned.revisionId, nodeIds: [], range: { startLine: 2, endLine: 2, startColumn: 1, endColumn: 5 } }
  ];
  const run = f.service.start({ ...f.input, expectedVersion: 1, baseRevisionId: current.revisionId, references,
    template: { id: 'edit-diagram/annotate', version: 1, options: { detail: 4 } } });
  await settled(f.service, run.runId, 'completed');
  const request = f.generator.generate.mock.calls[0][0] as DiagramGenerationRequest;
  expect(request.prompt).toMatchObject({ options: { detail: 4 }, markdown: expect.stringContaining('Annotate the supplied diagram'), references: [
    { ref: 1, kind: 'diagram', revisionId: pinned.revisionId, ascii: 'Original\n+-- Child' },
    { ref: 2, kind: 'nodes', excerpt: '+-- C', nodes: [] }
  ] });
});

it('rejects unknown templates up front and unresolvable references before generation', async () => {
  const f = fixture();
  expect(() => f.service.start({ ...f.input, template: { id: 'edit-diagram/restructure', version: 1, options: { detail: 9 } } })).toThrow('PROMPT_OPTION_INVALID');
  expect(() => f.service.start({ ...f.input, template: { id: 'create-diagram/overview', version: 1, options: {} } })).toThrow('PROMPT_TEMPLATE_OPERATION');
  expect(() => f.service.start({ ...f.input, count: 2 })).toThrow('count applies only to create-diagram');
  const missing = await settled(f.service, f.service.start({ ...f.input, references: [
    { kind: 'diagram', label: 'Gone', diagramId: f.base.diagramId, revisionId: 'diagram-revision-gone' }] }).runId, 'failed');
  expect(missing.error).toContain('PROMPT_REFERENCE_NOT_FOUND: [ref 1]');
  const invalid = await settled(f.service, f.service.start({ ...f.input, requestId: 'nodes', references: [{ kind: 'nodes', label: 'Bad',
    diagramId: f.base.diagramId, revisionId: f.base.revisionId, nodeIds: ['invented'], range: { startLine: 1, endLine: 1, startColumn: 1, endColumn: 3 } }] }).runId, 'failed');
  expect(invalid.error).toContain('node invented is not in its revision');
  expect(f.generator.generate).not.toHaveBeenCalled();
});

it('creates each requested diagram beside the anchor in one canvas update, without revising the anchor', async () => {
  let n = 0;
  const f = fixture(async () => ({ ascii: `New ${++n}` }));
  const input = { ...f.input, count: 2, template: { id: 'create-diagram/overview', version: 1, options: { kind: 'flow' } } };
  const run = f.service.start(input, undefined, 'create-diagram');
  expect(run.operation).toBe('create-diagram');
  const complete = await settled(f.service, run.runId, 'completed');
  expect(f.generator.generate).toHaveBeenCalledTimes(2); expect(f.create).toHaveBeenCalledOnce();
  expect(complete.created!.nodeIds).toHaveLength(2);
  const scene = f.controller.getSnapshot().document.scene;
  const placed = complete.created!.nodeIds.map(id => findBox(scene.root, id.slice(5))!);
  expect(placed.map(box => box.kind === 'diagram' && scene.contents[box.contentId].content.ascii)).toEqual(['New 1', 'New 2']);
  expect(placed[0].position.column).toBeGreaterThan(findBox(scene.root, 'overview')!.position.column);
  expect(placed[1].position.column).toBeGreaterThan(placed[0].position.column);
  expect(scene.contents.overview.revisionId).toBe(f.base.revisionId);
  expect(f.service.start(input, undefined, 'create-diagram')).toEqual(complete);
  expect(() => f.service.start({ ...input, count: 3 }, undefined, 'create-diagram')).toThrow('REQUEST_ID_CONFLICT');
});

it('places created diagrams on the latest canvas version even when it changed during generation', async () => {
  let release!: () => void;
  const pending = new Promise<void>(resolve => { release = resolve; });
  const f = fixture(async () => { await pending; return { ascii: 'Late' }; });
  const run = f.service.start(f.input, undefined, 'create-diagram');
  await vi.waitFor(() => expect(f.generator.generate).toHaveBeenCalledOnce());
  f.controller.applyUpdate(0, [{ method: 'replace', nodeId: 'grid:overview', ascii: 'Concurrent edit' }]);
  release();
  const complete = await settled(f.service, run.runId, 'completed');
  expect(f.create.mock.calls[0][1].expectedVersion).toBe(1);
  expect(complete.created!.documentVersion).toBe(2);
});
