import { updateChangeSessionSchema } from '../../../../domain/mapping/agent/contracts';
import { mkdtemp, readFile, writeFile, rename, rm } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { execFileSync } from 'node:child_process';
import { createServer } from 'node:http';
import { afterEach, expect, it, vi } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { DiagramStore } from '../../../core/persistence/store';
import { DiagramChangeSessionStore } from '../diagramChangeSessionStore';
import { ChangeSessionService } from '../../../../application/mapping/changes/changeSessionService';
import { AgentDiagrammingSessionService } from '../../../../application/mapping/agent/sessionService';
import type { CanvasSessionPort } from '../../../../application/mapping/agent/ports';
import type { MappingDiagramService } from '../../../../application/mapping/diagrams/diagramService';
import { QuickJsAgentRuntime } from '../../agent/execRuntime';
import { createMappingMcpServer } from '../../mcp/server';
import { handleAgentRoutes } from '../../../../src/server/routes/mapping/agentRoutes';
import { canvasSaveFixture } from '../../../../tests/support/mappingDiagram';
import { singleDiagramScene } from '../../../../domain/core/diagrams/projectDiagramCanvas';

const roots: string[] = [];
afterEach(async () => { await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true }))); });
const git = (root: string, ...args: string[]) => execFileSync('git', ['-C', root, ...args], { encoding: 'utf8' }).trim();
const commit = (root: string, message: string) => { git(root, 'add', '.'); git(root, '-c', 'user.name=Test', '-c', 'user.email=test@example.test', 'commit', '-qm', message); return git(root, 'rev-parse', 'HEAD'); };
async function setup(background = false) {
  const root = await mkdtemp(path.join(tmpdir(), 'diff-tree-')); roots.push(root); git(root, 'init', '-q');
  await writeFile(path.join(root, '.gitignore'), '.diagrams/\n');
  await writeFile(path.join(root, 'a.ts'), Array.from({ length: 30 }, (_, i) => `line ${i + 1}`).join('\n') + '\n');
  await writeFile(path.join(root, 'delete.txt'), 'remove me');
  const base = commit(root, 'base');
  await writeFile(path.join(root, 'a.ts'), Array.from({ length: 30 }, (_, i) => i === 1 ? 'changed early' : i === 26 ? 'changed late' : `line ${i + 1}`).join('\n') + '\n');
  await rm(path.join(root, 'delete.txt')); await writeFile(path.join(root, 'binary.dat'), Buffer.from([0, 1, 2, 0]));
  const head = commit(root, 'changes');
  const store = new DiagramStore(root), project = await store.ensureProject({ checkoutRoot: root, repositoryIdentity: '' });
  const saved = await store.projectCatalogs.saveMappingDiagram(project.id, canvasSaveFixture({ name: 'Canvas', scene: singleDiagramScene('Original') }));
  const repositoryId = project.repositories![0].id;
  const bridge: CanvasSessionPort = { register() {}, list: () => [], poll: async () => [], reply() {}, unregister() {}, dispose() {}, dispatch: async () => { throw Error('Unexpected live dispatch'); } };
  const records = new DiagramChangeSessionStore(store.storeRoot, undefined, background);
  const changes = new ChangeSessionService(records, store, bridge);
  const diagrams = { initialize: async () => ({ project: await store.loadProject(), catalog: await store.projectCatalogs.loadRepresentationCatalog(project.id) }) } as unknown as MappingDiagramService;
  const agent = new AgentDiagrammingSessionService(bridge, diagrams, store, new QuickJsAgentRuntime(), changes);
  const tool = (name: Parameters<typeof agent.call>[0], args: unknown) => agent.call(name, args) as Promise<any>;
  const discovered = await tool('get_repository_diff_hunks', { repositoryId, commits: [head] });
  const target = (hunkId: string) => ({ kind: 'diff-hunk', hunkId });
  const tree = { ascii: 'Review\n|-- Logic\n|   `-- Detail\n`-- Removed file', structureKind: 'tree', mappings: [
    { id: 'logic', source: { line: 2 }, targets: discovered.hunks.filter((h: any) => h.path === 'a.ts').map((h: any) => target(h.id)) },
    { id: 'removed', source: { line: 4 }, targets: discovered.hunks.filter((h: any) => h.path === 'delete.txt').map((h: any) => target(h.id)) }
  ] };
  const request = { title: 'Review', repositoryId, commits: discovered.commits, head: discovered.head, diffTree: tree, requestId: 'create' };
  const manifest = (id: string) => readFile(path.join(store.storeRoot, 'mapping-change-sessions', project.id, `${id}.manifest.json`), 'utf8').then(JSON.parse);
  return { root, base, head, store, records, project, repositoryId, saved, changes, agent, tool, discovered, tree, request, manifest };
}
it('discovers Git hunks, initializes a real Diagram and atomically edits/replays mappings through MCP and HTTP', async () => {
  const f = await setup();
  expect(f.discovered.hunks.filter((h: any) => h.path === 'a.ts')).toHaveLength(2);
  expect(f.discovered.hunks.find((h: any) => h.path === 'binary.dat').kind).toBe('binary');
  expect(f.discovered.hunks.find((h: any) => h.path === 'delete.txt').patch).toContain('\\ No newline at end of file');
  const rootHunks = await f.tool('get_repository_diff_hunks', { repositoryId: f.repositoryId, commits: [f.base], limit: 1, includePatches: false });
  expect(rootHunks.hunks[0].parent).toBeNull(); expect(rootHunks.hunks[0]).not.toHaveProperty('patch'); expect(rootHunks.nextOffset).toBe(1);
  const http = createServer((req, res) => { void handleAgentRoutes(req, res, new URL(req.url!, 'http://localhost'), f.agent); });
  await new Promise<void>(resolve => http.listen(0, '127.0.0.1', resolve));
  const address = http.address() as { port: number };
  const server = createMappingMcpServer(`http://127.0.0.1:${address.port}`), client = new Client({ name: 'diff-tree-test', version: '1' });
  const [a, b] = InMemoryTransport.createLinkedPair();
  try {
    await Promise.all([server.connect(a), client.connect(b)]);
    const tools = (await client.listTools()).tools;
    expect(tools.find(t => t.name === 'create_diagram_change_session')!.inputSchema.properties).toHaveProperty('diffTree');
    expect(tools.some(t => t.name === 'read_change_session_diff_tree')).toBe(true);
    const call = async (name: string, args: any) => {
      const response = await client.callTool({ name, arguments: args });
      expect(response.isError, JSON.stringify(response)).toBeFalsy(); return JSON.parse((response.content as any)[0].text);
    };
    const created = await call('create_diagram_change_session', f.request), id = created.changeSessionId;
    expect(created.diffTree).toMatchObject({ nodeCount: 4, mappingCount: 2, hunkCount: 4 });
    expect(await call('create_diagram_change_session', f.request)).toEqual(created);
    const read = await call('read_change_session_diff_tree', { changeSessionId: id });
    expect(read.diffTree.diagram.content.ascii).toBe(f.tree.ascii);
    const node = read.diffTree.nodes.find((n: any) => n.label === 'Detail');
    const selected = await call('read_change_session_diff_tree', { changeSessionId: id, nodeIds: [node.id], limit: 1 });
    expect(selected.total).toBe(2); expect(selected.hunks).toHaveLength(1); expect(selected.nextOffset).toBe(1);
    expect(selected.hunks[0].path).toBe('a.ts'); expect(selected.unmappedNodeIds).toEqual([]);
    const before = await f.manifest(id);
    const update = { changeSessionId: id, expectedVersion: 0, requestId: 'replace', diffTree: { ...f.tree,
      expectedRevisionId: read.diffTree.revisionId, ascii: f.tree.ascii.replace('Logic', 'Implementation') } };
    const updated = await call('update_diagram_change_session', update);
    expect(updated.version).toBe(1); expect(updated.diffTree.diagramId).toBe(created.diffTree.diagramId);
    expect(updated.diffTree.revisionId).not.toBe(created.diffTree.revisionId);
    expect((await f.manifest(id)).documents).toEqual(before.documents);
    const fresh = new ChangeSessionService(new DiagramChangeSessionStore(f.store.storeRoot), f.store, f.agent.bridge);
    expect(await fresh.update(updateChangeSessionSchema.parse(update))).toEqual(updated);
    await expect(fresh.update({ ...update, requestId: 'stale' } as any)).rejects.toThrow('VERSION_CONFLICT');
    const invalid = { changeSessionId: id, expectedVersion: 1, requestId: 'invalid', diffTree: {
      ascii: 'Changed tree\n`-- Child', expectedRevisionId: updated.diffTree.revisionId,
      mappings: [{ id: 'bad', source: { line: 1 }, targets: [{ kind: 'diff-hunk', hunkId: 'missing' }] }] } };
    const savedManifest = await f.manifest(id);
    await expect(fresh.update(invalid as any)).rejects.toThrow('Unknown DiffTree hunk');
    expect(await f.manifest(id)).toEqual(savedManifest);
    const mappingOnly = { changeSessionId: id, expectedVersion: 1, requestId: 'clear', diffTree: { expectedRevisionId: updated.diffTree.revisionId, mappings: [] } };
    const cleared = await fresh.update(mappingOnly);
    expect(cleared.diffTree?.revisionId).toBe(updated.diffTree.revisionId); expect(cleared.diffTree?.mappingCount).toBe(0);
    expect((await fresh.get(id)).documents[0].version).toBe(0);
  } finally { await client.close(); await server.close(); await new Promise<void>(resolve => http.close(() => resolve())); f.agent.dispose(); }
}, 30000);

