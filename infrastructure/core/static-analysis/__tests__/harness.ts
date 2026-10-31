import { createHash } from 'node:crypto';
import { mkdtemp, mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect } from 'vitest';
import { tsImport } from 'tsx/esm/api';
import type { StaticAnalysisRequest, StaticAnalysisResult } from '../../../../application/core/static-analysis/ports';
import { analysisArtifactChunks, parseAnalysisArtifact, serializeAnalysisArtifact, validateAnalysisArtifact, verifyCanonicalAnalysisStream } from '../../../../domain/core/static-analysis/persistence';
import type { AnalysisArtifact, AnalysisEntity, AnalysisRange, AnalysisRelation, AnalysisView } from '../../../../domain/core/static-analysis/schema';
import type { EntitySelector, ExpectedFact, Oracle } from './oracle';
// Exercise the CLI's Node/tsx execution path. Vitest still owns assertions and
// external measurements, but its SSR module rewriting is not part of the product.
const { staticAnalyzer }: typeof import('../analyzer') = await tsImport('../analyzer.ts', import.meta.url);

export const testRoot = fileURLToPath(new URL('.', import.meta.url));
export const repositoryRoot = path.resolve(testRoot, '../../../..');
export const allViews: AnalysisView[] = ['containment', 'lexical', 'calls', 'ownership', 'dependencies'];
export function selectedViews(): AnalysisView[] {
  const values = process.env.ANALYSIS_VIEWS?.split(',') ?? allViews;
  if (values.some(value => !allViews.includes(value as AnalysisView))) throw new Error('Unknown ANALYSIS_VIEWS value');
  return values as AnalysisView[];
}
export async function fixtureFiles(directory: string): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = await Promise.all(entries.map(entry => entry.isDirectory() ? fixtureFiles(path.join(directory, entry.name))
    : Promise.resolve(entry.name.endsWith('.txt') ? [path.join(directory, entry.name)] : [])));
  return files.flat().sort();
}
export async function prepareFixture(name: string): Promise<{ root: string; paths: string[] }> {
  const root = await mkdtemp(path.join(tmpdir(), 'static-analysis-corpus-'));
  const source = path.join(testRoot, 'fixtures', name), paths: string[] = [];
  for (const original of await fixtureFiles(source)) {
    const relative = path.relative(source, original).replaceAll(path.sep, '/').replace(/\.txt$/, '');
    const destination = path.join(root, relative); await mkdir(path.dirname(destination), { recursive: true });
    await writeFile(destination, await readFile(original)); paths.push(relative);
  }
  await writeFile(path.join(root, 'frameworks.d.ts'), await readFile(path.join(testRoot, 'fixtures/frameworks.d.ts.txt')));
  await writeFile(path.join(root, 'tsconfig.json'), JSON.stringify({ compilerOptions: { strict: true, target: 'ES2022', lib: ['ES2022'],
    module: 'ESNext', moduleResolution: 'Bundler', jsx: 'preserve', noEmit: true, skipLibCheck: true }, include: ['**/*.ts', '**/*.tsx'] }));
  return { root, paths };
}
export function requestFor(root: string, paths: readonly string[]): StaticAnalysisRequest {
  return { repositoryRoot: root, repositoryId: 'static-analysis-test-corpus', tsconfigPath: 'tsconfig.json', includePaths: paths,
    views: selectedViews(), frameworks: ['react', 'zustand', 'tldraw', 'controller'],
    metrics: { partitions: ['directory', 'layer', 'single-group'], shuffleSeed: 1729, shuffleSamples: 32 } };
}
/** Check performance from outside the implementation, not just self-reported numbers. */
export async function runAnalyzer(request: StaticAnalysisRequest): Promise<StaticAnalysisResult> {
  const started = performance.now();
  const result = await staticAnalyzer.analyze(request);
  const elapsedMs = performance.now() - started;
  const peakRssBytes = process.resourceUsage().maxRSS * 1024;
  expect(result.measurements.elapsedMs).toBeGreaterThanOrEqual(0);
  expect(result.measurements.elapsedMs).toBeLessThanOrEqual(elapsedMs + 5);
  expect(result.measurements.peakRssBytes).toBeGreaterThan(0);
  // Thresholds use the externally measured wall time and Linux process peak RSS.
  return { artifact: result.artifact, measurements: { elapsedMs, peakRssBytes } };
}
export async function sourceTexts(artifact: AnalysisArtifact, root: string): Promise<Map<string, string>> {
  return new Map(await Promise.all(artifact.snapshot.files.map(async file => [file.path, await readFile(path.join(root, file.path), 'utf8')] as const)));
}
function textOf(range: AnalysisRange, texts: ReadonlyMap<string, string>) {
  return texts.get(range.path)?.slice(range.start.offset, range.end.offset) ?? '';
}
export function entityMatches(entity: AnalysisEntity, selector: EntitySelector, texts: ReadonlyMap<string, string>): boolean {
  return (!selector.name || selector.name === entity.name) && (!selector.kind || selector.kind === entity.kind)
    && (!selector.path || entity.provenance.locations.some(range => range.path === selector.path))
    && (!selector.anchor || entity.provenance.locations.some(range => textOf(range, texts).includes(selector.anchor!)))
    && (!selector.metadata || Object.entries(selector.metadata).every(([key, value]) => entity.metadata[key as keyof AnalysisEntity['metadata']] === value));
}
function factMatches(edge: AnalysisRelation, fact: ExpectedFact, artifact: AnalysisArtifact, texts: ReadonlyMap<string, string>) {
  const from = artifact.entities.find(entity => entity.id === edge.from), to = artifact.entities.find(entity => entity.id === edge.to);
  if (!from || !to || edge.view !== fact.view || edge.kind !== fact.kind || !entityMatches(from, fact.from, texts)
    || !entityMatches(to, fact.to, texts) || fact.status && edge.provenance.status !== fact.status) return false;
  if (fact.at && !edge.provenance.locations.some(range => textOf(range, texts).includes(fact.at!))) return false;
  if (fact.access && !(edge.view === 'lexical' && fact.access.every(access => edge.access.includes(access)))) return false;
  if (fact.depth && !(edge.view === 'ownership' && edge.depth === fact.depth)) return false;
  if (fact.mechanism && !(edge.view === 'dependencies' && edge.mechanism === fact.mechanism)) return false;
  if (fact.typeOnly !== undefined && !(edge.view === 'containment' && edge.typeOnly === fact.typeOnly)) return false;
  if (fact.dispatch && !(edge.view === 'calls' && edge.dispatch === fact.dispatch)) return false;
  if (fact.propertyPath && !(edge.view === 'dependencies' && JSON.stringify(edge.propertyPath) === JSON.stringify(fact.propertyPath))) return false;
  return true;
}

