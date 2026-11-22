import { flattenGrid, resolveScene } from '../../core/diagrams/lineGrid';
import { diagramContentNodes } from '../../core/diagrams/diagramContentNodes';
import { contentNodeSpans } from '../../core/diagrams/contentNodeGeometry';
import type { MappingGridDocument } from '../workspace/mappingGrid';
import { experimentOverviewPhases, type EvalExperiment, type ExperimentComment, type ExperimentCommentAnchor } from './experiment';

/** Resolve exact membership against the saved document; never infer nodes from an old rectangle. */
export function commentExcerpts(document: MappingGridDocument, selections: ExperimentCommentAnchor['selections']): NonNullable<ExperimentComment['excerpts']> {
  const boxes = flattenGrid(resolveScene(document.scene));
  return selections.map(selection => {
    const box = boxes.find(box => `grid:${box.box.id}` === selection.diagramId);
    const diagram = box?.contentId && document.scene.contents[box.contentId];
    if (!diagram || diagram.content.revisionId !== selection.revisionId) throw Error('The selected diagram revision is unavailable.');
    const nodes = diagramContentNodes(diagram.content), selected = new Set(selection.nodeIds);
    if (selected.size !== selection.nodeIds.length || selection.nodeIds.some(id => !nodes.some(node => node.id === id))) throw Error('The selection contains missing or duplicate nodes.');
    const lines = diagram.content.ascii.split('\n');
    const spans = nodes.filter(node => selected.has(node.id)).flatMap(contentNodeSpans);
    // Keep the original tree indentation, but omit unselected labels sharing the same source row.
    const ascii = [...new Set(spans.map(span => span.line))].sort((a, b) => a - b).map(line => {
      const row = lines[line - 1];
      const selectedSpans = spans.filter(span => span.line === line);
      const otherSpans = nodes.filter(node => !selected.has(node.id)).flatMap(contentNodeSpans).filter(span => span.line === line);
      return [...row].map((char, index) => otherSpans.some(span => index + 1 >= span.startColumn && index + 1 <= span.endColumn)
        && !selectedSpans.some(span => index + 1 >= span.startColumn && index + 1 <= span.endColumn) ? ' ' : char).join('').trimEnd();
    }).join('\n');
    return { diagramId: selection.diagramId, title: lines.find(line => line.trim()) ?? selection.diagramId, ascii };
  });
}

export function commentOutputLabel(experiment: EvalExperiment, runId: string, cellKey: string) {
  const sample = experiment.samples.find(sample => sample.outputs.some(output => output.runId === runId && output.cellKey === cellKey));
  if (!sample) return 'Unavailable output set';
  const stageId = sample.outputs.find(output => output.runId === runId && output.cellKey === cellKey)?.stageId;
  return [experiment.cases.find(item => item.id === sample.caseId)?.name, experiment.conditions.find(item => item.id === sample.conditionId)?.name,
    `Sample ${sample.number}${sample.attempt > 1 ? ` · attempt ${sample.attempt}` : ''}`, experiment.workflow.stages.find(stage => stage.id === stageId)?.name].filter(Boolean).join(' · ');
}

/** Groups span all phases; ordering matches the comments branch and its closed navigation loop. */
export function experimentCommentGroups(experiment: EvalExperiment) {
  const groups = new Map<string, { id: string; label: string; comments: ExperimentComment[] }>();
  const phases = new Map(experimentOverviewPhases(experiment).map(phase => [phase.id, phase.name]));
  for (const comment of [...(experiment.comments ?? [])].sort((a, b) => a.createdAt.localeCompare(b.createdAt))) {
    const anchor = comment.anchor;
    const id = anchor ? JSON.stringify([anchor.runId, anchor.cellKey]) : comment.phaseId ? `phase/${comment.phaseId}` : 'general';
    if (!groups.has(id)) {
      const label = anchor ? commentOutputLabel(experiment, anchor.runId, anchor.cellKey)
        : comment.phaseId ? phases.get(comment.phaseId) ?? `Phase · ${comment.phaseId}` : 'General comments';
      groups.set(id, { id, label, comments: [] });
    }
    groups.get(id)!.comments.push(comment);
  }
  return [...groups.values()];
}

export function exportExperimentComments(experiment: EvalExperiment): string {
  const parts = [`# ${experiment.name} — comments`, `Experiment: ${experiment.id}`];
  for (const group of experimentCommentGroups(experiment)) {
    parts.push(`## ${group.label}`);
    for (const [index, comment] of group.comments.entries()) {
      parts.push(`### ${index + 1}. Comment`, comment.text);
      if (comment.tags?.length) parts.push(`Tags: ${comment.tags.join(', ')}`);
      if (comment.anchor) parts.push(`Output: ${comment.anchor.runId} / ${comment.anchor.cellKey}\nCanvas: ${comment.anchor.canvasId}${comment.anchor.checkpointId ? `\nSnapshot: ${comment.anchor.checkpointId}` : ''}`);
      for (const excerpt of comment.excerpts ?? []) {
        const fence = '`'.repeat(Math.max(3, ...(excerpt.ascii.match(/`+/g) ?? []).map(run => run.length + 1)));
        parts.push(`Selected nodes — ${excerpt.title}`, `${fence}text\n${excerpt.ascii}\n${fence}`);
      }
    }
  }
  return parts.join('\n\n') + '\n';
}
