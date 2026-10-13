import { displayGeometry } from '../displayModel';
import { describe, expect, it } from 'vitest';
import { deserializeWorkspace, serializeWorkspace } from '../mappingWorkspaceCodec';
import { initialCanvasState, type MappingWorkspaceSnapshot } from '../mappingWorkspace';
import { initialMappingGrid } from '../mappingGrid';
import { diagramSelectionItem, regionSelectionItem } from '../../selection/selectionState';
function snapshot(): MappingWorkspaceSnapshot { const document = initialMappingGrid(); return { schemaVersion: 3, projectId: 'project', activeDocumentId: 'diagram', documents: [{ representationId: 'diagram', revisionId: 'revision', name: 'Diagram', savedName: 'Diagram', savedScene: JSON.stringify(document.scene), document, canvas: initialCanvasState(), viewport: { offset: { x: 42, y: 51 }, scale: .8 } }] }; }
describe('workspace codec', () => {
  it('round trips the canonical collection independently of panels, including mixed node and diagram membership', () => {
    const input = snapshot(), doc = input.documents[0];
    const content = Object.values(doc.document.scene.contents)[0];
    const item = regionSelectionItem(content, 'overview', { startLine: 1, endLine: 1, startColumn: 1, endColumn: 2 }, 'selection');
    doc.canvas.selection = { items: [item] }; doc.canvas.controls.selectionFocusId = item.id;
    expect(deserializeWorkspace(serializeWorkspace(input))).toEqual(input);
    doc.canvas.selection = { items: [item, diagramSelectionItem('grid:overview')] };
    expect(deserializeWorkspace(serializeWorkspace(input))).toEqual(input);
    doc.canvas.selection = { items: [item, item] };
    expect(() => deserializeWorkspace(input)).toThrow('duplicate selection');
  });
  it('round trips scene, control drafts, and viewport without coupling controls to display nodes', () => {
    const input = snapshot(); input.documents[0].canvas.controls.surfaces.draft.promptText = 'Keep this draft';
    expect(deserializeWorkspace(serializeWorkspace(input))).toEqual(input);
  });
  it('does not restart in-flight operations or mutate live state', () => {
    const input = snapshot(); input.documents[0].canvas.controls.surfaces.draft.promptPhase = 'generating';
    expect(deserializeWorkspace(serializeWorkspace(input)).documents[0].canvas.controls.surfaces.draft.promptPhase).toBe('error');
    expect(input.documents[0].canvas.controls.surfaces.draft.promptPhase).toBe('generating');
  });
  it('rejects future versions, invalid coordinates, and missing control owners', () => {
    expect(() => deserializeWorkspace({ ...snapshot(), schemaVersion: 99 })).toThrow('version');
    const input = snapshot(); input.documents[0].viewport!.scale = Infinity;
    expect(() => deserializeWorkspace(input)).toThrow('zoom');
    delete input.documents[0].viewport; input.documents[0].canvas.controls.selectionFocusId = 'missing';
    expect(() => deserializeWorkspace(input)).toThrow('focus');
  });
  it('rejects cycles and duplicate ownership', () => {
    const input = snapshot(); const display = input.documents[0].canvas.display;
    display.nodes.a = { ...displayGeometry(), id: 'a', kind: 'detail', childIds: ['a'], expansion: 'expanded', title: 'A', ascii: 'A' }; display.rootIds = ['a'];
    expect(() => deserializeWorkspace(input)).toThrow('cycle');
    display.nodes.a.childIds = []; display.rootIds = ['a', 'a'];
    expect(() => deserializeWorkspace(input)).toThrow('ownership');
  });
});

