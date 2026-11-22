import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { useArrowNavigation } from './evalNavigation';
import { TerminalMarkdownContent } from '../../../shared/markdown/TerminalMarkdownContent';
import { ExperimentOutputPanel } from './ExperimentOutputPanel';
import type { ComparisonReport } from '../../../../domain/mapping/compare/comparisonReport';
import { opinionColor, resolvedOpinionScale } from '../../../../domain/mapping/compare/comparisonOpinion';
import type { CompareCanvasCopy } from '../../../../domain/mapping/compare/comparePageSession';
import { CompareCanvas, CompareDiagrams } from './CompareBlocks';
import { CompareTrees } from './CompareTrees';
import { ItemToolbarPortal, useItemToolbar } from './ItemToolbar';
import { reportSteps } from '../../../../domain/mapping/compare/reportSteps';

/** Read-only report inputs; traversal, expansion, alignment and cameras stay in the viewer. */
export function ComparisonReportView({ report, canvases, step: selected, onStep }: {
  report: Readonly<ComparisonReport>; canvases: readonly CompareCanvasCopy[];
  /** Controlled step key (see reportSteps); the viewer reports its own moves through onStep. */
  step?: string; onStep?: (key: string) => void;
}) {
  const steps = useMemo(() => reportSteps(report).map(step => ({ ...step, id: step.findingId })), [report]);
  const [stepIndex, setStepIndex] = useState(() => Math.max(0, steps.findIndex(step => step.key === selected)));
  useEffect(() => {
    const index = Math.max(0, steps.findIndex(step => step.key === selected));
    if (index >= 0 && index !== stepIndex) { setStepIndex(index); setNavigation(value => value + 1); }
  }, [selected, steps]);
  const [navigation, setNavigation] = useState(0), [expandedView, setExpandedView] = useState(false);
  const article = useRef<HTMLElement>(null);
  const findings = steps.filter(step => step.id !== undefined);
  const step = steps[Math.min(stepIndex, steps.length - 1)];
  const position = step?.pageIndex ?? 0, active = findings.findIndex(finding => finding.id === step?.id);
  const page = report.pages[position];
  const scale = resolvedOpinionScale(report.scale);
  const move = (direction: number) => {
    const next = stepIndex + direction;
    if (next < 0 || next >= steps.length) return;
    setStepIndex(next); setNavigation(value => value + 1); onStep?.(steps[next].key);
  };
  const selectPage = (index: number) => { const next = steps.findIndex(step => step.pageIndex === index); setStepIndex(next); setNavigation(value => value + 1); onStep?.(steps[next].key); };
  useArrowNavigation(move, true, { shift: true });
  useEffect(() => {
    const root = article.current, finding = findings[active];
    const target = finding && root?.querySelector<HTMLElement>(`[data-finding-id="${finding.id}"]`);
    if (root && target) root.scrollTop += target.getBoundingClientRect().top - root.getBoundingClientRect().top - 12;
    else root?.scrollTo({ top: 0 });
  }, [navigation, position]);
  const slot = useItemToolbar(), [notesOpen, setNotesOpen] = useState(false);
  const hasFinding = findings.some(finding => finding.pageIndex === position);
  return <div className={`comparison-report${expandedView ? ' is-expanded' : ''}${slot ? ' is-compact' : ''}`}>
    {slot ? <ItemToolbarPortal group="report">
      {hasFinding && <button type="button" aria-pressed={notesOpen} onClick={() => setNotesOpen(value => !value)}>Notes</button>}
      <button type="button" aria-pressed={expandedView} onClick={() => setExpandedView(value => !value)}>{expandedView ? 'Exit expanded' : 'Expand'}</button>
    </ItemToolbarPortal> : <nav aria-label="Report pages" className="comparison-toolbar">
      <select className="comparison-page-select" aria-label="Report page" value={position} onChange={event => selectPage(Number(event.target.value))}>
        {report.pages.map((item, index) => <option key={item.id} value={index}>{index + 1}. {item.title}</option>)}
      </select>
      {report.pages.map((item, index) => <button className="comparison-page-tab" key={item.id} type="button" aria-current={page.id === item.id ? 'page' : undefined}
        onClick={() => selectPage(index)}>{index + 1}. {item.title}</button>)}
      <button type="button" aria-pressed={expandedView} onClick={() => setExpandedView(value => !value)}>{expandedView ? 'Exit expanded view' : 'Expand comparison'}</button>
      <div className="comparison-stepper">
        <button type="button" title="Shift+←" aria-keyshortcuts="Shift+ArrowLeft" disabled={stepIndex === 0} onClick={() => move(-1)}>← Previous finding</button>
        <span aria-live="polite">{active < 0 ? page.title : `Finding ${active + 1} of ${findings.length}`}</span>
        <button type="button" title="Shift+→" aria-keyshortcuts="Shift+ArrowRight" disabled={stepIndex === steps.length - 1} onClick={() => move(1)}>Next finding →</button>
      </div>
    </nav>}
    {report.scale && <section className="comparison-legend" aria-label="Opinion scale">
      <details><summary><strong>{scale.title}</strong><span className="comparison-legend-chips">{scale.levels.map(level => <span key={level.id} title={level.meaning}><span className="opinion-swatch" style={{ background: opinionColor(report.scale, level.id) }} />{level.label}</span>)}</span><span className="evals-muted">Meanings</span></summary>
      <ul>{scale.levels.map(level => <li key={level.id} title={level.meaning}><span className="opinion-swatch" style={{ background: opinionColor(report.scale, level.id) }} />
        <strong>{level.label}</strong><span>{level.meaning}</span></li>)}</ul>
      {report.scale.kind === 'custom' && <p><strong>Why this scale:</strong> {report.scale.reason}</p>}
      <p>Color measures the Judge’s assessment, not output quality. Attribution confidence is stated separately.</p></details>
    </section>}
    {!findings.some(finding => finding.pageIndex === position) ? <ExperimentOutputPanel key={page.id} title={page.title}>
      {page.blocks.map((block, index) => block.kind === 'text' && <TerminalMarkdownContent key={index} className="output-markdown" source={block.text} />)}
    </ExperimentOutputPanel> : <article ref={article} key={page.id} className="comparison-report-page has-finding" aria-label={page.title}>
      {page.blocks.map((block, index) => {
        if (block.kind === 'text') return null;
        if (block.spec.id !== findings[active]?.id) return null;
        const opinion = block.spec.opinion, color = opinion ? opinionColor(report.scale, opinion.level) : undefined;
        const level = opinion && scale.levels.find(item => item.id === opinion.level);
        return <section key={block.spec.id} className="comparison-report-block" aria-label={block.spec.title} data-finding-id={block.spec.id}
          aria-current={findings[active]?.id === block.spec.id ? 'step' : undefined}
          style={{ '--opinion-color': color } as CSSProperties} onPointerDown={() => { const next = steps.findIndex(item => item.id === block.spec.id); if (next !== stepIndex) { setStepIndex(next); onStep?.(steps[next].key); } }}>
          {!slot && <h3>{block.spec.title} <small>{block.kind === 'compare-diagrams' ? 'Diagram comparison' : block.kind === 'compare-tree' ? 'Tree comparison' : 'Canvas comparison'}</small></h3>}
          {opinion && <div className="comparison-opinion"><span className="opinion-rating"><span className="opinion-swatch" style={{ background: color }} />{level?.label ?? opinion.level}</span>
            <span>Attribution confidence: {opinion.attributionConfidence}</span></div>}
          {(() => {
            const notes = <>{opinion && <p>{opinion.rationale}</p>}<TerminalMarkdownContent source={block.spec.explanation} />
              {page.blocks.filter(item => item.kind === 'text').map((item, i) => item.kind === 'text' && <TerminalMarkdownContent key={i} source={item.text} />)}</>;
            return slot ? notesOpen && <div className="comparison-finding-notes is-open">{notes}</div>
              : <details className="comparison-finding-notes"><summary>Finding notes</summary>{notes}</details>;
          })()}
          <div className="comparison-report-panes">{block.kind === 'compare-canvas'
            ? <CompareCanvas spec={block.spec} canvases={canvases} /> : block.kind === 'compare-tree'
            ? <CompareTrees spec={block.spec} sources={report.treeSources ?? []} /> : <CompareDiagrams spec={block.spec} canvases={canvases} alignHighlights />}</div>
        </section>;
      })}
    </article>}
  </div>;
}
