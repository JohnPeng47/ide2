import type { GenerateReferences, ReferenceGenerationSession } from '../../../../domain/mapping/evals/referenceGeneration';
import type { EvalExperiment, SaveExperiment, RelaunchExperiment } from '../../../../domain/mapping/evals/experiment';
import type { EvalPrompt, SaveEvalPrompt } from '../../../../domain/mapping/evals/evalPrompt';
import type { EvalRunRequest, EvalRunSummary } from '../../../../domain/mapping/evals/evalRun';
import type { GeneratedCanvasRecord } from '../../../../domain/core/diagrams/generatedCanvas';
import type { ProjectRepresentationRecord } from '../../../../domain/core/representations/projectCatalog';
import type { CompareCanvasCopy, CompareSource } from '../../../../domain/mapping/compare/comparePageSession';
import type { EvalReference, EvalReferenceGroup } from '../../../../domain/mapping/evals/evalReference';
import type { Judgement, JudgementSummary } from '../../../../domain/mapping/evals/judgement';
import type { LayoutCapture, LayoutTemplate } from '../../../../domain/core/diagrams/layoutTemplate';

const base = `${import.meta.env.BASE_URL}api/mapping/evals`;
async function request<T>(path: string, body?: unknown, method?: 'DELETE' | 'PATCH'): Promise<T> {
  const json = (verb: string) => ({ method: verb, headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  const response = await fetch(base + path, method === 'PATCH' ? json('PATCH') : method ? { method } : body === undefined ? undefined : { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  const value = await response.json().catch(() => ({}));
  if (!response.ok) throw Error(value.error ?? `Evals request failed (${response.status})`);
  return value;
}
export const relaunchExperiment = (id: string, input: RelaunchExperiment) => request<{ experiment: EvalExperiment; runId: string }>(`/experiments/${encodeURIComponent(id)}/relaunch`, input);
export const listExperiments = () => request<EvalExperiment[]>('/experiments');
export const saveExperiment = (input: SaveExperiment) => request<EvalExperiment>('/experiments', input);
export const listPrompts = () => request<EvalPrompt[]>('/prompts');
export const listLayoutTemplates = () => request<LayoutTemplate[]>('/layout-templates');
export const captureLayoutTemplate = (source: CompareSource) => request<LayoutCapture>('/layout-templates/capture', source);
export const saveLayoutTemplate = (capture: LayoutCapture, name: string, requestId: string) => request<LayoutTemplate>('/layout-templates', { capture, name, requestId });
export const renameLayoutTemplate = (id: string, name: string) => request<LayoutTemplate>(`/layout-templates/${encodeURIComponent(id)}`, { name });
export const updateLayoutDescriptions = (id: string, descriptions: Record<string, string>) => request<LayoutTemplate>(`/layout-templates/${encodeURIComponent(id)}`, { descriptions });
export const deleteLayoutTemplate = (id: string) => request<{ deleted: true }>(`/layout-templates/${encodeURIComponent(id)}`, undefined, 'DELETE');
export const readPrompt = (id: string) => request<EvalPrompt>(`/prompts/${encodeURIComponent(id)}`);
export const savePrompt = (input: SaveEvalPrompt) => request<EvalPrompt>('/prompts', input);
export const archivePrompt = (id: string, archived: boolean) => request<EvalPrompt>(`/prompts/${encodeURIComponent(id)}/archive`, { archived });
export const listRuns = () => request<EvalRunSummary[]>('/runs');
export const listJudgements = () => request<JudgementSummary[]>('/judgements');
export const readJudgement = (id: string) => request<Judgement>(`/judgements/${encodeURIComponent(id)}`);
export const deleteJudgement = (id: string) => request<{ deleted: true }>(`/judgements/${encodeURIComponent(id)}`, undefined, 'DELETE');
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
export const deleteRuns = (ids: string[]) => request<{ deleted: true }>('/runs/delete', { ids });
export const deleteGenerated = (id: string) => request<{ deleted: true }>(`/canvases/${encodeURIComponent(id)}`, undefined, 'DELETE');
export const deleteContextOutputs = (agentContextId: string, workflow: string) =>
  request<{ deleted: true }>(`/contexts/${encodeURIComponent(agentContextId)}/outputs?${new URLSearchParams({ workflow })}`, undefined, 'DELETE');
export const listReferences = (archived = false) => request<EvalReference[]>(`/references${archived ? '?archived=true' : ''}`);
export const createReference = (input: Omit<EvalReference, 'schemaVersion' | 'id' | 'projectId' | 'createdAt' | 'updatedAt' | 'archivedAt'>) => request<EvalReference>('/references', input);
export const updateReference = (id: string, input: { name?: string; archived?: boolean; groupId?: string | null; comment?: string }) => request<EvalReference>(`/references/${encodeURIComponent(id)}`, input, 'PATCH');
export const listReferenceGroups = () => request<EvalReferenceGroup[]>('/reference-groups');
export const createReferenceGroup = (input: { requestId: string; name: string }) => request<EvalReferenceGroup>('/reference-groups', input);
export const renameReferenceGroup = (id: string, name: string) => request<EvalReferenceGroup>(`/reference-groups/${encodeURIComponent(id)}`, { name }, 'PATCH');
export const deleteReferenceGroup = (id: string) => request<{ deleted: true }>(`/reference-groups/${encodeURIComponent(id)}`, undefined, 'DELETE');
export const openReferenceSession = (input: { source: CompareSource; boxId: string; revisionId: string }) => request<ReferenceGenerationSession>('/reference-sessions', input);
export const generateReferences = (id: string, input: GenerateReferences) => request<{ requestId: string }>(`/reference-sessions/${encodeURIComponent(id)}/generate`, input);
export const loadReferenceSources = (id: string, input: { requestId: string }) => request<{ requestId: string }>(`/reference-sessions/${encodeURIComponent(id)}/load-sources`, input);
export const captureCanvas = (source: CompareSource) => request<CompareCanvasCopy>('/capture', { source });

export const approveExperiment = (id: string, input: { requestId: string; expectedRevision: number }) => request<EvalExperiment>(`/experiments/${encodeURIComponent(id)}/approve`, input);

export const snapshotPrompts = () => request<import('../../../../domain/mapping/evals/evalPrompt').PromptProjectSnapshot>('/prompt-snapshots', { requestId: crypto.randomUUID(), name: `Prompt snapshot ${new Date().toISOString()}` });

export const judgeExperiment = (id: string, input: { requestId: string; expectedRevision: number; comparisonId: string }) => request<EvalExperiment>(`/experiments/${encodeURIComponent(id)}/judge`, input);
