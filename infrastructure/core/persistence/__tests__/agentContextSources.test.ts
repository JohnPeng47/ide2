import { execFileSync } from 'node:child_process';
import { mkdtemp, mkdir, readFile, readdir, rm, symlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, expect, it, vi } from 'vitest';
import { revisionFixture } from '../../../../tests/support/diagramRevisions';
import { AgentContext } from '../../../../domain/core/agents/agentContext';
import { sourceFileHash, type AgentContextSourceRange } from '../../../../domain/core/agents/agentContextSource';
import { AgentContextLibrary } from '../../../../application/mapping/agent/agentContextLibrary';
import { FileAgentContextSources } from '../fileAgentContextSources';
import { FileAgentContextRepository } from '../fileAgentContextRepository';
import { FileDiagramAgentContextStore } from '../fileDiagramAgentContextStore';
import { compileDiagramAgentContext, loadDiagramAgentContext, storeDiagramAgentContext } from '../../../../domain/core/diagrams/diagramAgentContext';
import { MappingWorkspaceService } from '../../../../application/mapping/workspace/workspaceService';
import type { MappingWorkspaceRepository } from '../../../../application/mapping/workspace/repository';
import type { DiagramRepository } from '../../../../application/core/ports/diagramRepository';
import { MappingDocumentController } from '../../../../domain/mapping/workspace/mappingDocumentController';
import { mappingDocumentFromScene } from '../../../../domain/mapping/workspace/mappingDocument';
import { initialCanvasState } from '../../../../domain/mapping/workspace/mappingWorkspace';
import { singleDiagramScene } from '../../../../domain/core/diagrams/projectDiagramCanvas';

