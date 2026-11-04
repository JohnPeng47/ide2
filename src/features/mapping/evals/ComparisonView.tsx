import { Component, useEffect, useMemo, useState, type ReactNode } from 'react';
import { compareDiagramLabels, compareSteps, type CompareCanvasCopy, type ComparePageSession } from '../../../../domain/mapping/compare/comparePageSession';
import type { EvalPrompt } from '../../../../domain/mapping/evals/evalPrompt';
import { evalWorkflows } from '../../../../domain/mapping/evals/evalWorkflows';
import { lineDiff } from '../../../../domain/mapping/evals/lineDiff';
import { CompareCanvas, CompareDiagrams } from './CompareBlocks';
import { Drawer } from './Drawer';
import { LayoutProvenance } from './LayoutTemplates';
import { errorMessage, promptLabel } from './evalsFormat';

class ComparisonBoundary extends Component<{ children: ReactNode }, { error?: string }> {
  state: { error?: string } = {};
  static getDerivedStateFromError(error: unknown) { return { error: errorMessage(error) }; }
  render() { return this.state.error ? <p role="alert" className="evals-message">Unable to display this comparison: {this.state.error}</p> : this.props.children; }
}

export function ComparisonView({ session, prompts }: { session: ComparePageSession; prompts: EvalPrompt[] }) {
  const diagramLabels = useMemo(() => compareDiagramLabels(session), [session]);
  const steps = useMemo(() => compareSteps(session), [session]);
  const [position, setPosition] = useState(0);
  const [rail, setRail] = useState(true), [notes, setNotes] = useState(true), [diff, setDiff] = useState(false);
  useEffect(() => {
    const navigate = (event: KeyboardEvent) => {
      if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight' || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey || event.isComposing) return;
      const target = event.target;
      if (target instanceof Element && target.closest('.compare-document, .evals-drawer, input, textarea, select, [contenteditable]:not([contenteditable="false"]), [role="textbox"], [role="combobox"], [role="separator"], [role="slider"], [role="menu"], [role="listbox"]')) return;
      event.preventDefault(); event.stopPropagation();
      setPosition(current => Math.max(0, Math.min(steps.length - 1, current + (event.key === 'ArrowRight' ? 1 : -1))));
    };
    // Capture before the canvas handles arrow keys so navigation also works inside either pane.
    window.addEventListener('keydown', navigate, true);
    return () => window.removeEventListener('keydown', navigate, true);
  }, [steps.length]);
  const step = steps[position], comparison = step?.compare;
  if (!comparison) return <p className="evals-message">This session has no comparisons.</p>;
  const copyFor = (side: 'A' | 'B') => session.canvases.find(copy => copy.id === comparison[side].canvasCopyId)!;
  const focusFor = (side: 'A' | 'B') => step.point ? copyFor(side).view.cameraViews?.find(camera => camera.id === step.point![side]) : undefined;
  const A = copyFor('A'), B = copyFor('B');
  const promptA = A.generated?.prompt, promptB = B.generated?.prompt;
  const diffable = !!promptA && !!promptB && (promptA.id !== promptB.id || promptA.version !== promptB.version);
  const diagramMode = comparison.A.kind === 'diagram' && comparison.B.kind === 'diagram';
  return <div className={`comparison-view${rail ? ' has-rail' : ''}`}>
    <header className="comparison-toolbar">
      <div className="comparison-title"><strong>{session.title}</strong><span title={step.point?.title ?? comparison.title}>{step.point?.title ?? comparison.title}</span></div>
      {diffable && <button type="button" onClick={() => setDiff(true)}>Prompt diff A ↔ B</button>}
      <div className="comparison-stepper">
        <button type="button" title="Previous comparison step (←)" aria-keyshortcuts="ArrowLeft" disabled={position === 0} onClick={() => setPosition(position - 1)}>Previous</button>
        <span aria-live="polite">{position + 1} / {steps.length}</span>
        <button type="button" title="Next comparison step (→)" aria-keyshortcuts="ArrowRight" disabled={position === steps.length - 1} onClick={() => setPosition(position + 1)}>Next</button>
      </div>
      <button type="button" aria-pressed={rail} onClick={() => setRail(value => !value)}>Steps</button>
    </header>
    <div className="comparison-body">
      <div className="comparison-main">
        <ComparisonBoundary key={`${session.id}:${comparison.id}`}>
          {diagramMode ? <CompareDiagrams key={comparison.id} spec={comparison} canvases={session.canvases} labels={diagramLabels} />
            : <CompareCanvas spec={comparison} canvases={session.canvases} focuses={{ A: focusFor('A'), B: focusFor('B') }} fitGenerated />}
        </ComparisonBoundary>
        {comparison.explanation && <section className={`comparison-notes${notes ? '' : ' is-collapsed'}`} aria-label="Comparison explanation">
          <button type="button" className="comparison-notes-toggle" aria-expanded={notes} onClick={() => setNotes(value => !value)}>
            {notes ? '▾' : '▸'} {step.point?.title ?? comparison.title}</button>
          {notes && <p>{comparison.explanation}</p>}
        </section>}
      </div>
      {rail && <nav className="comparison-rail" aria-label="Comparison steps">
        <h3>Steps</h3>
        <ol>{session.compares.map(item => <li key={item.id}>
          <button type="button" aria-current={item.id === comparison.id && !step.point ? 'step' : item.id === comparison.id ? 'true' : undefined}
            onClick={() => setPosition(steps.findIndex(candidate => candidate.compare.id === item.id))}>{item.title}</button>
          {item.points?.length ? <ol>{item.points.map(point => <li key={point.id}><button type="button" aria-current={point.id === step.point?.id ? 'step' : undefined}
            onClick={() => setPosition(steps.findIndex(candidate => candidate.point?.id === point.id))}>{point.title}</button></li>)}</ol> : null}
        </li>)}</ol>
      </nav>}
    </div>
    {diff && <PromptDiff A={A} B={B} prompts={prompts} onClose={() => setDiff(false)} />}
  </div>;
}

