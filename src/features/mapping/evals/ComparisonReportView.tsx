import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { useArrowNavigation, type BoundaryNavigation } from './evalNavigation';
import ReactMarkdown from 'react-markdown';
import type { ComparisonReport } from '../../../../domain/mapping/compare/comparisonReport';
import { opinionColor, resolvedOpinionScale } from '../../../../domain/mapping/compare/comparisonOpinion';
import type { CompareCanvasCopy } from '../../../../domain/mapping/compare/comparePageSession';
import { CompareCanvas, CompareDiagrams } from './CompareBlocks';

/** Read-only report inputs; traversal, expansion, alignment and cameras stay in the viewer. */
export function ComparisonReportView({ report, canvases, initialEntry, hasPrevious, hasNext, onBoundary }: { report: Readonly<ComparisonReport>; canvases: readonly CompareCanvasCopy[] } & BoundaryNavigation) {
  const steps = useMemo(() => report.pages.flatMap((page, pageIndex) => {
    const findings = page.blocks.flatMap(block => block.kind === 'text' ? [] : [{ pageIndex, id: block.spec.id as string | undefined }]);
    return findings.length ? findings : [{ pageIndex, id: undefined }];
  }), [report]);
  const [stepIndex, setStepIndex] = useState(() => initialEntry === 'last' ? Math.max(0, steps.length - 1) : 0);
  const [navigation, setNavigation] = useState(0), [expandedView, setExpandedView] = useState(false);
  const article = useRef<HTMLElement>(null);
  const findings = steps.filter(step => step.id !== undefined);
  const step = steps[Math.min(stepIndex, steps.length - 1)];
  const position = step?.pageIndex ?? 0, active = findings.findIndex(finding => finding.id === step?.id);
  const page = report.pages[position];
  const scale = resolvedOpinionScale(report.scale);
  const move = (direction: number) => {
    const next = stepIndex + direction;
    if (next < 0 || next >= steps.length) { onBoundary?.(direction); return; }
    setStepIndex(next); setNavigation(value => value + 1);
  };
  const selectPage = (index: number) => { setStepIndex(steps.findIndex(step => step.pageIndex === index)); setNavigation(value => value + 1); };
  useArrowNavigation(move);
  useEffect(() => {
    const root = article.current, finding = findings[active];
    const target = finding && root?.querySelector<HTMLElement>(`[data-finding-id="${finding.id}"]`);
    if (root && target) root.scrollTop += target.getBoundingClientRect().top - root.getBoundingClientRect().top - 12;
    else root?.scrollTo({ top: 0 });
  }, [navigation, position]);
  return <div className={`comparison-report${expandedView ? ' is-expanded' : ''}`}>
    <nav aria-label="Report pages" className="comparison-toolbar">
      <select className="comparison-page-select" aria-label="Report page" value={position} onChange={event => selectPage(Number(event.target.value))}>
        {report.pages.map((item, index) => <option key={item.id} value={index}>{index + 1}. {item.title}</option>)}
      </select>
      {report.pages.map((item, index) => <button className="comparison-page-tab" key={item.id} type="button" aria-current={page.id === item.id ? 'page' : undefined}
        onClick={() => selectPage(index)}>{index + 1}. {item.title}</button>)}
      <button type="button" aria-pressed={expandedView} onClick={() => setExpandedView(value => !value)}>{expandedView ? 'Exit expanded view' : 'Expand comparison'}</button>
      <div className="comparison-stepper">
        <button type="button" aria-keyshortcuts="ArrowLeft" disabled={stepIndex === 0 && !hasPrevious} onClick={() => move(-1)}>← Previous finding</button>
        <span aria-live="polite">{active < 0 ? page.title : `Finding ${active + 1} of ${findings.length}`}</span>
        <button type="button" aria-keyshortcuts="ArrowRight" disabled={stepIndex === steps.length - 1 && !hasNext} onClick={() => move(1)}>Next finding →</button>
      </div>
    </nav>
    {report.scale && <section className="comparison-legend" aria-label="Opinion scale">
      <details><summary><strong>{scale.title}</strong><span className="comparison-legend-chips">{scale.levels.map(level => <span key={level.id} title={level.meaning}><span className="opinion-swatch" style={{ background: opinionColor(report.scale, level.id) }} />{level.label}</span>)}</span><span className="evals-muted">Meanings</span></summary>
      <ul>{scale.levels.map(level => <li key={level.id} title={level.meaning}><span className="opinion-swatch" style={{ background: opinionColor(report.scale, level.id) }} />
        <strong>{level.label}</strong><span>{level.meaning}</span></li>)}</ul>
      {report.scale.kind === 'custom' && <p><strong>Why this scale:</strong> {report.scale.reason}</p>}
      <p>Color measures the Judge’s assessment, not output quality. Attribution confidence is stated separately.</p></details>
    </section>}
    <article ref={article} key={page.id} className={`comparison-report-page${findings.some(finding => finding.pageIndex === position) ? ' has-finding' : ''}`} aria-label={page.title}>
      {!findings.some(finding => finding.pageIndex === position) && <h2>{page.title}</h2>}
      {page.blocks.map((block, index) => {
        if (block.kind === 'text') return findings.some(finding => finding.pageIndex === position) ? null : <div key={index} className="comparison-report-text"><ReactMarkdown>{block.text}</ReactMarkdown></div>;
        if (block.spec.id !== findings[active]?.id) return null;
        const opinion = block.spec.opinion, color = opinion ? opinionColor(report.scale, opinion.level) : undefined;
        const level = opinion && scale.levels.find(item => item.id === opinion.level);
        return <section key={block.spec.id} className="comparison-report-block" aria-label={block.spec.title} data-finding-id={block.spec.id}
          aria-current={findings[active]?.id === block.spec.id ? 'step' : undefined}
          style={{ '--opinion-color': color } as CSSProperties} onPointerDown={() => setStepIndex(steps.findIndex(item => item.id === block.spec.id))}>
          <h3>{block.spec.title} <small>{block.kind === 'compare-diagrams' ? 'Diagram comparison' : 'Canvas comparison'}</small></h3>
          {opinion && <div className="comparison-opinion"><span className="opinion-rating"><span className="opinion-swatch" style={{ background: color }} />{level?.label ?? opinion.level}</span>
            <span>Attribution confidence: {opinion.attributionConfidence}</span></div>}
          <details className="comparison-finding-notes"><summary>Finding notes</summary>
            {opinion && <p>{opinion.rationale}</p>}<ReactMarkdown>{block.spec.explanation}</ReactMarkdown>
            {page.blocks.filter(item => item.kind === 'text').map((item, i) => item.kind === 'text' && <ReactMarkdown key={i}>{item.text}</ReactMarkdown>)}
          </details>
          <div className="comparison-report-panes">{block.kind === 'compare-canvas'
            ? <CompareCanvas spec={block.spec} canvases={canvases} /> : <CompareDiagrams spec={block.spec} canvases={canvases} alignHighlights />}</div>
        </section>;
      })}
    </article>
  </div>;
}