const roots: string[] = [];
afterEach(async () => { await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true }))); });
async function fixture(git = false) {
  const root = await mkdtemp(path.join(tmpdir(), 'context-sources-')); roots.push(root);
  const checkout = path.join(root, 'checkout'), store = path.join(root, 'store');
  await mkdir(checkout); await writeFile(path.join(checkout, 'code.ts'), 'before\nconst captured = 42;\nafter');
  const runGit = (...args: string[]) => execFileSync('git', ['-C', checkout, ...args], { encoding: 'utf8' }).trim();
  const commit = () => { runGit('add', '.'); runGit('-c', 'user.name=Test', '-c', 'user.email=test@example.test', 'commit', '-qm', 'fixture'); };
  if (git) { runGit('init', '-q'); commit(); }
  const binding = vi.fn(async (id: string) => {
    if (id !== 'source') throw Error('Unknown source');
    return git ? { kind: 'git-worktree' as const, root: checkout } : { kind: 'filesystem-documents' as const, root: checkout };
  });
  const sources = new FileAgentContextSources(store, binding);
  const library = new AgentContextLibrary(new FileAgentContextRepository(store), sources);
  const input = { requestId: crypto.randomUUID(), name: 'Source facts', context: [
    { type: 'text', text: 'Inspect this source.' },
    { type: 'sourceFile', sourceId: 'source', path: 'code.ts', startLine: 2, endLine: 2 }
  ] };
  return { root, checkout, store, binding, sources, library, input, commit, runGit };
}
it('pins committed files without copying source bytes and resolves only the selected range after HEAD moves', async () => {
  const f = await fixture(true), receipt = await f.library.create(f.input);
  const record = JSON.parse(await readFile(path.join(f.store, 'agent-contexts', `${receipt.agentContextId}.json`), 'utf8'));
  expect(record.snapshot.version).toBe(2);
  expect(record.snapshot.messages[0].content[1]).toMatchObject({ type: 'sourceRange', version: { kind: 'git', commit: f.runGit('rev-parse', 'HEAD') } });
  expect(JSON.stringify(record)).not.toContain('const captured');
  await expect(readdir(path.join(f.store, 'agent-context-sources'))).rejects.toMatchObject({ code: 'ENOENT' });
  await writeFile(path.join(f.checkout, 'code.ts'), 'entirely different'); f.commit();
  const read = await f.library.read(receipt.agentContextId);
  expect(read.contentHash).toBe(receipt.contentHash);
  expect(read.resolvedSnapshot?.messages[0].content[1]).toEqual({ type: 'text', text: 'code.ts:2-2\nconst captured = 42;' });
  expect(JSON.stringify(read.resolvedSnapshot)).not.toContain('before');
  expect(await f.library.create(f.input)).toEqual(receipt);
  await expect(f.library.create({ ...f.input, name: 'Changed' })).rejects.toThrow('REQUEST_ID_CONFLICT');
  f.binding.mockClear();
  await f.library.list(); await f.library.read(receipt.agentContextId, false);
  expect(f.binding).not.toHaveBeenCalled();
});
it.each([true, false])('shares dirty/non-Git source blobs across contexts and ranges (git=%s)', async git => {
  const f = await fixture(git);
  await writeFile(path.join(f.checkout, 'code.ts'), 'before\nconst captured = 99;\nafter');
  const first = await f.library.create(f.input);
  const second = await f.library.create({ ...f.input, requestId: crypto.randomUUID(), context: [
    { type: 'sourceFile', sourceId: 'source', path: 'code.ts', startLine: 1, endLine: 3 }
  ] });
  expect(await readdir(path.join(f.store, 'agent-context-sources'))).toHaveLength(1);
  await rm(path.join(f.checkout, 'code.ts'));
  const restarted = new AgentContextLibrary(new FileAgentContextRepository(f.store), new FileAgentContextSources(f.store));
  expect(JSON.stringify((await restarted.read(first.agentContextId)).resolvedSnapshot)).toContain('const captured = 99;');
  expect(JSON.stringify((await restarted.read(second.agentContextId)).resolvedSnapshot)).toContain('before');
  expect(await restarted.create(f.input)).toEqual(first);
  const stored = await new FileAgentContextRepository(f.store).read(first.agentContextId);
  expect(stored?.snapshot.sourceFiles).toBeUndefined();
  expect(JSON.stringify(stored)).not.toContain('const captured');
});
it('pins an explicit Git revision and makes portable contexts independent of the repository', async () => {
  const f = await fixture(true), commit = f.runGit('rev-parse', 'HEAD');
  await writeFile(path.join(f.checkout, 'code.ts'), 'dirty');
  const reference = await f.sources.capture({ type: 'sourceFile', sourceId: 'source', path: 'code.ts', startLine: 2, endLine: 2, revision: commit });
  const context = AgentContext.fromMessages('portable', [{ role: 'user', content: [reference], timestamp: 0 }]);
  const saveInput = { requestId: crypto.randomUUID(), name: 'Pinned snapshot', context: context.toSnapshot() };
  const receipt = await f.library.create(saveInput);
  const portable = await f.sources.portable(context.toSnapshot());
  expect(portable.sourceFiles).toBeDefined();
  expect(JSON.stringify(portable)).not.toContain('before');
  expect(JSON.stringify(portable)).not.toContain('after');
  await rm(f.checkout, { recursive: true });
  const restartedSources = new FileAgentContextSources(f.store, f.binding);
  await expect(restartedSources.read(reference)).rejects.toThrow();
  const restartedLibrary = new AgentContextLibrary(new FileAgentContextRepository(f.store), restartedSources);
  expect(await restartedLibrary.create(saveInput)).toEqual(receipt);
  const destination = new FileAgentContextSources(path.join(f.root, 'destination'));
  const imported = await destination.persist(portable);
  expect(imported.sourceFiles).toBeUndefined();
  expect(JSON.stringify((await AgentContext.fromSnapshot(imported).resolveSources(ref => destination.read(ref))).toSnapshot())).toContain('const captured = 42;');
});
it('rejects traversal, symlinks, missing sources, out-of-range lines and corrupted blobs', async () => {
  const f = await fixture();
  const capture = (patch: object) => f.sources.capture({ type: 'sourceFile', sourceId: 'source', path: 'code.ts', startLine: 1, ...patch });
  for (const file of ['../code.ts', '/etc/passwd', 'a/../code.ts', 'C:/code.ts', 'a\\b']) await expect(capture({ path: file })).rejects.toThrow();
  await symlink(path.join(f.checkout, 'code.ts'), path.join(f.checkout, 'link.ts'));
  await expect(capture({ path: 'link.ts' })).rejects.toThrow('symbolic');
  await expect(capture({ sourceId: 'unknown' })).rejects.toThrow('Unknown');
  await expect(capture({ endLine: 99 })).rejects.toThrow('outside');
  const reference = await capture({});
  if (reference.version.kind !== 'snapshot') throw Error('fixture');
  await writeFile(path.join(f.store, 'agent-context-sources', `${reference.version.contentHash}.json`), '{}');
  await expect(new FileAgentContextSources(f.store).read(reference)).rejects.toThrow('integrity');
});
it('stores diagram evidence once across contexts and keeps context files free of source text', async () => {
  const f = await fixture();
  const evidence = { entry: { id: 'entry', handle: 'entry', label: 'Entry', category: 'operation' as const, summary: 'Entry',
    sourceRanges: [{ id: 'r', path: 'code.ts', startLine: 2, endLine: 2, originalLines: ['const sharedEvidence = 123;'] }] } };
  const store = new FileDiagramAgentContextStore(f.store);
  const bounds = [];
  for (const name of ['First', 'Second']) {
    const diagram = singleDiagramScene(name).contents.overview;
    const compiled = compileDiagramAgentContext({ ...diagram, sourceContext: { ...diagram.sourceContext, evidence } });
    const bound = await storeDiagramAgentContext(compiled, store); bounds.push(bound);
    const compact = await loadDiagramAgentContext(bound, store);
    expect(compact.contentHash).toBe(compiled.contentHash);
    expect(compact.sourceFiles).toBeUndefined();
    expect(JSON.stringify(compact)).not.toContain('const sharedEvidence');
    expect(JSON.stringify(await store.resolve(compact))).toContain('const sharedEvidence');
    const portable = await store.portable(compact);
    expect(JSON.stringify((await AgentContext.fromSnapshot(portable).resolveSources()).toSnapshot())).toContain('const sharedEvidence');
  }
  expect(await readdir(path.join(f.store, 'agent-context-sources'))).toHaveLength(1);
  expect(bounds[0].backingRecordId).not.toBe(bounds[1].backingRecordId);
});
it('validates portable attachments, refuses unresolved model input and bounds expanded context size', async () => {
  const file = { startLine: 5, lines: ['pinned source'] }, hash = sourceFileHash(file);
  const reference: AgentContextSourceRange = { type: 'sourceRange', sourceId: 'source', path: 'code.ts', startLine: 5, endLine: 5, version: { kind: 'snapshot', contentHash: hash } };
  const compact = AgentContext.fromMessages('test', [{ role: 'user', content: [reference, reference], timestamp: 0 }]);
  expect(() => compact.toPiMessages()).toThrow('UNRESOLVED');
  const reader = vi.fn(async () => 'pinned source');
  await compact.resolveSources(reader); expect(reader).toHaveBeenCalledTimes(1);
  await expect(compact.resolveSources()).rejects.toThrow('UNAVAILABLE');
  expect(() => AgentContext.fromSnapshot({ ...compact.toSnapshot(), sourceFiles: { [hash]: { ...file, lines: ['tampered'] } } })).toThrow('hash mismatch');
  const portable = AgentContext.fromSnapshot({ ...compact.toSnapshot(), sourceFiles: { [hash]: file } });
  expect(portable.contentHash).toBe(compact.contentHash);
  expect((await portable.resolveSources()).toPiMessages()[0].content[0]).toEqual({ type: 'text', text: 'code.ts:5-5\npinned source' });
  await expect(compact.resolveSources(async () => 'x'.repeat(1_100_000))).rejects.toThrow('TOO_LARGE');
  const single = AgentContext.fromMessages('large', [{ role: 'user', content: [reference], timestamp: 0 }]);
  const large = await single.resolveSources(async () => 'x'.repeat(1_100_000));
  expect(large.toPiMessages()[0].content).toHaveLength(2);
});

