import { PromptTemplateTag, PromptTemplateText } from './PromptTemplateTags';
import { promptTemplateIds } from '../../../../domain/mapping/evals/promptTemplateIncludes';
import { PromptTextBox } from './PromptSectionsEditor';
import { legacyPromptTemplateBase } from '../../../../domain/mapping/evals/promptTemplateBase';
import { useEvalHistory } from './evalHistory';
import { type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import type { EvalPrompt } from '../../../../domain/mapping/evals/evalPrompt';
import { experimentPromptLineage, promptVersionKey } from '../../../../domain/mapping/evals/promptLineage';
import type { EvalExperiment } from '../../../../domain/mapping/evals/experiment';
import type { EvalRunSummary } from '../../../../domain/mapping/evals/evalRun';
import { evalWorkflows } from '../../../../domain/mapping/evals/evalWorkflows';
import { Drawer } from './Drawer';

export function ExperimentPrompts({ experiment, runs, prompts }: { experiment: EvalExperiment; runs: EvalRunSummary[]; prompts: EvalPrompt[] }) {
  const entries = experiment.samples.flatMap(sample => sample.outputs.map(output => {
    const run = runs.find(r => r.id === output.runId), cell = run?.cells.find(c => c.key === output.cellKey);
    return { id: `${sample.id}:${output.stageId}`, sample, output, run, cell,
      prompt: run?.prompts.find(p => p.promptId === cell?.promptId && (!cell.promptVersion || p.version === cell.promptVersion)),
      label: [experiment.cases.length > 1 ? experiment.cases.find(c => c.id === sample.caseId)?.name : undefined,
        experiment.conditions.find(c => c.id === sample.conditionId)?.name, `Sample ${sample.number}`, `Attempt ${sample.attempt}`,
        experiment.workflow.stages.find(s => s.id === output.stageId)?.name].filter(Boolean).join(' · ') };
  }));
  const nodes = experimentPromptLineage(experiment, runs, prompts);
  const { visit, navigation } = useEvalHistory();
  const panel = visit.view.panel;
  const openedId = panel?.kind === 'ancestry' ? panel.id : undefined;
  const open = (id: string, output?: string) => navigation.openPanel({ kind: 'ancestry', id, output });
  const openedNode = nodes.find(n => n.id === openedId);
  const visibleEntries = entries.filter(e => openedNode?.outputKeys.includes(e.id));
  const selected = panel?.kind === 'ancestry' ? panel.output : undefined;
  const entry = visibleEntries.find(e => e.id === selected) ?? visibleEntries[0];
  const inspectedPrompt = entry?.prompt ?? openedNode?.prompt;
  const inspectedWorkflow = entry?.run?.workflow ?? openedNode?.workflow;
  const derivation = inspectedPrompt?.derivation ?? prompts.find(p => p.id === inspectedPrompt?.promptId)?.versions.find(v => v.version === inspectedPrompt?.version)?.derivation;
  const renderBranch = (parentId?: string, prefix = ''): ReactNode => {
    const children = nodes.filter(node => node.parentId === parentId);
    return children.map((node, index) => {
      const last = index === children.length - 1;
      const outputs = entries.filter(e => node.outputKeys.includes(e.id));
      return <li key={node.id}>
        <div className="experiment-prompt-tree-row"><span className="experiment-tree-branch" aria-hidden="true">{prefix}{parentId ? (last ? '└── ' : '├── ') : ''}</span>
          <div>{node.prompt ? <button className="evals-link" aria-label={`Open ${node.name} prompt`} onClick={() => { open(node.id, outputs[0]?.id); }}>{node.name}</button> : <strong>{node.name}</strong>}
          {node.prompt && <span className="evals-muted"> [{outputs.length} {outputs.length === 1 ? 'output' : 'outputs'}]</span>}
          {node.prompt?.version && <span className="evals-muted"> · v{node.prompt.version}</span>}
          {[...new Set(Object.values(node.prompt?.templateSources ?? {}).flatMap(promptTemplateIds))].map(id => <PromptTemplateTag key={id} id={id} />)}
          {node.description && <small className="evals-muted">{node.description}</small>}</div>
        </div>
        {nodes.some(child => child.parentId === node.id) && <ul>{renderBranch(node.id, prefix + (parentId ? (last ? '    ' : '│   ') : ''))}</ul>}
      </li>;
    });
  };
  return <section className="experiment-prompts" aria-label="Generation prompts">
    <h3>Prompt tree</h3>
    {!nodes.length && <p className="evals-muted">No saved prompt versions are attached to outputs yet.</p>}
    <ul className="experiment-prompt-tree" aria-label="Prompt variations">{renderBranch()}</ul>
    {openedNode && createPortal(<Drawer title={`${openedNode.name} prompt`} wide onClose={navigation.closePanel}>
      <div className="experiment-prompt-inspector"><p className="evals-muted">Exact prompt text saved with each output.</p>
      {!!visibleEntries.length && <label className="evals-field">Output<select aria-label="Output prompt" value={entry?.id} onChange={event => open(openedNode.id, event.target.value)}>{visibleEntries.map(item => <option key={item.id} value={item.id}>{item.label}</option>)}</select></label>}
      {derivation && <p className="evals-muted">{derivation.kind} of <button className="evals-link" onClick={() => open(promptVersionKey(derivation.parent.promptId, derivation.parent.version))}>{prompts.find(p => p.id === derivation.parent.promptId)?.name ?? derivation.parent.promptId} · v{derivation.parent.version}</button>{derivation.dimension && ` · ${derivation.dimension.name}: ${derivation.dimension.value}`}</p>}
      {inspectedPrompt && inspectedWorkflow ? <>
        <div className="evals-actions"><strong>{inspectedPrompt.name} · v{inspectedPrompt.version ?? '?'}</strong><span className="evals-muted">{entry?.run?.request.model} · {entry?.run?.request.effort}</span>
        </div>
        {Object.entries(inspectedPrompt.stages).map(([stage, text]) => <details open key={`${openedNode.id}:${stage}`} className="experiment-prompt-source"><summary>{evalWorkflows[inspectedWorkflow].stages.find(s => s.id === stage)?.label ?? stage} · Pinned prompt</summary>{inspectedPrompt.templateSources?.[stage]
          ? <pre className="experiment-inspect-json" aria-label={`${stage} pinned prompt`}><PromptTemplateText source={inspectedPrompt.templateSources[stage]} /></pre>
          : <PromptTextBox base={inspectedPrompt.templateBase ?? legacyPromptTemplateBase(inspectedPrompt.stages)} label={`${stage} pinned prompt`} value={text} readOnly onChange={() => {}} />}</details>)}
        {!!Object.keys(inspectedPrompt.references ?? {}).length && <details><summary>Pinned reference text</summary>{Object.entries(inspectedPrompt.references!).map(([id, ref]) => <div key={id}><h4>{ref.name} · {id}</h4><pre>{ref.ascii}</pre>{ref.comment && <p>{ref.comment}</p>}</div>)}</details>}
      </> : <p className="evals-muted">This output has no retained prompt text.</p>}
    </div></Drawer>, document.body)}
  </section>;
}
