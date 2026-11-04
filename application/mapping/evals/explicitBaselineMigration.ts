import { sha256 } from '../../../domain/core/sha256';
import { evalRunRequestSchema, type EvalRun } from '../../../domain/mapping/evals/evalRun';
import type { EvalPrompt } from '../../../domain/mapping/evals/evalPrompt';
import type { GeneratedCanvas } from '../../../domain/core/diagrams/generatedCanvas';
import type { ProjectRepresentationCatalogRecord } from '../../../domain/core/representations/projectCatalog';
import { evalWorkflows } from '../../../domain/mapping/evals/evalWorkflows';
import { templateOutputInstructions } from '../../../domain/mapping/evals/layoutTemplate';
import { renderTemplate, tokenizeTemplate } from '../../../domain/mapping/evals/promptTemplate';

/** A deliberate metadata migration, not a new evaluation. Caller backs up and atomically writes the records. */
export function explicitBaselineMigration(source: EvalRun, runs: EvalRun[], catalog: ProjectRepresentationCatalogRecord, at: string) {
  if (source.workflow !== 'alternatives' || !source.layoutTemplate || source.prompts.length !== 1 || !source.request.task)
    throw Error('Expected an unmigrated, single-prompt template baseline with a saved task.');
  const old = source.prompts[0], workflow = evalWorkflows.alternatives;
  // Reconstruct the historical contract verbatim, including its original wording.
  const contract = templateOutputInstructions.replace('from context.json using these instructions', 'from context.json and the task');
  const body = tokenizeTemplate(old.stages.alternative).map(token => token.kind === 'variable' && token.name === 'task' ? source.request.task! : token.text).join('');
  const full = `${workflow.stages[0].contextHeader}\n\n${body}\n\n${contract}`;
  const values = { context: JSON.stringify(source.contexts!.context.name), task: source.request.task, pass: '1', passes: String(source.request.passes), previous: 'none' };
  if (renderTemplate(full, values) !== renderTemplate(`${workflow.stages[0].contextHeader}\n\n${old.stages.alternative}\n\n${contract}`, values))
    throw Error('Migration would change the rendered baseline prompt.');
  const prompt: EvalPrompt = { schemaVersion: 1, id: `${source.id}-template`, projectId: source.projectId, workflow: 'alternatives',
    name: 'Canvas-domain template baseline', description: 'Complete baseline instructions: seven titled layout slots, pinned source, no few-shot examples.',
    createdAt: at, updatedAt: at, versions: [{ version: 1, format: 'explicit-v1', createdAt: at,
      note: 'Reconstructed from the recorded baseline task and original workflow instructions; generated canvases are unchanged.', stages: { alternative: full } }] };
  const selected = runs.filter(run => run.id === source.id || run.parentRunId === source.id);
  const ids = new Set(selected.map(run => run.id));
  const rewriteGenerated = (generated: GeneratedCanvas): GeneratedCanvas => !generated.runId || !ids.has(generated.runId) ? generated : {
    ...generated, prompt: { id: prompt.id, version: 1, name: prompt.name }, promptStages: { alternative: full }
  };
  const updatedRuns = selected.map(run => {
    if (['queued', 'generating'].includes(run.status)) throw Error(`Run ${run.id} is still active.`);
    if (JSON.stringify(run.prompts) !== JSON.stringify(source.prompts) || run.request.task !== source.request.task
      || JSON.stringify(run.layoutTemplate) !== JSON.stringify(source.layoutTemplate)) throw Error(`Run ${run.id} has different instructions or layout.`);
    const { task: _, ...originalRequest } = run.request;
    const request = evalRunRequestSchema.parse({ ...originalRequest, prompts: [{ promptId: prompt.id, version: 1 }] });
    return { ...run, request, requestHash: sha256(JSON.stringify(request)),
      prompts: [{ promptId: prompt.id, version: 1, name: prompt.name, stages: { alternative: full } }],
      // Output keys and canvas identities stay stable for links, comparisons and judgements.
      cells: run.cells.map(cell => ({ ...cell, promptId: prompt.id, promptVersion: 1, promptName: prompt.name })),
      ...(run.outputSnapshots ? { outputSnapshots: Object.fromEntries(Object.entries(run.outputSnapshots).map(([id, output]) => [id, { ...output, generated: rewriteGenerated(output.generated) }])) } : {}) };
  });
  const updatedCatalog = { ...catalog, representations: Object.fromEntries(Object.entries(catalog.representations).map(([id, item]) => [id,
    item.generated && ids.has(item.generated.runId ?? '') ? { ...item, generated: rewriteGenerated(item.generated) } : item])) };
  return { prompt, runs: updatedRuns, catalog: updatedCatalog };
}
