import { useMemo, useState, type CSSProperties, type KeyboardEvent } from 'react';
import { ItemToolbarPortal, useItemToolbar } from './ItemToolbar';
import { childStep, layoutTreeComparison, treeMatchColor, type CompareTreeSpec, type TreeCell, type TreeSource } from '../../../../domain/mapping/compare/treeComparison';

const ROW = 20, GUTTER = 200;
const cardHeight = (match: { comment?: string }) => match.comment ? 84 : 38;
const kindLabel = { same: 'Same placement', 'depth-shift': 'Depth shift', 'implied-parent': 'Implied parent', relocated: 'Relocated' } as const;
const ranges = (list: { startLine: number; endLine: number }[]) => list.map(r => r.startLine === r.endLine ? `${r.startLine}` : `${r.startLine}–${r.endLine}`).join(', ');

/** Read-only evidence: two trees in source order, aligned by spacer rows, linked by colour and gutter bands. */
export function CompareTrees({ spec, sources }: { spec: Readonly<CompareTreeSpec>; sources: readonly TreeSource[] }) {
  const [stepIndex, setStepIndex] = useState(0), [fold, setFold] = useState(true);
  /** Index of the top-level match whose children are shown; viewer state only. */
  const [opened, setOpened] = useState<number>();
  const slot = useItemToolbar();
  const topStep = spec.steps[Math.min(stepIndex, spec.steps.length - 1)];
  const A = sources.find(s => s.id === spec.A), B = sources.find(s => s.id === spec.B);
  const parent = opened === undefined ? undefined : topStep.matches[opened];
  const step = useMemo(() => parent && A && B
    ? childStep(parent, { A: A.ascii.split('\n').length, B: B.ascii.split('\n').length }) ?? topStep : topStep, [parent, A, B, topStep]);
  const layout = useMemo(() => A && B ? layoutTreeComparison(A.ascii, B.ascii, step, fold) : undefined, [A, B, step, fold]);
  if (!A || !B || !layout) return <p role="alert">Missing tree evidence.</p>;
  const inChildren = step !== topStep;
  /** Only top-level matches with children open; child matches are terminal. */
  const openable = (i: number) => !inChildren && !!topStep.matches[i]?.children;
  const open = (i: number) => { if (openable(i)) setOpened(i); };
  const height = layout.rows.length * ROW;

  const bands = layout.spans.flatMap(span => {
    const a = span.A.filter(s => s.top >= 0), b = span.B.filter(s => s.top >= 0);
    if (!a.length || !b.length) return [];
    const pairs = a.length === b.length ? a.map((x, i) => [x, b[i]] as const)
      : a.length === 1 ? b.map(y => [a[0], y] as const) : b.length === 1 ? a.map(x => [x, b[0]] as const)
      : a.map((x, i) => [x, b[Math.min(i, b.length - 1)]] as const);
    return pairs.map(([x, y]) => ({ match: span.match, aTop: x.top * ROW, aBottom: (x.bottom + 1) * ROW, bTop: y.top * ROW, bBottom: (y.bottom + 1) * ROW }));
  });
  const mid = GUTTER / 2;
  const brackets = step.matches.flatMap((match, i) => {
    if (!match.implied) return [];
    const spans = layout.spans[i][match.implied.side].filter(s => s.top >= 0);
    return spans.length ? [{ match: i, side: match.implied.side, spans }] : [];
  });
  // Comment cards sit at their match's first band, pushed down to avoid overlap.
  let floor = -Infinity;
  const cards = step.matches.map((match, i) => {
    const band = bands.find(b => b.match === i);
    const height = cardHeight(match), want = band ? (band.aTop + band.aBottom + band.bTop + band.bBottom) / 4 - height / 2 : 0;
    return { match, i, want, height };
  }).sort((x, y) => x.want - y.want).map(card => { const top = Math.max(card.want, floor + 6, 0); floor = top + card.height; return { ...card, top }; });
  const bodyHeight = Math.max(height, floor + 8);

  const cell = (s: 'A' | 'B', item: TreeCell, row: number) => {
    if (item.kind === 'spacer') return <div key={row} className="tree-row is-spacer" />;
    if (item.kind === 'fold') return <div key={row} className="tree-row is-fold" title={`Lines ${item.from}–${item.to}`}><span className="tree-ln" />┆ {item.to - item.from + 1} lines</div>;
    if (item.kind === 'absent') return <div key={row} className="tree-row is-absent"><span className="tree-ln" />∅ {item.text}</div>;
    const color = item.matches.length ? treeMatchColor(item.matches[0]) : undefined;
    const target = item.matches.find(openable);
    return <div key={row} data-source-line={item.line} onClick={target === undefined ? undefined : () => open(target)}
      className={`tree-row${color ? ' is-matched' : item.context || item.root ? ' is-context' : ' is-dim'}${item.root ? ' is-root' : ''}${target === undefined ? '' : ' is-openable'}`}
      style={color ? { '--match-color': color } as CSSProperties : undefined}>
      <span className="tree-ln">{item.line}</span><span style={{ paddingLeft: `${layout.indent[s]}ch` }}>{item.text || ' '}</span>
    </div>;
  };

  const tools = <>
    {spec.steps.length > 1 && <span role="tablist" aria-label="Comparison steps" className="tree-compare-steps">{spec.steps.map((item, i) =>
      <button key={i} type="button" role="tab" aria-selected={i === stepIndex} title={item.title} onClick={() => { setStepIndex(i); setOpened(undefined); }}>{i + 1}. {item.title}</button>)}</span>}
    {inChildren && <button type="button" onClick={() => setOpened(undefined)} title="Back to the top-level matches">← Top level</button>}
    <button type="button" aria-pressed={!fold} onClick={() => setFold(value => !value)}>{fold ? 'Full trees' : 'Fold'}</button>
  </>;
  return <div className="tree-compare">
    {slot ? <ItemToolbarPortal group="tree">{tools}</ItemToolbarPortal> : <div className="tree-compare-tools">{tools}</div>}
    {inChildren && <p className="tree-compare-step-comment tree-compare-inside"><strong>Inside {opened! + 1}. {step.title}</strong> · {step.matches.length} child {step.matches.length === 1 ? 'match' : 'matches'}</p>}
    {step.comment && <p className="tree-compare-step-comment">{step.comment}</p>}
    <div className="tree-compare-heading" style={{ gridTemplateColumns: `minmax(0, 1fr) ${GUTTER}px minmax(0, 1fr)` }}>
      <div><span className="compare-side">A</span> <strong>{A.id} · {A.label}</strong></div><div />
      <div><span className="compare-side">B</span> <strong>{B.id} · {B.label}</strong></div>
    </div>
    <div className="tree-compare-body" tabIndex={0} role="region" aria-label="Aligned trees">
      <div className="tree-compare-grid" style={{ gridTemplateColumns: `minmax(0, 1fr) ${GUTTER}px minmax(0, 1fr)`, minHeight: bodyHeight }}>
        <div className="tree-pane"><pre>{layout.rows.map((row, i) => cell('A', row.A, i))}</pre></div>
        <div className="tree-gutter" style={{ height: bodyHeight }}>
          <svg width={GUTTER} height={bodyHeight} aria-hidden="true">
            {bands.map((b, i) => <path key={i} className={openable(b.match) ? 'is-openable' : undefined} onClick={() => open(b.match)} d={`M0,${b.aTop} C${mid},${b.aTop} ${mid},${b.bTop} ${GUTTER},${b.bTop} L${GUTTER},${b.bBottom} C${mid},${b.bBottom} ${mid},${b.aBottom} 0,${b.aBottom} Z`}
              fill={treeMatchColor(b.match)} fillOpacity={0.16} stroke={treeMatchColor(b.match)} strokeOpacity={0.55} />)}
            {brackets.map(bracket => {
              const x = bracket.side === 'A' ? 5 : GUTTER - 5, tick = bracket.side === 'A' ? 6 : -6;
              const top = bracket.spans[0].top * ROW + 2, bottom = (bracket.spans[bracket.spans.length - 1].bottom + 1) * ROW - 2;
              return <g key={bracket.match} stroke={treeMatchColor(bracket.match)} strokeWidth={2} fill="none">
                <path d={`M${x + tick},${top} L${x},${top} L${x},${bottom} L${x + tick},${bottom}`} strokeDasharray="4 3" />
                {bracket.spans.map((s, i) => <path key={i} d={`M${x},${s.top * ROW + 2} L${x + tick},${s.top * ROW + 2} M${x},${(s.bottom + 1) * ROW - 2} L${x + tick},${(s.bottom + 1) * ROW - 2}`} />)}
              </g>;
            })}
          </svg>
          {cards.map(({ match, i, top, height: cardH }) => <div key={match.id} className={`tree-card${openable(i) ? ' is-openable' : ''}`} style={{ top, height: cardH, '--match-color': treeMatchColor(i) } as CSSProperties}
            title={[match.label, match.implied && `Implied in ${match.implied.side}: ${match.implied.label}`, match.comment, openable(i) && 'Click to show the matches inside.'].filter(Boolean).join('\n\n')}
            {...openable(i) ? { role: 'button', tabIndex: 0, 'aria-label': `Show matches inside ${match.label}`, onClick: () => open(i),
              onKeyDown: (event: KeyboardEvent) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); open(i); } } } : {}}>
            <strong>{i + 1}. {match.label}{openable(i) && <span className="tree-card-open" aria-hidden="true"> ▸ {topStep.matches[i].children!.matches.length}</span>}</strong>
            <small>{kindLabel[match.kind]}{match.implied ? ` · implied in ${match.implied.side}: ${match.implied.label}` : ''}</small>
            {match.comment && <span>{match.comment}</span>}
          </div>)}
        </div>
        <div className="tree-pane"><pre>{layout.rows.map((row, i) => cell('B', row.B, i))}</pre></div>
      </div>
    </div>
    <details className="tree-compare-notes"><summary>Match notes ({step.matches.length})</summary>
      <ol>{step.matches.map((match, i) => <li key={match.id} style={{ '--match-color': treeMatchColor(i) } as CSSProperties}>
        <span className="tree-swatch" /> <strong>{match.label}</strong> — {kindLabel[match.kind]} · A {ranges(match.A)} ↔ B {ranges(match.B)}
        {match.implied && <> · implied in {match.implied.side}: <em>{match.implied.label}</em></>}
        {match.comment && <p>{match.comment}</p>}
      </li>)}
      {(step.absent ?? []).map((item, i) => <li key={`absent-${i}`}>∅ Absent in {item.side}: {item.text}</li>)}</ol>
    </details>
  </div>;
}
