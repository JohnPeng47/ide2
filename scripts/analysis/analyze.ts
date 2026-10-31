import { mkdir, writeFile, stat } from 'node:fs/promises';
import { createWriteStream } from 'node:fs';
import { createGzip } from 'node:zlib';
import { Readable } from 'node:stream';
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
function* chunks() { for (const chunk of analysisArtifactChunks(result.artifact)) { jsonBytes += Buffer.byteLength(chunk); yield chunk; } }
const artifactPath = path.join(output, `${name}.json.gz`);
await pipeline(Readable.from(chunks()), createGzip({ level: 6 }), createWriteStream(artifactPath));
await writeFile(path.join(root, `docs/analysis/architecture-${name}.md`), architectureReport(result.artifact, `artifacts/${name}.json.gz`));
const manifest = { snapshotId: result.artifact.snapshot.id, ...result.measurements, serializationMs: performance.now() - started,
  finalPeakRssBytes: process.resourceUsage().maxRSS * 1024, jsonBytes, compressedBytes: (await stat(artifactPath)).size,
  analyzedFiles: paths.length, entities: result.artifact.entities.length, relations: result.artifact.relations.length,
  views: result.artifact.coverage.views, unresolvedCount: result.artifact.coverage.unresolvedCount };
await writeFile(path.join(output, `${name}.run.json`), JSON.stringify(manifest, null, 2) + '\n');
console.log(JSON.stringify(manifest));
