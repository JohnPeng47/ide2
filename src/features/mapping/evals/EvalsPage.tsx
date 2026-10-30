import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ComparePageSession } from '../../../../domain/mapping/compare/comparePageSession';
import type { ComparisonRunSummary } from '../../../../domain/mapping/compare/comparisonGeneration';
import { latestVersion, type EvalPrompt } from '../../../../domain/mapping/evals/evalPrompt';
import type { EvalRunSummary } from '../../../../domain/mapping/evals/evalRun';
import { evalWorkflowIds, evalWorkflows, type EvalWorkflowId } from '../../../../domain/mapping/evals/evalWorkflows';
import { comparisonRuns, deleteCompareSession, deleteComparisonRun, listCompareSessions, readCompareSession } from './compareApi';
import { cancelRun, renameRun, deleteContextOutputs, deleteGenerated, deleteRun, listGenerated, listPrompts, listRuns, migrateGenerated } from './evalsApi';
import { errorMessage, relativeTime, runActive, runNumbers, runProgress, runTitle, statusLabel } from './evalsFormat';
import { EvalsTree, type EvalsSelection, type PickedOutput, type TreeActions } from './EvalsTree';
import { PopoverMenu, type MenuSection } from './PopoverMenu';
import { CanvasPreview } from './CanvasPreview';
import { candidateKey } from './CanvasPicker';
import { PromptEditor } from './PromptEditor';
import { RunLauncher, type RunLaunch } from './RunLauncher';
import { OutputView } from './OutputView';
import { CompareBar } from './CompareBar';
import { ComparisonView } from './ComparisonView';
import { CompareLauncher } from './CompareLauncher';
import './evals.css';

type Route = { kind: 'home' } | { kind: 'prompt'; id: string; version?: number } | { kind: 'new-prompt'; workflow: EvalWorkflowId; from?: string }
  | { kind: 'run'; id: string; output?: string } | { kind: 'session'; id: string } | { kind: 'canvas'; id: string };
function readRoute(): Route {
  const params = new URLSearchParams(location.search);
  const id = (key: string) => params.get(key) ?? '';
  if (params.has('prompt')) return { kind: 'prompt', id: id('prompt'), ...(Number(id('version')) > 0 ? { version: Number(id('version')) } : {}) };
  if (params.has('new-prompt') && evalWorkflowIds.includes(id('new-prompt') as EvalWorkflowId))
    return { kind: 'new-prompt', workflow: id('new-prompt') as EvalWorkflowId, ...(params.has('from') ? { from: id('from') } : {}) };
  if (params.has('run')) return { kind: 'run', id: id('run'), ...(params.has('output') ? { output: id('output') } : {}) };
  if (params.has('canvas')) return { kind: 'canvas', id: id('canvas') };
  if (params.has('session')) return { kind: 'session', id: id('session') };
  return { kind: 'home' };
}
function routeUrl(route: Route) {
  const url = new URL(location.href); url.search = '';
  if (route.kind === 'prompt' || route.kind === 'run' || route.kind === 'session' || route.kind === 'canvas') url.searchParams.set(route.kind, route.id);
  if (route.kind === 'run' && route.output) url.searchParams.set('output', route.output);
  if (route.kind === 'prompt' && route.version) url.searchParams.set('version', String(route.version));
  if (route.kind === 'new-prompt') { url.searchParams.set('new-prompt', route.workflow); if (route.from) url.searchParams.set('from', route.from); }
  return url;
}
/** Polls quickly only while work is running. */
function usePolled<T>(load: () => Promise<T>, active: (value: T) => boolean, onError: (error: unknown) => void) {
  const [value, setValue] = useState<T>();
  const refresh = useRef<() => Promise<void>>(async () => {});
  useEffect(() => {
    let closed = false, timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      clearTimeout(timer);
      let next = 20000;
      try { const result = await load(); if (closed) return; setValue(result); if (active(result)) next = 2500; }
      catch (error) { if (!closed) onError(error); }
      if (!closed) timer = setTimeout(() => void poll(), next);
    };
    refresh.current = poll; void poll();
    return () => { closed = true; clearTimeout(timer); };
  }, []);
  return [value, useCallback(() => refresh.current(), [])] as const;
}

