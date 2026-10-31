import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import ts from 'typescript';
import type { StaticAnalysisRequest, StaticAnalysisResult, StaticAnalyzer } from '../../../application/core/static-analysis/ports';
import type { AnalysisArtifact } from '../../../domain/core/static-analysis/schema';
import { analysisDependencyEdges, dependencyComponents, mergeAnalysisFacts } from '../../../domain/core/static-analysis/incremental';
import { deriveAnalysis } from '../../../domain/core/static-analysis/derive';
import { validateAnalysisArtifact } from '../../../domain/core/static-analysis/persistence';
import { ANALYZER_VERSION, AnalysisContext, sha } from './context';
import { staticAnalyzer } from './analyzer';

export interface IncrementalCheckpoint {
  version: 1;
  fragments: { key: string; paths: string[]; artifact: AnalysisArtifact; semanticResolution: boolean }[];
}
export interface IncrementalResult extends StaticAnalysisResult {
  update: { changedFiles: string[]; analyzedFiles: string[]; reusedFiles: string[]; removedFiles: string[];
    components: number; fallbackReasons: string[]; derivedRecomputed: true };
}

/** Read current resolution, including previously missing imports, before trusting cached edges. */
function inventory(request: StaticAnalysisRequest) {
  const root = path.resolve(request.repositoryRoot), absoluteConfig = path.resolve(root, request.tsconfigPath);
  const config = ts.readConfigFile(absoluteConfig, ts.sys.readFile);
  if (config.error) throw new Error(ts.flattenDiagnosticMessageText(config.error.messageText, '\n'));
  const parsed = ts.parseJsonConfigFileContent(config.config, ts.sys, path.dirname(absoluteConfig));
  if (parsed.errors.length) throw new Error(parsed.errors.map(error => ts.flattenDiagnosticMessageText(error.messageText, '\n')).join('\n'));
  const selected = [...new Set(request.includePaths.map(file => path.relative(root, path.resolve(root, file)).replaceAll(path.sep, '/')))].sort();
  if (selected.some(file => file.startsWith('../') || path.isAbsolute(file))) throw new Error('Analysis input escapes repository');
  const host = ts.createCompilerHost(parsed.options, true);
  host.getCurrentDirectory = () => root;
  const program = ts.createProgram([...selected.map(file => path.resolve(root, file)), ...parsed.fileNames.filter(file => file.endsWith('.d.ts'))], parsed.options, host);
  const local = new Map<string, string>(), environment = new Map<string, string>(), edges: [string, string][] = [];
  const resolutions = new Map<string, string[]>(), fallback = new Set<string>();
  const relative = (file: string) => path.relative(root, file).replaceAll(path.sep, '/');
  const inside = (file: string) => !file.startsWith('../') && !path.isAbsolute(file) && !file.split('/').includes('node_modules');
  for (const source of program.getSourceFiles()) {
    const file = relative(source.fileName), content = readFileSync(source.fileName, 'utf8');
    if (!inside(file) || source.isDeclarationFile) {
      environment.set(inside(file) ? file : `external:${source.fileName}`, sha(content));
      if (selected.includes(file)) { local.set(file, sha(content)); fallback.add('selected-declaration-file'); }
      // Ambient declarations can expose types imported from ordinary local code
      // to every component, without an import in the consuming source file.
      for (const imported of ts.preProcessFile(content, true, true).importedFiles) {
        const target = ts.resolveModuleName(imported.fileName, source.fileName, parsed.options, host).resolvedModule?.resolvedFileName;
        if (target && inside(relative(target)) && !target.endsWith('.d.ts')) fallback.add('declaration-source-dependency');
      }
      for (const reference of source.referencedFiles) {
        const target = path.resolve(path.dirname(source.fileName), reference.fileName);
        if (inside(relative(target)) && !target.endsWith('.d.ts')) fallback.add('declaration-source-dependency');
      }
      continue;
    }
    local.set(file, sha(content));
    if (!ts.isExternalModule(source)) fallback.add('global-script');
    const inspect = (node: ts.Node) => {
      if (ts.isModuleDeclaration(node) && (ts.isStringLiteral(node.name) || node.flags & ts.NodeFlags.GlobalAugmentation)) fallback.add('module-or-global-augmentation');
      if (ts.isCallExpression(node) && (node.expression.kind === ts.SyntaxKind.ImportKeyword || ts.isIdentifier(node.expression) && node.expression.text === 'require')
        && (!node.arguments[0] || !ts.isStringLiteralLike(node.arguments[0]))) fallback.add('dynamic-module-resolution');
      ts.forEachChild(node, inspect);
    };
    inspect(source);
    const observations: string[] = [];
    for (const imported of ts.preProcessFile(content, true, true).importedFiles) {
      const target = ts.resolveModuleName(imported.fileName, source.fileName, parsed.options, host).resolvedModule?.resolvedFileName;
      observations.push(JSON.stringify([imported.fileName, target ? relative(target) : null]));
      if (target && inside(relative(target))) edges.push([file, relative(target)]);
    }
    resolutions.set(file, observations.sort());
    // Package boundaries can change resolution and containment without a TS edit.
    for (let directory = path.dirname(source.fileName); directory === root || directory.startsWith(root + path.sep); directory = path.dirname(directory)) {
      const manifest = path.join(directory, 'package.json');
      if (existsSync(manifest)) environment.set(relative(manifest), sha(readFileSync(manifest, 'utf8')));
      if (directory === root) break;
    }
  }
  for (const file of [request.tsconfigPath, 'package.json', 'package-lock.json']) if (existsSync(path.join(root, file))) environment.set(file, sha(readFileSync(path.join(root, file), 'utf8')));
  for (const file of selected) if (!local.has(file)) throw new Error(`Missing selected source file: ${file}`);
  if ([ts.ModuleResolutionKind.Node16, ts.ModuleResolutionKind.NodeNext].includes(parsed.options.moduleResolution!)) fallback.add('mode-sensitive-module-resolution');
  const environmentKey = sha(JSON.stringify({ version: `incremental-v1/analyzer-${ANALYZER_VERSION}`, compiler: ts.version, repositoryId: request.repositoryId,
    views: request.views, frameworks: request.frameworks, options: parsed.options, environment: [...environment].sort(([a], [b]) => a < b ? -1 : 1) }));
  return { selected, local, resolutions, edges, environmentKey, fallback: [...fallback].sort() };
}

