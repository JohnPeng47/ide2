import { describe, expect, it } from 'vitest';
import { SourcePaneViewState } from '../sourcePaneViewState';
import { deserializeWorkspace, serializeWorkspace } from '../../../../../domain/mapping/workspace/mappingWorkspaceCodec';
import fixture from '../../../../../tests/fixtures/source-pane-performance/workspace.json';

const display = () => deserializeWorkspace(fixture).documents[0].canvas.display;

describe('source viewport snapshots', () => {
  it('captures and prunes the shared CodePanel viewport independently of source-file viewers', () => {
    const state = new SourcePaneViewState(), original = display();
    const node = original.nodes['source-1'];
    if (node.kind !== 'projection') throw Error();
    node.content = { kind: 'code-panel', selectionId: 'selection', panel: { mappedResourceType: 'source-range',
      diagramId: 'diagram', revisionId: 'revision', contentHash: 'hash', selectedNodeIds: [], unmappedNodeIds: [], items: [] } };
    const binding = state.bind('source', 'source-1', '@code-panel');
    binding.connect(() => ({ top: 320, left: 8 }));
    state.prune('source', original);
    expect(state.captureDisplay('source', original).nodes['source-1']).toMatchObject({ content: { scroll: { top: 320, left: 8 } } });
    delete original.nodes['source-1']; state.prune('source', original);
    expect(binding.read()).toBeUndefined();
  });

  it('samples live DOM readers at save time without changing the display model', () => {
    const state = new SourcePaneViewState(), original = display();
    let position = { top: 12, left: 3 };
    const binding = state.bind('source', 'source-1', 'src/large.ts');
    const disconnect = binding.connect(() => position);
    position = { top: 400, left: 70 }; // A scroll event need not have been delivered yet.
    const captured = state.captureDisplay('source', original);
    expect(captured.nodes['source-1']).toMatchObject({ content: { scroll: position } });
    expect(original.nodes['source-1']).toMatchObject({ content: { scroll: { top: 0, left: 0 } } });
    expect(captured.nodes['source-2']).toBe(original.nodes['source-2']);
    expect(state.captureDisplay('source', original)).toBe(captured);
    state.setCamera('source', { offset: { x: 80, y: 90 }, scale: .8 });
    expect(state.captureDisplay('source', original)).toBe(captured); // Panning must not resubmit source contents.
    disconnect();
    position = { top: 0, left: 0 };
    expect(state.bind('source', 'source-1', 'src/large.ts').read()).toEqual({ top: 400, left: 70 });
  });

  it('isolates documents and rejects writes/cleanup from a replaced viewer', () => {
    const state = new SourcePaneViewState();
    const old = state.bind('a', 'pane', 'old.ts');
    const cleanup = old.connect(() => ({ top: 999, left: 1 }));
    state.resetPane('a', 'pane');
    const fresh = state.bind('a', 'pane', 'new.ts');
    fresh.connect(() => ({ top: 12, left: 0 }));
    old.write({ top: 555, left: 0 }); cleanup();
    expect(fresh.read()).toEqual({ top: 12, left: 0 });
    expect(state.bind('b', 'pane', 'new.ts', { top: 42, left: 0 }).read()).toEqual({ top: 42, left: 0 });
  });

  it('retains the last visible offset when an inactive document has no CSS box', () => {
    const state = new SourcePaneViewState();
    let visible = true;
    const binding = state.bind('source', 'source-1', 'src/large.ts');
    const cleanup = binding.connect(() => visible ? { top: 420, left: 30 } : undefined);
    binding.write({ top: 420, left: 30 });
    visible = false;
    expect(state.captureDisplay('source', display()).nodes['source-1']).toMatchObject({ content: { scroll: { top: 420, left: 30 } } });
    cleanup();
    expect(binding.read()).toEqual({ top: 420, left: 30 });
  });

  it('preserves hidden panes, prunes deleted panes, and excludes old-file positions', () => {
    const state = new SourcePaneViewState(), original = display();
    const binding = state.bind('source', 'source-1', 'src/large.ts');
    binding.connect(() => ({ top: 222, left: 4 }))();
    original.nodes['source-1'].expansion = 'collapsed';
    state.prune('source', original);
    expect(state.captureDisplay('source', original).nodes['source-1']).toMatchObject({ content: { scroll: { top: 222, left: 4 } } });
    expect(state.bind('source', 'source-1', 'other.ts').read()).toBeUndefined();
    delete original.nodes['source-1']; state.prune('source', original);
    expect(binding.read()).toBeUndefined();
  });

  it('round trips all five pane positions through the existing workspace codec', () => {
    const workspace = deserializeWorkspace(fixture), state = new SourcePaneViewState();
    for (let id = 1; id <= 5; id++) state.bind('source', `source-${id}`, 'src/large.ts').connect(() => ({ top: id * 100, left: id * 10 }));
    workspace.documents[0].canvas.display = state.captureDisplay('source', workspace.documents[0].canvas.display);
    state.setCamera('source', { offset: { x: 80, y: 90 }, scale: .8 });
    workspace.documents[0].viewport = state.captureCamera('source');
    const restored = deserializeWorkspace(serializeWorkspace(workspace));
    expect(restored).toEqual(workspace);
    const fresh = new SourcePaneViewState();
    expect(fresh.captureDisplay('source', restored.documents[0].canvas.display)).toBe(restored.documents[0].canvas.display);
  });
});