it('persists tree/hunks separately, reads them without canvases or Git, and preserves them through undo and acceptance', async () => {
  const f = await setup(true);
  try {
    const created = await f.tool('create_diagram_change_session', f.request), id = created.changeSessionId;
    const original = await f.manifest(id);
    const rawTree = JSON.parse(await readFile(path.join(f.store.storeRoot, 'change-session-records', `${original.diffTree}.json`), 'utf8'));
    expect(rawTree.revision.diagram.$diagramRecord).toBe('diagram');
    expect(original.summary.diffTree).not.toHaveProperty('hunks');
    const docId = created.documents[0].documentId;
    await f.changes.apply(id, docId, 0, [{ method: 'patchDiagram', nodeId: 'grid:overview', start: 1, end: 1, patch: 'Changed' }], 'edit');
    await f.changes.update({ changeSessionId: id, expectedVersion: 1, requestId: 'undo', action: 'undo', documentId: docId });
    expect((await f.manifest(id)).diffTree).toBe(original.diffTree);
    await f.changes.update({ changeSessionId: id, expectedVersion: 2, requestId: 'redo', action: 'redo', documentId: docId });
    await f.changes.update({ changeSessionId: id, expectedVersion: 3, requestId: 'ready', status: 'ready' });
    await f.changes.accept({ changeSessionId: id, expectedVersion: 4, requestId: 'accept' });
    await expect(f.changes.update({ changeSessionId: id, expectedVersion: 5, requestId: 'frozen', diffTree: { expectedRevisionId: created.diffTree.revisionId, mappings: [] } })).rejects.toThrow('accepted');
    expect((await f.manifest(id)).diffTree).toBe(original.diffTree);
    await rename(path.join(f.root, '.git'), path.join(f.root, 'git-offline'));
    const manifest = await f.manifest(id);
    await rm(path.join(f.store.storeRoot, 'change-session-records', `${manifest.documents[docId]}.json`));
    const fresh = new ChangeSessionService(new DiagramChangeSessionStore(f.store.storeRoot, undefined, true), f.store, f.agent.bridge);
    const read = await fresh.readDiffTree({ changeSessionId: id, offset: 0, limit: 100, includePatches: true });
    expect(read.status).toBe('accepted'); expect(read.hunks).toEqual(f.discovered.hunks);
    expect((await fresh.list())[0].diffTree?.hunkCount).toBe(4);
    await expect(new DiagramChangeSessionStore(f.store.storeRoot).read(f.project.id, id)).rejects.toThrow();
  } finally { f.agent.dispose(); }
}, 30000);

