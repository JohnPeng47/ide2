import { createHash } from 'node:crypto';
import { connectionIdSchema, pushEventSchema, repositoryConnectionSchema, type PushGeneration } from '../../../domain/core/integrations/pushIntegration';
import type { PushIntegrationStore, PushSource, PushWorkflow } from './ports';
import { decodeArtifactsPush } from './artifactsPush';

export class PushIntegrationService {
  private readonly pending = new Map<string, Promise<PushGeneration>>();
  constructor(private readonly store: PushIntegrationStore, private readonly source: PushSource,
    private readonly workflow: PushWorkflow, private readonly enabled: boolean) {}

  connections() { return this.store.connections(); }
  async connect(raw: unknown) {
    const connection = repositoryConnectionSchema.parse(raw);
    const prior = await this.store.connection(connection.id);
    if (prior && (prior.repositoryId !== connection.repositoryId || JSON.stringify(prior.external) !== JSON.stringify(connection.external))) {
      throw Error('Connection identity is immutable; use a new connection ID for another repository');
    }
    await this.source.validateConnection(connection);
    await this.store.saveConnection(connection);
    return connection;
  }
  async receive(connectionId: string, raw: unknown, format: 'generic' | 'artifacts' = 'generic') {
    connectionIdSchema.parse(connectionId);
    const connection = await this.store.connection(connectionId);
    if (!connection) throw Error('Unknown repository connection');
    const event = format === 'artifacts' ? decodeArtifactsPush(connection, raw) : pushEventSchema.parse(raw);
    const id = `push-${createHash('sha256').update(JSON.stringify([connectionId, event.eventId])).digest('hex').slice(0, 32)}`;
    const check = (generation: PushGeneration) => {
      if (JSON.stringify(generation.event) !== JSON.stringify(event)) throw Error('PUSH_EVENT_ID_CONFLICT');
      return generation;
    };
    const pending = this.pending.get(id);
    if (pending) return check(await pending);
    const prior = await this.store.generation(id);
    if (prior) return check((await this.get(id))!);
    if (!connection.enabled) throw Error('Repository connection is disabled');
    if (!this.enabled) throw Error('Start the application with --pi to enable push generation');
    const execute = async () => {
      const now = new Date().toISOString();
      const generation: PushGeneration = { id, connectionId, repositoryId: connection.repositoryId, event,
        commits: [], status: 'resolving', createdAt: now, updatedAt: now };
      if (!await this.store.createGeneration(generation)) return check((await this.get(id))!);
      try {
        if (!event.ref.startsWith('refs/heads/')) {
          generation.status = 'skipped';
          generation.reason = 'Only branch pushes generate DiffSessions';
        } else if (event.after === null) {
          generation.kind = 'delete';
          generation.status = 'skipped';
          generation.reason = 'Branch deleted';
        } else if (event.before === event.after) {
          generation.kind = 'unchanged';
          generation.status = 'skipped';
          generation.reason = 'Ref did not change';
        } else {
          const resolved = await this.source.resolve(connection, event);
          generation.kind = resolved.kind;
          generation.commits = resolved.commits;
          if (!resolved.hasChanges) {
            generation.status = 'skipped';
            generation.reason = 'Push has no net content changes';
          } else {
            const run = await this.workflow.start({ requestId: id, title: `Push ${event.ref.slice(11, 100)} @ ${event.after.slice(0, 12)}`,
              repositoryId: connection.repositoryId, commits: resolved.commits, head: event.after,
              comparisonBase: event.before, ...(connection.canvasId ? { canvasId: connection.canvasId } : {}) });
            generation.workflowRunId = run.id;
            generation.status = run.status;
            generation.changeSessionId = run.changeSessionId;
            generation.error = run.error;
          }
        }
      } catch (error) {
        generation.status = 'failed';
        generation.error = error instanceof Error ? error.message : String(error);
      }
      generation.updatedAt = new Date().toISOString();
      await this.store.saveGeneration(generation);
      return generation;
    };
    // Recheck after the asynchronous reads: simultaneous deliveries must share execution.
    const racing = this.pending.get(id);
    if (racing) return check(await racing);
    const started = execute();
    this.pending.set(id, started);
    try { return await started; } finally { this.pending.delete(id); }
  }
  async get(id: string) {
    const generation = await this.store.generation(id);
    if (!generation?.workflowRunId || generation.status !== 'running') return generation;
    const run = await this.workflow.get(generation.workflowRunId);
    if (!run) return generation;
    const next = { ...generation, status: run.status, changeSessionId: run.changeSessionId, error: run.error };
    if (JSON.stringify(next) !== JSON.stringify(generation)) {
      next.updatedAt = new Date().toISOString();
      await this.store.saveGeneration(next);
    }
    return next;
  }
  async generations(connectionId?: string) {
    if (connectionId) connectionIdSchema.parse(connectionId);
    const generations = await this.store.generations(connectionId);
    return Promise.all(generations.map(async generation => (await this.get(generation.id))!));
  }
}