it('exports source-bearing workspace history and imports it into a store without the original sources', async () => {
  const f = await fixture(), initialScene = singleDiagramScene('Portable');
  const base = revisionFixture().create({ id: 'overview', revision: 0, ascii: 'Portable', evidence: {
    item: { id: 'item', handle: 'item', label: 'Item', category: 'operation', summary: 'Item',
      sourceRanges: [{ id: 'range', path: 'removed.ts', startLine: 9, endLine: 9, originalLines: ['export const preserved = 123;'] }] }
  } }).diagram;
  const scene = { ...initialScene, contents: { ...initialScene.contents, overview: base } };
  const contextStore = new FileDiagramAgentContextStore(f.store);
  const bound = await storeDiagramAgentContext(compileDiagramAgentContext(scene.contents.overview), contextStore);
  const controller = new MappingDocumentController(mappingDocumentFromScene(scene), initialCanvasState());
  controller.applyUpdate(0, [{ method: 'diagram-context-set', nodeId: 'grid:overview', expectedRevisionId: base.revisionId, context: bound }]);
  controller.applyUpdate(1, [{ method: 'replace', nodeId: 'grid:overview', ascii: 'Changed' }]);
  const state = controller.getSnapshot();
  const workspace = { schemaVersion: 3 as const, projectId: 'project', documents: [{ representationId: 'draft-test',
    revisionId: '', name: 'Portable', savedName: '', savedScene: JSON.stringify(scene),
    document: state.document, canvas: state.canvas, history: controller.exportHistory() }] };
  const project = { loadProject: async () => ({ id: 'project' }) } as unknown as Pick<DiagramRepository, 'loadProject'>;
  const service = new MappingWorkspaceService(project, {} as MappingWorkspaceRepository, contextStore);
  const portable = await service.portableExport(workspace);
  expect(portable.documents[0].document.diagramContexts![base.diagramId].snapshot?.sourceFiles).toBeDefined();
  const destinationStore = new FileDiagramAgentContextStore(path.join(f.root, 'destination'));
  const destination = new MappingWorkspaceService(project, {} as MappingWorkspaceRepository, destinationStore);
  const imported = await destination.prepareImport(JSON.parse(JSON.stringify(portable)));
  const binding = imported.documents[0].document.diagramContexts![base.diagramId];
  expect(binding).toEqual(bound);
  expect(JSON.stringify(imported.documents[0].document.diagramContexts)).not.toContain('export const preserved');
  expect(JSON.stringify(await destinationStore.resolve(await loadDiagramAgentContext(binding, destinationStore)))).toContain('export const preserved');
  const head = imported.documents[0].history!.snapshots[imported.documents[0].history!.headId];
  expect(head.document.diagramContexts![base.diagramId]).toEqual(bound);
});
