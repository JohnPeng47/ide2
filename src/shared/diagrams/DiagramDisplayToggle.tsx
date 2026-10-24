/** Shared by any surface presenting a comparison of diagram revisions. */
export function DiagramDisplayToggle({ mode, onChange }: { mode: 'regular' | 'diff'; onChange: (mode: 'regular' | 'diff') => void }) {
  return <div className="diagram-display-toggle" role="group" aria-label="Diagram display" data-mapping-static-ui data-diagram-canvas-static-ui
    onPointerDown={event => event.stopPropagation()}>
    <button type="button" aria-pressed={mode === 'regular'} onClick={() => onChange('regular')}>Regular</button>
    <button type="button" aria-pressed={mode === 'diff'} onClick={() => onChange('diff')}>Diff</button>
  </div>;
}
