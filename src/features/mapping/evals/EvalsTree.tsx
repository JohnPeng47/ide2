import { useMemo, useRef, useState, type KeyboardEvent, type MouseEvent, type ReactNode } from 'react';
import { generatedWorkflow } from '../../../../domain/core/diagrams/generatedCanvas';
import type { ProjectRepresentationRecord } from '../../../../domain/core/representations/projectCatalog';
import type { CompareSessionSummary } from '../../../../domain/mapping/compare/comparePageSession';
import type { ComparisonRunSummary } from '../../../../domain/mapping/compare/comparisonGeneration';
import type { EvalRunCell, EvalRunSummary } from '../../../../domain/mapping/evals/evalRun';
import type { EvalWorkflowId } from '../../../../domain/mapping/evals/evalWorkflows';
import { promptLabel, runNumbers, runProgress, statusLabel, UNKNOWN_PROMPT } from './evalsFormat';

export type EvalsSelection = { kind: 'run'; id: string; output?: string } | { kind: 'canvas'; id: string } | { kind: 'session'; id: string } | { kind: 'other' };
export interface TreeActions {
  open: (target: EvalsSelection) => void;
  deleteRun: (run: EvalRunSummary) => void;
  deleteCanvas: (id: string, name: string) => void;
  deleteContext: (context: { id: string; name: string; workflow: EvalWorkflowId; outputs: number }) => void;
  deleteSession: (session: CompareSessionSummary) => void;
  deleteComparisonRun: (run: ComparisonRunSummary) => void;
  contextMenu: (context: { id: string; name: string; workflow: EvalWorkflowId; runs: EvalRunSummary[] }, at: { x: number; y: number }) => void;
  runMenu: (run: EvalRunSummary, at: { x: number; y: number }) => void;
  /** An empty name restores the default label. */
  renameRun: (run: EvalRunSummary, name: string) => void;
}
interface NavNode {
  id: string; label: string; meta?: string; status?: string; title?: string; muted?: boolean;
  /** Collapsed by default (runs); everything else starts expanded. */
  closed?: boolean; current?: boolean; onOpen?: () => void;
  onDelete?: { label: string; run: () => void };
  onContextMenu?: (at: { x: number; y: number }) => void;
  /** Shown as an inline text field while `renaming` names this node. */
  rename?: { value: string; save: (name: string) => void };
  /** Finished outputs can be ticked for comparison. */
  pick?: { canvasId: string; checkpointId?: string; label: string; runId?: string };
  children?: NavNode[];
}
export interface PickedOutput { canvasId: string; checkpointId?: string; label: string; runId?: string }
const WORKFLOWS: { id: EvalWorkflowId; label: string }[] = [{ id: 'alternatives', label: 'Alternatives' }, { id: 'roll-up', label: 'Roll-ups' }];
const STORAGE = 'evals-tree-toggled';
const cellLabel = (cell: EvalRunCell, workflow: EvalWorkflowId) =>
  [cell.promptName ? `${cell.promptName} v${cell.promptVersion}` : UNKNOWN_PROMPT, `pass ${cell.pass}`, workflow === 'roll-up' ? cell.stage : ''].filter(Boolean).join(' · ');

