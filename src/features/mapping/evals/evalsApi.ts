import type { EvalPrompt, SaveEvalPrompt } from '../../../../domain/mapping/evals/evalPrompt';
import type { EvalRunRequest, EvalRunSummary } from '../../../../domain/mapping/evals/evalRun';
import type { GeneratedCanvasRecord } from '../../../../domain/core/diagrams/generatedCanvas';
import type { ProjectRepresentationRecord } from '../../../../domain/core/representations/projectCatalog';

const base = `${import.meta.env.BASE_URL}api/mapping/evals`;
async function request<T>(path: string, body?: unknown, method?: 'DELETE'): Promise<T> {
  const response = await fetch(base + path, method ? { method } : body === undefined ? undefined : { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  const value = await response.json().catch(() => ({}));
  if (!response.ok) throw Error(value.error ?? `Evals request failed (${response.status})`);
  return value;
}
export const listPrompts = () => request<EvalPrompt[]>('/prompts');
export const readPrompt = (id: string) => request<EvalPrompt>(`/prompts/${encodeURIComponent(id)}`);
export const savePrompt = (input: SaveEvalPrompt) => request<EvalPrompt>('/prompts', input);
export const archivePrompt = (id: string, archived: boolean) => request<EvalPrompt>(`/prompts/${encodeURIComponent(id)}/archive`, { archived });
export const listRuns = () => request<EvalRunSummary[]>('/runs');
export const readRun = (id: string) => request<EvalRunSummary>(`/runs/${encodeURIComponent(id)}`);
export const startRun = (input: Partial<EvalRunRequest> & Pick<EvalRunRequest, 'requestId' | 'workflow' | 'prompts' | 'inputs'>) => request<EvalRunSummary>('/runs', input);
export const rerunChat = (id: string, requestId: string) => request<EvalRunSummary>(`/runs/${encodeURIComponent(id)}/rerun-chat`, { requestId });
export const renameRun = (id: string, name: string) => request<EvalRunSummary>(`/runs/${encodeURIComponent(id)}/rename`, { name });
export const cancelRun = (id: string) => request<{ cancelled: true }>(`/runs/${encodeURIComponent(id)}/cancel`, {});
export const listGenerated = () => request<ProjectRepresentationRecord[]>('/canvases');
export const readGenerated = (id: string, checkpointId?: string) => request<GeneratedCanvasRecord>(`/canvases/${encodeURIComponent(id)}${checkpointId ? `?checkpoint=${encodeURIComponent(checkpointId)}` : ''}`);
export const migrateGenerated = () => request<{ migrated: number }>('/migrate', {});
export type AgentContextSummary = ReturnType<typeof import('../../../../domain/core/agents/savedAgentContext').summarizeAgentContext>;
export const listContexts = async (query = '') => {
  const items: AgentContextSummary[] = []; let offset = 0;
  for (;;) {
    const page = await request<{ items: AgentContextSummary[]; nextOffset: number | null }>(`/contexts?${new URLSearchParams({ query, offset: String(offset) })}`);
    items.push(...page.items);
    if (page.nextOffset === null) return { items, nextOffset: null };
    offset = page.nextOffset;
  }
};
export const deleteRun = (id: string) => request<{ deleted: true }>(`/runs/${encodeURIComponent(id)}`, undefined, 'DELETE');
export const deleteGenerated = (id: string) => request<{ deleted: true }>(`/canvases/${encodeURIComponent(id)}`, undefined, 'DELETE');
export const deleteContextOutputs = (agentContextId: string, workflow: string) =>
  request<{ deleted: true }>(`/contexts/${encodeURIComponent(agentContextId)}/outputs?${new URLSearchParams({ workflow })}`, undefined, 'DELETE');