it('creates a default tree, supports mapping by logical node ID, and retains legacy sessions without fabricating a tree', async () => {
  const f = await setup(true);
  try {
    const { diffTree: _, ...request } = f.request;
    const created = await f.tool('create_diagram_change_session', request), id = created.changeSessionId;
    const read = await f.tool('read_change_session_diff_tree', { changeSessionId: id });
    expect(read.diffTree.nodes.map((n: any) => n.label)).toEqual(['Changes', f.head.slice(0, 12)]);
    await f.tool('update_diagram_change_session', { changeSessionId: id, expectedVersion: 0, requestId: 'nodes', diffTree: {
      expectedRevisionId: read.diffTree.revisionId, mappings: [{ id: 'root', source: { nodeId: read.diffTree.nodes[0].id }, targets: [{ kind: 'diff-hunk', hunkId: read.hunks[0].id }] }] } });
    const edited = await f.tool('read_change_session_diff_tree', { changeSessionId: id, nodeIds: [read.diffTree.nodes[0].id] });
    expect(edited.total).toBe(1);
    // Old records have no tree pointer or summary; they remain readable.
    const manifest = await f.manifest(id); delete manifest.diffTree; delete manifest.summary.diffTree;
    await writeFile(path.join(f.store.storeRoot, 'mapping-change-sessions', f.project.id, `${id}.manifest.json`), JSON.stringify(manifest));
    expect((await f.tool('read_change_session_diff_tree', { changeSessionId: id })).diffTree).toBeNull();
    await f.tool('update_diagram_change_session', { changeSessionId: id, expectedVersion: 1, requestId: 'initialize-old', diffTree: f.tree });
    expect((await f.tool('read_change_session_diff_tree', { changeSessionId: id })).diffTree.diagram.content.ascii).toBe(f.tree.ascii);
  } finally { f.agent.dispose(); }
}, 30000);

