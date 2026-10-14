import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { pathToFileURL } from 'node:url';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { expect, it } from 'vitest';
import { DiagramChangeSessionStore } from '../diagramChangeSessionStore';
import { ChangeSessionService } from '../../../../application/mapping/changes/changeSessionService';
import { DiffSessionTools } from '../../../../application/mapping/changes/diffSessionTools';
import { AgentDiagrammingSessionService } from '../../../../application/mapping/agent/sessionService';
import { QuickJsAgentRuntime } from '../../agent/execRuntime';
import type { DiagramRepository } from '../../../../application/core/ports/diagramRepository';
import type { CanvasSessionPort } from '../../../../application/mapping/agent/ports';
import type { MappingDiagramService } from '../../../../application/mapping/diagrams/diagramService';

it('recreates Proposal 2 inputs from originals, isolates all writes, and replays creation without duplicating', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'diff-workflow-'));
  const projectId = 'project-4971c06b-83d5-49eb-998d-043d5fc2dca4';
  const originalId = 'change-055f3a0d4998baac78e013e4f7929bb9';
  try {
    const original = await new DiagramChangeSessionStore('.diagrams-local/canvas-domain-model').read(projectId, originalId);
    const repository = new DiagramChangeSessionStore(root, undefined, true); await repository.write(original);
    // Cold worker reads must also restore revision identities in the caller.
    const coldScript = path.join(root, 'cold-read.mjs');
    await writeFile(coldScript, `
      import { DiagramChangeSessionStore } from ${JSON.stringify(pathToFileURL(path.resolve('infrastructure/mapping/changes/diagramChangeSessionStore.ts')).href)};
      import { ChangeSessionService } from ${JSON.stringify(pathToFileURL(path.resolve('application/mapping/changes/changeSessionService.ts')).href)};
      const changes = new ChangeSessionService(new DiagramChangeSessionStore(${JSON.stringify(root)}, undefined, true),
        { loadProject: async () => ({ id: ${JSON.stringify(projectId)} }) }, { list: () => [] });
      const capture = await changes.capture({ baselineChangeSessionId: ${JSON.stringify(originalId)} });
      console.log(capture.documents.length);
    `);
    const cold = await promisify(execFile)(process.execPath, ['--import', 'tsx', coldScript]);
    expect(Number(cold.stdout.trim())).toBe(original.documents.filter(doc => doc.baseline).length);
    const source = { loadProject: async () => ({ id: projectId }) } as unknown as DiagramRepository;
    const bridge = { list: () => [], dispatch: async () => { throw Error('Live bridge must not be touched'); } } as unknown as CanvasSessionPort;
    const changes = new ChangeSessionService(repository, source, bridge);
    const capture = await changes.capture({ baselineChangeSessionId: originalId });
    expect(capture.hunks).toEqual(original.diffTree!.hunks);
    expect(capture.context).toEqual({ repositoryId: original.repositoryId, head: original.head, commits: original.commits });
    for (const doc of capture.documents) {
      const baseline = original.documents.find(before => before.id === doc.id)!.baseline;
      expect(doc.baseline).toEqual(baseline); expect(doc.proposed).toEqual(baseline);
      expect(doc.version).toBe(0); expect(doc.history!.past).toEqual([]);
    }
    const agent = new AgentDiagrammingSessionService(bridge, {} as MappingDiagramService, source, new QuickJsAgentRuntime(), changes);
    const tools = new DiffSessionTools(capture, changes, agent, async () => ({}), 'workflow-run', 'Regenerated', async () => {});
    const readHunks = (stage: 'analyze' | 'materialize', includePatches?: boolean) => tools.tools(stage)
      .find(tool => tool.name === 'get_repository_diff_hunks')!.execute({ repositoryId: original.repositoryId, commits: original.commits, limit: 1,
        ...(includePatches === undefined ? {} : { includePatches }) }) as Promise<any>;
    expect((await readHunks('analyze')).hunks[0]).toHaveProperty('patch');
    expect((await readHunks('materialize')).hunks[0]).not.toHaveProperty('patch');
    expect((await readHunks('materialize', true)).hunks[0]).toHaveProperty('patch');
    expect(tools.tools('analyze').map(tool => tool.name)).not.toContain('exec');
    const create = tools.tools('materialize').find(tool => tool.name === 'create_diagram_change_session')!;
    const result = await create.execute({}) as any;
    expect(await create.execute({})).toEqual(result);
    expect(result.changeSessionId).not.toBe(originalId);
    const execute = tools.tools('materialize').find(tool => tool.name === 'exec')!;
    await expect(execute.execute({ changeSessionId: originalId, requestId: 'wrong', code: 'return canvas.list();' })).rejects.toThrow('another ChangeSession');
    const doc = capture.documents[0];
    const attached = await execute.execute({ requestId: 'attach', code: `return canvas.attach({canvasId:${JSON.stringify(result.canvasId)},documentId:${JSON.stringify(doc.id)}});` }) as any;
    const node = 'grid:overview';
    await execute.execute({ requestId: 'edit', sessionId: attached.value.sessionId, expectedVersion: 0,
      code: `return nodes.patchDiagram({nodeId:${JSON.stringify(node)},start:1,end:1,patch:"Generated workflow test"});` });
    expect(await repository.read(projectId, originalId)).toEqual(original);
    expect((await changes.get(result.changeSessionId)).changes.length).toBeGreaterThan(0);
    expect((await changes.list())).toHaveLength(2);
    agent.dispose();
  } finally { await rm(root, { recursive: true, force: true }); }
}, 30000);
