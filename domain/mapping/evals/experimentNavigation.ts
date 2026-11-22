import { viewTreeOrder, type NavigationList, type NavigationStop } from '../../core/presentation/viewTree';
import type { EvalExperiment } from './experiment';
import type { ExperimentOverviewNode } from './experimentOverview';
import type { ReportStep } from '../compare/reportSteps';

/** What an experiment tree node opens. `step` is a page or finding inside a judgement's report. */
/** An output target with `diagram` focuses that diagram (a display ID) inside the output's canvas. */
export type NavigationTarget = { kind: 'output'; runId: string; cellKey: string; diagram?: string } | { kind: 'judgement'; judgementId: string }
  | { kind: 'comment'; commentId: string; runId: string; cellKey: string }
  | { kind: 'step'; judgementId: string; step: string };
export type ExperimentNavigationStop = NavigationStop<NavigationTarget>;
export type ExperimentNavigationList = NavigationList<NavigationTarget>;

export const navigationKey = (target: NavigationTarget) => target.kind === 'comment' ? `comment:${target.commentId}` : target.kind === 'output' ? `output:${target.runId}:${target.cellKey}${target.diagram ? `:${target.diagram}` : ''}`
  : target.kind === 'step' ? `step:${target.judgementId}:${target.step}` : `judgement:${target.judgementId}`;

/** Grouping nodes that add no meaning to a stop's breadcrumb. */
export const isStructuralNode = (node: { id: string }) => /\/(variants|outputs|scaffolds|diagrams)$/.test(node.id) || node.id === 'comparisons';

/** ←/→ order over the (possibly phase-filtered) experiment overview tree. */
export function navigationOrder(root: ExperimentOverviewNode, include: (target: NavigationTarget) => boolean = () => true): ExperimentNavigationList {
  return viewTreeOrder<NavigationTarget>(root, navigationKey, { include: target => target.kind !== 'comment' && include(target), crumb: node => !isStructuralNode(node) });
}

/** Experiment-wide closed path, disjoint from output/judgement navigation. */
export function commentNavigationOrder(root: ExperimentOverviewNode): ExperimentNavigationList {
  const list = viewTreeOrder<NavigationTarget>(root, navigationKey, { include: target => target.kind === 'comment' });
  const first = list.order[0], last = list.order.at(-1);
  if (first && last) { list.stops.get(first)!.prev = last; list.stops.get(last)!.next = first; }
  return list;
}

/**
 * A copy of the tree with one judgement's report steps as its children, grouped by page.
 * A page with a single text step is one row; a page of findings becomes a group.
 */
export function withReportSteps(root: ExperimentOverviewNode, judgementId: string, steps: readonly ReportStep[]): ExperimentOverviewNode {
  const pages = [...new Set(steps.map(step => step.pageIndex))].map(pageIndex => steps.filter(step => step.pageIndex === pageIndex));
  const children: ExperimentOverviewNode[] = pages.map(group => {
    const item = (step: ReportStep): ExperimentOverviewNode => ({ id: `step/${judgementId}/${step.key}`, kind: 'item', label: step.title,
      target: { kind: 'step', judgementId, step: step.key } });
    return group.length === 1 && !group[0].findingId ? item(group[0])
      : { id: `step/${judgementId}/page-${group[0].pageIndex}`, kind: 'summary', label: `${group[0].pageIndex + 1}. ${group[0].pageTitle}`, children: group.map(item) };
  });
  const visit = (node: ExperimentOverviewNode): ExperimentOverviewNode => node.target?.kind === 'judgement' && node.target.judgementId === judgementId
    ? { ...node, children: [...(node.children ?? []), ...children] }
    : node.children ? { ...node, children: node.children.map(visit) } : node;
  return visit(root);
}

/** The phase a target is drawn under, so opening an item can narrow the tree to it. */
export function navigationPhase(experiment: EvalExperiment, target: NavigationTarget): string | undefined {
  if (target.kind === 'comment') return undefined;
  if (target.kind !== 'output') return experiment.comparisons.find(c => c.judgementIds.includes(target.judgementId))?.phaseId;
  const sample = experiment.samples.find(s => s.outputs.some(o => o.runId === target.runId && o.cellKey === target.cellKey));
  if (!sample) return undefined;
  if (experiment.phases?.length) return sample.phaseId;
  // Phase-less experiments are presented with one phase per workflow stage.
  return sample.outputs.find(o => o.runId === target.runId && o.cellKey === target.cellKey)?.stageId;
}

/**
 * URL form of the traversal context. `phaseId` narrows to one phase; `ALL_PHASES` keeps the whole
 * experiment; omitting it means "the phase of the item being shown".
 */
export const ALL_PHASES = '*';
export const navigationContext = (experimentId: string, phaseId?: string) => phaseId ? `${experimentId}:${phaseId}` : experimentId;
export function parseNavigationContext(value: string): { experimentId: string; phaseId?: string } {
  const split = value.indexOf(':');
  return split < 0 ? { experimentId: value } : { experimentId: value.slice(0, split), phaseId: value.slice(split + 1) };
}
