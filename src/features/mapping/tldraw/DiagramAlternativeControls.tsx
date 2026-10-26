import { mappingShapeId } from './shapeProjection';
import { useContext, useState } from 'react';
import { useValue } from 'tldraw';
import { CanvasRuntimeContext, type GridModel } from './CanvasRuntimeContext';
import { getDiagramRevision } from '../../../../domain/core/diagrams/diagramRevisionStore';
import { resolveRevisionLines } from '../../../../domain/core/diagrams/diagramRevisionSelection';
import { alternativeSelections, scopeOwner } from '../../../../domain/core/presentation/diagramAlternative';
import type { AlternativeOperation } from '../../../../domain/mapping/workspace/diagramAlternatives';

export function DiagramAlternativeControls({ model, disabled }: { model: GridModel; disabled: boolean }) {
  const runtime = useContext(CanvasRuntimeContext)!;
  const state = useValue('promoted alternatives', () => runtime.alternativeState.get(), [runtime]);
  const [menu, setMenu] = useState<string>(), [error, setError] = useState('');
  const snapshot = runtime.controller.getSnapshot(), base = getDiagramRevision(model.diagram!.revisionId);
  const folded = new Set([...(model.view?.collapsedNodeRefs ?? []), ...(model.view?.collapsedContentNodeIds ?? []).flatMap(id => base.nodeRefs[id] ? [base.nodeRefs[id]] : [])]);
  const lines = resolveRevisionLines(base, alternativeSelections(snapshot.document, model.id, model.diagram!.id, base), getDiagramRevision, folded);
  const groups = new Map<string, { id: string; name: string; partIndex: number }[]>();
  for (const item of Object.values(state?.items ?? {})) if (item.presentationId === model.id && (!item.parentAlternativeId || state?.selected[model.id]?.includes(item.parentAlternativeId)))
    item.parts.forEach((part, partIndex) => { const owner = scopeOwner(part.target); groups.set(owner, [...(groups.get(owner) ?? []), { id: item.id, name: item.name, partIndex }]); });
  const run = (op: AlternativeOperation) => {
    try { runtime.controller.applyUpdate(runtime.controller.getSnapshot().version, [op]); setError(''); setMenu(undefined); }
    catch (error) { setError(error instanceof Error ? error.message : String(error)); }
  };
  return <div className="diagram-alternative-controls" data-mapping-static-ui data-diagram-canvas-static-ui onPointerDown={e => e.stopPropagation()} onDoubleClick={e => e.stopPropagation()}>
    {[...groups].map(([owner, alternatives]) => {
      const row = owner === 'root' ? 0 : lines.findIndex(line => line.nodeRef === owner || line.ownerNodeId === owner);
      if (row < 0 || model.frame.collapsed && row > 0) return null;
      const active = alternatives.find(item => state?.selected[model.id]?.includes(item.id)) ?? alternatives[0];
      const select = (id: string) => run({ method: 'alternative-select', nodeId: model.id, alternativeId: id, selected: !state?.selected[model.id]?.includes(id), replace: true });
      const open = (item: typeof active) => {
        const panelId = `panel:${item.id}:${item.partIndex}`;
        const bounds = state?.panels[panelId] && runtime.editor?.getShapePageBounds(mappingShapeId(panelId));
        if (bounds) { runtime.editor?.zoomToBounds(bounds.clone().expandBy(80), { animation: { duration: 150 } }); setMenu(undefined); }
        else run({ method: 'side-panel', nodeId: model.id, alternativeId: item.id, partIndex: item.partIndex });
      };
      return <div key={owner} data-alternative-node={owner} style={{ position: 'absolute', top: row * model.cell.height, right: -48, display: 'flex', zIndex: 8, pointerEvents: 'auto' }}>
        <button style={{ height: model.cell.height, width: 23, padding: 0, fontSize: 13 }} disabled={disabled} aria-label={`Swap alternative ${active.name}`} title="Swap alternative inline" aria-pressed={state?.selected[model.id]?.includes(active.id) ?? false}
          onClick={() => alternatives.length === 1 ? select(active.id) : setMenu(menu === `swap:${owner}` ? undefined : `swap:${owner}`)}>⇄</button>
        <button style={{ height: model.cell.height, width: 23, padding: 0, fontSize: 13 }} disabled={disabled} aria-label={`Open alternative panel ${active.name}`} title="Open alternative SidePanel"
          onClick={() => alternatives.length === 1 ? open(active) : setMenu(menu === `panel:${owner}` ? undefined : `panel:${owner}`)}>▥</button>
        {(menu === `swap:${owner}` || menu === `panel:${owner}`) && <div role="menu" style={{ position: 'absolute', left: 0, top: '100%', background: 'var(--surface-raised)', padding: 4, minWidth: 180 }}>
          {alternatives.map(item => <button role="menuitem" key={item.id} onClick={() => menu.startsWith('swap:') ? select(item.id) : open(item)}>{item.name}{state?.selected[model.id]?.includes(item.id) ? ' ✓' : ''}</button>)}
        </div>}
      </div>;
    })}
    {error && <div role="alert" style={{ position: 'absolute', top: '100%', color: 'var(--diff-deleted-text)', background: 'var(--surface-raised)' }}>{error}</div>}
  </div>;
}
