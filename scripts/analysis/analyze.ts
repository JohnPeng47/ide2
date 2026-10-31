import { mkdir, writeFile, stat, rename, rm } from 'node:fs/promises';
import { createWriteStream } from 'node:fs';
import { createHash } from 'node:crypto';
import { createGzip } from 'node:zlib';
import { Readable, Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import path from 'node:path';
import ts from 'typescript';
import { staticAnalyzer } from '../../infrastructure/core/static-analysis/analyzer';
import { analysisArtifactChunks } from '../../domain/core/static-analysis/persistence';
import { architectureReport } from '../../domain/core/static-analysis/report';

const root = process.cwd(), configPath = path.join(root, 'tsconfig.json');
const config = ts.readConfigFile(configPath, ts.sys.readFile);
if (config.error) throw new Error(ts.flattenDiagnosticMessageText(config.error.messageText, '\n'));
const parsed = ts.parseJsonConfigFileContent(config.config, ts.sys, root);
if (parsed.errors.length) throw new Error(parsed.errors.map(error => ts.flattenDiagnosticMessageText(error.messageText, '\n')).join('\n'));
const includes = process.argv.slice(2);
const paths = parsed.fileNames.filter(file => /\.tsx?$/.test(file) && !file.endsWith('.d.ts'))
  .map(file => path.relative(root, file).replaceAll(path.sep, '/'))
  .filter(file => !includes.length || includes.some(prefix => file === prefix || file.startsWith(prefix.replace(/\/$/, '') + '/'))).sort();
console.log(`Analyzing ${paths.length} TypeScript/TSX files`);
const result = await staticAnalyzer.analyze({ repositoryRoot: root, repositoryId: 'new-diagram', tsconfigPath: 'tsconfig.json', includePaths: paths,
  views: ['containment', 'lexical', 'calls', 'ownership', 'dependencies'], frameworks: ['react', 'zustand', 'tldraw', 'controller'],
  metrics: { partitions: ['directory', 'layer', 'single-group'], shuffleSeed: 1729, shuffleSamples: 32 } });
console.log(JSON.stringify({ ...result.measurements, entities: result.artifact.entities.length, relations: result.artifact.relations.length }));
const output = path.join(root, 'docs/analysis/artifacts'); await mkdir(output, { recursive: true });
const name = includes.length ? 'selected-scope' : 'whole-repository';
const started = performance.now();
let jsonBytes = 0;
const jsonHash = createHash('sha256'), compressedHash = createHash('sha256');
function* chunks() {
  let parts: string[] = [], bytes = 0;
  // Keep canonical bytes intact while avoiding a zlib/stream callback per record.
  for (const chunk of analysisArtifactChunks(result.artifact)) {
    parts.push(chunk); bytes += Buffer.byteLength(chunk);
    if (bytes >= 256 * 1024) {
      const block = parts.join(''); jsonBytes += bytes; jsonHash.update(block); yield block; parts = []; bytes = 0;
    }
  }
  if (parts.length) { const block = parts.join(''); jsonBytes += bytes; jsonHash.update(block); yield block; }
}
const artifactPath = path.join(output, `${name}.json.gz`);
const temporaryPath = `${artifactPath}.${process.pid}.tmp`;
try {
  await pipeline(Readable.from(chunks()), createGzip({ level: 6 }),
    new Transform({ transform(chunk, _encoding, done) { compressedHash.update(chunk); done(null, chunk); } }), createWriteStream(temporaryPath));
  await rename(temporaryPath, artifactPath);
} finally { await rm(temporaryPath, { force: true }); }
const reportPath = path.join(root, `docs/analysis/architecture-${name}.md`);
await writeFile(`${reportPath}.tmp`, architectureReport(result.artifact, `artifacts/${name}.json.gz`));
await rename(`${reportPath}.tmp`, reportPath);
const manifest = { snapshotId: result.artifact.snapshot.id, ...result.measurements, serializationMs: performance.now() - started,
  completedAt: new Date().toISOString(), jsonSha256: jsonHash.digest('hex'), compressedSha256: compressedHash.digest('hex'),
  finalPeakRssBytes: process.resourceUsage().maxRSS * 1024, jsonBytes, compressedBytes: (await stat(artifactPath)).size,
  analyzedFiles: paths.length, entities: result.artifact.entities.length, relations: result.artifact.relations.length,
  views: result.artifact.coverage.views, unresolvedCount: result.artifact.coverage.unresolvedCount };
const manifestPath = path.join(output, `${name}.run.json`);
await writeFile(`${manifestPath}.tmp`, JSON.stringify(manifest, null, 2) + '\n');
await rename(`${manifestPath}.tmp`, manifestPath);
console.log(JSON.stringify(manifest));
