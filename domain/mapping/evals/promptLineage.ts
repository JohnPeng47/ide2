import type { EvalPrompt, PromptDerivation } from './evalPrompt';
import type { EvalRunPrompt, EvalRunSummary } from './evalRun';
import type { EvalExperiment } from './experiment';
import type { EvalWorkflowId } from './evalWorkflows';

export const promptVersionKey = (promptId: string, version: number) => `prompt:${promptId}:v${version}`;
export interface PromptLineageNode {
  id: string; name: string; parentId?: string; description?: string;
  prompt?: EvalRunPrompt; workflow?: EvalWorkflowId; outputKeys: string[];
}
/** Derive ancestry from pinned prompt versions, never names, conditions or output contents. */
export function experimentPromptLineage(experiment: EvalExperiment, runs: EvalRunSummary[], prompts: EvalPrompt[]): PromptLineageNode[] {
  const nodes = new Map<string, PromptLineageNode>();
  const catalog = new Map(prompts.map(p => [p.id, p]));
  const visiting = new Set<string>();
  const ensure = (snapshot: EvalRunPrompt, workflow?: EvalWorkflowId, label?: string): PromptLineageNode => {
    const id = snapshot.version ? promptVersionKey(snapshot.promptId, snapshot.version) : `unversioned:${snapshot.promptId}`;
    const existing = nodes.get(id);
    if (existing) return existing;
    const stored = catalog.get(snapshot.promptId), version = stored?.versions.find(v => v.version === snapshot.version);
    const parents = snapshot.parents ?? version?.parents;
    const derivation: PromptDerivation | undefined = parents?.some(p => p.relation === 'merge') ? { parent: parents[0], kind: 'merge' } : snapshot.derivation ?? version?.derivation ?? (parents?.[0] ? { parent: parents[0], kind: parents[0].relation } : undefined);
    const node: PromptLineageNode = { id, name: label ?? snapshot.name, prompt: snapshot, workflow: workflow ?? stored?.workflow, outputKeys: [] };
    nodes.set(id, node); visiting.add(id);
    if (derivation) {
      const parentKey = promptVersionKey(derivation.parent.promptId, derivation.parent.version);
      // Defensive for imported legacy data: an invalid cycle must not hide all roots.
      if (!visiting.has(parentKey)) {
        const parentRecord = catalog.get(derivation.parent.promptId);
        const parentVersion = parentRecord?.versions.find(v => v.version === derivation.parent.version);
        const pinnedParent = runs.flatMap(r => r.prompts).find(p => p.promptId === derivation.parent.promptId && p.version === derivation.parent.version);
        const parent = ensure(pinnedParent ?? { ...derivation.parent, name: parentRecord?.name ?? 'Unavailable parent prompt', stages: parentVersion?.stages ?? {}, templateSources: parentVersion?.templateSources, derivation: parentVersion?.derivation, parents: parentVersion?.parents }, parentRecord?.workflow);
        if (derivation.dimension) {
          const groupId = `${parent.id}:dimension:${derivation.dimension.id}`;
          if (!nodes.has(groupId)) nodes.set(groupId, { id: groupId, parentId: parent.id, name: derivation.dimension.name, outputKeys: [] });
          node.parentId = groupId; node.description = derivation.dimension.value;
        } else node.parentId = parent.id;
      }
    }
    for (const extra of parents?.slice(1) ?? []) {
      const key = promptVersionKey(extra.promptId, extra.version);
      if (visiting.has(key)) continue;
      const record = catalog.get(extra.promptId), v = record?.versions.find(v => v.version === extra.version);
      ensure({ ...extra, name: record?.name ?? 'Unavailable merge parent', stages: v?.stages ?? {}, templateSources: v?.templateSources, parents: v?.parents, derivation: v?.derivation }, record?.workflow);
      node.description = [node.description, `Merge parent: ${record?.name ?? extra.promptId} v${extra.version}`].filter(Boolean).join(' · ');
    }
    visiting.delete(id);
    return node;
  };
  // Resolve all outputs first so shared versions retain their user-facing condition labels.
  const outputs = experiment.samples.flatMap(sample => sample.outputs.flatMap(output => {
    const run = runs.find(r => r.id === output.runId), cell = run?.cells.find(c => c.key === output.cellKey);
    const prompt = run?.prompts.find(p => p.promptId === cell?.promptId && (!cell.promptVersion || p.version === cell.promptVersion));
    return prompt ? [{ sample, output, run: run!, prompt }] : [];
  }));
  for (const { sample, output, run, prompt } of outputs) {
    const condition = experiment.conditions.find(c => c.id === sample.conditionId);
    const node = ensure(prompt, run.workflow);
    // Retries with edited prompts are distinct children, even when the condition stays the same.
    if (!node.outputKeys.length) node.name = sample.relaunchedFrom ? `${condition?.name ?? prompt.name} · edited attempt` : condition?.name ?? prompt.name;
    node.outputKeys.push(`${sample.id}:${output.stageId}`);
  }
  return [...nodes.values()];
}