/** Session-owned component cache. Unknown global effects deliberately broaden invalidation. */
export class IncrementalAnalyzer {
  private checkpoint: IncrementalCheckpoint = { version: 1, fragments: [] };
  private busy = false;
  constructor(private readonly extractor: StaticAnalyzer = staticAnalyzer) {}
  exportCheckpoint(): IncrementalCheckpoint { return structuredClone(this.checkpoint); }
  restoreCheckpoint(checkpoint: IncrementalCheckpoint) {
    if (this.busy) throw new Error('Cannot restore a running analysis');
    if (checkpoint.version !== 1) throw new Error('Unsupported incremental checkpoint version');
    const keys = new Set<string>();
    for (const fragment of checkpoint.fragments) {
      if (!/^[a-f0-9]{64}$/.test(fragment.key) || keys.has(fragment.key) || typeof fragment.semanticResolution !== 'boolean') throw new Error('Invalid incremental fragment');
      keys.add(fragment.key); validateAnalysisArtifact(fragment.artifact);
      if (JSON.stringify([...fragment.paths].sort()) !== JSON.stringify([...fragment.artifact.snapshot.scope.roots].sort())) throw new Error('Fragment scope differs from its artifact');
    }
    this.checkpoint = structuredClone(checkpoint);
  }
  async analyze(request: StaticAnalysisRequest): Promise<IncrementalResult> {
    if (this.busy) throw new Error('An incremental session cannot run concurrent updates');
    this.busy = true;
    try { return await this.update(request); } finally { this.busy = false; }
  }
  private async update(request: StaticAnalysisRequest): Promise<IncrementalResult> {
    const started = performance.now(), current = inventory(request);
    const selected = new Set(current.selected), previousFiles = new Map<string, string>();
    const graphEdges = [...current.edges];
    for (const entry of this.checkpoint.fragments) {
      for (const file of entry.artifact.snapshot.files) if (file.role === 'analyzed') previousFiles.set(file.path, file.contentHash);
      for (const edge of analysisDependencyEdges(entry.artifact)) if (current.local.has(edge[0]) && current.local.has(edge[1])) graphEdges.push(edge);
    }
    const groups = current.fallback.length ? [[...current.local.keys()].sort()] : dependencyComponents([...current.local.keys()], graphEdges);
    const previous = new Map(this.checkpoint.fragments.map(fragment => [fragment.key, fragment]));
    const next: IncrementalCheckpoint = { version: 1, fragments: [] }, analyzedFiles: string[] = [], reusedFiles: string[] = [];
    for (const members of groups) {
      const paths = members.filter(file => selected.has(file)); if (!paths.length) continue;
      const key = sha(JSON.stringify([current.environmentKey, paths, members.map(file => [file, current.local.get(file), current.resolutions.get(file)])]));
      const cached = previous.get(key);
      if (cached) { next.fragments.push(cached); reusedFiles.push(...paths); }
      else {
        const result = await this.extractor.analyze({ ...request, includePaths: paths });
        next.fragments.push({ key, paths, artifact: result.artifact, semanticResolution: result.execution?.semanticResolution ?? true });
        analyzedFiles.push(...paths);
      }
    }
    if (!next.fragments.length) throw new Error('Select at least one source file');
    // Fresh header pins the current commit/configuration/input set even on a cache hit.
    const context = new AnalysisContext(request);
    if (next.fragments.some(fragment => fragment.semanticResolution)) void context.checker;
    // Module extraction also discovers nested package manifests. They must remain
    // pinned even though assembly does not walk declarations again.
    const configurationPaths = new Set(context.artifact.snapshot.files.map(file => file.path));
    for (const fragment of next.fragments) for (const file of fragment.artifact.snapshot.files) {
      if (file.role === 'configuration' && !configurationPaths.has(file.path)) {
        context.artifact.snapshot.files.push({ ...file }); configurationPaths.add(file.path);
      }
    }
    const facts = mergeAnalysisFacts(next.fragments.map(fragment => fragment.artifact), selected);
    context.entities.clear(); facts.entities.forEach(entity => context.entities.set(entity.id, entity));
    facts.relations.forEach(edge => context.relationMap.set(edge.id, edge));
    context.artifact.uncertainties = facts.uncertainties;
    const artifact = context.finish(); context.release();
    deriveAnalysis(artifact, request.metrics, sha);
    this.checkpoint = next; // Publish only after a successful complete assembly.
    return { artifact, execution: { semanticResolution: next.fragments.some(fragment => fragment.semanticResolution) },
      measurements: { elapsedMs: performance.now() - started, peakRssBytes: process.resourceUsage().maxRSS * 1024 },
      update: { changedFiles: current.selected.filter(file => previousFiles.get(file) !== current.local.get(file)),
        removedFiles: [...previousFiles.keys()].filter(file => !selected.has(file)).sort(), analyzedFiles: analyzedFiles.sort(), reusedFiles: reusedFiles.sort(),
        components: next.fragments.length, fallbackReasons: current.fallback, derivedRecomputed: true } };
  }
}