it('captures literal paths and merge commits against their first parent, ignoring the worktree and omitted commits', async () => {
  const f = await setup();
  try {
    const main = git(f.root, 'branch', '--show-current');
    git(f.root, 'checkout', '-qb', 'side');
    const file = 'literal[1].txt';
    await writeFile(path.join(f.root, file), 'side change\n');
    const side = commit(f.root, 'side');
    git(f.root, 'checkout', '-q', main);
    await writeFile(path.join(f.root, 'main.txt'), 'main change\n');
    const firstParent = commit(f.root, 'main');
    git(f.root, '-c', 'user.name=Test', '-c', 'user.email=test@example.test', 'merge', '--no-ff', '-qm', 'merge', 'side');
    const merge = git(f.root, 'rev-parse', 'HEAD');
    await writeFile(path.join(f.root, file), 'uncommitted content\n');
    const result = await f.tool('get_repository_diff_hunks', { repositoryId: f.repositoryId, commits: [f.base, merge] });
    const merged = result.hunks.filter((h: any) => h.commit === merge);
    expect(merged).toHaveLength(1); expect(merged[0]).toMatchObject({ path: file, parent: firstParent });
    expect(merged[0].patch).toContain('+side change'); expect(merged[0].patch).not.toContain('uncommitted');
    expect(result.hunks.some((h: any) => h.commit === side || h.commit === firstParent)).toBe(false);
    const metadata = await f.tool('get_repository_diff_hunks', { repositoryId: f.repositoryId, commits: [merge], includePatches: false });
    expect(metadata.hunks[0].id).toBe(merged[0].id);
    const empty = await f.tool('get_repository_diff_hunks', { repositoryId: f.repositoryId });
    expect(empty.hunks).toEqual([]);
  } finally { f.agent.dispose(); }
}, 30000);

