import { createServer, type Server } from 'node:http';
import { execFileSync } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { expect, it, vi } from 'vitest';
import { DiagramStore } from '../../persistence/store';
import { GitPushSource } from '../gitPushSource';
import { FilePushIntegrationStore } from '../pushIntegrationStore';
import { PushIntegrationService } from '../../../../application/core/integrations/pushIntegrationService';
import { handlePushIntegration } from '../../../../src/server/routes/mapping/integrations/pushIntegrationRoutes';
import { DiagramChangeSessionStore } from '../../../mapping/changes/diagramChangeSessionStore';
import { ChangeSessionService } from '../../../../application/mapping/changes/changeSessionService';
import { AgentDiagrammingSessionService } from '../../../../application/mapping/agent/sessionService';
import { DiffSessionWorkflowService } from '../../../../application/mapping/changes/diffSessionWorkflowService';
import type { DiffSessionRuntime } from '../../../../application/mapping/changes/diffSessionWorkflow';
import { QuickJsAgentRuntime } from '../../../mapping/agent/execRuntime';
import { FileDiffSessionRunStore, createDiffSessionSourceReader } from '../../../mapping/agents/diff-session-create/diffSessionStorage';
import { CanvasSessionBridge } from '../../../mapping/agent/canvasSessionBridge';
import type { MappingDiagramService } from '../../../../application/mapping/diagrams/diagramService';
import { canvasSaveFixture, singleDiagramScene } from '../../../../tests/support/mappingDiagram';
import worker from '../../../../deploy/artifacts-push/worker';

