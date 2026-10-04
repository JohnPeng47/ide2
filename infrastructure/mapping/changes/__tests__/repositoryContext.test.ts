import { mkdtemp, mkdir, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { expect, it } from 'vitest';
import { DiagramStore } from '../../../core/persistence/store';
import { DiagramChangeSessionStore } from '../diagramChangeSessionStore';
import { ChangeSessionService } from '../../../../application/mapping/changes/changeSessionService';
import { AgentDiagrammingSessionService } from '../../../../application/mapping/agent/sessionService';
import { QuickJsAgentRuntime } from '../../agent/execRuntime';
import type { CanvasSessionPort } from '../../../../application/mapping/agent/ports';
import type { MappingDiagramService } from '../../../../application/mapping/diagrams/diagramService';
import { canvasSaveFixture } from '../../../../tests/support/mappingDiagram';
import { singleDiagramScene } from '../../../../domain/core/diagrams/projectDiagramCanvas';
import { initialCanvasState } from '../../../../domain/mapping/workspace/mappingWorkspace';
import { mappingDocumentFromScene } from '../../../../domain/mapping/workspace/mappingDocument';
import type { CanvasDescriptor } from '../../../../domain/mapping/agent/contracts';

const git = (root: string, ...args: string[]) => execFileSync('git', ['-C', root, ...args], { encoding: 'utf8' }).trim();
const commit = (root: string, message: string) => { git(root, '-c', 'user.name=Test', '-c', 'user.email=test@example.test', 'commit', '--allow-empty', '-qm', message); return git(root, 'rev-parse', 'HEAD'); };

it('registers worktrees once, scopes captured canvases and preserves repository ownership and pinned commit context through acceptance', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'repository-context-'));
  try {
    const a = path.join(root, 'alpha'), b = path.join(root, 'beta'), worktree = path.join(root, 'alpha-worktree');
    await mkdir(a); await mkdir(b); git(a, 'init', '-q'); git(b, 'init', '-q');
    const first = commit(a, 'first'), middle = commit(a, 'middle'), head = commit(a, 'head'); commit(b, 'other repo');
    const store = new DiagramStore(a), project = await store.ensureProject({ checkoutRoot: a, repositoryIdentity: '' });
    const alpha = project.repositories![0];
    const old = await store.projectCatalogs.saveMappingDiagram(project.id, canvasSaveFixture({ name: 'Alpha canvas', scene: singleDiagramScene('Alpha') }));
    expect(old.representation.repositoryId).toBe(alpha.id);
    const live: CanvasDescriptor[] = [], captures: string[] = [];
    const bridge: CanvasSessionPort = { register() {}, list: () => live, poll: async () => [], reply() {}, unregister() {}, dispose() {}, dispatch: async (_canvasId, command) => {
      if (command.method !== 'snapshot' || command.documentId !== 'draft-alpha') throw Error('Captured another repository draft');
      captures.push(command.documentId);
      return { name: 'Alpha draft', repositoryId: alpha.id, version: 0,
        document: mappingDocumentFromScene(singleDiagramScene('Unsaved alpha')), canvas: initialCanvasState() };
    } };
    const changes = new ChangeSessionService(new DiagramChangeSessionStore(store.storeRoot), store, bridge);
    const diagrams = { initialize: async () => ({ project: await store.loadProject(), catalog: await store.projectCatalogs.loadRepresentationCatalog(project.id) }) } as unknown as MappingDiagramService;
    const agent = new AgentDiagrammingSessionService(bridge, diagrams, store, new QuickJsAgentRuntime(), changes);
    const beta = await agent.call('register_repository', { path: b, name: 'Beta', requestId: 'register-beta' }) as any;
    git(a, 'worktree', 'add', '-q', '--detach', worktree, head);
    const linked = await agent.call('register_repository', { path: worktree, requestId: 'register-worktree' }) as any;
    expect(linked.id).toBe(alpha.id); expect(linked.checkoutRoots).toEqual([a, worktree]);
    expect(await agent.call('list_repositories', {})).toHaveLength(2);
    const other = await store.projectCatalogs.saveMappingDiagram(project.id, { ...canvasSaveFixture({ name: 'Beta canvas', scene: singleDiagramScene('Beta') }), repositoryId: beta.id });
    await expect(store.projectCatalogs.saveMappingDiagram(project.id, canvasSaveFixture({ name: 'Ambiguous', scene: singleDiagramScene('Unknown') }))).rejects.toThrow('Specify repositoryId');
    await expect(agent.call('create_diagram_change_session', { title: 'Ambiguous', requestId: 'ambiguous' })).rejects.toThrow('repositoryId');
    await expect(agent.call('create_diagram_change_session', { title: 'Bad commit', repositoryId: alpha.id, commits: ['missing'], requestId: 'bad' })).rejects.toThrow('Unknown commit');
    live.push({ canvasId: 'live-workspace', projectId: project.id, documents: [
      { documentId: 'draft-alpha', name: 'Alpha draft', repositoryId: alpha.id },
      { documentId: 'draft-beta', name: 'Beta draft', repositoryId: beta.id }
    ] });
    const request = { title: 'Selected changes', repositoryId: alpha.id, commits: [first, 'HEAD', first], requestId: 'create' };
    const created = await agent.call('create_diagram_change_session', request) as any;
    expect(created).toMatchObject({ repositoryId: alpha.id, commits: [first, head], head });
    expect(created.commits).not.toContain(middle);
    expect(created.documents.map((d: any) => d.documentId)).toEqual([old.representation.id, 'draft-alpha']);
    expect(captures).toEqual(['draft-alpha']);
    commit(a, 'after capture');
    expect(await agent.call('create_diagram_change_session', request)).toEqual(created);
    const reopened = new ChangeSessionService(new DiagramChangeSessionStore(store.storeRoot), store, bridge);
    expect((await reopened.list())[0]).toMatchObject({ repositoryId: alpha.id, commits: [first, head], head });
    const read = await agent.call('diagram-search', { changeSessionId: created.changeSessionId, operation: 'search' }) as any;
    expect(read.changeSession).toMatchObject({ repositoryId: alpha.id, commits: [first, head], head });
    const fresh = await changes.createDocument(created.changeSessionId, 'New alpha canvas', 'new-canvas');
    let session = await changes.get(created.changeSessionId);
    expect(session.documents.find(doc => doc.id === fresh.documentId)?.repositoryId).toBe(alpha.id);
    await changes.update({ changeSessionId: session.id, expectedVersion: session.version, requestId: 'ready', status: 'ready' });
    session = await changes.get(session.id);
    await changes.accept({ changeSessionId: session.id, expectedVersion: session.version, requestId: 'accept' });
    const accepted = await reopened.get(session.id);
    expect(accepted).toMatchObject({ repositoryId: alpha.id, commits: [first, head], head, status: 'accepted' });
    const catalog = await store.projectCatalogs.loadRepresentationCatalog(project.id);
    const published = accepted.acceptance!.documents.find(doc => doc.documentId === fresh.documentId)!;
    expect(catalog.representations[published.representationId].repositoryId).toBe(alpha.id);
    expect(catalog.representations[other.representation.id].currentRevisionId).toBe(other.representation.currentRevisionId);
    expect(JSON.parse(await readFile(path.join(store.storeRoot, 'project.json'), 'utf8')).repositories).toHaveLength(2);
    agent.dispose();
  } finally { await rm(root, { recursive: true, force: true }); }
}, 30000);
