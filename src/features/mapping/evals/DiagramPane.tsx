import { useEffect, useMemo, useRef } from 'react';
import type { CompareCanvasCopy, CompareDiagramPaneSpec } from '../../../../domain/mapping/compare/comparePageSession';
import { revisionScope } from '../../../../domain/core/diagrams/diagramRevisionReview';
import { projectSelectedDiagramRows } from '../../../../domain/core/presentation/diagramRevisionProjection';
import { DiagramText } from '../../../shared/diagrams/DiagramText';
import { ComparePaneFrame } from './ComparePaneFrame';

/** Read only the pinned revision; canvas alternatives and diff modes do not compose this document. */
export function DiagramPane({ copy, pane, side, expanded = false, label, detail }: { copy: CompareCanvasCopy; pane: CompareDiagramPaneSpec; side: 'A' | 'B'; expanded?: boolean; label?: string; detail?: string }) {
  const scroll = useRef<HTMLDivElement>(null);
  const { rows, name, ranges } = useMemo(() => {
    const get = (id: string) => {
      const revision = copy.history.diagramRevisions[id];
      if (!revision) throw Error('The diagram revision is missing from this comparison.');
      return revision;
    };
    const revision = get(pane.revisionId), ranges = pane.ranges ?? [revisionScope(revision, pane.nodeRef ?? 'root')];
    const settings = copy.history.snapshots[copy.history.headId].document.diagramPresentations?.[revision.diagram.id];
    const rows = projectSelectedDiagramRows(revision, {}, pane.diagramId, get, settings)
      .filter(row => expanded || ranges.some(range => row.sourceLine! >= range.startLine && row.sourceLine! <= range.endLine));
    return { rows, ranges, name: revision.diagram.content.ascii.split('\n').find(line => line.trim())?.trim() || 'Diagram' };
  }, [copy, pane, expanded]);
  useEffect(() => {
    if (expanded) scroll.current?.querySelector('[data-compare-slice-start]')?.scrollIntoView({ block: 'center', inline: 'nearest' });
    else scroll.current?.scrollTo({ top: 0, left: 0 });
  }, [expanded]);
  return <ComparePaneFrame side={side} title={label ? `${label} · ${name}` : name} subtitle={`${copy.canvasName} — ${copy.view.name}`} detail={detail}
    actions={<button type="button" onClick={() => scroll.current?.scrollTo({ top: 0, left: 0 })}>Top</button>}>
    <div ref={scroll} className="compare-document" data-compare-pane={side} data-diagram-revision={pane.revisionId}
      role="region" aria-label={`Diagram document ${side}`} tabIndex={0}>
      <DiagramText rows={rows} rowProps={row => {
        const line = row.sourceLine!, range = ranges.find(range => line >= range.startLine && line <= range.endLine);
        const start = range?.startLine === line, end = range?.endLine === line;
        const gap = !expanded && start && ranges.indexOf(range!) > 0;
        return { 'data-source-line': line, ...(start ? { 'data-compare-slice-start': true } : {}),
          ...(gap ? { 'data-slice-gap': '…' } : {}),
          className: `ascii-line${expanded && range ? ` compare-slice${start ? ' is-start' : ''}${end ? ' is-end' : ''}` : ''}${gap ? ' compare-slice-gap' : ''}` };
      }} />
    </div>
  </ComparePaneFrame>;
}
