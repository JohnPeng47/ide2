import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { mkdir, mkdtemp, writeFile, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { IncrementalAnalyzer } from '../../infrastructure/core/static-analysis/incremental';
import { staticAnalyzer } from '../../infrastructure/core/static-analysis/analyzer';
import { analysisArtifactChunks } from '../../domain/core/static-analysis/persistence';
import type { AnalysisArtifact } from '../../domain/core/static-analysis/schema';
import type { StaticAnalysisRequest } from '../../application/core/static-analysis/ports';

const root = process.cwd();
const worktree = process.argv[2] ? path.resolve(process.argv[2]) : await mkdtemp(path.join(tmpdir(), 'new-diagram-analysis-history-'));
const revisions = process.argv.slice(3);
if (!revisions.length) revisions.push('e0c9e764^', 'e0c9e764', 'e0c9e764^', 'adbf1845', '7fa6f6f3', 'b321abcf', '7fa6f6f3', 'adbf1845', 'adbf1845');
const git = (cwd: string, args: string[]) => execFileSync('git', args, { cwd, encoding: 'utf8', maxBuffer: 16 * 1024 ** 2 }).trim();
const implementationFiles = git(root, ['ls-files', '--cached', '--others', '--exclude-standard', '--',
  'application/core/static-analysis', 'domain/core/static-analysis', 'infrastructure/core/static-analysis', 'scripts/analysis/history.ts']).split('\n').filter(Boolean).sort();
const implementationHash = createHash('sha256');
for (const file of implementationFiles) implementationHash.update(JSON.stringify([file, readFileSync(path.join(root, file), 'utf8')]));
const implementationSha256 = implementationHash.digest('hex');
const commits = revisions.map(revision => git(root, ['rev-parse', '--verify', `${revision}^{commit}`]));
if (worktree === root) throw new Error('History replay requires a separate worktree');
if (!existsSync(path.join(worktree, '.git'))) git(root, ['worktree', 'add', '--detach', worktree, commits[0]]);
if (git(worktree, ['rev-parse', '--show-toplevel']) !== worktree) throw new Error('Expected a dedicated worktree root');
if (!existsSync(path.join(worktree, 'node_modules'))) await symlink(path.join(root, 'node_modules'), path.join(worktree, 'node_modules'), 'dir');
const candidates = ['src/features/mapping/workspace/canvasSession.ts', 'src/features/mapping/workspace/canvasWorkspace.ts',
  'domain/core/immutability.ts', 'tests/architecture/dependencies.test.ts'];
const digest = (artifact: AnalysisArtifact) => { const hash = createHash('sha256'); for (const chunk of analysisArtifactChunks(artifact)) hash.update(chunk); return hash.digest('hex'); };
const session = new IncrementalAnalyzer(), rows = [];
const output = path.join(root, 'docs/analysis/artifacts/history-replay.json');
for (const commit of commits) {
  // Never discard tracked modifications in the testing worktree.
  git(worktree, ['diff', '--exit-code']); git(worktree, ['diff', '--cached', '--exit-code']);
  git(worktree, ['checkout', '--detach', commit]);
  const paths = candidates.filter(file => existsSync(path.join(worktree, file)));
  const request: StaticAnalysisRequest = { repositoryRoot: worktree, repositoryId: 'new-diagram-history', tsconfigPath: 'tsconfig.json', includePaths: paths,
    views: ['containment', 'lexical', 'calls', 'ownership', 'dependencies'], frameworks: ['react', 'zustand', 'tldraw', 'controller'],
    metrics: { partitions: ['directory', 'layer', 'single-group'], shuffleSeed: 1729, shuffleSamples: 32 } };
  const incremental = await session.analyze(request), fresh = await staticAnalyzer.analyze(request);
  const incrementalHash = digest(incremental.artifact), freshHash = digest(fresh.artifact);
  const row = { commit, paths, snapshotId: incremental.artifact.snapshot.id, ...incremental.update,
    incrementalMs: incremental.measurements.elapsedMs, freshMs: fresh.measurements.elapsedMs, incrementalHash, freshHash, equal: incrementalHash === freshHash };
  rows.push(row); console.log(JSON.stringify(row));
  await mkdir(path.dirname(output), { recursive: true });
  await writeFile(output, JSON.stringify({ worktree, analyzerCommit: git(root, ['rev-parse', 'HEAD']), analyzerVersion: incremental.artifact.snapshot.analyzer.version, implementationSha256,
    analyzerTrackedChanges: git(root, ['diff', 'HEAD', '--name-only', '--', 'application/core/static-analysis', 'domain/core/static-analysis', 'infrastructure/core/static-analysis', 'scripts/analysis/history.ts']).split('\n').filter(Boolean),
    dependencyPolicy: 'Current installed dependencies shared read-only through a node_modules symlink; historical source commits, not historical dependency installs.', rows }, null, 2) + '\n');
  if (!row.equal) throw new Error(`Incremental/fresh mismatch at ${commit}`);
}
console.log(`Verified ${rows.length} historical revisions; results: ${output}`);
