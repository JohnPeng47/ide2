import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import ts from 'typescript';
import { sourceClassification } from '../../../domain/core/static-analysis/classification';
import type { StaticAnalysisRequest } from '../../../application/core/static-analysis/ports';
import type { AnalysisArtifact, AnalysisEntity, AnalysisProvenance, AnalysisRange, AnalysisRelation, AnalysisView } from '../../../domain/core/static-analysis/schema';

export const sha = (value: string) => createHash('sha256').update(value).digest('hex');
export const compare = (a: string, b: string) => a < b ? -1 : a > b ? 1 : 0;
export const callable = (node: ts.Node): node is ts.FunctionLikeDeclaration => ts.isFunctionDeclaration(node) || ts.isFunctionExpression(node)
  || ts.isArrowFunction(node) || ts.isMethodDeclaration(node) || ts.isConstructorDeclaration(node) || ts.isGetAccessorDeclaration(node) || ts.isSetAccessorDeclaration(node);
export const views: AnalysisView[] = ['containment', 'lexical', 'calls', 'ownership', 'dependencies'];
let previousProgram: ts.Program | undefined;

export function classify(relative: string): AnalysisEntity['metadata'] {
  const { runtime, owner, composition } = sourceClassification(relative);
  const layer = relative.includes('/__tests__/') || /\.(?:test|integration)\.tsx?$/.test(relative) ? 'test'
    : ({ src: 'ui', domain: 'domain', application: 'application', infrastructure: 'infrastructure', server: 'server', packages: 'package' } as const)[runtime as 'src'] ?? 'other';
  return { layer, feature: owner, compositionRoot: composition };
}

export class AnalysisContext {
  readonly root: string;
  private activeProgram?: ts.Program;
  get program(): ts.Program { if (!this.activeProgram) throw new Error('Analysis compiler context has been released'); return this.activeProgram; }
  private typeChecker?: ts.TypeChecker;
  private semanticReady = false;
  private compilerOptions!: ts.CompilerOptions;
  private compilerRoots!: string[];
  private compilerHost!: ts.CompilerHost;
  get checker() {
    if (!this.semanticReady) {
      const syntax = this.program, host = this.compilerHost;
      const semanticHost = { ...host, getSourceFile: (...args: Parameters<ts.CompilerHost['getSourceFile']>) => syntax.getSourceFile(args[0]) ?? host.getSourceFile(...args) };
      this.activeProgram = ts.createProgram({ rootNames: this.compilerRoots, options: this.compilerOptions, host: semanticHost, oldProgram: previousProgram });
      previousProgram = this.activeProgram; this.semanticReady = true;
    }
    return this.typeChecker ??= this.program.getTypeChecker();
  }
  readonly selected: ts.SourceFile[];
  readonly selectedPaths: Set<string>;
  readonly artifact: AnalysisArtifact;
  readonly entities = new Map<string, AnalysisEntity>();
  readonly nodeEntities = new Map<ts.Node, string>();
  readonly entityNodes = new Map<string, ts.Node>();
  readonly scopes = new Map<ts.Node, string>();
  readonly bindingScopes = new Map<string, string>();
  readonly aliases = new Map<string, string>();
  readonly setters = new Map<string, string>();
  readonly relationMap = new Map<string, AnalysisRelation>();
  readonly callableNodes: ts.FunctionLikeDeclaration[] = [];
  readonly files = new Map<string, { source: ts.SourceFile; hash: string }>();
  readonly duplicates = new Map<string, number>();
  readonly ranges = new Map<ts.Node, AnalysisRange>();
  readonly relativePaths = new Map<string, string>();
  readonly sites = new Map<ts.Node, string>();
  readonly syntaxProvenance = new WeakMap<ts.Node, AnalysisProvenance>();
  readonly emptyIds: string[] = [];
  readonly issueIds = new Set<string>();
  readonly siteKeys = new Map<ts.Node, string>();
  readonly siteCounts = new Map<string, number>();
  readonly resourceKinds = new Map<string, NonNullable<AnalysisEntity['metadata']['resourceKind']>>();
  readonly siteSets = new Map<AnalysisView, { resolved: Set<string>; unresolved: Set<string> }>();
  readonly rootId: string;

