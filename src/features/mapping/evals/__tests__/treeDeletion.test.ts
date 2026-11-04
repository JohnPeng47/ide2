import { expect, it } from 'vitest';
import { treeDeletion } from '../treeDeletion';

it('derives group deletion from all descendants, deduplicating resources without including siblings', () => {
  const date = { children: [{ children: [
    { resources: { runIds: ['original'] }, children: [{ resources: { canvasIds: ['output'] } }] },
    { resources: { canvasIds: ['loose', 'output'], sessionIds: ['comparison'] } },
    { children: [{ resources: { comparisonRunIds: ['pending'] } }] }
  ] }] };
  const otherDate = { resources: { runIds: ['rerun'], canvasIds: ['other-output'] } };
  expect(treeDeletion(date)).toEqual({ judgementIds: [], runIds: ['original'], canvasIds: ['output', 'loose'], sessionIds: ['comparison'], comparisonRunIds: ['pending'] });
  expect(treeDeletion({ children: [date, otherDate] }).runIds).toEqual(['original', 'rerun']);
});