/** Golden comparison is a bounded semantic projection of the serialized output.
 * Expectations are authored by source inspection; extra unrelated facts are permitted. */
export function assertOracle(artifact: AnalysisArtifact, oracle: Oracle, texts: ReadonlyMap<string, string>) {
  expect(oracle.verification.method).toBe('manual-source-inspection');
  const views = selectedViews();
  const required = oracle.mustContain.filter(fact => views.includes(fact.view));
  const forbidden = oracle.mustNotContain.filter(fact => views.includes(fact.view));
  const expectedIssues = oracle.uncertainties.filter(issue => views.includes(issue.view));
  const actual = {
    present: required.filter(fact => artifact.relations.some(edge => factMatches(edge, fact, artifact, texts))).map(fact => fact.label).sort(),
    forbidden: forbidden.filter(fact => artifact.relations.some(edge => factMatches(edge, fact, artifact, texts))).map(fact => fact.label).sort(),
    issues: expectedIssues.filter(issue => artifact.uncertainties.some(actual => actual.view === issue.view && actual.reason === issue.reason
      && (!issue.at || actual.provenance.locations.some(range => textOf(range, texts).includes(issue.at!))))).map(issue => `${issue.view}:${issue.reason}:${issue.at ?? ''}`).sort(),
  };
  expect(actual).toEqual({ present: required.map(fact => fact.label).sort(), forbidden: [],
    issues: expectedIssues.map(issue => `${issue.view}:${issue.reason}:${issue.at ?? ''}`).sort() });
}
export async function readOracle(name: string): Promise<Oracle> {
  return JSON.parse(await readFile(path.join(testRoot, 'goldens', name), 'utf8')) as Oracle;
}
export function artifactFingerprint(artifact: AnalysisArtifact) {
  const hash = createHash('sha256'); for (const chunk of analysisArtifactChunks(artifact)) hash.update(chunk); return hash.digest('hex');
}
export async function assertPipeline(result: StaticAnalysisResult, root: string, stream = false, verifiedFingerprint?: string): Promise<{ artifact: AnalysisArtifact; texts: Map<string, string>; fingerprint?: string }> {
  const verificationStarted = performance.now();
  // A whole graph exceeds V8's 512 MiB string ceiling. Verify every serialized record
  // and its canonical parse/re-encode instead of retaining duplicate giant strings.
  const json = stream ? undefined : serializeAnalysisArtifact(result.artifact);
  const artifact = json === undefined ? result.artifact : parseAnalysisArtifact(json);
  const texts = await sourceTexts(artifact, root);
  let fingerprint: string | undefined;
  if (stream) {
    const hash = createHash('sha256');
    function* hashedChunks() { for (const chunk of analysisArtifactChunks(artifact, texts)) { hash.update(chunk); yield chunk; } }
    if (verifiedFingerprint === undefined) {
      expect(verifyCanonicalAnalysisStream(hashedChunks())).toMatchObject({ entities: artifact.entities.length, relations: artifact.relations.length,
        uncertainties: artifact.uncertainties.length, 'derived.findings': artifact.derived.findings.length });
    } else {
      // The writer still validates this entire graph and all supplied coordinates.
      // An identical complete SHA-256 stream reuses the first stream's parse proof;
      // changed bytes fail below instead of bypassing wire validation silently.
      for (const _chunk of hashedChunks()) { /* hash every emitted byte */ }
    }
    fingerprint = hash.digest('hex');
    if (verifiedFingerprint !== undefined) expect(fingerprint, 'repeat must match the fully parsed and validated first stream').toBe(verifiedFingerprint);
  } else validateAnalysisArtifact(artifact, texts);
  for (const file of artifact.snapshot.files) expect(createHash('sha256').update(texts.get(file.path)!).digest('hex'), file.path).toBe(file.contentHash);
  if (json !== undefined) expect(serializeAnalysisArtifact(artifact)).toBe(json);
  expect(artifact.entities.some(entity => ['runtime-instance', 'execution-event', 'value-version'].includes(entity.kind))).toBe(false);
  expect([...artifact.entities, ...artifact.relations, ...artifact.uncertainties, ...artifact.derived.findings]
    .some(fact => fact.provenance.status === 'observed')).toBe(false);
  expect(result.measurements.elapsedMs).toBeGreaterThanOrEqual(0);
  expect(result.measurements.peakRssBytes).toBeGreaterThan(0);
  expect(artifact.derived.partitions.map(partition => partition.basis)).toEqual(expect.arrayContaining(['directory', 'layer', 'custom']));
  if (selectedViews().some(view => view === 'calls' || view === 'dependencies')) expect(artifact.derived.metrics.length).toBeGreaterThan(0);
  for (const report of artifact.derived.metrics) {
    const partition = artifact.derived.partitions.find(partition => partition.id === report.partitionId)!;
    const isSingle = partition.groups.length === 1 && partition.memberships.every(member => member.primaryGroupId !== null);
    if (isSingle && report.edgeMass.total > 0) expect(report.coveredCohesion).toEqual({ status: 'ok', value: 1 });
  }
  for (const view of artifact.coverage.views) {
    if (selectedViews().includes(view.view)) expect(['complete', 'partial'], `${view.view} stage status`).toContain(view.status);
    else expect(view.status, `${view.view} unrequested stage`).toBe('not-run');
  }
  if (stream && process.env.STATIC_ANALYSIS_PROFILE) console.error(JSON.stringify({ phase: 'verify-stream', elapsedMs: performance.now() - verificationStarted, rss: process.memoryUsage().rss }));
  return { artifact, texts, fingerprint };
}
