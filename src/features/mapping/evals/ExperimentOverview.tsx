import { PromptTemplateTag, PromptTemplateText } from './PromptTemplateTags';
import { useEvalHistory } from './evalHistory';
import { viewTreePath } from '../../../../domain/core/presentation/viewTree';
import { Fragment, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import type { EvalExperiment, ExperimentGroundTruthSample } from '../../../../domain/mapping/evals/experiment';
import type { EvalRunSummary } from '../../../../domain/mapping/evals/evalRun';
import type { ExperimentOverviewAction, ExperimentOverviewNode, ExperimentReadResult } from '../../../../domain/mapping/evals/experimentOverview';
import { projectExperimentOverview } from '../../../../domain/mapping/evals/experimentOverviewProjection';
import type { ExperimentRoute } from './ExperimentExplorer';
import { readExperimentBatch } from './evalsApi';
import { TerminalMarkdownContent } from '../../../shared/markdown/TerminalMarkdownContent';
import { ExperimentPromptEdit, type PromptEditSource } from './ExperimentPromptEdit';
import { Drawer } from './Drawer';
import { ExperimentCommentActions, PhaseCommentAction } from './ExperimentComments';
import { experimentPhaseUrl } from './experimentPhaseLink';
import { useTreeExpansion, type TreeExpansion } from './useTreeExpansion';

function CopyNodeId({ id, label }: { id: string; label: string }) {
  const [status, setStatus] = useState('');
  return <>
    <button type="button" className="experiment-copy-id experiment-output-copy-id experiment-hover-action" aria-label={label} title={`${label}: ${id}`} onBlur={() => setStatus('')}
      onClick={async () => {
        try { await navigator.clipboard.writeText(id); setStatus('Copied'); }
        catch { setStatus('Copy failed'); }
      }}>
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true"><rect x="8" y="8" width="12" height="12" rx="2" /><path d="M16 8V5a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h3" /></svg>
    </button><span className="evals-muted" role="status">{status}</span>
  </>;
}

function Label({ node, onAction }: { node: ExperimentOverviewNode; onAction: (action: ExperimentOverviewAction, node: ExperimentOverviewNode) => void }) {
  if (node.upstreamOutput) {
    const source = node.upstreamOutput;
    const query = new URLSearchParams({ run: source.runId, output: source.cellKey, nav: source.experimentId });
    return <>Uses <a className="evals-link" href={`?${query}`}>{source.label}</a></>;
  }
  const label = node.kind === 'section' || node.kind === 'summary' ? <strong>{node.label}</strong>
    : node.kind === 'comment' ? <span className={node.status === 'failed' ? 'evals-error' : 'experiment-ascii-comment'}># {node.label}</span> : <span>{node.label}</span>;
  return <>{label}{node.status && node.kind !== 'comment' && <span className="experiment-ascii-status" data-status={node.status}>
    [{node.counts && node.status === 'finished' ? 'done' : node.status}{node.counts ? ` · ${node.counts.finished}/${node.counts.total} outputs` : node.detail ? ` · ${node.detail}` : ''}]
  </span>}{node.actions?.map((action, index) => <Fragment key={index}><button type="button" className="evals-link experiment-ascii-action" onClick={() => onAction(action, node)}>[{action.label}]</button>
    {action.templateIds?.map(id => <PromptTemplateTag key={id} id={id} />)}</Fragment>)}</>;
}
function Branch({ node, prefix = '', last = true, onAction, renderCommentActions, focusPhase, experimentId, onPhase, expansion }: { node: ExperimentOverviewNode; prefix?: string; last?: boolean; renderCommentActions: (node: ExperimentOverviewNode, phaseId?: string) => ReactNode; onAction: (action: ExperimentOverviewAction, node: ExperimentOverviewNode) => void; focusPhase?: string; experimentId: string; onPhase: (phaseId: string) => void; expansion: TreeExpansion }) {
  const open = expansion.isOpen(node.id, !node.collapsed);
  const { setOpen } = expansion;
  const phaseId = node.id === `phase/${encodeURIComponent(node.source?.phaseId ?? '')}` ? node.source?.phaseId : undefined;
  const focused = !!phaseId && phaseId === focusPhase;
  const row = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!focused) return;
    setOpen(node.id, true);
    row.current?.scrollIntoView({ block: 'center' });
    row.current?.focus({ preventScroll: true });
  }, [focused, node.id, setOpen]);
  const isOutputsGroup = node.kind === 'summary' && node.id.endsWith('/outputs');
  return <li data-node-id={node.id}>
    <div ref={row} tabIndex={-1} aria-current={focused ? 'location' : undefined} className={`experiment-ascii-row${focused ? ' experiment-phase-focused' : ''}`}><span className="experiment-ascii-guide" aria-hidden="true">{prefix}{last ? '`-- ' : '+-- '}</span>
      <div className="experiment-ascii-content">
        {!!node.children?.length && <button className="experiment-ascii-toggle" aria-label={`${open ? 'Collapse' : 'Expand'} ${node.id}`} aria-expanded={open} onClick={() => setOpen(node.id, !open)}>{open ? '[-]' : '[+]'}</button>}
        <Label node={node} onAction={onAction} />{(isOutputsGroup || node.source?.sampleId && node.source.stageId) && <CopyNodeId id={node.id} label={isOutputsGroup ? 'Copy Outputs node ID' : 'Copy output ID'} />}
        {phaseId && <CopyNodeId id={`experiment/${encodeURIComponent(experimentId)}/${node.id}`} label="Copy phase ID" />}
        {phaseId && <a className="experiment-phase-link experiment-ascii-action" href={experimentPhaseUrl(experimentId, phaseId)} aria-label={`Link to ${node.label}`} onClick={event => {
          if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
          event.preventDefault(); setOpen(node.id, true); onPhase(phaseId);
        }}>[link]</a>}
        {renderCommentActions(node, phaseId)}
      </div>
    </div>
    {open && !!node.children?.length && <ul>{node.children.map((child, index) => <Branch key={child.id} node={child} prefix={prefix + (last ? '    ' : '|   ')} last={index === node.children!.length - 1} onAction={onAction} renderCommentActions={renderCommentActions} focusPhase={focusPhase} experimentId={experimentId} onPhase={onPhase} expansion={expansion} />)}</ul>}
  </li>;
}
function ReadResult({ result, onEdit }: { result: ExperimentReadResult; onEdit?: () => void }) {
  if (result.status === 'error') return <p role="alert" className="evals-error">{result.error.message}</p>;
  const value = result.value;
  if (value.kind === 'ground-truth') {
    const sample = value.data as ExperimentGroundTruthSample;
    if (sample.format === 'markdown') return <section aria-label="Reference exchange">
      <h3>User query</h3>
      <pre className="experiment-inspect-json">{sample.query}</pre>
      <h3>{sample.provenance.model ? sample.provenance.model + ' answer' : 'Reference answer'}</h3>
      <TerminalMarkdownContent className="output-markdown" source={sample.markdown} />
    </section>;
    return <section>
      <h3>{sample.name}</h3>
      <p className="evals-muted">Source {sample.source.commit} · {sample.provenance.kind}{sample.provenance.model ? ` (${sample.provenance.model})` : ''} · sha256 {sample.asciiSha256.slice(0, 12)}</p>
      {sample.description && <p>{sample.description}</p>}
      <pre className="experiment-inspect-json" aria-label="Ground truth diagram">{sample.ascii}</pre>
    </section>;
  }
  if (value.kind !== 'prompt') return <pre className="experiment-inspect-json">{JSON.stringify(value.kind === 'output' ? value.result : value.data, null, 2)}</pre>;
  const versions = [...new Set(value.sources.map(source => source.version === undefined ? 'unversioned' : `v${source.version}`))].join(', ');
  return <section>
    <h3>{value.name} · {versions} · {value.stage}</h3>
    <p className="evals-muted">{value.templateSource ? 'Pinned prompt with template references shown as tags.' : 'Exact pinned prompt text. Template variables are shown as saved.'}</p>
    {onEdit && <button type="button" onClick={onEdit}>Edit prompt</button>}
    <pre className="experiment-inspect-json" aria-label="Raw prompt text">{value.templateSource ? <PromptTemplateText source={value.templateSource} /> : value.text}</pre>
    {!!Object.keys(value.references ?? {}).length && <details><summary>Pinned references</summary>{Object.entries(value.references!).map(([id, reference]) => <section key={id}><h4>{reference.name}</h4><pre>{reference.ascii}</pre>{reference.comment && <p>{reference.comment}</p>}</section>)}</details>}
  </section>;
}

