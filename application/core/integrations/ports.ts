import type { PushEvent, PushGeneration, RepositoryConnection, ResolvedPush } from '../../../domain/core/integrations/pushIntegration';

export interface PushIntegrationStore {
  connections(): Promise<RepositoryConnection[]>;
  connection(id: string): Promise<RepositoryConnection | undefined>;
  saveConnection(connection: RepositoryConnection): Promise<void>;
  generations(connectionId?: string): Promise<PushGeneration[]>;
  generation(id: string): Promise<PushGeneration | undefined>;
  createGeneration(generation: PushGeneration): Promise<boolean>;
  saveGeneration(generation: PushGeneration): Promise<void>;
}
export interface PushSource {
  validateConnection(connection: RepositoryConnection): Promise<void>;
  resolve(connection: RepositoryConnection, event: PushEvent): Promise<ResolvedPush>;
}
export interface PushWorkflow {
  start(input: { requestId: string; title: string; repositoryId: string; commits: string[];
    head: string; comparisonBase: string | null; canvasId?: string }): Promise<PushWorkflowRun>;
  get(id: string): Promise<PushWorkflowRun | undefined>;
}
export interface PushWorkflowRun {
  id: string;
  status: 'running' | 'completed' | 'failed' | 'cancelled' | 'interrupted';
  changeSessionId?: string;
  error?: string;
}
