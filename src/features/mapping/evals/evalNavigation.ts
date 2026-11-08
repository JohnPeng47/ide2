import { hasEvalOutput } from '../../../../domain/mapping/evals/evalRun';
import { useEffect, useRef } from 'react';
import { experimentOutput, type EvalExperiment } from '../../../../domain/mapping/evals/experiment';
import type { EvalRunSummary } from '../../../../domain/mapping/evals/evalRun';

export interface BoundaryNavigation {
  initialEntry?: 'first' | 'last';
  hasPrevious?: boolean;
  hasNext?: boolean;
  onBoundary?: (direction: number) => void;
}

/** Capture before canvas panning, while leaving editing and widget keys alone. */
export function useArrowNavigation(move: (direction: number) => void, enabled = true) {
  const latest = useRef(move); latest.current = move;
  useEffect(() => {
    if (!enabled) return;
    const key = (event: KeyboardEvent) => {
      if (!['ArrowLeft', 'ArrowRight'].includes(event.key) || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey || event.isComposing || event.defaultPrevented) return;
      if (event.target instanceof Element && event.target.closest('input, textarea, select, [contenteditable]:not([contenteditable="false"]), [role="dialog"], [role="tree"], [role="textbox"], [role="separator"], [role="slider"], [role="menu"], [role="listbox"], [role="combobox"], [data-output-canvas-navigation], .evals-drawer')) return;
      event.preventDefault(); event.stopPropagation(); latest.current(event.key === 'ArrowRight' ? 1 : -1);
    };
    window.addEventListener('keydown', key, true);
    return () => window.removeEventListener('keydown', key, true);
  }, [enabled]);
}

/** The same case/condition/sample/stage order drives entry points and traversal. */
export function experimentOutputSequence(experiment: EvalExperiment, runs: EvalRunSummary[]) {
  const phases = experiment.phases?.length ? experiment.phases : [{ id: undefined, name: '' }];
  return phases.flatMap(phase => experiment.cases.flatMap(input => experiment.conditions.flatMap(condition => experiment.samples
    .filter(sample => sample.phaseId === phase.id && sample.caseId === input.id && sample.conditionId === condition.id)
    .sort((a, b) => a.number - b.number || a.attempt - b.attempt)
    .flatMap(sample => experiment.workflow.stages.flatMap(stage => {
      const output = sample.outputs.find(item => item.stageId === stage.id), cell = output && experimentOutput(output, runs);
      return output && cell?.status === 'finished' && hasEvalOutput(cell)
        ? [{ ...output, caseId: input.id, conditionId: condition.id, phaseId: phase.id, label: `${phase.name ? phase.name + ' · ' : ''}${input.name} · ${condition.name} · sample ${sample.number} · ${stage.name}` }] : [];
    })))));
}