/** Render the shared view projection; summary nodes are independent of persisted entity nesting. */
export function ExperimentOverview({ experiment, runs, phaseId, focusPhase, onOpen, availableTags, onSaved, onChanged }: {
  experiment: EvalExperiment; runs: EvalRunSummary[]; phaseId?: string; focusPhase?: string; availableTags: string[];
  onSaved: (experiment: EvalExperiment) => void; onChanged: () => Promise<unknown>;
  onOpen: (route: ExperimentRoute | { kind: 'run'; id: string; output?: string; comment?: string; nav?: string } | { kind: 'judgements'; judgementId: string }) => void;
}) {
  const expansion = useTreeExpansion(`overview:${experiment.id}`);
  const { overview } = useMemo(() => projectExperimentOverview(experiment, runs, phaseId), [experiment, runs, phaseId]);
  const [drawer, setDrawer] = useState<{ title: string; content: ReactNode }>();
  const [edit, setEdit] = useState<{ stage: string; sources: PromptEditSource[] }>();
  const { navigation, visit } = useEvalHistory();
  const panel = visit.view.panel;
  const inspector = panel?.kind === 'overview' ? panel : undefined;
  const close = navigation.closePanel;
  const onAction = (action: ExperimentOverviewAction, node: ExperimentOverviewNode) => {
    visit.position.row = node.id;
    if (action.output) { onOpen({ kind: 'run', id: action.output.runId, output: action.output.cellKey, ...(action.output.commentId ? { comment: action.output.commentId, nav: `${experiment.id}:*` } : {}) }); return; }
    if (action.judgement) { onOpen({ kind: 'judgements', judgementId: action.judgement.judgementId }); return; }
    navigation.openPanel({ kind: 'overview', node: node.id, action: action.label });
  };
  const section = useRef<HTMLElement>(null);
  useEffect(() => {
    if (panel || !visit.position.row) return;
    const path = viewTreePath(overview.root, node => node.id === visit.position.row);
    if (!path) return;
    expansion.setMany(path.slice(0, -1).map(node => [node.id, true]));
    const frame = requestAnimationFrame(() => {
      const row = section.current?.querySelector<HTMLElement>(`[data-node-id="${CSS.escape(visit.position.row!)}"] > .experiment-ascii-row`);
      row?.focus({ preventScroll: true }); row?.scrollIntoView({ block: 'nearest' });
    });
    return () => cancelAnimationFrame(frame);
  }, [visit.key]);
  useEffect(() => {
    let closed = false;
    setEdit(undefined); setDrawer(undefined);
    if (!inspector) return;
    const node = viewTreePath(overview.root, item => item.id === inspector.node)?.at(-1) as ExperimentOverviewNode | undefined;
    const action = node?.actions?.find(item => item.label === inspector.action);
    if (!action) { setDrawer({ title: inspector.action, content: <p>This item is no longer available.</p> }); return; }
    const title = node?.label ?? inspector.action;
    setDrawer({ title, content: <p className="evals-muted">Loading…</p> });
    async function load(action: ExperimentOverviewAction) {
      try {
        const batches: string[][] = [];
        for (let i = 0; i < action.refs.length; i += overview.read.maxRefs) batches.push(action.refs.slice(i, i + overview.read.maxRefs));
        const responses = await Promise.all(batches.map(refs => readExperimentBatch(experiment.id, refs)));
        const scoped = new Set(action.promptSources?.map(item => `${item.sampleId}/${item.stageId}`));
        if (!closed) setDrawer({ title, content: <>{responses.flatMap(response => response.results).map(result => {
          const value = result.status === 'ok' && result.value.kind === 'prompt' ? result.value : undefined;
          const sources = value?.sources.flatMap(source => {
            if (!scoped.has(`${source.sampleId}/${source.stageId}`)) return [];
            const run = runs.find(run => run.id === source.runId) ?? experiment.generationReview?.runs.find(run => run.id === source.runId);
            const prompt = run?.prompts.find(prompt => prompt.promptId === source.promptId && prompt.version === source.version);
            return run && prompt ? [{ source, run, prompt }] : [];
          }) ?? [];
          return <ReadResult key={result.ref} result={result} onEdit={value && sources.length ? () => setEdit({ stage: value.stage, sources }) : undefined} />;
        })}</> });
      } catch (error) {
        if (!closed) setDrawer({ title, content: <p role="alert" className="evals-error">{error instanceof Error ? error.message : 'Read failed.'}</p> });
      }
    }
    void load(action);
    return () => { closed = true; };
  }, [inspector, experiment.id]);
  const renderCommentActions = (node: ExperimentOverviewNode, rowPhaseId?: string) => {
    const props = { experimentId: experiment.id, availableTags, onSaved, onChanged };
    if (rowPhaseId) return <PhaseCommentAction key={experiment.id} {...props} phaseId={rowPhaseId} phaseName={node.label} onOpen={() => expansion.setOpen(node.id, true)} />;
    if (node.source?.commentId) return <ExperimentCommentActions {...props} commentId={node.source.commentId} text={node.label} tags={node.tags ?? []} />;
    return null;
  };
  const nodes = overview.root.children ?? [];
  return <section ref={section} className="experiment-overview" aria-label="Experiment workflow" onClickCapture={event => {
    if (event.button || event.altKey || event.metaKey || event.ctrlKey || event.shiftKey || !(event.target instanceof Element)) return;
    const source = event.target.closest('a[href]')?.closest<HTMLElement>('[data-node-id]');
    if (source) visit.position.row = source.dataset.nodeId;
  }}>
    <div className="experiment-ascii-root"><Label node={overview.root} onAction={onAction} /></div>
    <ul className="experiment-ascii-tree">{nodes.map((node, index) => <Branch key={node.id} node={node} last={index === nodes.length - 1} onAction={onAction} renderCommentActions={renderCommentActions} focusPhase={focusPhase} experimentId={experiment.id} expansion={expansion} onPhase={id => onOpen({ kind: 'experiment', id: experiment.id, focusPhase: id })} />)}</ul>
    {inspector && (edit ? createPortal(<ExperimentPromptEdit {...edit} experiment={experiment} onClose={close} onChanged={onChanged}
      onRerun={(updated, runId) => {
        const phases = new Set(updated.samples.flatMap(sample => sample.outputs.filter(output => output.runId === runId).map(output => sample.phaseId ?? output.stageId)));
        expansion.setMany([...phases].flatMap(phase => [[`phase/${phase}`, true], [`phase/${phase}/variants`, true]]));
        onSaved(updated); close();
      }} />, document.body)
      : drawer && createPortal(<Drawer title={drawer.title} wide onClose={close}>{drawer.content}</Drawer>, document.body))}
  </section>;
}
