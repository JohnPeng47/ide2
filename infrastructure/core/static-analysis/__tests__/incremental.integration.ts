import { rm, writeFile, unlink, rename, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { expect, it } from 'vitest';
import { tsImport } from 'tsx/esm/api';
import { serializeAnalysisArtifact, validateAnalysisArtifact } from '../../../../domain/core/static-analysis/persistence';
import { prepareFixture, requestFor } from './harness';
const { IncrementalAnalyzer }: typeof import('../incremental') = await tsImport('../incremental.ts', import.meta.url);
const { staticAnalyzer }: typeof import('../analyzer') = await tsImport('../analyzer.ts', import.meta.url);

it('reuses independent components and matches fresh output through edits, removals, renames and restored checkpoints', async () => {
  const fixture = await prepareFixture('empty');
  try {
    const put = (name: string, content: string) => writeFile(path.join(fixture.root, name), content);
    await put('producer.ts', 'export const value = 1;');
    await put('consumer.ts', "import { value } from './producer'; export const read = () => value;");
    await put('separate.ts', 'export const separate = () => 7;');
    const session = new IncrementalAnalyzer();
    let paths = ['consumer.ts', 'producer.ts', 'separate.ts'];
    const check = async (runner = session) => {
      const request = requestFor(fixture.root, paths), result = await runner.analyze(request), fresh = await staticAnalyzer.analyze(request);
      validateAnalysisArtifact(result.artifact);
      expect(serializeAnalysisArtifact(result.artifact)).toBe(serializeAnalysisArtifact(fresh.artifact));
      return result;
    };
    expect((await check()).update.components).toBe(2);
    expect((await check()).update.analyzedFiles).toEqual([]);
    await put('producer.ts', 'export const value = 2;');
    const changed = await check();
    expect(changed.update.analyzedFiles).toEqual(['consumer.ts', 'producer.ts']);
    expect(changed.update.reusedFiles).toEqual(['separate.ts']);
    const restored = new IncrementalAnalyzer(); restored.restoreCheckpoint(JSON.parse(JSON.stringify(session.exportCheckpoint())));
    expect((await check(restored)).update.analyzedFiles).toEqual([]);
    await unlink(path.join(fixture.root, 'producer.ts')); paths = ['consumer.ts', 'separate.ts'];
    expect((await check()).update.removedFiles).toEqual(['producer.ts']);
    await put('producer.ts', 'export const value = 3;'); paths.push('producer.ts');
    expect((await check()).update.analyzedFiles).toContain('consumer.ts');
    await rename(path.join(fixture.root, 'separate.ts'), path.join(fixture.root, 'renamed.ts'));
    paths = ['consumer.ts', 'producer.ts', 'renamed.ts'];
    expect((await check()).update.removedFiles).toEqual(['separate.ts']);
    await put('frameworks.d.ts', 'declare const changedAmbient: number;');
    expect((await check()).update.reusedFiles).toEqual([]);
  } finally { await rm(fixture.root, { recursive: true, force: true }); }
}, 120_000);

it('broadens invalidation for globals and dynamic imports', async () => {
  const fixture = await prepareFixture('empty');
  try {
    await writeFile(path.join(fixture.root, 'global.ts'), 'const shared = 1;');
    await writeFile(path.join(fixture.root, 'use.ts'), 'export const read = () => shared; export const load = (name: string) => import(name);');
    const request = requestFor(fixture.root, ['global.ts', 'use.ts']), session = new IncrementalAnalyzer();
    const result = await session.analyze(request);
    expect(result.update.fallbackReasons).toEqual(expect.arrayContaining(['global-script', 'dynamic-module-resolution']));
    expect(serializeAnalysisArtifact(result.artifact)).toBe(serializeAnalysisArtifact((await staticAnalyzer.analyze(request)).artifact));
  } finally { await rm(fixture.root, { recursive: true, force: true }); }
});

it('keeps external summaries local to independent modules and reuses facts when only metrics change', async () => {
  const fixture = await prepareFixture('empty');
  try {
    await writeFile(path.join(fixture.root, 'a.ts'), 'export const a = Object.keys({ a: 1 }).some(x => x.length > 0);');
    await writeFile(path.join(fixture.root, 'b.ts'), 'export const b = Object.keys({ b: 2 }).some(x => x.length > 0);');
    const session = new IncrementalAnalyzer(), request = requestFor(fixture.root, ['a.ts', 'b.ts']);
    const check = async () => {
      const result = await session.analyze(request);
      expect(serializeAnalysisArtifact(result.artifact)).toBe(serializeAnalysisArtifact((await staticAnalyzer.analyze(request)).artifact));
      return result;
    };
    expect((await check()).update.components).toBe(2);
    request.metrics = { partitions: ['directory'], shuffleSeed: 5, shuffleSamples: 3 };
    expect((await check()).update.analyzedFiles).toEqual([]);
    await writeFile(path.join(fixture.root, 'a.ts'), 'export const a = Object.keys({ changed: 3 }).some(x => x.length > 1);');
    expect((await check()).update.reusedFiles).toEqual(['b.ts']);
    request.views = ['containment'];
    expect((await check()).update.reusedFiles).toEqual([]);
  } finally { await rm(fixture.root, { recursive: true, force: true }); }
});

it('invalidates through unselected dependencies and preserves the checkpoint after a failed run', async () => {
  const fixture = await prepareFixture('empty');
  try {
    await writeFile(path.join(fixture.root, 'library.ts'), 'export const value = 1;');
    await writeFile(path.join(fixture.root, 'consumer.ts'), "import { value } from './library'; export const read = () => value;");
    await writeFile(path.join(fixture.root, 'separate.ts'), 'export const separate = 2;');
    const session = new IncrementalAnalyzer(), request = requestFor(fixture.root, ['consumer.ts', 'separate.ts']);
    await session.analyze(request);
    const checkpoint = session.exportCheckpoint();
    await expect(session.analyze({ ...request, includePaths: ['missing.ts'] })).rejects.toThrow();
    expect(session.exportCheckpoint()).toEqual(checkpoint);
    await writeFile(path.join(fixture.root, 'library.ts'), 'export const value = 7;');
    const result = await session.analyze(request);
    expect(result.update.changedFiles).toEqual([]);
    expect(result.update.analyzedFiles).toEqual(['consumer.ts']);
    expect(result.update.reusedFiles).toEqual(['separate.ts']);
    expect(serializeAnalysisArtifact(result.artifact)).toBe(serializeAnalysisArtifact((await staticAnalyzer.analyze(request)).artifact));
    const invalid = session.exportCheckpoint(); invalid.fragments[0].paths = ['wrong.ts'];
    expect(() => session.restoreCheckpoint(invalid)).toThrow('Fragment scope');
  } finally { await rm(fixture.root, { recursive: true, force: true }); }
});

it.each(['imports', 'cross-layer', 'scope-and-dispatch', 'callback-forwarding', 'imported-shorthand', 'react-props'])(
  'matches full extraction for the %s corpus alongside an independent module', async name => {
    const fixture = await prepareFixture(name);
    try {
      await writeFile(path.join(fixture.root, 'independent.ts'), 'export const independent = Object.keys({ ready: true });');
      const request = requestFor(fixture.root, [...fixture.paths, 'independent.ts']), session = new IncrementalAnalyzer();
      const fresh = serializeAnalysisArtifact((await staticAnalyzer.analyze(request)).artifact);
      expect(serializeAnalysisArtifact((await session.analyze(request)).artifact)).toBe(fresh);
      const repeated = await session.analyze(request);
      expect(repeated.update.analyzedFiles).toEqual([]);
      expect(serializeAnalysisArtifact(repeated.artifact)).toBe(fresh);
    } finally { await rm(fixture.root, { recursive: true, force: true }); }
  }, 30_000);

it('merges shared package containment and follows newly added dependency edges', async () => {
  const fixture = await prepareFixture('empty');
  try {
    await mkdir(path.join(fixture.root, 'pkg'));
    await writeFile(path.join(fixture.root, 'pkg/package.json'), '{"name":"example","type":"module"}');
    await writeFile(path.join(fixture.root, 'pkg/a.ts'), 'export const a = 1;');
    await writeFile(path.join(fixture.root, 'pkg/b.ts'), 'export const b = 2;');
    const session = new IncrementalAnalyzer(), request = requestFor(fixture.root, ['pkg/a.ts', 'pkg/b.ts']);
    const check = async () => {
      const result = await session.analyze(request);
      expect(serializeAnalysisArtifact(result.artifact)).toBe(serializeAnalysisArtifact((await staticAnalyzer.analyze(request)).artifact));
      return result;
    };
    expect((await check()).update.components).toBe(2);
    expect((await check()).update.analyzedFiles).toEqual([]);
    await writeFile(path.join(fixture.root, 'pkg/a.ts'), "import { b } from './b'; export const a = b + 1;");
    expect((await check()).update.components).toBe(1);
    await writeFile(path.join(fixture.root, 'pkg/a.ts'), 'export const a = 1;');
    await check(); // Previous facts may conservatively retain connectivity for one update.
    expect((await check()).update.components).toBe(2);
    await writeFile(path.join(fixture.root, 'pkg/package.json'), '{"name":"changed","type":"module"}');
    expect((await check()).update.reusedFiles).toEqual([]);
  } finally { await rm(fixture.root, { recursive: true, force: true }); }
});

it('invalidates consumers of ambient types backed by an unselected local module', async () => {
  const fixture = await prepareFixture('empty');
  try {
    await writeFile(path.join(fixture.root, 'types.ts'), 'export interface Service { run(): string }');
    await writeFile(path.join(fixture.root, 'frameworks.d.ts'), "declare const service: import('./types').Service;");
    await writeFile(path.join(fixture.root, 'consumer.ts'), 'export const read = () => service.run();');
    await writeFile(path.join(fixture.root, 'other.ts'), 'export const other = 2;');
    const session = new IncrementalAnalyzer(), request = requestFor(fixture.root, ['consumer.ts', 'other.ts']);
    const first = await session.analyze(request);
    expect(first.update.fallbackReasons).toContain('declaration-source-dependency');
    await writeFile(path.join(fixture.root, 'types.ts'), 'export interface Service { run(): number }');
    const result = await session.analyze(request);
    expect(result.update.reusedFiles).toEqual([]);
    expect(serializeAnalysisArtifact(result.artifact)).toBe(serializeAnalysisArtifact((await staticAnalyzer.analyze(request)).artifact));
  } finally { await rm(fixture.root, { recursive: true, force: true }); }
});