it('forwards an Artifacts push over HTTP through both workflow turns into one ready, persisted DiffSession', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'push-http-'));
  let server: Server | undefined;
  let workflow: DiffSessionWorkflowService | undefined;
  let agent: AgentDiagrammingSessionService | undefined;
  const bridge = new CanvasSessionBridge();
  try {
    const git = (...args: string[]) => execFileSync('git', ['-C', root, ...args], { encoding: 'utf8' }).trim();
    git('init', '-q', '-b', 'main');
    const commit = async (value: string) => {
      await writeFile(path.join(root, 'app.txt'), `${value}\n`); git('add', 'app.txt');
      git('-c', 'user.name=Test', '-c', 'user.email=test@example.com', 'commit', '-qm', value);
      return git('rev-parse', 'HEAD');
    };
    const before = await commit('Before'), middle = await commit('Middle'), after = await commit('After');
    const store = new DiagramStore(root, path.join(root, 'data'));
    const project = await store.ensureProject({ checkoutRoot: root, repositoryIdentity: '' });
    const repositoryId = project.repositories![0].id;
    const baseline = await store.projectCatalogs.saveMappingDiagram(project.id,
      canvasSaveFixture({ name: 'App', scene: singleDiagramScene('Before') }));
    const changes = new ChangeSessionService(new DiagramChangeSessionStore(store.storeRoot), store, bridge);
    agent = new AgentDiagrammingSessionService(bridge, {} as MappingDiagramService, store, new QuickJsAgentRuntime(), changes);
    const turns: string[] = [];
    // Only model output is controlled. Git, HTTP, storage, proposal tools,
    // version checks, completion validation and workflow sequencing are real.
    const runtime: DiffSessionRuntime = { dispose() {}, async openSession(input) {
      return { sessionId: 'test-agent', dispose() {}, transcript: () => turns,
        async runStep(request) {
          turns.push(request.stepId);
          if (request.stepId === 'analyze') {
            expect(request.prompt).toContain(before);
            expect(request.prompt).toContain(middle);
            expect(request.prompt).toContain(after);
            return { text: 'Replace Before with After.' };
          }
          const call = async (name: string, args: unknown) => input.tools('materialize').find(tool => tool.name === name)!.execute(args);
          const created = await call('create_diagram_change_session', {}) as { changeSessionId: string; canvasId: string; documents: { documentId: string }[] };
          const attached = await call('exec', { requestId: 'attach', code: `return canvas.attach({ canvasId: ${JSON.stringify(created.canvasId)}, documentId: ${JSON.stringify(created.documents[0].documentId)} });` }) as { value: { sessionId: string } };
          await call('exec', { requestId: 'edit', sessionId: attached.value.sessionId, expectedVersion: 0,
            code: 'return nodes.patchDiagram({nodeId: "grid:overview", start: 1, end: 1, patch: "After"});' });
          const session = await changes.get(created.changeSessionId);
          await call('update_diagram_change_session', { changeSessionId: created.changeSessionId, requestId: 'ready', expectedVersion: session.version, status: 'ready' });
          await call('complete_diff_session', {});
          return { text: 'Created', changeSessionId: created.changeSessionId };
        }
      };
    } };
    workflow = new DiffSessionWorkflowService(changes, agent, runtime, new FileDiffSessionRunStore(store.storeRoot),
      { enabled: true, sourceRoot: root, loadPrompts: async () => ({ analyze: 'Analyze', materialize: 'Create' }),
        sourceReader: capture => createDiffSessionSourceReader(store.repositories, capture) });
    const service = new PushIntegrationService(new FilePushIntegrationStore(store.storeRoot), new GitPushSource(store.repositories), workflow, true);
    const token = 'test-integration-token';
    server = createServer((request, response) => {
      void handlePushIntegration(request, response, new URL(request.url!, 'http://localhost'), service, token).catch(error => {
        response.statusCode = 400; response.end(JSON.stringify({ error: error.message }));
      });
    });
    await new Promise<void>(resolve => server!.listen(0, '127.0.0.1', resolve));
    const address = server.address() as { port: number };
    const base = `http://127.0.0.1:${address.port}/api/mapping/integrations`;
    expect((await fetch(`${base}/connections`)).status).toBe(401);
    const headers = { authorization: `Bearer ${token}`, 'content-type': 'application/json' };
    const accountId = 'a'.repeat(32);
    const connected = await fetch(`${base}/connections/test`, { method: 'PUT', headers, body: JSON.stringify({ repositoryId,
      external: { provider: 'artifacts', accountId, namespace: 'default', repoName: 'example' },
      remoteUrl: `https://${accountId}.artifacts.cloudflare.net/git/default/example.git` }) });
    expect(connected.status).toBe(200);
    const event = { type: 'cf.artifacts.repo.pushed', source: { type: 'artifacts.repo', namespace: 'default', repoName: 'example' },
      payload: { ref: 'refs/heads/main', before, after, commits: [{ id: after }], commitsTruncated: true, totalCommitsCount: 2 },
      metadata: { accountId, eventSchemaVersion: 1, eventTimestamp: '2026-10-14T01:02:03Z' } };
    const ack = vi.fn();
    await worker.queue({ messages: [{ body: event, ack, retry() {} }, { body: event, ack, retry() {} }] },
      { PUSH_ENDPOINT: `${base}/connections/test/artifacts`, PUSH_TOKEN: token });
    expect(ack).toHaveBeenCalledTimes(2);
    await vi.waitFor(async () => {
      const runs = await service.generations();
      expect(runs).toHaveLength(1);
      expect(runs[0].error).toBeUndefined();
      expect(runs[0]).toMatchObject({ status: 'completed', commits: [middle, after] });
    }, { timeout: 10000 });
    const [generation] = await (await fetch(`${base}/pushes`, { headers })).json();
    const proposal = await changes.get(generation.changeSessionId);
    expect(proposal).toMatchObject({ status: 'ready', commits: [middle, after], head: after, comparisonBase: before });
    expect(proposal.diffTree!.hunks[0].patch).toContain('-Before\n+After');
    expect(turns).toEqual(['analyze', 'materialize']);
    expect(await changes.list()).toHaveLength(1);
    const catalog = await store.projectCatalogs.loadRepresentationCatalog(project.id);
    expect(catalog.representations[baseline.representation.id].currentRevisionId).toBe(baseline.representation.currentRevisionId);
    const reopened = await new DiagramChangeSessionStore(store.storeRoot).read(project.id, proposal.id);
    expect(reopened.comparisonBase).toBe(before);
    expect((await changes.capture({ baselineChangeSessionId: proposal.id })).context?.comparisonBase).toBe(before);
  } finally {
    if (server) { server.closeAllConnections(); await new Promise<void>(resolve => server!.close(() => resolve())); }
    workflow?.dispose(); agent?.dispose(); bridge.dispose();
    await rm(root, { recursive: true, force: true });
  }
}, 20000);