it('persists explicit diagram destinations without replacing hunk mappings or ASCII', async () => {
  const f = await setup();
  try {
    const created = await f.tool('create_diagram_change_session', f.request);
    const before = await f.tool('read_change_session_diff_tree', { changeSessionId: created.changeSessionId });
    const target = { representationId: created.documents[0].documentId, displayNodeId: 'grid:overview' };
    const mappings = [...f.tree.mappings, { id: 'navigate', source: { line: 2 }, targets: [], diagramTargets: [target] }];
    await f.tool('update_diagram_change_session', { changeSessionId: created.changeSessionId, expectedVersion: 0, requestId: 'destinations',
      diffTree: { expectedRevisionId: before.diffTree.revisionId, mappings } });
    const fresh = new ChangeSessionService(new DiagramChangeSessionStore(f.store.storeRoot), f.store, f.agent.bridge);
    const read = await fresh.readDiffTree({ changeSessionId: created.changeSessionId, offset: 0, limit: 100, includePatches: true });
    expect(read.diffTree?.revisionId).toBe(before.diffTree.revisionId);
    expect(read.diffTree?.mappings.at(-1)?.diagramTargets).toEqual([target]);
    expect(read.hunks).toEqual(before.hunks);
    expect(read.documents.map(doc => doc.id)).toContain(target.representationId);
    await expect(f.tool('update_diagram_change_session', { changeSessionId: created.changeSessionId, expectedVersion: 1, requestId: 'empty-target',
      diffTree: { expectedRevisionId: before.diffTree.revisionId, mappings: [{ id: 'empty', source: { line: 2 }, targets: [] }] } })).rejects.toThrow();
  } finally { f.agent.dispose(); }
});

it('reads treemaps from pinned snapshots without full histories, generation, or live Git capture', async () => {
  const f = await setup();
  const created = await f.tool('create_diagram_change_session', f.request), id = created.changeSessionId;
  const readFull = vi.spyOn(f.records, 'read').mockRejectedValue(Error('Full history read is not allowed'));
  const capture = vi.spyOn(f.store.repositories!, 'captureHunks').mockRejectedValue(Error('Live Git capture is not allowed'));
  const preview = vi.spyOn(f.records, 'readPreview');
  const first = await f.changes.readTreemaps(id);
  expect(first).toMatchObject({ id, version: 0, actual: 5, mapped: 0, unmapped: 5, extra: 0, nonTextHunks: 1 });
  expect(first?.files.hunkIds).toHaveLength(4);
  expect(first).not.toHaveProperty('documents'); expect(first).not.toHaveProperty('receipts');
  preview.mockClear();
  expect(await f.changes.readTreemaps(id, 0)).toBeNull();
  expect(preview).not.toHaveBeenCalled(); expect(readFull).not.toHaveBeenCalled(); expect(capture).not.toHaveBeenCalled();
  const http = createServer((req, res) => { void handleAgentRoutes(req, res, new URL(req.url!, 'http://localhost'), f.agent); });
  await new Promise<void>(resolve => http.listen(0, '127.0.0.1', resolve));
  const url = `http://127.0.0.1:${(http.address() as { port: number }).port}/api/mapping/agent/change-sessions/${id}/treemaps`;
  try {
    const response = await fetch(url); expect(response.status).toBe(200); expect(response.headers.get('cache-control')).toBe('no-store');
    expect(await response.json()).toMatchObject({ actual: 5, extra: 0 });
    expect(await (await fetch(`${url}?version=0`)).json()).toBeNull();
    expect((await fetch(`${url}?version=-1`)).status).toBe(400);
    const snapshot = await f.records.readPreview(f.project.id, id, created.documents[0].documentId);
    preview.mockResolvedValueOnce({ ...snapshot, version: snapshot.version + 1 });
    await expect(f.changes.readTreemaps(id)).rejects.toThrow('VERSION_CONFLICT');
  } finally { await new Promise<void>(resolve => http.close(() => resolve())); }
});
