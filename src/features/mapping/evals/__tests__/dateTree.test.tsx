import { expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { EvalsTree, evalDate, type TreeActions } from '../EvalsTree';
import type { EvalRunSummary } from '../../../../../domain/mapping/evals/evalRun';

it('files a rerun on its own date, newest last, without losing either run or its output', () => {
  const make = (id: string, createdAt: string, parentRunId?: string) => ({ schemaVersion: 1, projectId: 'project', id, createdAt, parentRunId, workflow: 'alternatives', agentContextId: 'context', contextName: 'Example',
    inputs: {}, prompts: [], request: { requestId: id, workflow: 'alternatives', prompts: [], inputs: {}, passes: 1, model: 'test', effort: 'high' }, status: 'finished',
    cells: [{ key: id, canvasId: id, status: 'finished', pass: 1, stage: 'alternative' }] }) as EvalRunSummary;
  const runs = [make('original', '2026-10-29T12:00:00Z'), make('rerun', '2026-10-30T12:00:00Z', 'original')];
  const html = renderToStaticMarkup(<EvalsTree runs={runs} generated={[]} judgements={[]}
    actions={{} as TreeActions} picked={[]} onPick={() => {}} onRenameEnd={() => {}} selection={{ kind: 'run', id: 'rerun', output: 'rerun' }} />);
  expect(html.indexOf('2026-10-29')).toBeLessThan(html.indexOf('2026-10-30'));
  expect(html.match(/aria-level="1"/g)).toHaveLength(2);
  expect(html).toContain('aria-label="Delete everything under 2026-10-30"');
  expect(html).toContain('aria-label="Delete everything under Alternatives"');
  expect(html).toContain('aria-label="Delete everything under Example"');
  expect(html).toContain('Rerun #'); expect(html).toContain('Run #');
  expect(html).toContain('aria-label="Expand Rerun #');
  expect(html).not.toContain('aria-current="page"');
});
it('groups timestamps using the same local calendar as the run tooltip', () => {
  const value = '2026-11-01T02:30:00Z', date = new Date(value);
  expect(evalDate(value)).toBe(`${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,'0')}-${String(date.getDate()).padStart(2,'0')}`);
  expect(evalDate('')).toBe('Unknown date');
});