export function EvalsPage() {
  const [route, setRoute] = useState(readRoute);
  const [error, setError] = useState('');
  const onError = useCallback((error: unknown) => setError(errorMessage(error)), []);
  const [prompts, setPrompts] = useState<EvalPrompt[]>();
  const [runs, refreshRuns] = usePolled(listRuns, items => items.some(runActive), onError);
  const [sessions, refreshSessions] = usePolled(listCompareSessions, () => false, onError);
  const [comparisons, refreshComparisons] = usePolled(comparisonRuns, items => items.some(item => item.status === 'queued' || item.status === 'generating'), onError);
  const [session, setSession] = useState<ComparePageSession>();
  const [launch, setLaunch] = useState<RunLaunch | 'compare'>();
  const [generated, refreshGenerated] = usePolled(listGenerated, () => false, onError);
  const [picked, setPicked] = useState<PickedOutput[]>([]);
  const [renaming, setRenaming] = useState<string>();
  const [menu, setMenu] = useState<{ label: string; at: { x: number; y: number }; sections: MenuSection[] }>();
  const [navWidth, setNavWidth] = useState(() => Number(localStorage.getItem('evals-nav-width')) || 300);
  const layout = useRef<HTMLDivElement>(null);
  const resize = (width: number) => { const next = Math.round(Math.max(200, Math.min(560, width))); setNavWidth(next); localStorage.setItem('evals-nav-width', String(next)); };
  const dirty = useRef(false);
  const setDirty = useCallback((value: boolean) => { dirty.current = value; }, []);
  const numbers = useMemo(() => runNumbers(runs ?? []), [runs]);

  useEffect(() => { void listPrompts().then(setPrompts).catch(onError); void migrateGenerated().catch(() => {}); }, [onError]);
  useEffect(() => {
    const back = () => { setRoute(readRoute()); dirty.current = false; };
    window.addEventListener('popstate', back); return () => window.removeEventListener('popstate', back);
  }, []);
  useEffect(() => {
    const leave = (event: BeforeUnloadEvent) => { if (dirty.current) event.preventDefault(); };
    window.addEventListener('beforeunload', leave); return () => window.removeEventListener('beforeunload', leave);
  }, []);
  // A finished LLM comparison publishes a session; refresh the list when one completes.
  const finished = comparisons?.filter(item => item.status === 'finished').length;
  useEffect(() => { if (finished !== undefined) void refreshSessions(); }, [finished, refreshSessions]);
  // New outputs appear as runs progress.
  const produced = runs?.reduce((sum, item) => sum + item.cells.filter(cell => cell.canvasId).length, 0);
  useEffect(() => { if (produced !== undefined) void refreshGenerated(); }, [produced, refreshGenerated]);
  // Deleted outputs leave the comparison selection.
  useEffect(() => { if (generated) setPicked(current => current.filter(item => generated.some(canvas => canvas.id === item.canvasId))); }, [generated]);
  const sessionId = route.kind === 'session' ? route.id : undefined;
  useEffect(() => {
    if (!sessionId) { setSession(undefined); return; }
    if (session?.id === sessionId) return;
    let closed = false; setSession(undefined);
    void readCompareSession(sessionId).then(value => { if (!closed) setSession(value); }).catch(error => { if (!closed) onError(error); });
    return () => { closed = true; };
  }, [sessionId]);

  const go = (next: Route) => {
    if (dirty.current && !confirm('Discard unsaved prompt edits?')) return;
    dirty.current = false; setError('');
    history.pushState(null, '', routeUrl(next)); setRoute(next);
  };
  const savedPrompt = (prompt: EvalPrompt) => {
    setPrompts(previous => [...(previous ?? []).filter(item => item.id !== prompt.id), prompt].sort((a, b) => Number(!!b.builtin) - Number(!!a.builtin) || a.createdAt.localeCompare(b.createdAt)));
    dirty.current = false;
    // After a save the editor shows the latest version, not the one a run link opened.
    if (route.kind !== 'prompt' || route.id !== prompt.id || route.version) { history.replaceState(null, '', routeUrl({ kind: 'prompt', id: prompt.id })); setRoute({ kind: 'prompt', id: prompt.id }); }
  };
  const openSession = (value: ComparePageSession) => {
    setSession(value); void refreshSessions(); setLaunch(undefined); go({ kind: 'session', id: value.id });
  };
  const started = (run: EvalRunSummary) => { setLaunch(undefined); void refreshRuns(); go({ kind: 'run', id: run.id }); };
  const comparisonStarted = (_: ComparisonRunSummary) => { void refreshComparisons(); };

  const current = route.kind === 'prompt' ? prompts?.find(prompt => prompt.id === route.id) : undefined;
  const run = route.kind === 'run' ? runs?.find(item => item.id === route.id) : undefined;
  const loading = !prompts || !runs || !sessions;
  const refreshAll = () => Promise.all([refreshRuns(), refreshGenerated(), refreshSessions(), refreshComparisons()]);
  /** Confirms, deletes, refreshes, and leaves a view whose subject is gone. */
  const remove = async (question: string, task: () => Promise<unknown>, leaves: (route: Route) => boolean) => {
    if (!confirm(question)) return;
    try { await task(); if (leaves(route)) go({ kind: 'home' }); } catch (error) { onError(error); }
    await refreshAll();
  };
  // A run opens on the requested output, else its first finished (or first) output.
  const shownCell = run && (run.cells.find(item => item.key === (route.kind === 'run' ? route.output : undefined))
    ?? run.cells.find(item => item.status === 'finished' && !item.deleted) ?? run.cells[0]);
  const selection: EvalsSelection | undefined = route.kind === 'run' ? { kind: 'run', id: route.id, output: shownCell?.key }
    : route.kind === 'canvas' || route.kind === 'session' ? { kind: route.kind, id: route.id } : undefined;
  const treeActions: TreeActions = {
    open: target => target.kind === 'run' ? go({ kind: 'run', id: target.id, ...(target.output ? { output: target.output } : {}) })
      : target.kind === 'canvas' || target.kind === 'session' ? go({ kind: target.kind, id: target.id }) : undefined,
    deleteRun: item => {
      const family = [item, ...(runs ?? []).filter(other => other.parentRunId === item.id)];
      const outputs = family.reduce((sum, member) => sum + member.cells.filter(cell => cell.canvasId && !cell.deleted).length, 0);
      void remove(`Delete run #${numbers.get(item.id)}${family.length > 1 ? `, its ${family.length - 1} rerun${family.length > 2 ? 's' : ''}` : ''} and ${outputs} outputs?`,
        () => deleteRun(item.id), current => current.kind === 'run' && family.some(member => member.id === current.id));
    },
    deleteCanvas: (id, name) => void remove(`Delete output “${name}”?`, () => deleteGenerated(id), current => current.kind === 'canvas' && current.id === id),
    deleteContext: context => void remove(`Delete all ${context.outputs} outputs, runs and comparisons generated from “${context.name}” (${context.workflow === 'roll-up' ? 'roll-ups' : 'alternatives'})? The AgentContext itself is kept.`,
      () => deleteContextOutputs(context.id, context.workflow), current => current.kind === 'run' && runs?.find(item => item.id === current.id)?.agentContextId === context.id),
    deleteSession: item => void remove(`Delete comparison “${item.title}”?`, () => deleteCompareSession(item.id), current => current.kind === 'session' && current.id === item.id),
    deleteComparisonRun: item => void remove(`Delete comparison “${item.request.title}”?`, () => deleteComparisonRun(item.id), () => false),
    runMenu: (item, at) => setMenu({ label: `Run #${numbers.get(item.id)}`, at, sections: [{ label: `Run #${numbers.get(item.id)} · ${item.contextName}`, items: [
      // Opens the exact version the run pinned; prompts deleted or unknown (legacy runs) are skipped.
      ...item.prompts.filter(pinned => prompts?.some(prompt => prompt.id === pinned.promptId)).map(pinned => ({
        label: item.prompts.length > 1 ? `Edit prompt “${pinned.name}”` : 'Edit prompt', detail: `v${pinned.version}`,
        onSelect: () => go({ kind: 'prompt', id: pinned.promptId, version: pinned.version }) })),
      { label: 'Rerun…', onSelect: () => setLaunch({ workflow: item.workflow, rerun: item }) },
      ...(item.legacy ? [] : [{ label: 'Rename', onSelect: () => setRenaming(item.id) }]),
      ...(runActive(item) && !item.legacy ? [{ label: 'Cancel run', onSelect: () => void cancelRun(item.id).then(() => refreshRuns()).catch(onError) }] : []),
      { label: 'Delete run…', danger: true, onSelect: () => treeActions.deleteRun(item) }
    ] }] }),
    renameRun: (item, name) => void renameRun(item.id, name).then(() => refreshRuns()).catch(onError),
    contextMenu: (context, at) => setMenu({ label: context.name, at, sections: [{ label: context.name, items: [
      { label: 'New run from this context…', onSelect: () => {
        if (context.workflow === 'alternatives') { setLaunch({ workflow: 'alternatives', contextId: context.id }); return; }
        // Roll-ups reuse the latest run's child and parent canvases.
        const latest = context.runs[0];
        setLaunch({ workflow: 'roll-up', canvasKeys: latest ? ['child', 'parent'].flatMap(name => latest.inputs[name] ? [candidateKey(latest.inputs[name].source)] : []) : [] });
      } },
      { label: 'Delete outputs…', danger: true, onSelect: () => treeActions.deleteContext({ id: context.id, name: context.name, workflow: context.workflow,
        outputs: context.runs.reduce((sum, item) => sum + item.cells.filter(cell => cell.canvasId && !cell.deleted).length, 0) }) }
    ] }] }),
  };
  const promptsMenu = (at: { x: number; y: number }) => setMenu({ label: 'Prompts', at, sections: evalWorkflowIds.map(id => ({ label: evalWorkflows[id].label, items: [
    ...(prompts ?? []).filter(prompt => prompt.workflow === id).map(prompt => ({ label: prompt.name, detail: `v${latestVersion(prompt).version}${prompt.archivedAt ? ' · archived' : ''}`,
      muted: !!prompt.archivedAt, onSelect: () => go({ kind: 'prompt', id: prompt.id }) })),
    { label: `+ New ${evalWorkflows[id].label.toLowerCase()} prompt`, onSelect: () => go({ kind: 'new-prompt', workflow: id }) }
  ] })) });
  const canvas = route.kind === 'canvas' ? generated?.find(item => item.id === route.id) : undefined;

  const content = () => {
    if (route.kind === 'prompt') return current ? <PromptEditor key={`${current.id}:${latestVersion(current).version}:${route.version ?? ''}`} prompt={current} version={route.version} onSaved={savedPrompt} onDirty={setDirty}
      onRun={prompt => setLaunch({ workflow: prompt.workflow, promptIds: [prompt.id] })} onDuplicate={prompt => go({ kind: 'new-prompt', workflow: prompt.workflow, from: prompt.id })} />
      : prompts && <p className="evals-message">Prompt not found.</p>;
    if (route.kind === 'new-prompt') {
      const from = route.from ? prompts?.find(prompt => prompt.id === route.from) : undefined;
      if (route.from && !prompts) return null;
      return <PromptEditor key={`new:${route.workflow}:${route.from ?? ''}`} draft={{ workflow: route.workflow, from }} onSaved={savedPrompt} onDirty={setDirty}
        onRun={() => {}} onDuplicate={() => {}} />;
    }
    if (route.kind === 'canvas') return generated && (canvas ? <div className="output-view"><CanvasPreview key={canvas.id} canvasId={canvas.id} bare /></div>
      : <p className="evals-message">This output was deleted.</p>);
    if (route.kind === 'run') {
      if (!runs) return null;
      if (!run) return <p className="evals-message">Run not found.</p>;
      return <OutputView key={`${run.id}:${shownCell!.key}`} cell={shownCell!} />;
    }
    if (route.kind === 'session') return session ? <ComparisonView key={session.id} session={session} prompts={prompts ?? []} />
      : !error && <p role="status" className="evals-message">Loading comparison…</p>;
    return home();
  };

  function home() {
    return <div className="evals-home">
      <h2>Generate, then compare</h2>
      <p className="evals-muted">Write prompt versions for a workflow, run several at once against the same inputs, and compare their outputs side by side.</p>
      <div className="evals-home-cards">
        {evalWorkflowIds.map(id => { const workflow = evalWorkflows[id], count = prompts?.filter(prompt => prompt.workflow === id && !prompt.archivedAt).length ?? 0;
          return <section key={id} className="evals-card" aria-label={`${workflow.label} workflow`}>
            <h3>{workflow.label}</h3><p>{workflow.description}</p>
            <p className="evals-muted">{count} prompt{count === 1 ? '' : 's'} · {workflow.stages.map(stage => stage.id).join(' → ')}</p>
            <div className="evals-actions"><button type="button" onClick={() => go({ kind: 'new-prompt', workflow: id })}>New prompt</button>
              <button type="button" className="is-primary" onClick={() => setLaunch({ workflow: id })}>New run…</button></div>
          </section>; })}
      </div>
      {!!runs?.length && <section aria-label="Recent runs"><h3>Recent runs</h3><ul className="evals-recent">{runs.slice(0, 5).map(item => <li key={item.id}>
        <button type="button" className="evals-link" onClick={() => go({ kind: 'run', id: item.id })}>{runTitle(item, numbers.get(item.id))}</button>
        <span className="evals-status" data-status={item.status}>{statusLabel[item.status]}</span><span className="evals-muted">{runProgress(item)} · {relativeTime(item.createdAt)}</span>
      </li>)}</ul></section>}
    </div>;
  }

  return <main className="evals-page">
    <header className="evals-header">
      <a href={import.meta.env.BASE_URL}>← Mapping</a>
      <h1><button type="button" className="evals-home-link" onClick={() => go({ kind: 'home' })}>Evals</button></h1>
      <span className="evals-muted">Prompt workflows, runs and comparisons</span>
      <span className="evals-spacer" />
      <button type="button" aria-haspopup="menu" onClick={event => { const box = event.currentTarget.getBoundingClientRect(); promptsMenu({ x: box.left, y: box.bottom + 4 }); }}>Prompts ▾</button>
      <button type="button" onClick={() => setLaunch('compare')}>New comparison</button>
      <button type="button" className="is-primary" onClick={() => setLaunch({ workflow: route.kind === 'prompt' && current ? current.workflow : 'roll-up' })}>New run</button>
    </header>
    <div className="evals-layout" ref={layout} style={{ gridTemplateColumns: `${navWidth}px 5px minmax(0, 1fr)` }}>
      <nav className="evals-nav" aria-label="Evals">
        {runs && generated && sessions ? <EvalsTree runs={runs} generated={generated} sessions={sessions} comparisons={comparisons ?? []} selection={selection} actions={treeActions} renaming={renaming} onRenameEnd={() => setRenaming(undefined)}
          picked={picked} onPick={(output, on) => setPicked(current => on ? [...current.filter(item => item.canvasId !== output.canvasId), output] : current.filter(item => item.canvasId !== output.canvasId))} />
          : <p role="status" className="evals-muted">Loading…</p>}
        {picked.length > 0 && runs && <CompareBar picked={picked} runs={runs} onClear={() => setPicked([])} onSession={openSession} onComparisonStarted={comparisonStarted} />}
      </nav>
      <div role="separator" aria-label="Resize sidebar" aria-orientation="vertical" aria-valuemin={200} aria-valuemax={560} aria-valuenow={navWidth} tabIndex={0}
        className="evals-divider evals-nav-divider" onDoubleClick={() => resize(300)}
        onKeyDown={event => { if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') { event.preventDefault(); resize(navWidth + (event.key === 'ArrowLeft' ? -16 : 16)); } if (event.key === 'Home') resize(300); }}
        onPointerDown={event => { if (event.button === 0) { event.preventDefault(); event.currentTarget.setPointerCapture(event.pointerId); } }}
        onPointerMove={event => { if (event.currentTarget.hasPointerCapture(event.pointerId)) resize(event.clientX - layout.current!.getBoundingClientRect().left); }}
        onPointerUp={event => { if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId); }} />
      <section className="evals-content">
        {error && <p role="alert" className="evals-error">{error} <button type="button" className="evals-link" onClick={() => setError('')}>Dismiss</button></p>}
        {loading && route.kind === 'home' ? <p role="status" className="evals-message">Loading…</p> : content()}
      </section>
    </div>
    {launch === 'compare' && <CompareLauncher onClose={() => setLaunch(undefined)} onCreated={openSession} />}
    {menu && <PopoverMenu label={menu.label} at={menu.at} sections={menu.sections} onClose={() => setMenu(undefined)} />}
    {launch && launch !== 'compare' && prompts && <RunLauncher prompts={prompts} runs={runs ?? []} initial={launch} onClose={() => setLaunch(undefined)} onStarted={started} />}
  </main>;
}