/** Outputs by workflow, then AgentContext: runs with their canvases, loose (migrated) canvases, and comparisons. */
export function EvalsTree({ runs, generated, sessions, comparisons, selection, actions, picked, onPick, renaming, onRenameEnd }: {
  runs: EvalRunSummary[]; generated: ProjectRepresentationRecord[]; sessions: CompareSessionSummary[]; comparisons: ComparisonRunSummary[];
  selection?: EvalsSelection; actions: TreeActions; picked: PickedOutput[]; onPick: (output: PickedOutput, on: boolean) => void;
  /** ID of the run being renamed. */
  renaming?: string; onRenameEnd: () => void;
}) {
  const [toggled, setToggled] = useState<Set<string>>(() => { try { return new Set(JSON.parse(localStorage.getItem(STORAGE) ?? '[]')); } catch { return new Set(); } });
  const toggle = (id: string) => setToggled(previous => {
    const next = new Set(previous); if (next.has(id)) next.delete(id); else next.add(id);
    localStorage.setItem(STORAGE, JSON.stringify([...next])); return next;
  });
  const numbers = useMemo(() => runNumbers(runs), [runs]);
  const nodes = useMemo(() => {
    const canvasOwner = new Map(generated.map(canvas => [canvas.id, canvas.generated!]));
    const inRuns = new Set(runs.flatMap(run => run.cells.flatMap(cell => cell.canvasId ? [cell.canvasId] : [])));
    const placed = new Set<string>();
    const ownerOf = (canvasIds: string[]) => canvasIds.map(id => canvasOwner.get(id)).find(Boolean);
    const sessionNode = (session: CompareSessionSummary): NavNode => ({ id: `session:${session.id}`, label: session.title, meta: String(session.compareCount),
      current: selection?.kind === 'session' && selection.id === session.id, onOpen: () => actions.open({ kind: 'session', id: session.id }),
      onDelete: { label: `Delete comparison ${session.title}`, run: () => actions.deleteSession(session) } });
    const pendingNode = (run: ComparisonRunSummary): NavNode => ({ id: `pending:${run.id}`, label: run.request.title, status: run.status, muted: true, title: run.error,
      meta: run.status === 'failed' ? 'Failed' : 'Generating…', onDelete: { label: `Delete comparison ${run.request.title}`, run: () => actions.deleteComparisonRun(run) } });
    const pending = comparisons.filter(run => run.status !== 'finished');
    const roots: NavNode[] = WORKFLOWS.map(workflow => {
      const contexts = new Map<string, string>();
      for (const run of runs) if (run.workflow === workflow.id) contexts.set(run.agentContextId, run.contextName);
      for (const canvas of generated) if (generatedWorkflow(canvas.generated!) === workflow.id) contexts.set(canvas.generated!.agentContextId, canvas.generated!.contextName);
      const children = [...contexts].map(([contextId, contextName]): NavNode => {
        const contextRuns = runs.filter(run => run.workflow === workflow.id && run.agentContextId === contextId);
        const loose = generated.filter(canvas => canvas.generated!.agentContextId === contextId && generatedWorkflow(canvas.generated!) === workflow.id && !inRuns.has(canvas.id));
        const outputs = contextRuns.reduce((sum, run) => sum + run.cells.filter(cell => cell.canvasId && !cell.deleted).length, 0) + loose.length;
        const contextSessions = sessions.filter(session => session.origins[0]?.agentContextId === contextId && session.origins[0].workflow === workflow.id);
        contextSessions.forEach(session => placed.add(session.id));
        const contextPending = pending.filter(run => { const owner = ownerOf(run.request.sources.map(source => source.documentId));
          return owner?.agentContextId === contextId && generatedWorkflow(owner) === workflow.id; });
        contextPending.forEach(run => placed.add(run.id));
        const comparisonsNode: NavNode[] = contextSessions.length || contextPending.length ? [{ id: `comparisons:${workflow.id}:${contextId}`, label: 'Comparisons',
          meta: String(contextSessions.length + contextPending.length), children: [...contextPending.map(pendingNode), ...contextSessions.map(sessionNode)] }] : [];
        return { id: `context:${workflow.id}:${contextId}`, label: contextName, meta: `${outputs} output${outputs === 1 ? '' : 's'}`,
          onContextMenu: at => actions.contextMenu({ id: contextId, name: contextName, workflow: workflow.id, runs: contextRuns }, at),
          onDelete: { label: `Delete everything generated from ${contextName}`, run: () => actions.deleteContext({ id: contextId, name: contextName, workflow: workflow.id, outputs }) },
          children: [
            ...contextRuns.filter(run => !run.parentRunId || !contextRuns.some(root => root.id === run.parentRunId)).map(function runNode(run): NavNode {
              const output = (cell: EvalRunCell, label: string): NavNode => ({ id: `cell:${run.id}:${cell.key}`, label, status: cell.status,
                title: [cellLabel(cell, run.workflow), cell.error, cell.explanation].filter(Boolean).join('\n\n'),
                muted: cell.status !== 'finished', meta: cell.status === 'finished' ? undefined : statusLabel[cell.status],
                current: selection?.kind === 'run' && selection.id === run.id && selection.output === cell.key,
                onOpen: () => actions.open({ kind: 'run', id: run.id, output: cell.key }),
                ...(cell.canvasId ? {
                  pick: { canvasId: cell.canvasId, checkpointId: cell.checkpointId, label: cellLabel(cell, run.workflow), runId: run.id },
                  onDelete: { label: `Delete output ${cellLabel(cell, run.workflow)}`, run: () => actions.deleteCanvas(cell.canvasId!, cellLabel(cell, run.workflow)) } } : {}) });
              // Multi-stage workflows group each prompt × pass, with one leaf per stage (r2, g2).
              // Deleted outputs leave the tree.
              const live = run.cells.filter(cell => !cell.deleted);
              const staged = new Set(run.cells.map(cell => cell.stage)).size > 1;
              const groups = [...new Set(live.map(cell => `${cell.promptId ?? 'unknown'}:${cell.pass}`))];
              const children = staged ? groups.map(group => {
                const cells = live.filter(cell => `${cell.promptId ?? 'unknown'}:${cell.pass}` === group);
                return { id: `pass:${run.id}:${group}`, label: cellLabel({ ...cells[0], stage: '' }, 'alternatives'),
                  meta: `${cells.filter(cell => cell.status === 'finished').length}/${cells.length}`, children: cells.map(cell => output(cell, cell.stage)) };
              }) : live.map(cell => output(cell, cellLabel(cell, run.workflow)));
              // Reruns nest under their original run, oldest first.
              const defaultName = run.prompts.map(prompt => promptLabel(prompt)).join(', ') || UNKNOWN_PROMPT;
              const reruns = run.parentRunId ? [] : contextRuns.filter(item => item.parentRunId === run.id).reverse().map(runNode);
              return { id: `run:${run.id}`, closed: true, status: run.status,
                label: `${run.parentRunId ? 'Rerun' : 'Run'} #${numbers.get(run.id) ?? '?'} · ${run.name ?? defaultName}`,
                rename: { value: run.name ?? defaultName, save: name => actions.renameRun(run, name === defaultName ? '' : name) },
                title: [...(run.name ? [`Prompts: ${defaultName}`] : []), `Started ${new Date(run.createdAt).toLocaleString()}`, `${run.request.model} · ${run.request.effort} effort`,
                  ...Object.entries(run.inputs).map(([name, input]) => `${name}: ${input.name}`), ...Object.values(run.contexts ?? {}).map(context => `context: ${context.name}`),
                  ...(run.request.task ? [`task: ${run.request.task}`] : [])].join('\n'),
                meta: runProgress(run), onContextMenu: at => actions.runMenu(run, at),
                onDelete: { label: `Delete run #${numbers.get(run.id)} and its outputs${reruns.length ? ' and reruns' : ''}`, run: () => actions.deleteRun(run) }, children: [...children, ...reruns] };
            }),
            ...loose.map((canvas): NavNode => ({ id: `output:${canvas.id}`, label: canvas.name, meta: canvas.generated!.stage === 'legacy' ? 'legacy' : undefined,
              pick: { canvasId: canvas.id, label: canvas.name },
              current: selection?.kind === 'canvas' && selection.id === canvas.id, onOpen: () => actions.open({ kind: 'canvas', id: canvas.id }),
              onDelete: { label: `Delete output ${canvas.name}`, run: () => actions.deleteCanvas(canvas.id, canvas.name) } })),
            ...comparisonsNode
          ] };
      });
      return { id: `workflow:${workflow.id}`, label: workflow.label, meta: children.length ? undefined : 'no outputs yet', children };
    });
    const other = [...pending.filter(run => !placed.has(run.id)).map(pendingNode), ...sessions.filter(session => !placed.has(session.id)).map(sessionNode)];
    if (other.length) roots.push({ id: 'other', label: 'Other comparisons', meta: String(other.length), children: other });
    return roots;
  }, [runs, generated, sessions, comparisons, selection, numbers]);
  const pickedIds = new Set(picked.map(item => item.canvasId));
  /** Ancestors of the open item stay expanded so it is always visible. */
  const holdsCurrent = (node: NavNode): boolean => !!node.current || (node.children ?? []).some(holdsCurrent);

  const expandedOf = (node: NavNode) => !!node.closed === toggled.has(node.id) || (node.children ?? []).some(holdsCurrent);
  const row = (node: NavNode, depth: number): ReactNode => {
    const children = node.children ?? [], expanded = children.length > 0 && expandedOf(node);
    const open = node.onOpen ?? (children.length ? () => toggle(node.id) : undefined);
    const menu = (event: MouseEvent) => { if (!node.onContextMenu) return; event.preventDefault(); node.onContextMenu({ x: event.clientX, y: event.clientY }); };
    const keys = (event: KeyboardEvent) => {
      if (node.onContextMenu && (event.key === 'ContextMenu' || event.key === 'F10' && event.shiftKey)) {
        event.preventDefault(); const box = event.currentTarget.getBoundingClientRect(); node.onContextMenu({ x: box.left + 24, y: box.bottom });
      }
      if (children.length && (event.key === 'ArrowRight' && !expanded || event.key === 'ArrowLeft' && expanded)) { event.preventDefault(); toggle(node.id); }
    };
    return <li key={node.id} role="treeitem" aria-level={depth + 1} aria-expanded={children.length ? expanded : undefined} aria-current={node.current ? 'page' : undefined}>
      <div className={`evals-tree-row${node.current ? ' is-current' : ''}${node.muted ? ' is-muted' : ''}`} style={{ paddingLeft: 4 + depth * 14 }} onContextMenu={menu} title={node.title}>
        {children.length ? <button type="button" tabIndex={-1} className="evals-tree-chevron" aria-label={`${expanded ? 'Collapse' : 'Expand'} ${node.label}`} onClick={() => toggle(node.id)}>{expanded ? '▾' : '▸'}</button>
          : <span className="evals-tree-chevron" aria-hidden />}
        {node.pick && <input type="checkbox" className="evals-tree-pick" aria-label={`Select ${node.pick.label} for comparison`} checked={pickedIds.has(node.pick.canvasId)}
          onChange={event => onPick(node.pick!, event.target.checked)} />}
        {node.status && <span className="evals-dot" data-status={node.status} role="img" aria-label={statusLabel[node.status as keyof typeof statusLabel] ?? node.status} />}
        {node.rename && renaming && node.id === `run:${renaming}` ? <RenameField value={node.rename.value} label={`Rename ${node.label}`}
          onDone={name => { if (name !== undefined && name !== node.rename!.value) node.rename!.save(name); onRenameEnd(); }} />
          : <button type="button" className="evals-tree-label" onClick={open} onKeyDown={keys} aria-haspopup={node.onContextMenu ? 'menu' : undefined}>
            <span title={node.label}>{node.label}</span>
          </button>}
        {node.meta && <span className="evals-tree-meta">{node.meta}</span>}
        {node.onDelete && <button type="button" className="evals-tree-delete" aria-label={node.onDelete.label} title={node.onDelete.label} onClick={node.onDelete.run}><TrashIcon /></button>}
      </div>
      {expanded && <ul role="group">{children.map(child => row(child, depth + 1))}</ul>}
    </li>;
  };
  return <ul role="tree" aria-label="Evals outputs" className="evals-tree">{nodes.map(node => row(node, 0))}</ul>;
}

/** Enter or blur saves; Escape cancels (`undefined`). */
function RenameField({ value, label, onDone }: { value: string; label: string; onDone: (name?: string) => void }) {
  const [text, setText] = useState(value), done = useRef(false);
  const finish = (name?: string) => { if (done.current) return; done.current = true; onDone(name); };
  return <input className="evals-tree-rename" aria-label={label} value={text} maxLength={120} autoFocus onFocus={event => event.target.select()}
    onChange={event => setText(event.target.value)} onBlur={() => finish(text.trim())}
    onKeyDown={event => { if (event.key === 'Enter') { event.preventDefault(); finish(text.trim()); } if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); finish(); } }} />;
}

export const TrashIcon = () => <svg width="13" height="13" viewBox="0 0 16 16" aria-hidden="true"><path fill="currentColor" d="M6 1h4l1 1h3v2H2V2h3zm-3 4h10l-1 10H4zm3 2v6h1V7zm3 0v6h1V7z" /></svg>;