export function PromptDiff({ A, B, prompts, onClose }: { A: CompareCanvasCopy; B: CompareCanvasCopy; prompts: EvalPrompt[]; onClose: () => void }) {
  const text = (copy: CompareCanvasCopy) => copy.generated?.promptStages ?? prompts.find(prompt => prompt.id === copy.generated?.prompt?.id)?.versions.find(item => item.version === copy.generated?.prompt?.version)?.stages;
  const a = text(A), b = text(B), workflow = A.generated?.workflow ? evalWorkflows[A.generated.workflow] : undefined;
  const stages = [...new Set([...Object.keys(a ?? {}), ...Object.keys(b ?? {})])];
  return <Drawer title="Prompt diff" wide onClose={onClose}>
    <p className="prompt-diff-legend"><span className="is-removed">− A · {promptLabel(A.generated!.prompt)}</span><span className="is-added">+ B · {promptLabel(B.generated!.prompt)}</span></p>
    {(A.generated?.layoutTemplate || B.generated?.layoutTemplate) && <section aria-label="Pinned layout inputs">
      {([['A', A], ['B', B]] as const).map(([side, copy]) => <div key={side}><h3>{side} · Layout input</h3>
        {copy.generated?.layoutTemplate ? <LayoutProvenance template={copy.generated.layoutTemplate} placements={copy.generated.layoutPlacements} /> : <p>No layout template.</p>}
      </div>)}
    </section>}
    {!a || !b ? <p className="evals-muted">One of these prompt versions is no longer available.</p> : stages.map(stage => {
      const lines = lineDiff(a[stage] ?? '', b[stage] ?? ''), changed = lines.some(line => line.kind !== 'same');
      return <section key={stage} className="prompt-diff" aria-label={`Stage ${stage} diff`}>
        <h3>{workflow?.stages.find(item => item.id === stage)?.label ?? stage} {!changed && <small>identical</small>}</h3>
        <pre>{lines.map((line, i) => <span key={i} className={`is-${line.kind}`}>{line.kind === 'added' ? '+ ' : line.kind === 'removed' ? '− ' : '  '}{line.text}{'\n'}</span>)}</pre>
      </section>;
    })}
  </Drawer>;
}