  constructor(readonly request: StaticAnalysisRequest) {
    this.root = path.resolve(request.repositoryRoot);
    const configPath = path.resolve(this.root, request.tsconfigPath);
    const config = ts.readConfigFile(configPath, ts.sys.readFile);
    if (config.error) throw new Error(ts.flattenDiagnosticMessageText(config.error.messageText, '\n'));
    const parsed = ts.parseJsonConfigFileContent(config.config, ts.sys, path.dirname(configPath));
    if (parsed.errors.length) throw new Error(parsed.errors.map(error => ts.flattenDiagnosticMessageText(error.messageText, '\n')).join('\n'));
    this.selectedPaths = new Set([...request.includePaths].map(file => this.relative(path.resolve(this.root, file))));
    for (const file of this.selectedPaths) if (file.startsWith('../') || path.isAbsolute(file)) throw new Error('Analysis input escapes repository');
    const host = ts.createCompilerHost(parsed.options, true);
    const original = host.getSourceFile.bind(host);
    host.getSourceFile = (file, languageVersion, onError, shouldCreateNewSourceFile) => {
      const previous = previousProgram?.getSourceFile(file);
      if (previous && existsSync(file) && readFileSync(file, 'utf8') === previous.text) return previous;
      return original(file, languageVersion, onError, shouldCreateNewSourceFile);
    };
    const roots = [...this.selectedPaths].sort().map(file => path.join(this.root, file));
    roots.push(...parsed.fileNames.filter(file => file.endsWith('.d.ts')));
    this.compilerOptions = parsed.options; this.compilerRoots = [...new Set(roots)]; this.compilerHost = host;
    // Syntax and locally resolved facts do not need to parse/bind the standard library.
    // Build the complete, original project lazily on the first symbol/type query.
    this.activeProgram = ts.createProgram({ rootNames: this.compilerRoots, options: { ...parsed.options, noLib: true, noResolve: true, types: [] }, host });
    this.selected = [...this.selectedPaths].sort().map(file => {
      const source = this.program.getSourceFile(path.join(this.root, file)); if (!source) throw new Error(`Missing source ${file}`); return source;
    });
    if (!this.selected.length) throw new Error('Select at least one source file');
    this.artifact = { schemaVersion: 1,
      snapshot: { id: 'pending', repositoryId: request.repositoryId, commit: null, dirtyFiles: [], files: [],
        analyzer: { version: '0.2.0', compilerVersion: ts.version, identityVersion: 1, configurationHash: sha(JSON.stringify({ options: parsed.options, views: request.views, frameworks: request.frameworks, metrics: request.metrics })) },
        tsconfigs: [], scope: { roots: [...this.selectedPaths].sort(), excludedPatterns: ['node_modules/**', 'docs/analysis/artifacts/**'], externalPolicy: 'summarize', followImports: true } },
      entities: [], relations: [], uncertainties: [], layers: [], derived: { sccs: [], trees: [], partitions: [], metrics: [], sourceJoins: [], findings: [] },
      coverage: { analyzedFiles: 0, resolutionOnlyFiles: 0, unresolvedCount: 0, views: views.map(view => ({ view, status: request.views.includes(view) ? 'complete' : 'not-run', candidateSites: 0, resolvedSites: 0, unresolvedSites: 0 })) } };
    for (const view of views) this.siteSets.set(view, { resolved: new Set(), unresolved: new Set() });
    for (const source of this.selected) this.trackFile(source);
    const configText = readFileSync(configPath, 'utf8'), relativeConfig = this.relative(configPath);
    this.artifact.snapshot.files.push({ path: relativeConfig, contentHash: sha(configText), utf16Length: configText.length, lineCount: this.lineCount(configText), role: 'configuration', language: 'json' });
    this.artifact.snapshot.tsconfigs.push({ path: relativeConfig, contentHash: sha(configText), effectiveOptionsHash: sha(JSON.stringify(parsed.options)) });
    for (const filename of ['package.json', 'package-lock.json']) {
      const absolute = path.join(this.root, filename);
      if (existsSync(absolute)) { const text = readFileSync(absolute, 'utf8'); this.artifact.snapshot.files.push({ path: filename, contentHash: sha(text), utf16Length: text.length, lineCount: this.lineCount(text), role: 'configuration', language: 'json' }); }
    }
    this.rootId = this.addEntity('repository', request.repositoryId, this.selected[0], undefined, 'repository', 'synthetic');
  }
  relative(absolute: string) {
    let relative = this.relativePaths.get(absolute);
    if (relative === undefined) { relative = path.relative(this.root, absolute); if (path.sep !== '/') relative = relative.replaceAll(path.sep, '/'); this.relativePaths.set(absolute, relative); }
    return relative;
  }
  inside(node: ts.Node) { const file = this.relative(node.getSourceFile().fileName); return !file.startsWith('../') && !file.includes('node_modules/') && !path.isAbsolute(file); }
  active(view: AnalysisView) { return this.request.views.includes(view); }
  lineCount(text: string) { return text.length ? text.split('\n').length - (text.endsWith('\n') ? 1 : 0) : 0; }
  trackFile(source: ts.SourceFile) {
    const relative = this.relative(source.fileName);
    if (this.files.has(relative)) return;
    const hash = sha(source.text); this.files.set(relative, { source, hash });
    this.artifact.snapshot.files.push({ path: relative, contentHash: hash, utf16Length: source.text.length, lineCount: this.lineCount(source.text),
      role: this.selectedPaths.has(relative) ? 'analyzed' : 'resolution-only', language: relative.endsWith('.tsx') ? 'tsx' : 'ts' });
  }
  range(node: ts.Node): AnalysisRange {
    const cached = this.ranges.get(node); if (cached) return cached;
    const source = node.getSourceFile(); this.trackFile(source);
    const start = node.getStart(source), end = node.getEnd(), a = source.getLineAndCharacterOfPosition(start), b = source.getLineAndCharacterOfPosition(end);
    const relative = this.relative(source.fileName);
    const result = { snapshotId: 'pending', path: relative, fileHash: this.files.get(relative)!.hash,
      start: { offset: start, line: a.line + 1, column: a.character + 1 }, end: { offset: end, line: b.line + 1, column: b.character + 1 } };
    this.ranges.set(node, result); return result;
  }
  provenance(node: ts.Node, method: AnalysisProvenance['method'] = 'syntax', status: AnalysisProvenance['status'] = 'resolved', explanation = ''): AnalysisProvenance {
    if (method === 'syntax' && status === 'resolved' && !explanation) {
      const existing = this.syntaxProvenance.get(node); if (existing) return existing;
      const provenance = { status, method, rule: 'syntax:v1', locations: [this.range(node)], supportingRelationIds: this.emptyIds, explanation };
      this.syntaxProvenance.set(node, provenance); return provenance;
    }
    return { status, method, rule: `${method}:v1`, locations: [this.range(node)], supportingRelationIds: this.emptyIds, explanation };
  }
  addEntity(kind: AnalysisEntity['kind'], name: string, node: ts.Node, parent: string | undefined,
    role = kind as string, origin: AnalysisEntity['identity']['origin'] = 'source', structural = false): string {
    const ownerKey = parent ?? this.request.repositoryId;
    const fingerprint = structural ? sha(node.getText().replace(/\s+/g, ' ')).slice(0, 20) : name;
    let key = JSON.stringify([this.request.repositoryId, this.relative(node.getSourceFile().fileName), ownerKey, kind, fingerprint, role]);
    // Source-file owners already encode their path; synthetic repository identity is path-independent.
    if (kind === 'repository') key = JSON.stringify([this.request.repositoryId, 'repository']);
    let id = `entity:${sha(key)}`;
    if (this.entities.has(id)) {
      if (this.entityNodes.get(id) === node || ['directory', 'module', 'repository'].includes(kind)) return id;
      const duplicate = (this.duplicates.get(key) ?? 0) + 1; this.duplicates.set(key, duplicate); key += `#${duplicate}`; id = `entity:${sha(key)}`;
    }
    const entity: AnalysisEntity = { id, kind, name, identity: { key, stability: structural ? 'structural' : 'named', origin },
      provenance: this.provenance(node), metadata: classify(this.relative(node.getSourceFile().fileName)) };
    this.entities.set(id, entity); this.entityNodes.set(id, node);
    if (parent) this.edge('containment', 'contains', parent, id, node);
    return id;
  }
  module(source: ts.SourceFile): string {
    const cached = this.nodeEntities.get(source); if (cached) return cached;
    const relative = this.relative(source.fileName); let parent = this.rootId;
    const segments = relative.split('/').slice(0, -1);
    // Directory keys must not depend on whichever source introduced them.
    for (let i = 0; i < segments.length; i++) {
      const name = segments.slice(0, i + 1).join('/'), key = JSON.stringify([this.request.repositoryId, 'directory', name]), id = `entity:${sha(key)}`;
      if (!this.entities.has(id)) {
        this.entities.set(id, { id, kind: 'directory', name, identity: { key, stability: 'named', origin: 'synthetic' }, provenance: this.provenance(source), metadata: classify(relative) });
        this.entityNodes.set(id, source); this.edge('containment', 'contains', parent, id, source);
      }
      parent = id;
    }
    const id = this.addEntity('module', relative, source, parent); this.nodeEntities.set(source, id); return id;
  }
  site(node: ts.Node) {
    let site = this.sites.get(node);
    if (!site) { site = `${this.relative(node.getSourceFile().fileName)}:${node.pos}:${node.end}`; this.sites.set(node, site); }
    return site;
  }
  stableSite(node: ts.Node): string {
    const known = this.siteKeys.get(node); if (known) return known;
    const owner = ts.isSourceFile(node) ? node : this.owner(node);
    const key = sha(JSON.stringify([this.relative(node.getSourceFile().fileName), this.nodeEntities.get(owner) ?? 'module', node.kind, sha(node.getText().replace(/\s+/g, ' '))]));
    const ordinal = this.siteCounts.get(key) ?? 0; this.siteCounts.set(key, ordinal + 1);
    const result = `${key}:${ordinal}`; this.siteKeys.set(node, result); return result;
  }
  edge(view: AnalysisView, kind: AnalysisRelation['kind'], from: string, to: string, node: ts.Node,
    attributes: Record<string, unknown> = {}, method: AnalysisProvenance['method'] = 'syntax', status: AnalysisProvenance['status'] = 'resolved'): string {
    if (view !== 'containment' && !this.active(view)) return '';
    const baseAttributes = view === 'lexical' ? { access: [], ...attributes } : view === 'calls' ? { dispatch: 'direct', ...attributes } : attributes;
    const site = this.stableSite(node);
    const key = JSON.stringify([view, kind, from, to, site, baseAttributes]), id = `relation:${sha(key)}`;
    if (!this.relationMap.has(id)) this.relationMap.set(id, { id, view, kind, from, to, weight: 1,
      provenance: this.provenance(node, method, status), ...baseAttributes } as AnalysisRelation);
    if (this.active(view)) this.siteSets.get(view)!.resolved.add(this.site(node));
    return id;
  }
  issue(view: AnalysisView, reason: AnalysisArtifact['uncertainties'][number]['reason'], node: ts.Node,
    entityIds: string[] = [], explanation = '', kind: AnalysisArtifact['uncertainties'][number]['kind'] = 'unresolved') {
    if (!this.active(view)) return;
    const id = `issue:${sha(JSON.stringify([view, reason, this.site(node), entityIds]))}`;
    if (!this.issueIds.has(id)) { this.issueIds.add(id); this.artifact.uncertainties.push({ id, kind, view, reason, entityIds,
      relationIds: [], candidateEntityIds: [], provenance: this.provenance(node, 'syntax', 'unresolved', explanation) }); }
    this.siteSets.get(view)!.unresolved.add(this.site(node));
  }
  canonical(id: string): string { const seen = new Set<string>(); while (this.aliases.has(id) && !seen.has(id)) { seen.add(id); id = this.aliases.get(id)!; } return id; }
  owner(node: ts.Node): ts.FunctionLikeDeclaration | ts.SourceFile {
    let current = node.parent; while (current && !callable(current) && !ts.isSourceFile(current)) current = current.parent;
    return current as ts.FunctionLikeDeclaration | ts.SourceFile;
  }
  releaseCompiler() {
    if (this.selected.length > 100 && previousProgram === this.activeProgram) previousProgram = undefined;
    this.activeProgram = undefined; this.typeChecker = undefined;
  }
  release() {
    this.releaseCompiler(); this.selected.length = 0; this.files.clear();
    this.entities.clear(); this.entityNodes.clear(); this.nodeEntities.clear(); this.scopes.clear(); this.bindingScopes.clear();
    this.aliases.clear(); this.setters.clear(); this.relationMap.clear(); this.callableNodes.length = 0;
    this.ranges.clear(); this.sites.clear(); this.siteKeys.clear(); this.siteCounts.clear(); this.siteSets.clear(); this.duplicates.clear(); this.issueIds.clear();
  }
  finish() {
    const artifact = this.artifact;
    artifact.entities = [...this.entities.values()]; artifact.relations = [...this.relationMap.values()];
    artifact.snapshot.files.sort((a, b) => compare(a.path, b.path));
    try {
      artifact.snapshot.commit = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: this.root, stdio: ['ignore', 'pipe', 'ignore'], encoding: 'utf8' }).trim();
    } catch { /* Non-Git corpora have a null commit; content hashes still pin their inputs. */ }
    if (artifact.snapshot.commit) {
      // Scope Git reads to pinned inputs; large unrelated diagram stores can exceed maxBuffer.
      const paths = artifact.snapshot.files.map(file => file.path);
      const options = { cwd: this.root, encoding: 'utf8' as const, maxBuffer: 16 * 1024 * 1024 };
      const tracked = new Set(execFileSync('git', ['ls-files', '-z', '--', ...paths], options).split('\0'));
      const changed = new Set(execFileSync('git', ['diff', 'HEAD', '--name-only', '-z', '--', ...paths], options).split('\0'));
      artifact.snapshot.dirtyFiles = artifact.snapshot.files.filter(file => changed.has(file.path) || !tracked.has(file.path))
        .map(file => ({ path: file.path, status: tracked.has(file.path) ? 'modified' as const : 'untracked' as const, contentHash: file.contentHash }));
    }
    artifact.snapshot.id = `snapshot:${sha(JSON.stringify({ ...artifact.snapshot, id: undefined }))}`;
    for (const fact of [...artifact.entities, ...artifact.relations, ...artifact.uncertainties]) for (const range of fact.provenance.locations) range.snapshotId = artifact.snapshot.id;
    artifact.coverage.analyzedFiles = artifact.snapshot.files.filter(file => file.role === 'analyzed').length;
    artifact.coverage.resolutionOnlyFiles = artifact.snapshot.files.filter(file => file.role === 'resolution-only').length;
    artifact.coverage.unresolvedCount = artifact.uncertainties.filter(issue => ['unresolved', 'unsupported', 'ambiguous-identity'].includes(issue.kind)).length;
    for (const coverage of artifact.coverage.views) {
      const sites = this.siteSets.get(coverage.view)!;
      coverage.unresolvedSites = sites.unresolved.size; coverage.resolvedSites = [...sites.resolved].filter(site => !sites.unresolved.has(site)).length;
      coverage.candidateSites = coverage.resolvedSites + coverage.unresolvedSites;
      if (coverage.unresolvedSites) coverage.status = 'partial';
    }
    return artifact;
  }
}
