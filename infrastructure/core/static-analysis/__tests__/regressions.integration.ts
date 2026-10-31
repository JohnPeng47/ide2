import { readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { expect, it } from 'vitest';
import { assertOracle, assertPipeline, prepareFixture, requestFor, runAnalyzer } from './harness';
import { manual, type Oracle } from './oracle';

const precision: Oracle = {
  verification: manual('An early-return branch does not reach the final return; ternary and short-circuit writes have multiple reaching definitions. Reassigning an alias changes its binding, not the previous object. Calls transfer actual arguments into parameters and results back into local definitions. Await in an initializer still suspends.'),
  mustContain: [
    { label: 'early true branch returns second definition', view: 'dependencies', kind: 'return', from: { kind: 'definition', anchor: 'value = 2' }, to: { name: 'early' } },
    { label: 'early false branch retains first definition', view: 'dependencies', kind: 'return', from: { kind: 'definition', anchor: 'value = 1' }, to: { name: 'early' } },
    { label: 'ternary joins its alternatives', view: 'dependencies', kind: 'return', from: { kind: 'merge', anchor: 'flag ?' }, to: { name: 'conditional' } },
    { label: 'short circuit retains skipped right-hand side', view: 'dependencies', kind: 'return', from: { kind: 'merge', anchor: 'flag &&' }, to: { name: 'shortCircuit' } },
    { label: 'actual argument reaches formal parameter', view: 'dependencies', kind: 'argument', from: { name: 'seed', kind: 'parameter' }, to: { name: 'value', kind: 'parameter', anchor: 'value: number' }, at: 'inc(seed)' },
    { label: 'callee output reaches call result', view: 'dependencies', kind: 'return', from: { name: 'inc', kind: 'function' }, to: { kind: 'expression', anchor: 'inc(seed)' } },
    { label: 'initializer await is recorded', view: 'dependencies', kind: 'awaits', from: { kind: 'expression', anchor: 'load()' }, to: { name: 'asyncValue', kind: 'function' } },
  ],
  mustNotContain: [
    { label: 'dead assignment does not reach return', view: 'dependencies', kind: 'return', from: { kind: 'definition', anchor: 'value = 3' }, to: { name: 'early' } },
    { label: 'reassigned alias does not mutate former target', view: 'dependencies', kind: 'writes', from: { name: 'aliasReassign' }, to: { name: 'first' } },
    { label: 'scalar copy is not a shared cell', view: 'dependencies', kind: 'writes', from: { name: 'scalarCopy' }, to: { name: 'original' } },
  ], uncertainties: [],
};

it('preserves control-flow and alias precision across a compact adversarial program', async () => {
  const fixture = await prepareFixture('precision');
  try {
    const result = await runAnalyzer(requestFor(fixture.root, fixture.paths));
    const { artifact, texts } = await assertPipeline(result, fixture.root); assertOracle(artifact, precision, texts);
  } finally { await rm(fixture.root, { recursive: true, force: true }); }
});

it('token identities preserve literal contents, ignore comments and disclose duplicate anchors', async () => {
  const fixture = await prepareFixture('identity-tokens');
  try {
    const request = requestFor(fixture.root, fixture.paths), before = await runAnalyzer(request);
    const callbacks = before.artifact.entities.filter(entity => entity.kind === 'function' && entity.provenance.locations.some(range => range.start.line === 1));
    expect(new Set(callbacks.map(entity => entity.name)).size).toBe(2);
    const duplicates = before.artifact.entities.filter(entity => entity.kind === 'function' && entity.provenance.locations.some(range => range.start.line === 2));
    expect(duplicates).toHaveLength(2);
    expect(duplicates.every(entity => entity.identity.stability === 'ambiguous')).toBe(true);
    expect(before.artifact.uncertainties.some(issue => issue.kind === 'ambiguous-identity')).toBe(true);
    const file = path.join(fixture.root, 'input.ts');
    await writeFile(file, (await readFile(file, 'utf8')).replace("() => 'a b'", "() => /* explanation */ 'a b'"));
    const after = await runAnalyzer(request);
    expect(after.artifact.entities.filter(entity => entity.kind === 'function' && entity.provenance.locations.some(range => range.start.line === 1)).map(entity => entity.id).sort())
      .toEqual(callbacks.map(entity => entity.id).sort());
  } finally { await rm(fixture.root, { recursive: true, force: true }); }
});
