import { describe, expect, it } from 'vitest';
import type { ExperimentOverviewNode } from '../experimentOverview';
import { navigationContext, navigationKey, navigationOrder, navigationPhase, withReportSteps, parseNavigationContext, type NavigationTarget } from '../experimentNavigation';
import { viewTreePath } from '../../../core/presentation/viewTree';
import type { EvalExperiment } from '../experiment';

const out = (runId: string): NavigationTarget => ({ kind: 'output', runId, cellKey: 'c' });
const node = (id: string, children: ExperimentOverviewNode[] = [], navigation?: NavigationTarget, collapsed = false): ExperimentOverviewNode =>
  ({ id, kind: navigation ? 'item' : 'section', label: id, children, collapsed, ...(navigation ? { target: navigation } : {}) });
const tree = node('root', [
  node('inputs', [node('case-1')]),
  node('phase/1', [node('phase/1/variants', [node('A', [node('phase/1/A/outputs', [node('o1', [], out('r1')), node('o2', [], out('r2'), true)], undefined, true)])])]),
  node('phase/2', [node('B', [node('o3', [], out('r3')), node('o1-again', [], out('r1'))])]),
  node('comparisons', [node('Cmp', [node('j1', [], { kind: 'judgement', judgementId: 'j1' }), node('j2', [], { kind: 'judgement', judgementId: 'j2' })])])
]);

describe('experiment navigation order', () => {
  it('walks stops depth-first in display order, ignoring collapsed state', () => {
    expect(navigationOrder(tree).order).toEqual(['output:r1:c', 'output:r2:c', 'output:r3:c', 'judgement:j1', 'judgement:j2']);
  });

  it('is a doubly linked list whose links are inverses', () => {
    const { order, stops } = navigationOrder(tree);
    for (const key of order) {
      const stop = stops.get(key)!;
      if (stop.next) expect(stops.get(stop.next)!.prev).toBe(key);
      if (stop.prev) expect(stops.get(stop.prev)!.next).toBe(key);
    }
    expect(stops.get(order[0])!.prev).toBeUndefined();
    expect(stops.get(order.at(-1)!)!.next).toBeUndefined();
  });

  it('keeps the first occurrence of a repeated target', () => {
    const { order, stops } = navigationOrder(tree);
    expect(order.filter(key => key === 'output:r1:c')).toHaveLength(1);
    expect(stops.get('output:r1:c')!.index).toBe(0);
  });

  it('skips excluded targets and relinks around them', () => {
    const { order, stops } = navigationOrder(tree, target => target.kind !== 'judgement' || target.judgementId !== 'j1');
    expect(order).toEqual(['output:r1:c', 'output:r2:c', 'output:r3:c', 'judgement:j2']);
    expect(stops.get('judgement:j2')!.prev).toBe('output:r3:c');
  });

  it('builds breadcrumbs from meaningful ancestors only', () => {
    const { stops } = navigationOrder(tree);
    expect(stops.get('output:r1:c')!.label).toBe('phase/1 · A · o1');
    expect(stops.get('judgement:j2')!.label).toBe('Cmp · j2');
  });

  it('round-trips the URL context', () => {
    expect(parseNavigationContext(navigationContext('exp-1', 'pi'))).toEqual({ experimentId: 'exp-1', phaseId: 'pi' });
    expect(parseNavigationContext(navigationContext('exp-1'))).toEqual({ experimentId: 'exp-1' });
    expect(navigationKey({ kind: 'judgement', judgementId: 'x' })).toBe('judgement:x');
  });

  it('finds the root-to-node path used to expand and highlight the current stop', () => {
    expect(viewTreePath(tree, n => n.target !== undefined && navigationKey(n.target) === 'output:r2:c')?.map(n => n.id))
      .toEqual(['root', 'phase/1', 'phase/1/variants', 'A', 'phase/1/A/outputs', 'o2']);
    expect(viewTreePath(tree, n => n.id === 'missing')).toBeUndefined();
  });

  it("resolves the phase an item is drawn under", () => {
    const experiment = { phases: [{ id: 'p1' }, { id: 'p2' }],
      samples: [{ phaseId: 'p2', outputs: [{ runId: 'r1', cellKey: 'c', stageId: 'tree' }] }],
      comparisons: [{ phaseId: 'p1', judgementIds: ['j1'] }] } as unknown as EvalExperiment;
    expect(navigationPhase(experiment, out('r1'))).toBe('p2');
    expect(navigationPhase(experiment, { kind: 'judgement', judgementId: 'j1' })).toBe('p1');
    expect(navigationPhase({ ...experiment, phases: [] } as EvalExperiment, out('r1'))).toBe('tree');
    expect(navigationPhase(experiment, out('nope'))).toBeUndefined();
  });

  it('adds report steps under their judgement as stops that follow it', () => {
    const steps = [{ key: 'page:summary', pageIndex: 0, pageTitle: 'Judgement', title: 'Judgement' },
      { key: 'finding:a', pageIndex: 1, pageTitle: 'Evidence', findingId: 'a', title: 'A' }, { key: 'finding:b', pageIndex: 1, pageTitle: 'Evidence', findingId: 'b', title: 'B' }];
    const augmented = withReportSteps(tree, 'j1', steps);
    const judgement = viewTreePath(augmented, n => n.id === 'j1')!.at(-1)!;
    expect(judgement.children!.map(c => c.label)).toEqual(['Judgement', '2. Evidence']);
    expect(judgement.children![1].children!.map(c => navigationKey(c.target!))).toEqual(['step:j1:finding:a', 'step:j1:finding:b']);
    expect(navigationOrder(augmented, target => target.kind !== 'judgement' || target.judgementId !== 'j1').order)
      .toEqual(['output:r1:c', 'output:r2:c', 'output:r3:c', 'step:j1:page:summary', 'step:j1:finding:a', 'step:j1:finding:b', 'judgement:j2']);
    expect(tree.children!.at(-1)!.children![0].children![0].children ?? []).toHaveLength(0);
  });
});
