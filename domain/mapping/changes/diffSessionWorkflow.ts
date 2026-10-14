export interface DiffSessionRun {
  id: string; workflowId: 'diff-session-create'; request: { requestId: string; title: string; baselineChangeSessionId?: string;
    repositoryId?: string; commits?: string[]; head?: string; canvasId?: string };
  status: 'running' | 'completed' | 'failed' | 'cancelled' | 'interrupted';
  stage: 'capture' | 'analyze' | 'materialize' | 'validate';
  model: { readonly preset: 'astra-high'; readonly modelId: 'gpt-6-astra'; readonly thinkingLevel: 'high' }; createdAt: string; updatedAt: string;
  agentSessionId?: string; changeSessionId?: string; message?: string; error?: string;
}
