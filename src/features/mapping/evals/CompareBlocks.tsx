import { useRef, useState, type ReactNode } from 'react';
import type { CanvasCameraView } from '../../../../domain/core/diagrams/canvasCameraView';
import type { CompareCanvasCopy, CompareView } from '../../../../domain/mapping/compare/comparePageSession';
import { CompareCanvasPane } from './CompareCanvasPane';
import { DiagramPane } from './DiagramPane';
import { provenanceDetail } from './evalsFormat';

/** These props describe saved evidence. There is deliberately no update callback. */
interface ComparisonProps {
  spec: Readonly<CompareView>;
  canvases: readonly CompareCanvasCopy[];
  labels?: ReadonlyMap<string, string>;
  alignHighlights?: boolean;
}
export function ComparisonPanels({ A, B }: { A: ReactNode; B: ReactNode }) {
  const [split, setSplit] = useState(50), splitRoot = useRef<HTMLDivElement>(null);
  return <div className="evals-split" ref={splitRoot} style={{ gridTemplateColumns: `minmax(0, ${split}fr) 7px minmax(0, ${100 - split}fr)` }}>
    {A}
            <div role="separator" aria-label="Resize comparison panes" aria-orientation="vertical" aria-valuemin={20} aria-valuemax={80} aria-valuenow={Math.round(split)}
              tabIndex={0} className="evals-divider" onDoubleClick={() => setSplit(50)}
              onKeyDown={event => { if (event.key === 'ArrowLeft' || event.key === 'ArrowRight' || event.key === 'Home') {
                event.preventDefault(); setSplit(value => event.key === 'Home' ? 50 : Math.max(20, Math.min(80, value + (event.key === 'ArrowLeft' ? -2 : 2))));
              } }}
              onPointerDown={event => { if (event.button === 0) { event.preventDefault(); event.currentTarget.setPointerCapture(event.pointerId); } }}
              onPointerMove={event => { if (!event.currentTarget.hasPointerCapture(event.pointerId)) return;
                const bounds = splitRoot.current!.getBoundingClientRect(); setSplit(Math.max(20, Math.min(80, (event.clientX - bounds.left) / bounds.width * 100)));
              }} onPointerUp={event => { if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId); }} />
    {B}
  </div>;
}

/** Pan/zoom belongs to the private editors, and split belongs to ComparisonPanels. */
export function CompareCanvas({ spec, canvases, focuses, fitGenerated = false }: ComparisonProps & {
  focuses?: Partial<Record<'A' | 'B', CanvasCameraView>>; fitGenerated?: boolean;
}) {
  const pane = (side: 'A' | 'B') => {
    const target = spec[side], copy = canvases.find(copy => copy.id === target.canvasCopyId);
    if (!copy || target.kind === 'diagram') return <p role="alert">Missing canvas evidence.</p>;
    return <CompareCanvasPane key={`${spec.id}:${side}`} copy={copy} side={side} camera={target.camera} focus={focuses?.[side]}
      detail={provenanceDetail(copy.view.name, copy.generated)} fitContent={fitGenerated && !!copy.generated} />;
  };
  return <ComparisonPanels key={spec.id} A={pane('A')} B={pane('B')} />;
}

/** Expansion and scrolling are local; the saved slices remain unchanged. */
export function CompareDiagrams({ spec, canvases, labels, alignHighlights = false }: ComparisonProps) {
  const [expanded, setExpanded] = useState(!alignHighlights);
  const [aligned, setAligned] = useState(alignHighlights);
  const pane = (side: 'A' | 'B') => {
    const target = spec[side], copy = canvases.find(copy => copy.id === target.canvasCopyId);
    if (!copy || target.kind !== 'diagram') return <p role="alert">Missing diagram evidence.</p>;
    const other = spec[side === 'A' ? 'B' : 'A'];
    return <DiagramPane alignedWith={aligned && other.kind === 'diagram' ? other.ranges : undefined} key={`${spec.id}:${side}`} copy={copy} side={side} pane={target} expanded={expanded}
      detail={provenanceDetail(copy.view.name, copy.generated)} label={labels?.get(`${copy.id}:${target.diagramId}`)} />;
  };
  return <div className="comparison-diagrams mapping-document-view" onScrollCapture={event => {
    const target = event.target;
    if (!aligned || !(target instanceof HTMLElement) || !target.classList.contains('compare-document')) return;
    for (const other of event.currentTarget.querySelectorAll<HTMLElement>('.compare-document'))
      if (other !== target && Math.abs(other.scrollTop - target.scrollTop) > 1) other.scrollTop = target.scrollTop;
  }}><div className="comparison-block-tools"><button type="button" aria-pressed={expanded} onClick={() => setExpanded(value => !value)}>
    {expanded ? 'Show compared slices' : 'Show full diagrams'}</button> <button type="button" aria-pressed={aligned} onClick={() => setAligned(value => !value)}>Align highlights</button></div>
    <ComparisonPanels key={spec.id} A={pane('A')} B={pane('B')} /></div>;
}
