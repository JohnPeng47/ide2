import { readFile, rm } from 'node:fs/promises';
import path from 'node:path';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';
import { allViews, fixtureFiles, prepareFixture, readOracle, repositoryRoot, testRoot } from './harness';
import { coverageMatrix } from './coverageMatrix';
import { fixtureOracles, type Oracle } from './oracle';
import { realSeeds, subsystemSeed } from './seeds';

describe('independently maintained analysis corpus', () => {
  it('covers all 30 feature/view cells with an executable semantic assertion', () => {
    const features = ['aliasing', 'async', 'callbacks-through-props', 'cycles', 'cross-layer', 'unresolved-externals'];
    expect(coverageMatrix).toHaveLength(features.length * allViews.length);
    for (const feature of features) for (const view of allViews) {
      const cells = coverageMatrix.filter(cell => cell.feature === feature && cell.view === view);
      expect(cells, `${feature}/${view}`).toHaveLength(1);
      const cell = cells[0], oracle = fixtureOracles[cell.fixture];
      expect(oracle, cell.fixture).toBeDefined();
      expect(cell.issue ? oracle.uncertainties.some(issue => issue.view === view && issue.reason === cell.assertion)
        : oracle.mustContain.some(fact => fact.view === view && fact.label === cell.assertion), `${cell.fixture}: ${cell.assertion}`).toBe(true);
    }
  });
  it('micro sources parse, and every handwritten anchor occurs in the appropriate corpus', async () => {
    for (const [name, oracle] of Object.entries(fixtureOracles)) {
      const root = path.join(testRoot, 'fixtures', name), texts = new Map<string, string>();
      for (const file of await fixtureFiles(root)) {
        const relative = path.relative(root, file).replaceAll(path.sep, '/').replace(/\.txt$/, '');
        const text = await readFile(file, 'utf8'); texts.set(relative, text);
        const result = ts.transpileModule(text, { fileName: relative, reportDiagnostics: true,
          compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext, jsx: ts.JsxEmit.Preserve } });
        expect(result.diagnostics?.filter(diagnostic => diagnostic.category === ts.DiagnosticCategory.Error), file).toEqual([]);
      }
      assertAnchors(oracle, texts);
    }
  });
  it('real goldens remain tied to source text rather than a generated analyzer snapshot', async () => {
    for (const seed of [...realSeeds, subsystemSeed]) {
      const texts = new Map(await Promise.all(seed.paths.map(async file => [file, await readFile(path.join(repositoryRoot, file), 'utf8')] as const)));
      const oracle = await readOracle(seed.golden);
      expect(oracle.verification.method).toBe('manual-source-inspection');
      expect(oracle.verification.author).toContain('not human-reviewed');
      assertAnchors(oracle, texts);
      expect(oracle.mustContain.length).toBeGreaterThan(0);
      expect(oracle.mustNotContain.length).toBeGreaterThan(0);
    }
  });
  it('fixture staging retains repository-relative multi-file imports and config', async () => {
    const fixture = await prepareFixture('imports');
    try {
      expect(fixture.paths).toContain('application/core/use.ts');
      const config = ts.readConfigFile(path.join(fixture.root, 'tsconfig.json'), ts.sys.readFile);
      const parsed = ts.parseJsonConfigFileContent(config.config, ts.sys, fixture.root);
      const program = ts.createProgram(parsed.fileNames, parsed.options);
      expect(ts.getPreEmitDiagnostics(program).map(diagnostic => ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n'))).toEqual([]);
    } finally { await rm(fixture.root, { recursive: true, force: true }); }
  });
});

function assertAnchors(oracle: Oracle, texts: Map<string, string>) {
  const labels = [...oracle.mustContain, ...oracle.mustNotContain].map(fact => fact.label);
  expect(new Set(labels).size).toBe(labels.length);
  for (const fact of [...oracle.mustContain, ...oracle.mustNotContain]) {
    for (const selector of [fact.from, fact.to]) if (selector.anchor) {
      const candidates = selector.path ? [texts.get(selector.path) ?? ''] : [...texts.values()];
      expect(candidates.some(text => text.includes(selector.anchor!)), `${fact.label}: ${selector.anchor}`).toBe(true);
    }
    if (fact.at) expect([...texts.values()].some(text => text.includes(fact.at!)), `${fact.label}: ${fact.at}`).toBe(true);
  }
  for (const issue of oracle.uncertainties) if (issue.at) expect([...texts.values()].some(text => text.includes(issue.at!)), issue.at).toBe(true);
}