it('round trips exact manual geometry, including the allocation saved for expansion', () => {
  const input = snapshot(); input.documents[0].canvas.display = { rootIds: ['detail'], nodes: {
    detail: { ...displayGeometry({ x: -12.25, y: 90.75 }, { width: 612, height: 31 }), id: 'detail', kind: 'detail',
      title: 'Details', ascii: 'content', childIds: [], expansion: 'collapsed',
      geometryPolicy: { placement: 'manual', sizing: 'fixed' },
      expandedGeometry: { coordinateSpace: 'canvas', position: { x: -12.25, y: 90.75 }, bounds: { width: 612, height: 405 } } }
  } };
  expect(deserializeWorkspace(serializeWorkspace(input))).toEqual(input);
});
it('migrates legacy detail coordinates and conversation anchors without mutating input', () => {
  const input: any = snapshot(); input.schemaVersion = 1;
  input.documents[0].canvas.display = { rootIds: ['detail', 'chat'], nodes: {
    detail: { id: 'detail', kind: 'detail', title: 'Details', ascii: 'content', childIds: [], expansion: 'expanded', x: 125, y: -30 },
    chat: { id: 'chat', kind: 'conversation', childIds: [], expansion: 'collapsed', presentation: 'docked', draft: 'draft',
      thread: { id: 'chat', title: 'Chat', anchor: { x: 200, y: 250 }, messages: [], pending: false,
        selection: { nodeIds: [], summary: '', rect: { startLine: 1, endLine: 1, startColumn: 1, endColumn: 1 } } } }
  } };
  const migrated = deserializeWorkspace(input);
  const nodes = migrated.documents[0].canvas.display.nodes;
  expect(migrated.schemaVersion).toBe(3);
  expect(nodes.detail).toMatchObject({ position: { x: 125, y: -30 }, geometryPolicy: { placement: 'manual' } });
  expect(nodes.detail).not.toHaveProperty('x');
  expect(nodes.chat).toMatchObject({ canvasAnchor: { x: 200, y: 250 }, coordinateSpace: 'canvas', position: { x: 183, y: 233 } });
  expect(nodes.chat).not.toHaveProperty('thread.anchor');
  expect(input.documents[0].canvas.display.nodes.chat.thread.anchor).toBeDefined();
  expect(deserializeWorkspace(serializeWorkspace(migrated))).toEqual(migrated);
});
it.each([
  { position: { x: Infinity, y: 0 } }, { bounds: { width: -1, height: 10 } },
  { geometryPolicy: { placement: 'surprise', sizing: 'content' } }, { coordinateSpace: 'viewport' }
])('rejects malformed node geometry: %j', invalid => {
  const input: any = snapshot(); input.documents[0].canvas.display = { rootIds: ['d'], nodes: {
    d: { ...displayGeometry(), id: 'd', kind: 'detail', title: 'D', ascii: '', childIds: [], expansion: 'expanded', ...invalid }
  } };
  expect(() => deserializeWorkspace(input)).toThrow('Invalid workspace');
});
it('migrates a legacy retained projection chain into automatic node geometry', () => {
  const input: any = snapshot(); input.schemaVersion = 1;
  input.documents[0].canvas.display = { rootIds: ['selection'], nodes: {
    selection: { id: 'selection', kind: 'selection', childIds: ['pane'], expansion: 'expanded', displayMode: 'chained',
      sourceBoxId: 'overview', sourceContentId: 'overview', sourceAscii: 'A', selectedIds: [],
      rect: { startLine: 1, endLine: 2, startColumn: 1, endColumn: 4 } },
    pane: { id: 'pane', kind: 'projection', childIds: [], expansion: 'expanded', title: 'Projection', content: { kind: 'compaction', files: [] } }
  } };
  const migrated = deserializeWorkspace(input);
  const { selection, pane } = migrated.documents[0].canvas.display.nodes;
  expect(pane.position.x).toBe(selection.position.x + selection.bounds.width + 72);
  expect(pane.geometryPolicy).toEqual({ placement: 'automatic', sizing: 'content' });
  expect(deserializeWorkspace(serializeWorkspace(migrated))).toEqual(migrated);
});

function snapshotWithConversation(): MappingWorkspaceSnapshot {
  const input = snapshot();
  const display = input.documents[0].canvas.display;
  display.rootIds = ['selection'];
  display.nodes.selection = { ...displayGeometry(), id: 'selection', kind: 'selection', childIds: ['chat'],
    expansion: 'expanded', displayMode: 'chained', sourceBoxId: 'overview', sourceContentId: 'overview',
    sourceAscii: 'Worker', selectedIds: ['worker'], rect: { startLine: 1, endLine: 1, startColumn: 1, endColumn: 6 } };
  display.nodes.chat = { ...displayGeometry({ x: 20, y: 30 }), id: 'chat', kind: 'conversation', childIds: [],
    expansion: 'expanded', presentation: 'compact', canvasAnchor: { x: 20, y: 30 }, draft: 'Next question',
    thread: { id: 'chat', title: 'Worker', verbosity: 'high', pending: false,
      context: { contentId: 'overview', diagramAscii: 'Worker', diagramRevision: 0, mappings: [],
        sourceRanges: [{ mappingId: 'mapping-worker', elementId: 'worker', elementLabel: 'Worker', diagramLine: 1, startColumn: 1, endColumn: 6, path: 'worker.ts', startLine: 1, endLine: 1, lines: ['export function worker() {}'] }] },
      selection: { boxId: 'overview', nodeIds: ['worker'], summary: 'Worker',
        rect: { startLine: 1, endLine: 1, startColumn: 1, endColumn: 6 } },
      messages: [{ id: 'question', role: 'user', text: 'What does it do?' }] } };
  return input;
}
it('preserves retained chat ownership, frozen evidence, verbosity, and drafts across workspace reload', () => {
  const input = snapshotWithConversation();
  expect(deserializeWorkspace(serializeWorkspace(input))).toEqual(input);
});
it('restores interrupted replies as retryable errors without modifying or duplicating the conversation history', () => {
  const input = snapshotWithConversation();
  const chat = input.documents[0].canvas.display.nodes.chat;
  if (chat.kind !== 'conversation') throw new Error('Expected conversation');
  chat.thread.pending = true; chat.thread.progress = 'Reading source';
  const restored = deserializeWorkspace(serializeWorkspace(input)).documents[0].canvas.display.nodes.chat;
  if (restored.kind !== 'conversation') throw new Error('Expected conversation');
  expect(restored.thread).toMatchObject({ pending: false, error: expect.stringContaining('Retry') });
  expect(restored.thread.progress).toBeUndefined();
  expect(restored.thread.messages).toEqual(chat.thread.messages);
  expect(chat.thread.pending).toBe(true);
});
it('rejects corrupted frozen source snapshots and invalid verbosity', () => {
  const input = snapshotWithConversation();
  const chat = input.documents[0].canvas.display.nodes.chat;
  if (chat.kind !== 'conversation') throw new Error('Expected conversation');
  chat.thread.context!.sourceRanges![0].endLine = 2;
  expect(() => deserializeWorkspace(input)).toThrow('frozen source lines');
  chat.thread.context!.sourceRanges![0].endLine = 1;
  (chat.thread as any).verbosity = 'unexpected';
  expect(() => deserializeWorkspace(input)).toThrow('verbosity');
});
