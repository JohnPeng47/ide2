import { promptTemplateIds } from './promptTemplateIncludes';
import { sha256 } from '../../core/sha256';
import { experimentCommentGroups } from './experimentNodeComments';
import { experimentOverviewPhases, experimentSampleStages, type EvalExperiment } from './experiment';
import { hasEvalOutput, type EvalRunCell, type EvalRunSummary } from './evalRun';
import type { ExperimentOverview, ExperimentOverviewAction, ExperimentOverviewNode as Node, ExperimentPromptSource } from './experimentOverview';

type Row = { sample: EvalExperiment['samples'][number]; stage: EvalExperiment['workflow']['stages'][number]; output?: { runId: string; cellKey: string }; run?: EvalRunSummary; cell?: EvalRunCell; promptRef?: string };
export type ExperimentReadTarget =
  | { kind: 'prompt'; stage: string; templateIds?: string[]; sources: ExperimentPromptSource[] }
  | { kind: 'output' | 'inputs' | 'details'; sampleId: string; stageId: string; runId?: string; cellKey?: string }
  | { kind: 'case'; caseId: string }
  | { kind: 'conditions' }
  | { kind: 'ground-truth'; sampleId: string }
  | { kind: 'settings' }
  | { kind: 'judgement'; judgementId: string };
const key = (...parts: string[]) => parts.map(encodeURIComponent).join('/');
const excerpt = (text: string) => text.length <= 240 ? text : `${text.slice(0, 239).trimEnd()}…`;

