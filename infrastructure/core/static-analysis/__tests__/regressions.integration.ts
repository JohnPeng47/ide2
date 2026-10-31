import { readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { expect, it } from 'vitest';
import { assertOracle, assertPipeline, prepareFixture, requestFor, runAnalyzer } from './harness';
import { manual, type Oracle } from './oracle';
import { createHash } from 'node:crypto';
import { serializeAnalysisArtifact } from '../../../../domain/core/static-analysis/persistence';

it('models constructor parameter properties as initialized fields without promising deep readonly values', async () => {
  const fixture = await prepareFixture('parameter-properties');
  try {
    const { artifact, texts } = await assertPipeline(await runAnalyzer(requestFor(fixture.root, fixture.paths)), fixture.root);
    assertOracle(artifact, { verification: manual('The constructor counter parameter initializes a distinct instance field. readonly prevents replacing the field; increment still mutates counter.value. onChange receives changed through the constructor and field initialization.'), mustContain: [
      { label: 'constructor argument initializes instance field', view: 'dependencies', kind: 'value-flow', from: { name: 'counter', kind: 'parameter' }, to: { name: 'counter', kind: 'field' } },
      { label: 'readonly field can expose a mutable object', view: 'ownership', kind: 'can-mutate', from: { name: 'increment', kind: 'method' }, to: { name: 'counter', kind: 'field' } },
      { label: 'callback flows through constructor field', view: 'calls', kind: 'calls', from: { name: 'increment', kind: 'method' }, to: { name: 'changed', kind: 'function' }, status: 'inferred' },
    ], mustNotContain: [], uncertainties: [] }, texts);
  } finally { await rm(fixture.root, { recursive: true, force: true }); }
});

it('resolves imported shorthand values and records missing value bindings explicitly', async () => {
  const fixture = await prepareFixture('imported-shorthand');
  try {
    const { artifact, texts } = await assertPipeline(await runAnalyzer(requestFor(fixture.root, fixture.paths)), fixture.root);
    assertOracle(artifact, { verification: manual('The shorthand property in wrap reads the imported state binding, rather than declaring a new local state. missingValue has no declaration and must remain an explicit lexical gap.'), mustContain: [
      { label: 'imported shorthand retains its free binding', view: 'lexical', kind: 'captures', from: { name: 'wrap' }, to: { name: 'state', kind: 'binding', path: 'state.ts' }, access: ['read'] },
    ], mustNotContain: [], uncertainties: [{ view: 'lexical', reason: 'other', at: 'missingValue' }] }, texts);
  } finally { await rm(fixture.root, { recursive: true, force: true }); }
});

it('uses repository-relative identities when the same corpus moves to another checkout', async () => {
  const left = await prepareFixture('react-props'), right = await prepareFixture('react-props');
  try {
    const before = await runAnalyzer(requestFor(left.root, left.paths));
    const after = await runAnalyzer(requestFor(right.root, right.paths));
    expect(serializeAnalysisArtifact(after.artifact)).toBe(serializeAnalysisArtifact(before.artifact));
  } finally { await Promise.all([rm(left.root, { recursive: true, force: true }), rm(right.root, { recursive: true, force: true })]); }
});

it('pins ambient compiler inputs even when they do not own an extracted declaration', async () => {
  const fixture = await prepareFixture('empty');
  try {
    const request = requestFor(fixture.root, fixture.paths), before = await runAnalyzer(request);
    const filename = path.join(fixture.root, 'frameworks.d.ts');
    const changed = (await readFile(filename, 'utf8')) + '\ndeclare const ambientVersion: 2;\n';
    await writeFile(filename, changed);
    const after = await runAnalyzer(request);
    expect(after.artifact.snapshot.id).not.toBe(before.artifact.snapshot.id);
    expect(after.artifact.snapshot.files.find(file => file.path === 'frameworks.d.ts')).toMatchObject({
      role: 'resolution-only', contentHash: createHash('sha256').update(changed).digest('hex'),
    });
    await assertPipeline(after, fixture.root);
  } finally { await rm(fixture.root, { recursive: true, force: true }); }
});

it('does not resolve a reassigned function variable to its old initializer', async () => {
  const fixture = await prepareFixture('reassigned-callback');
  try {
    const { artifact, texts } = await assertPipeline(await runAnalyzer(requestFor(fixture.root, fixture.paths)), fixture.root);
    assertOracle(artifact, { verification: manual('action changes from first to second before invocation. A flow-insensitive may-target set can retain both as inferred, but must not label first as the resolved target. A const alias remains a direct resolved target.'),
      mustContain: [
        { label: 'reassigned callback includes its new implementation', view: 'calls', kind: 'calls', from: { name: 'reassigned' }, to: { name: 'second', kind: 'function' }, status: 'inferred' },
        { label: 'const callback remains resolved', view: 'calls', kind: 'calls', from: { name: 'stable' }, to: { name: 'first', kind: 'function' }, status: 'resolved' },
      ], mustNotContain: [
        { label: 'old initializer is not a resolved mutable callback target', view: 'calls', kind: 'calls', from: { name: 'reassigned' }, to: { name: 'first', kind: 'function' }, status: 'resolved' },
        { label: 'inline mutable callback is not permanently its initializer', view: 'calls', kind: 'calls', from: { name: 'inlineReassigned' }, to: { kind: 'function', anchor: '() => 1' }, status: 'resolved' },
      ], uncertainties: [{ view: 'calls', reason: 'dynamic-dispatch', at: 'action()' }] }, texts);
  } finally { await rm(fixture.root, { recursive: true, force: true }); }
});

it('pins BOMs, Unicode and every JavaScript line terminator without shifting source coordinates', async () => {
  const fixture = await prepareFixture('empty');
  try {
    const text = '\uFEFFexport const face = "😀";\r\nexport const cr = face;\rexport const ls = cr;\u2028export const ps = ls;\u2029';
    await writeFile(path.join(fixture.root, 'input.ts'), text);
    const result = await runAnalyzer(requestFor(fixture.root, ['input.ts']));
    const { artifact } = await assertPipeline(result, fixture.root);
    const file = artifact.snapshot.files.find(file => file.path === 'input.ts')!;
    expect(file.contentHash).toBe(createHash('sha256').update(text).digest('hex'));
    expect(file.utf16Length).toBe(text.length); expect(file.lineCount).toBe(4);
    for (const [name, line] of [['face', 1], ['cr', 2], ['ls', 3], ['ps', 4]] as const) {
      const range = artifact.entities.find(entity => entity.kind === 'binding' && entity.name === name)!.provenance.locations[0];
      expect(range.start.line).toBe(line); expect(text.slice(range.start.offset, range.end.offset)).toContain(name);
    }
  } finally { await rm(fixture.root, { recursive: true, force: true }); }
});

it('keeps loop bindings local and resolves overload bodies, literal members and type-only specifiers', async () => {
  const fixture = await prepareFixture('scope-and-dispatch');
  try {
    const { artifact, texts } = await assertPipeline(await runAnalyzer(requestFor(fixture.root, fixture.paths)), fixture.root);
    assertOracle(artifact, {
      verification: manual('The returned closure sees the outer const index after each for header scope ends. The imported overload has one concrete implementation; run has a literal computed property name. Every named specifier in the first import and re-export is type-only.'),
      mustContain: [
        { label: 'closure after loops retains outer binding', view: 'lexical', kind: 'captures', from: { kind: 'function', anchor: '() => index', path: 'input.ts' }, to: { kind: 'binding', anchor: 'index = 7' }, at: 'index' },
        { label: 'imported overload resolves implementation body', view: 'calls', kind: 'calls', from: { name: 'invoke' }, to: { name: 'choose', kind: 'function', anchor: '{ return value; }' } },
        { label: 'literal member call resolves method', view: 'calls', kind: 'calls', from: { name: 'invoke' }, to: { name: 'run', kind: 'method' } },
        { label: 'named type-only import stays type-only', view: 'containment', kind: 'imports', from: { name: 'input.ts' }, to: { name: 'lib.ts' }, at: 'import { type Shape }', typeOnly: true },
        { label: 'named type-only re-export stays type-only', view: 'containment', kind: 'reexports', from: { name: 'input.ts' }, to: { name: 'lib.ts' }, typeOnly: true },
      ],
      mustNotContain: [
        { label: 'overload signature is not a second implementation', view: 'calls', kind: 'calls', from: { name: 'invoke' }, to: { name: 'choose', kind: 'function', anchor: 'value: number): number;' } },
      ], uncertainties: [],
    }, texts);
  } finally { await rm(fixture.root, { recursive: true, force: true }); }
});

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

it('connects constructor stores, shallow facades, disposal and React context', async () => {
  const fixture = await prepareFixture('framework-lifecycle');
  try {
    const result = await runAnalyzer(requestFor(fixture.root, fixture.paths));
    const { artifact, texts } = await assertPipeline(result, fixture.root);
    assertOracle(artifact, { verification: manual('The constructor allocates state and wraps its read API. off closes that subscription even when dispose is declared first. The provider value flows to Theme, which Consumer reads through React useContext.'),
      mustContain: [
        { label: 'constructor allocates store', view: 'ownership', kind: 'creates', from: { kind: 'constructor' }, to: { kind: 'allocation', anchor: 'createStore(()' } },
        { label: 'public field is a shallow facade', view: 'ownership', kind: 'exposes-read-api', from: { name: 'store', kind: 'field' }, to: { name: 'state', kind: 'field' }, depth: 'shallow' },
        { label: 'disposer closes original store subscription', view: 'ownership', kind: 'unsubscribes', from: { name: 'dispose', kind: 'method' }, to: { name: 'state', kind: 'field' } },
        { label: 'consumer reads context', view: 'dependencies', kind: 'context-read', from: { name: 'Theme' }, to: { name: 'Consumer', kind: 'function' }, mechanism: 'react' },
        { label: 'provider supplies context value', view: 'dependencies', kind: 'prop-flow', from: { name: 'value', kind: 'parameter' }, to: { name: 'Theme' }, mechanism: 'react' },
      ], mustNotContain: [{ label: 'facade does not promise deep immutability', view: 'ownership', kind: 'exposes-read-api', from: { name: 'store', kind: 'field' }, to: { name: 'state', kind: 'field' }, depth: 'deep' }], uncertainties: [] }, texts);
  } finally { await rm(fixture.root, { recursive: true, force: true }); }
});

it('recovers callback candidates through arguments and returned closures without confusing numbers with functions', async () => {
  const fixture = await prepareFixture('callback-forwarding');
  try {
    const result = await runAnalyzer(requestFor(fixture.root, fixture.paths));
    const { artifact, texts } = await assertPipeline(result, fixture.root);
    assertOracle(artifact, { verification: manual('invoke receives work; returned invokes the closure produced by factory, not factory itself. start returns a number, so its callable identity must not flow into numeric.value.'),
      mustContain: [
        { label: 'argument callback target', view: 'calls', kind: 'calls', from: { name: 'invoke' }, to: { name: 'work', kind: 'function' }, status: 'inferred' },
        { label: 'returned closure target', view: 'calls', kind: 'calls', from: { name: 'returned' }, to: { kind: 'function', anchor: '() => 2' }, status: 'inferred' },
      ], mustNotContain: [
        { label: 'returned closure is not the factory callable', view: 'calls', kind: 'calls', from: { name: 'returned' }, to: { name: 'factory', kind: 'function' }, at: 'callback()' },
      ], uncertainties: [] }, texts);
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
