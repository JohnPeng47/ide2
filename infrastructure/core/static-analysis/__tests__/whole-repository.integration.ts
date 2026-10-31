import path from 'node:path';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';
import { assertPipeline, repositoryRoot, requestFor, runAnalyzer } from './harness';

// The performance tier owns a fresh worker: process peak RSS and compiler/JIT
// caches must describe this cold run and its repeat, not earlier micro fixtures.
describe('Tier 3: whole repository', () => {
  it('emits a complete pinned corpus with bounded runtime and memory', async () => {
    const config = ts.readConfigFile(path.join(repositoryRoot, 'tsconfig.json'), ts.sys.readFile);
    const parsed = ts.parseJsonConfigFileContent(config.config, ts.sys, repositoryRoot);
    expect(parsed.errors).toEqual([]);
    const paths = parsed.fileNames.filter(file => /\.tsx?$/.test(file) && !file.endsWith('.d.ts'))
      .map(file => path.relative(repositoryRoot, file).replaceAll(path.sep, '/')).sort();
    expect(paths.length).toBeGreaterThan(500); // Discover current corpus; never freeze the historical 711 estimate.
    const request = requestFor(repositoryRoot, paths);
    const analyzeAndCheck = async (verifiedFingerprint?: string) => {
      const result = await runAnalyzer(request);
      const { artifact, fingerprint } = await assertPipeline(result, repositoryRoot, true, verifiedFingerprint);
      expect(artifact.snapshot.files.filter(file => file.role === 'analyzed').map(file => file.path).sort()).toEqual(paths);
      expect(result.measurements.elapsedMs, 'Tier 3 extraction budget').toBeLessThan(60_000);
      // Include persistence verification in the memory bound, not just extraction.
      expect(process.resourceUsage().maxRSS * 1024, 'Tier 3 process peak RSS budget').toBeLessThan(2 * 1024 ** 3);
      return fingerprint;
    };
    const first = await analyzeAndCheck();
    expect(await analyzeAndCheck(first)).toBe(first);
  }, 180_000);
});
