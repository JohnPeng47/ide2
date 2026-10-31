import { rm, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { serializeAnalysisArtifact } from '../../../../domain/core/static-analysis/persistence';
import { assertOracle, assertPipeline, entityMatches, prepareFixture, readOracle, repositoryRoot, requestFor, runAnalyzer, selectedViews } from './harness';
import { fixtureOracles } from './oracle';
import { realSeeds, subsystemSeed } from './seeds';

describe('Tier 0: micro semantic combinations', () => {
  for (const [name, oracle] of Object.entries(fixtureOracles)) it(name, async () => {
    const fixture = await prepareFixture(name);
    try {
      const request = requestFor(fixture.root, fixture.paths);
      const result = await runAnalyzer(request);
      const { artifact, texts } = await assertPipeline(result, fixture.root);
      assertOracle(artifact, oracle, texts);
      expect(serializeAnalysisArtifact((await runAnalyzer(request)).artifact)).toBe(serializeAnalysisArtifact(artifact));
      expect(result.measurements.elapsedMs, 'Tier 0 per-fixture target').toBeLessThan(1000);
      if (name === 'recursion' && selectedViews().includes('calls')) {
        const even = artifact.entities.find(entity => entityMatches(entity, { name: 'even', kind: 'function' }, texts))!;
        const odd = artifact.entities.find(entity => entityMatches(entity, { name: 'odd', kind: 'function' }, texts))!;
        expect(artifact.derived.sccs.some(scc => scc.components.some(component => component.entityIds.includes(even.id) && component.entityIds.includes(odd.id)))).toBe(true);
      }
      if (name === 'empty') for (const report of artifact.derived.metrics) {
        if (report.edgeMass.total === 0) expect(report.internalFraction).toEqual({ status: 'na', reason: 'zero-denominator' });
      }
    } finally { await rm(fixture.root, { recursive: true, force: true }); }
  });
  it('identities survive unrelated declaration insertion while snapshot identity changes', async () => {
    const fixture = await prepareFixture('captured-cell');
    try {
      const request = requestFor(fixture.root, fixture.paths);
      const before = await runAnalyzer(request);
      const file = path.join(fixture.root, 'input.ts');
      await writeFile(file, `export const unrelated = 'unrelated';\n${await readFile(file, 'utf8')}`);
      const after = await runAnalyzer(request);
      const names = ['counter', 'previous', 'state', 'tick', 'read'];
      for (const name of names) {
        const ids = (result: typeof before) => result.artifact.entities.filter(entity => entity.name === name).map(entity => entity.id).sort();
        expect(ids(before).length, name).toBeGreaterThan(0); expect(ids(after), name).toEqual(ids(before));
      }
      expect(after.artifact.snapshot.id).not.toBe(before.artifact.snapshot.id);
    } finally { await rm(fixture.root, { recursive: true, force: true }); }
  });
});

describe('Tier 1: real source seeds with hand-authored semantic goldens', () => {
  for (const seed of realSeeds) it(seed.id, async () => {
    const request = requestFor(repositoryRoot, seed.paths);
    const result = await runAnalyzer(request);
    const { artifact, texts } = await assertPipeline(result, repositoryRoot);
    assertOracle(artifact, await readOracle(seed.golden), texts);
    expect(serializeAnalysisArtifact((await runAnalyzer(request)).artifact)).toBe(serializeAnalysisArtifact(artifact));
    expect(result.measurements.elapsedMs, 'Tier 1 per-cluster target').toBeLessThan(5000);
  });
});

describe('Tier 2: workspace/session/controller/reactive consumer pipeline', () => {
  it('joins all real seeds without inventing runtime order', async () => {
    const request = requestFor(repositoryRoot, subsystemSeed.paths);
    const result = await runAnalyzer(request);
    const { artifact, texts } = await assertPipeline(result, repositoryRoot);
    for (const seed of [...realSeeds, subsystemSeed]) assertOracle(artifact, await readOracle(seed.golden), texts);
    expect(serializeAnalysisArtifact((await runAnalyzer(request)).artifact)).toBe(serializeAnalysisArtifact(artifact));
    expect(result.measurements.elapsedMs, 'Tier 2 target').toBeLessThan(10_000);
  });
});