/** Pure projection shared by the Overview UI and API. Payloads remain behind read references. */
export function projectExperimentOverview(experiment: EvalExperiment, suppliedRuns: EvalRunSummary[], phaseId?: string): { overview: ExperimentOverview; reads: Map<string, ExperimentReadTarget> } {
  const runs = new Map((experiment.generationReview?.runs ?? []).filter(run => run.projectId === experiment.projectId).map(run => [run.id, run]));
  suppliedRuns.forEach(run => { if (run.projectId === experiment.projectId) runs.set(run.id, run); });
  const reads = new Map<string, ExperimentReadTarget>();
  const register = (ref: string, target: ExperimentReadTarget) => { reads.set(ref, target); return ref; };
  const planned = new Map(experiment.plannedRuns?.flatMap(run => run.outputs.map(output => [key(output.sampleId, output.stageId), { ...output, runId: run.request.requestId }] as const)));
  const promptHashes = new Map<string, string>();
  const lineage = new Map(experiment.inputLineage?.map(item => [item.caseId, item.sources]));
  const rows: Row[] = experiment.samples.flatMap(sample => experimentSampleStages(experiment, sample).map(stage => {
    const output = sample.outputs.find(output => output.stageId === stage.id) ?? planned.get(key(sample.id, stage.id));
    const run = output && runs.get(output.runId), cell = run?.cells.find(cell => cell.key === output?.cellKey);
    const pinned = run?.prompts.find(prompt => prompt.promptId === cell?.promptId && (!cell.promptVersion || prompt.version === cell.promptVersion));
    const executionStage = cell?.stage ?? stage.id;
    let promptRef: string | undefined;
    if (pinned?.stages[executionStage] !== undefined && run && cell && !cell.historyArtifact?.stepId.startsWith('scaffold-')) {
      const templateSource = pinned.templateSources?.[executionStage];
      const identity = JSON.stringify([executionStage, pinned.stages[executionStage], pinned.references ?? {}, ...(templateSource ? [templateSource] : [])]);
      promptRef = promptHashes.get(identity);
      if (!promptRef) { promptRef = `prompt/${sha256(identity)}`; promptHashes.set(identity, promptRef); }
      const source: ExperimentPromptSource = { runId: run.id, cellKey: cell.key, sampleId: sample.id, stageId: stage.id, promptId: pinned.promptId, version: pinned.version, contentHash: pinned.contentHash };
      const previous = reads.get(promptRef);
      if (previous?.kind === 'prompt') previous.sources.push(source);
      else register(promptRef, { kind: 'prompt', stage: executionStage, ...(templateSource && { templateIds: promptTemplateIds(templateSource) }), sources: [source] });
    }
    return { sample, stage, output, run, cell, promptRef };
  }));
  const relatedIds = new Set(rows.flatMap(row => row.output ? [row.output.runId] : []));
  const related = [...runs.values()].filter(run => relatedIds.has(run.id));
  const progress = (items: Row[]): Pick<Node, 'status' | 'counts'> => {
    const finished = items.filter(row => row.cell?.status === 'finished' && !row.cell.deleted).length;
    const statuses = items.map(row => row.cell?.deleted ? 'unavailable' : row.cell?.status ?? (row.output && !planned.has(key(row.sample.id, row.stage.id)) ? 'unavailable' : 'planned'));
    const status = statuses.includes('generating') ? 'generating' : statuses.includes('queued') ? 'queued'
      : statuses.includes('failed') ? 'failed' : statuses.includes('cancelled') ? 'cancelled'
      : statuses.includes('unavailable') || statuses.includes('skipped') ? 'partial'
      : items.length && finished === items.length ? 'finished' : 'planned';
    return { status, counts: { finished, total: items.length } };
  };
  const promptAction = (items: Row[]): ExperimentOverviewAction[] => {
    const refs = [...new Set(items.flatMap(row => row.promptRef ? [row.promptRef] : []))];
    const sources = new Map<string, { sampleId: string; stageId: string }>();
    for (const row of items) {
      if (row.promptRef && row.output && row.cell) sources.set(key(row.promptRef, row.output.runId, row.cell.promptId!), { sampleId: row.sample.id, stageId: row.stage.id });
    }
    const templateIds = [...new Set(refs.flatMap(ref => {
      const target = reads.get(ref);
      return target?.kind === 'prompt' ? target.templateIds ?? [] : [];
    }))];
    return refs.length ? [{ ...(templateIds.length ? { templateIds } : {}), label: refs.length === 1 ? 'prompt' : 'prompts', refs, promptSources: [...sources.values()] }] : [];
  };
  const rowAction = (row: Row, kind: 'output' | 'inputs' | 'details', label: string = kind): ExperimentOverviewAction => ({ label,
    refs: [register(key(kind, row.sample.id, row.stage.id), { kind, sampleId: row.sample.id, stageId: row.stage.id, runId: row.output?.runId, cellKey: row.output?.cellKey })],
    ...(row.output && kind !== 'inputs' ? { output: row.output } : {}) });
  const outputNode = (row: Row): Node => {
    const { sample, stage, output, cell, run } = row;
    const input = experiment.cases.find(item => item.id === sample.caseId)!;
    const condition = experiment.conditions.find(item => item.id === sample.conditionId)!;
    const subject = input.name.startsWith(`${condition.id} · `) ? input.name.slice(condition.id.length + 3) : input.name;
    const label = [experiment.cases.length > 1 ? subject : stage.name, (run?.request.passes ?? 1) > 1 ? `sample ${sample.number}` : '', sample.attempt > 1 ? `attempt ${sample.attempt}` : ''].filter(Boolean).join(' · ');
    const id = key('output', sample.id, stage.id), children: Node[] = [];
    if (cell?.error) children.push({ id: `${id}/error`, kind: 'comment', label: excerpt(cell.error), status: 'failed', actions: cell.error.length > 240 ? [rowAction(row, 'details')] : [] });
    if (cell?.explanation) children.push({ id: `${id}/description`, kind: 'comment', label: excerpt(cell.explanation), actions: cell.explanation.length > 240 ? [rowAction(row, 'details')] : [] });
    if (run?.historyInput) {
      const previous = rows.find(candidate => candidate.cell?.historyArtifact?.timelineId === run.historyInput!.timelineId && candidate.cell.historyArtifact.stepId === run.historyInput!.stepId);
      children.push({ id: `${id}/dependency`, kind: 'item', label: `Starts from ${run.historyInput.stepId}`, actions: previous ? [rowAction(previous, 'output')] : [] });
    }
    const scaffold = cell?.historyArtifact?.stepId.startsWith('scaffold-');
    const origin = scaffold ? rows.find(candidate => candidate.cell?.historyArtifact?.timelineId === cell?.historyArtifact?.timelineId && candidate.cell?.historyArtifact?.stepId === 'plan') : undefined;
    // Only viewable results are navigation stops; failures stay visible in the tree but are skipped.
    const viewable = !!output && cell?.status === 'finished' && !cell.deleted && hasEvalOutput(cell);
    // The output itself shows the whole canvas; each diagram of a multi-diagram canvas follows as a focused stop.
    if (viewable && (cell.diagrams?.length ?? 0) > 1) children.push({ id: `${id}/diagrams`, kind: 'summary', label: `Diagrams · ${cell.diagrams!.length}`,
      children: cell.diagrams!.map(diagram => ({ id: `${id}/diagram/${encodeURIComponent(diagram.id)}`, kind: 'item' as const, label: diagram.title,
        target: { kind: 'output' as const, runId: output!.runId, cellKey: output!.cellKey, diagram: diagram.id } })) });
    return { id, kind: 'item', label, collapsed: true, source: { caseId: sample.caseId, sampleId: sample.id, stageId: stage.id, phaseId: sample.phaseId, conditionId: sample.conditionId },
      ...(viewable ? { target: { kind: 'output' as const, runId: output!.runId, cellKey: output!.cellKey } } : {}),
      status: cell?.deleted ? 'unavailable' : cell?.status ?? (output && !planned.has(key(sample.id, stage.id)) ? 'unavailable' : 'planned'),
      detail: cell?.output?.format === 'canvas-layout' ? 'Canvas layout' : cell?.output?.format === 'markdown' ? 'Markdown' : cell?.output ? `${cell.output.canvases.length} canvas${cell.output.canvases.length === 1 ? '' : 'es'}` : undefined,
      actions: [...(output && cell ? [rowAction(row, cell.status === 'finished' ? 'output' : 'details')] : []),
        ...(scaffold ? origin ? [rowAction(origin, 'output', 'generation source')] : [] : promptAction([row])), rowAction(row, 'inputs')], children };
  };
  const outputNodes = (items: Row[], id: string): Node[] => {
    const scaffolds = items.filter(row => row.cell?.historyArtifact?.stepId.startsWith('scaffold-'));
    return [...items.filter(row => !scaffolds.includes(row)).map(outputNode), ...(scaffolds.length ? [{ id: `${id}/scaffolds`, kind: 'summary' as const, label: `Scaffold snapshots · ${scaffolds.length}`, collapsed: true,
      children: [{ id: `${id}/scaffolds/description`, kind: 'comment' as const, label: 'Materialized from the Phase 1 plan' }, ...scaffolds.map(outputNode)] }] : [])];
  };
  const phases = experimentOverviewPhases(experiment).map(phase => ({
    ...phase, rows: rows.filter(row => (experiment.phases?.length ? row.sample.phaseId : row.stage.id) === phase.id)
  }));
  const phaseNodes: Node[] = phases.filter(phase => !phaseId || phase.id === phaseId).map(phase => {
    const id = key('phase', phase.id);
    const variants: Node[] = experiment.conditions.flatMap(condition => {
      const groups = new Map<string, Row[]>();
      for (const row of phase.rows.filter(row => row.sample.conditionId === condition.id)) {
        const runId = row.sample.relaunchedFrom ? row.output?.runId ?? row.sample.id : '';
        if (!groups.has(runId)) groups.set(runId, []);
        groups.get(runId)!.push(row);
      }
      return [...groups].map(([rerunId, items]): Node => {
        const base = key('phase', phase.id, 'variant', condition.id);
        const variantId = rerunId ? `${base}/rerun/${encodeURIComponent(rerunId)}` : base;
        const prompts = promptAction(items);
        const refs = prompts[0]?.refs ?? [];
        return { id: variantId, kind: 'section', label: rerunId ? `[RERUN] ${condition.name} · attempt ${items[0].sample.attempt}` : condition.name, source: { phaseId: phase.id, conditionId: condition.id }, ...progress(items), actions: prompts,
          children: [...(condition.description ? [{ id: `${variantId}/description`, kind: 'comment' as const, label: condition.description }] : []),
            ...(refs.length > 1 ? [{ id: `${variantId}/prompts`, kind: 'summary' as const, label: `Prompts · ${refs.length}`, children: refs.map(ref => {
              const row = items.find(row => row.promptRef === ref)!;
              const name = row.run?.prompts.find(p => p.promptId === row.cell?.promptId)?.name;
              return { id: `${variantId}/${ref}`, kind: 'item' as const, label: [row.stage.name, name].filter(Boolean).join(' · '), actions: promptAction(items.filter(row => row.promptRef === ref)) };
            }) }] : []),
            { id: `${variantId}/outputs`, kind: 'summary', label: `Outputs · ${items.length}`, collapsed: true, children: outputNodes(items, variantId) }] };
      });
    });
    return { id, kind: 'section', label: phase.name, source: { phaseId: phase.id }, ...progress(phase.rows), actions: promptAction(phase.rows), children: [
      ...(phase.description ? [{ id: `${id}/description`, kind: 'comment' as const, label: phase.description }] : []),
      ...(experiment.comments ?? []).filter(comment => comment.phaseId === phase.id).map(comment => ({
        id: key('phase', phase.id, 'comment', comment.id), kind: 'comment' as const, label: comment.text,
        source: { phaseId: phase.id, commentId: comment.id }, tags: comment.tags ?? []
      })),
      { id: `${id}/dependencies`, kind: 'summary', label: `Inputs · ${phase.rows.some(row => row.run?.historyInput) ? 'pinned batch contexts + preceding canvas state' : [...new Set(phase.rows.flatMap(row => row.stage.dependsOn.map(id => experiment.workflow.stages.find(stage => stage.id === id)?.name ?? id)))].join(', ') || 'experiment inputs'}` },
      { id: `${id}/variants`, kind: 'summary', label: 'Variants and prompts', children: variants.length ? variants : [{ id: `${id}/empty`, kind: 'comment', label: 'No outputs registered yet.' }] }
    ] };
  });
  const comparisons: Node[] = experiment.comparisons.filter(c => !phaseId || c.phaseId === phaseId).map(comparison => ({ id: key('comparison', comparison.id), kind: 'summary', label: comparison.name,
    children: comparison.judgementIds.map(id => ({ id: key('judgement', comparison.id, id), kind: 'item', label: 'Saved judgement', target: { kind: 'judgement' as const, judgementId: id }, actions: [{ label: 'open', refs: [register(key('judgement', id), { kind: 'judgement', judgementId: id })], judgement: { judgementId: id } }] })) }));
  return { reads, overview: { schemaVersion: 1, experiment: { id: experiment.id, name: experiment.name, revision: experiment.revision, description: experiment.description, tags: experiment.tags ?? [] },
    read: { method: 'POST', url: `/api/mapping/evals/experiments/${encodeURIComponent(experiment.id)}/read`, maxRefs: 100 },
    root: { id: key('experiment', experiment.id), kind: 'section', label: experiment.workflow.name, ...progress(rows), children: [
      { id: 'inputs', kind: 'section', label: 'Inputs', children: [
        ...(experiment.groundTruth?.length ? [{ id: 'inputs/ground-truth', kind: 'summary' as const, label: `Ground truth · ${experiment.groundTruth.length} sample${experiment.groundTruth.length === 1 ? '' : 's'}`, collapsed: !experiment.groundTruth.some(sample => sample.format === 'markdown'),
          children: experiment.groundTruth.map(sample => ({ id: key('inputs', 'ground-truth', sample.id), kind: 'item' as const, label: sample.name,
              detail: `${sample.provenance.kind} · source ${sample.source.commit.slice(0, 7)}${sample.caseIds.length ? ` · ${sample.caseIds.length} case${sample.caseIds.length === 1 ? '' : 's'}` : ''}`,
              actions: [{ label: 'inspect', refs: [register(key('ground-truth', sample.id), { kind: 'ground-truth', sampleId: sample.id })] }] })) }] : []),
        { id: 'inputs/cases', kind: 'summary', label: `AgentContexts · ${experiment.cases.length} input cases`, collapsed: true, children: experiment.cases.map(input => ({ id: key('inputs', 'case', input.id), kind: 'item', label: input.name, source: { caseId: input.id },
          children: lineage.get(input.id)?.map((source, index) => ({
            id: key('inputs', 'case', input.id, 'source', String(index)), kind: 'item', label: source.label, upstreamOutput: source
          })),
          actions: [{ label: 'inspect', refs: [register(key('case', input.id), { kind: 'case', caseId: input.id })] }] })) },
        { id: 'inputs/conditions', kind: 'summary', label: `Conditions · ${experiment.conditions.length}`, actions: [{ label: 'inspect', refs: [register('conditions', { kind: 'conditions' })] }] },
        { id: 'inputs/settings', kind: 'summary', label: [...new Set(related.map(run => `${run.request.model} / ${run.request.effort} · n=${run.request.passes}`))].join('; ') || 'Generation settings not recorded',
          actions: [{ label: 'settings', refs: [register('settings', { kind: 'settings' })] }] }
      ] }, ...phaseNodes, ...(comparisons.length ? [{ id: 'comparisons', kind: 'section' as const, label: 'Comparisons', children: comparisons }] : []),
      { id: 'comments', kind: 'section', label: 'Comments', children: experimentCommentGroups(experiment).map(group => ({
        id: key('comments', group.id), kind: 'summary' as const, label: group.label,
        children: group.comments.map(comment => ({
          id: key('comment', comment.id), kind: 'comment' as const, label: comment.text, source: { commentId: comment.id }, tags: comment.tags ?? [],
          ...(comment.anchor ? { target: { kind: 'comment' as const, commentId: comment.id, runId: comment.anchor.runId, cellKey: comment.anchor.cellKey },
            actions: [{ label: 'selected nodes', refs: [], output: { runId: comment.anchor.runId, cellKey: comment.anchor.cellKey, commentId: comment.id } }] } : {}),
          children: comment.excerpts?.map((excerpt, index) => ({ id: key('comment', comment.id, String(index)), kind: 'summary' as const, label: excerpt.title, collapsed: true,
            children: excerpt.ascii.split('\n').map((line, row) => ({ id: key('comment', comment.id, String(index), String(row)), kind: 'item' as const, label: line })) }))
        })) })) }] }
  } };
}
