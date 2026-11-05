import { experimentOutputSequence, useArrowNavigation } from './evalNavigation';
import { ExperimentExplorer, type ExperimentRoute } from './ExperimentExplorer';
import { ExperimentView } from './ExperimentView';
import { experimentJudgementIds } from '../../../../domain/mapping/evals/experiment';
import { LayoutTemplates } from './LayoutTemplates';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ConfirmDialog, type Confirmation } from './ConfirmDialog';
import { generatedWorkflow } from '../../../../domain/core/diagrams/generatedCanvas';
import type { ComparePageSession } from '../../../../domain/mapping/compare/comparePageSession';
import type { ComparisonRunSummary } from '../../../../domain/mapping/compare/comparisonGeneration';
import { latestVersion, type EvalPrompt } from '../../../../domain/mapping/evals/evalPrompt';
import type { EvalRunSummary } from '../../../../domain/mapping/evals/evalRun';
import { evalWorkflowIds, evalWorkflows, type EvalWorkflowId } from '../../../../domain/mapping/evals/evalWorkflows';
import { comparisonRuns, deleteCompareSession, deleteComparisonRun, listCompareSessions, readCompareSession } from './compareApi';
import { listExperiments, listJudgements, deleteJudgement, listReferences, listReferenceGroups, createReferenceGroup, renameReferenceGroup, deleteReferenceGroup, updateReference, readPrompt, rerunChat, cancelRun, renameRun, deleteContextOutputs, deleteGenerated, deleteRun, deleteRuns, listGenerated, listPrompts, listRuns, migrateGenerated } from './evalsApi';
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
import { JudgementsPane } from './JudgementsPane';
import { CompareLauncher } from './CompareLauncher';
import { loadCandidates, ReferencesLanding, ReferenceView, ReferenceWorkbench, useReferenceCaptures, type ReferenceTarget } from './References';
import { ReferenceExplorer } from './ReferenceExplorer';
import { diagramLeafKey, type DiagramLeaf } from '../../../../domain/mapping/evals/referenceExplorer';
import type { CompareCandidate } from '../../../../domain/mapping/compare/comparePageSession';
import { MappingServicesContext, type MappingServices } from '../services/MappingServices';
import type { EvalReference, EvalReferenceGroup } from '../../../../domain/mapping/evals/evalReference';
import './evals.css';

type Route = ExperimentRoute | { kind: 'home' } | { kind: 'prompt'; id: string; version?: number } | { kind: 'new-prompt'; workflow: EvalWorkflowId; from?: string; fromVersion?: number }
  | { kind: 'run'; id: string; output?: string } | { kind: 'session'; id: string } | { kind: 'canvas'; id: string }
  | { kind: 'references' } | { kind: 'reference'; id: string } | { kind: 'new-reference'; target?: ReferenceTarget } | { kind: 'judgements'; id?: string; judgementId?: string; entry?: 'first' | 'last' };
function readRoute(): Route {
  const params = new URLSearchParams(location.search);
  const id = (key: string) => params.get(key) ?? '';
  if (params.has('experiment')) return { kind: 'experiment', id: id('experiment'), ...(['overview', 'outputs', 'judgements'].includes(id('view')) ? { view: id('view') as ExperimentRoute['view'] } : {}), ...(params.has('phase') ? { phaseId: id('phase') } : {}), ...(params.has('group') ? { groupId: id('group') } : {}) };
  if (params.has('prompt')) return { kind: 'prompt', id: id('prompt'), ...(Number(id('version')) > 0 ? { version: Number(id('version')) } : {}) };
  if (params.has('new-prompt') && evalWorkflowIds.includes(id('new-prompt') as EvalWorkflowId))
    return { kind: 'new-prompt', workflow: id('new-prompt') as EvalWorkflowId, ...(params.has('from') ? { from: id('from') } : {}), ...(Number(id('from-version')) > 0 ? { fromVersion: Number(id('from-version')) } : {}) };
  if (params.has('judgements')) return { kind: 'judgements', ...(params.has('run') ? { id: id('run') } : {}), ...(params.has('judgement') ? { judgementId: id('judgement') } : {}), ...(id('entry') === 'last' ? { entry: 'last' as const } : {}) };
  if (params.has('run')) return { kind: 'run', id: id('run'), ...(params.has('output') ? { output: id('output') } : {}) };
  if (params.has('reference')) return { kind: 'reference', id: id('reference') };
  if (params.has('references')) return { kind: 'references' };
  if (params.has('new-reference')) return { kind: 'new-reference', ...(params.has('document') && params.has('checkpoint') && params.has('diagram')
    ? { target: { source: { documentId: id('document'), ...(params.has('view') ? { viewId: id('view') } : {}), checkpointId: id('checkpoint') }, diagramId: id('diagram') } } : {}) };
  if (params.has('canvas')) return { kind: 'canvas', id: id('canvas') };
  if (params.has('session')) return { kind: 'session', id: id('session') };
  return { kind: 'home' };
}
function routeUrl(route: Route) {
  const url = new URL(location.href); url.search = '';
  if (route.kind === 'prompt' || route.kind === 'run' || route.kind === 'session' || route.kind === 'canvas' || route.kind === 'reference') url.searchParams.set(route.kind, route.id);
  if (route.kind === 'experiment') { url.searchParams.set('experiment', route.id); if (route.view) url.searchParams.set('view', route.view); if (route.groupId) url.searchParams.set('group', route.groupId); if (route.phaseId) url.searchParams.set('phase', route.phaseId); }
  if (route.kind === 'judgements') { url.searchParams.set('judgements', ''); if (route.id) url.searchParams.set('run', route.id); if (route.judgementId) url.searchParams.set('judgement', route.judgementId); if (route.entry === 'last') url.searchParams.set('entry', 'last'); }
  if (route.kind === 'references') url.searchParams.set('references', '');
  if (route.kind === 'new-reference') { url.searchParams.set('new-reference', ''); if (route.target) { const { source, diagramId } = route.target;
    url.searchParams.set('document', source.documentId); if (source.viewId) url.searchParams.set('view', source.viewId); url.searchParams.set('checkpoint', source.checkpointId); url.searchParams.set('diagram', diagramId); } }
  if (route.kind === 'run' && route.output) url.searchParams.set('output', route.output);
  if (route.kind === 'prompt' && route.version) url.searchParams.set('version', String(route.version));
  if (route.kind === 'new-prompt') { url.searchParams.set('new-prompt', route.workflow); if (route.from) url.searchParams.set('from', route.from); if (route.fromVersion) url.searchParams.set('from-version', String(route.fromVersion)); }
  return url;
}
/** Polls quickly only while work is running. */
function usePolled<T>(load: () => Promise<T>, active: (value: T) => boolean, onError: (error: unknown) => void) {
  const [value, setValue] = useState<T>();
  const refresh = useRef<() => Promise<void>>(async () => {});
  const revision = useRef(0);
  useEffect(() => {
    let closed = false, timer: ReturnType<typeof setTimeout>;
    let inFlight: Promise<void> | undefined;
    const poll = (): Promise<void> => {
      if (inFlight) return inFlight;
      clearTimeout(timer);
      const at = revision.current;
      inFlight = (async () => {
        let next = 20000;
        try { const result = await load(); if (closed) return;
          if (at === revision.current) setValue(result);
          else next = 0;
          if (next && active(result)) next = 2500;
        } catch (error) { if (!closed) onError(error); }
        finally { inFlight = undefined; if (!closed) timer = setTimeout(() => void poll(), next); }
      })();
      return inFlight;
    };
    refresh.current = poll; void poll();
    return () => { closed = true; clearTimeout(timer); };
  }, []);
  const update = useCallback((change: (current: T | undefined) => T | undefined) => { revision.current++; setValue(change); }, []);
  return [value, useCallback(() => refresh.current(), []), update] as const;
}

/** Mapping services let the reference creator reuse Mapping's selection canvas. */
export function EvalsPage({ services }: { services?: MappingServices }) {
  const page = <EvalsWorkspace />;
  return services ? <MappingServicesContext.Provider value={services}>{page}</MappingServicesContext.Provider> : page;
}
function EvalsWorkspace() {
  const [templatesOpen, setTemplatesOpen] = useState(false);
  const [route, setRoute] = useState(readRoute);
  const [error, setError] = useState('');
  const [confirmation, setConfirmation] = useState<Confirmation>();
  const onError = useCallback((error: unknown) => setError(errorMessage(error)), []);
  const [prompts, setPrompts] = useState<EvalPrompt[]>();
  const [experiments, refreshExperiments] = usePolled(listExperiments, () => false, onError);
  const [runs, refreshRuns, updateRuns] = usePolled(listRuns, items => items.some(runActive), onError);
  const [sessions, refreshSessions] = usePolled(listCompareSessions, () => false, onError);
  const [comparisons, refreshComparisons] = usePolled(comparisonRuns, items => items.some(item => item.status === 'queued' || item.status === 'generating'), onError);
  const [judgements, refreshJudgements] = usePolled(listJudgements, items => items.some(item => item.status === 'queued' || item.status === 'generating'), onError);
  const [session, setSession] = useState<ComparePageSession>();
  const [launch, setLaunch] = useState<RunLaunch | 'compare'>();
  const [generated, refreshGenerated, updateGenerated] = usePolled(listGenerated, () => false, onError);
  const [picked, setPicked] = useState<PickedOutput[]>([]);
  const [renaming, setRenaming] = useState<string>();
  /** All references, archived included: archived ones still resolve in the prompts that cite them. */
  const [references, setReferences] = useState<EvalReference[]>();
  const activeReferences = useMemo(() => references?.filter(item => !item.archivedAt) ?? [], [references]);
  const [referenceGroups, setReferenceGroups] = useState<EvalReferenceGroup[]>([]);
  const groupChanged = useCallback((group: EvalReferenceGroup) => setReferenceGroups(current => [...current.filter(item => item.id !== group.id), group].sort((a, b) => a.name.localeCompare(b.name))), []);
  const [captures, setCaptures] = useReferenceCaptures();
  const [candidates, setCandidates] = useState<CompareCandidate[]>(), [candidatesError, setCandidatesError] = useState('');
  const inReferences = route.kind === 'references' || route.kind === 'reference' || route.kind === 'new-reference';
  const lastDiagram = useRef<ReferenceTarget>(undefined);
  if (route.kind === 'new-reference' && route.target) lastDiagram.current = route.target;
  const refreshReferences = useCallback(() => listReferences(true).then(setReferences).catch(onError), [onError]);
  const referenceChanged = useCallback((reference: EvalReference) => setReferences(current => [reference, ...(current ?? []).filter(item => item.id !== reference.id)]
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))), []);
  const [menu, setMenu] = useState<{ label: string; at: { x: number; y: number }; sections: MenuSection[] }>();
  const [navWidth, setNavWidth] = useState(() => Number(localStorage.getItem('evals-nav-width')) || 300);
  const layout = useRef<HTMLDivElement>(null);
  const resize = (width: number) => { const next = Math.round(Math.max(200, Math.min(560, width))); setNavWidth(next); localStorage.setItem('evals-nav-width', String(next)); };
  const dirty = useRef(false);
  const setDirty = useCallback((value: boolean) => { dirty.current = value; }, []);
  const numbers = useMemo(() => runNumbers(runs ?? []), [runs]);

  const [polledPrompts] = usePolled(listPrompts, () => false, onError);
  useEffect(() => { if (polledPrompts && !dirty.current) setPrompts(polledPrompts); }, [polledPrompts]);
  useEffect(() => { void migrateGenerated().then(() => refreshAll()).catch(onError); }, []);
  const promptRouteId = route.kind === 'prompt' ? route.id : undefined;
  const promptRouteVersion = route.kind === 'prompt' ? route.version : undefined;
  useEffect(() => {
    if (!promptRouteId) return;
    let closed = false;
    void readPrompt(promptRouteId).then(prompt => {
      if (!closed && !dirty.current) setPrompts(current => [...(current ?? []).filter(item => item.id !== prompt.id), prompt]);
    }).catch(error => { if (!closed) onError(error); });
    return () => { closed = true; };
  }, [promptRouteId, promptRouteVersion, onError]);
  useEffect(() => { void refreshReferences(); void listReferenceGroups().then(setReferenceGroups).catch(onError); }, [refreshReferences, onError]);
  // The diagram list is only needed in the Canvas tab, and entering it picks up canvases saved since.
  const canvasTab = route.kind === 'new-reference';
  useEffect(() => {
    if (!canvasTab) return;
    let closed = false; setCandidatesError('');
    void loadCandidates().then(value => { if (!closed) setCandidates(value); }).catch(error => { if (!closed) setCandidatesError(errorMessage(error)); });
    return () => { closed = true; };
  }, [canvasTab]);
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
    const navigate = () => { dirty.current = false; setError(''); history.pushState(null, '', routeUrl(next)); setRoute(next); };
    if (dirty.current) setConfirmation({ title: 'Discard edits', message: 'Discard unsaved prompt edits?', confirmLabel: 'Discard', onConfirm: navigate });
    else navigate();
  };
  const savedPrompt = (prompt: EvalPrompt) => {
    setPrompts(previous => [...(previous ?? []).filter(item => item.id !== prompt.id), prompt].sort((a, b) => Number(!!b.builtin) - Number(!!a.builtin) || a.createdAt.localeCompare(b.createdAt)));
    dirty.current = false;
    // After a save the editor shows the latest version, not the one a run link opened.
    if (route.kind !== 'prompt' || route.id !== prompt.id || route.version) { history.replaceState(null, '', routeUrl({ kind: 'prompt', id: prompt.id })); setRoute({ kind: 'prompt', id: prompt.id }); }
  };
  const openSession = (value: ComparePageSession) => {
    setLaunch(undefined);
    void listJudgements().then(items => { const item = items.find(item => item.id.startsWith(value.id + '-'));
      void refreshJudgements(); void refreshRuns();
      if (item) go({ kind: 'judgements', id: item.runIds[0], judgementId: item.id });
      else { setSession(value); go({ kind: 'session', id: value.id }); }
    }).catch(onError);
  };
  const started = (run: EvalRunSummary) => { setLaunch(undefined); void refreshRuns(); go({ kind: 'run', id: run.id }); };
  const comparisonStarted = (_: ComparisonRunSummary) => { void refreshComparisons(); void refreshJudgements(); void refreshRuns(); };

  const current = route.kind === 'prompt' ? prompts?.find(prompt => prompt.id === route.id) : undefined;
  const run = route.kind === 'run' ? runs?.find(item => item.id === route.id) : undefined;
  const loading = !prompts || !runs || !sessions;
  const refreshAll = () => Promise.all([listPrompts().then(setPrompts), refreshExperiments(), refreshRuns(), refreshGenerated(), refreshSessions(), refreshComparisons(), refreshJudgements()]);
  /** Confirms, deletes, refreshes, and leaves a view whose subject is gone. */
  const remove = (question: string, task: () => Promise<unknown>, leaves: (route: Route) => boolean, removed?: () => void) => {
    setConfirmation({ title: question.startsWith('Delete output') ? 'Delete output' : 'Confirm deletion', message: question, onConfirm: async () => {
      await task(); removed?.();
      if (leaves(route)) { dirty.current = false; history.pushState(null, '', routeUrl({ kind: 'home' })); setRoute({ kind: 'home' }); }
      // Remove the acknowledged output immediately; unrelated lists refresh in the background.
      if (removed) void refreshAll(); else await refreshAll();
    } });
  };
  // A run opens on the requested output, else its first finished (or first) output.
  const shownCell = run && (run.cells.find(item => item.key === (route.kind === 'run' ? route.output : undefined))
    ?? run.cells.find(item => item.status === 'finished' && !item.deleted) ?? run.cells[0]);
  const registeredOutputs = new Set((experiments ?? []).flatMap(e => e.samples.flatMap(s => s.outputs.map(o => JSON.stringify([o.runId, o.cellKey])))));
  const registeredReports = new Set((experiments ?? []).flatMap(experimentJudgementIds));
  const legacyRuns = (runs ?? []).filter(r => !r.cells.length || r.cells.some(c => !registeredOutputs.has(JSON.stringify([r.id, c.key]))));
  const registeredCanvases = new Set((runs ?? []).flatMap(r => r.cells.filter(c => registeredOutputs.has(JSON.stringify([r.id, c.key]))).map(c => c.canvasId)));
  const activeExperiment = (experiments ?? []).find(e => route.kind === 'experiment' ? e.id === route.id
    : route.kind === 'judgements' ? experimentJudgementIds(e).includes(route.judgementId ?? '')
    : route.kind === 'run' && e.samples.some(s => s.outputs.some(o => o.runId === route.id && o.cellKey === shownCell?.key)));
  const judgementItems = activeExperiment
    ? experimentJudgementIds(activeExperiment).flatMap(id => judgements?.find(item => item.id === id) ?? [])
    : judgements ?? [];
  const outputItems = activeExperiment ? experimentOutputSequence(activeExperiment, runs ?? [])
    : (runs ?? []).flatMap(item => item.cells.filter(cell => cell.status === 'finished' && cell.canvasId && !cell.deleted)
      .map(cell => ({ runId: item.id, cellKey: cell.key, label: `${runTitle(item, numbers.get(item.id))} · ${cell.stage} · sample ${cell.pass}` })));
  const outputIndex = route.kind === 'run' ? outputItems.findIndex(item => item.runId === route.id && item.cellKey === shownCell?.key) : -1;
  const moveOutput = (direction: number) => { const next = outputItems[outputIndex + direction]; if (next) go({ kind: 'run', id: next.runId, output: next.cellKey }); };
  useArrowNavigation(moveOutput, route.kind === 'run' && outputIndex >= 0);
  const selection: EvalsSelection | undefined = route.kind === 'experiment' ? route : route.kind === 'run' ? { kind: 'run', id: route.id, output: shownCell?.key }
    : route.kind === 'judgements' ? { kind: 'judgements', id: route.id, judgementId: route.judgementId }
    : route.kind === 'canvas' || route.kind === 'session' ? { kind: route.kind, id: route.id } : undefined;
  const treeActions: TreeActions = {
    deleteGroup: (label, targets) => void remove(`Delete everything under “${label}”? Runs: ${targets.runIds.length}; outputs: ${targets.canvasIds.length}; judgements: ${targets.judgementIds.length}. Runs still generating will be cancelled.`, async () => {
      try {
        // Resolve current records on every attempt so a partially completed deletion can be retried.
        for (const item of await listJudgements()) if (targets.judgementIds.includes(item.id)
          && (!targets.runIds.length || !item.runIds.some(id => !targets.runIds.includes(id) && runs?.some(run => run.id === id)))) await deleteJudgement(item.id);
        const liveComparisons = await comparisonRuns();
        const comparisonIds = new Set([...targets.comparisonRunIds, ...liveComparisons.filter(item => targets.sessionIds.includes(item.sessionId ?? item.id)).map(item => item.id)]);
        for (const item of liveComparisons) if (comparisonIds.has(item.id)) await deleteComparisonRun(item.id);
        for (const item of await listCompareSessions()) if (targets.sessionIds.includes(item.id)) await deleteCompareSession(item.id);
        if (targets.runIds.length) await deleteRuns(targets.runIds);
        // Deleting runs already removes their output canvases.
        for (const item of await listGenerated()) if (targets.canvasIds.includes(item.id)) await deleteGenerated(item.id);
        setPicked(items => items.filter(item => !targets.canvasIds.includes(item.canvasId)));
      } catch (error) { await refreshAll(); throw error; }
    }, current => current.kind === 'run' ? targets.runIds.includes(current.id) || current.id === run?.id && !!shownCell?.canvasId && targets.canvasIds.includes(shownCell.canvasId)
      : current.kind === 'judgements' ? !!current.id && targets.runIds.includes(current.id)
      : current.kind === 'canvas' ? targets.canvasIds.includes(current.id)
      : current.kind === 'session' && (targets.sessionIds.includes(current.id) || targets.comparisonRunIds.includes(current.id))),
    open: target => target.kind === 'experiment' ? go(target) : target.kind === 'run' ? go({ kind: 'run', id: target.id, ...(target.output ? { output: target.output } : {}) })
      : target.kind === 'judgements' ? go({ kind: 'judgements', id: target.id, judgementId: target.judgementId })
      : target.kind === 'canvas' || target.kind === 'session' ? go({ kind: target.kind, id: target.id }) : undefined,
    deleteRun: item => {
      const family = [item, ...(runs ?? []).filter(other => other.parentRunId === item.id)];
      const outputs = family.reduce((sum, member) => sum + member.cells.filter(cell => cell.canvasId && !cell.deleted).length, 0);
      void remove(`Delete run #${numbers.get(item.id)}${family.length > 1 ? `, its ${family.length - 1} rerun${family.length > 2 ? 's' : ''}` : ''} and ${outputs} outputs?`,
        () => deleteRun(item.id), current => current.kind === 'run' && family.some(member => member.id === current.id));
    },
    deleteCanvas: (id, name) => void remove(`Delete output “${name}”?`, () => deleteGenerated(id),
      current => current.kind === 'canvas' && current.id === id || current.kind === 'run' && current.id === run?.id && shownCell?.canvasId === id,
      () => { updateGenerated(items => items?.filter(item => item.id !== id));
        updateRuns(items => items?.map(item => ({ ...item, cells: item.cells.map(cell => cell.canvasId === id ? { ...cell, deleted: true } : cell) })));
        setPicked(items => items.filter(item => item.canvasId !== id)); }),
    deleteContext: context => void remove(`Delete all ${context.outputs} outputs, runs and comparisons generated from “${context.name}” (${context.workflow === 'roll-up' ? 'roll-ups' : 'alternatives'})? The AgentContext itself is kept.`,
      () => deleteContextOutputs(context.id, context.workflow), current => current.kind === 'run' ? runs?.some(item => item.id === current.id && item.agentContextId === context.id && item.workflow === context.workflow) === true
        : current.kind === 'canvas' ? generated?.some(item => item.id === current.id && item.generated?.agentContextId === context.id && generatedWorkflow(item.generated) === context.workflow) === true
        : current.kind === 'session' && sessions?.some(item => item.id === current.id && !item.mixedOrigins && item.origins.length > 0 && item.origins.every(origin => origin.agentContextId === context.id && origin.workflow === context.workflow)) === true),
    runMenu: (item, at) => setMenu({ label: `Run #${numbers.get(item.id)}`, at, sections: [{ label: `Run #${numbers.get(item.id)} · ${item.contextName}`, items: [
      // Opens the exact version the run pinned; prompts deleted or unknown (legacy runs) are skipped.
      ...item.prompts.filter(pinned => prompts?.some(prompt => prompt.id === pinned.promptId)).map(pinned => ({
        label: item.prompts.length > 1 ? `Edit prompt “${pinned.name}”` : 'Edit prompt', detail: `v${pinned.version}`,
        onSelect: () => go({ kind: 'prompt', id: pinned.promptId, version: pinned.version }) })),
      ...(item.compatibility ? [{ label: 'Rerun with original chat settings', onSelect: () => void rerunChat(item.id, crypto.randomUUID()).then(started).catch(onError) }] : [{ label: 'Rerun…', onSelect: () => setLaunch({ workflow: item.workflow, rerun: item }) }]),
      ...(item.legacy ? [] : [{ label: 'Rename', onSelect: () => setRenaming(item.id) }]),
      ...(runActive(item) && !item.legacy ? [{ label: 'Cancel run', onSelect: () => void cancelRun(item.id).then(() => refreshRuns()).catch(onError) }] : []),
      { label: 'Delete run…', danger: true, onSelect: () => treeActions.deleteRun(item) }
    ] }] }),
    renameRun: (item, name) => void renameRun(item.id, name).then(() => refreshRuns()).catch(onError),
    contextMenu: (context, at) => setMenu({ label: context.name, at, sections: [{ label: context.name, items: [
      { label: 'New run from this context…', onSelect: () => {
        if (context.workflow !== 'roll-up') { setLaunch({ workflow: context.workflow, contextId: context.id }); return; }
        // Roll-ups reuse the latest run's child and parent canvases.
        const latest = context.runs[0];
        setLaunch({ workflow: 'roll-up', ...(latest ? { rerun: latest } : {}) });
      } },
      { label: 'Delete outputs…', danger: true, onSelect: () => treeActions.deleteContext({ id: context.id, name: context.name, workflow: context.workflow,
        outputs: context.outputs }) }
    ] }] }),
  };
  const openDiagram = (leaf: DiagramLeaf) => go({ kind: 'new-reference', target: { source: leaf.source, diagramId: leaf.diagram.diagramId } });
  const openReference = (id: string) => go({ kind: 'reference', id });
  const archiveReference = (reference: EvalReference) => void updateReference(reference.id, { archived: true }).then(referenceChanged).catch(onError);
  const moveReference = (reference: EvalReference, groupId: string | null) => void updateReference(reference.id, { groupId }).then(referenceChanged).catch(onError);
  const createGroup = (name: string) => void createReferenceGroup({ requestId: crypto.randomUUID(), name }).then(groupChanged).catch(onError);
  const renameGroup = (group: EvalReferenceGroup, name: string) => void renameReferenceGroup(group.id, name).then(groupChanged).catch(onError);
  const deleteGroup = (group: EvalReferenceGroup, members: number) => setConfirmation({ title: 'Delete group', confirmLabel: 'Delete group',
    message: `Delete group “${group.name}”?${members ? ` Its ${members} reference${members === 1 ? '' : 's'} stay and become ungrouped.` : ''}`, onConfirm: async () => {
      await deleteReferenceGroup(group.id);
      setReferenceGroups(current => current.filter(item => item.id !== group.id));
      await refreshReferences();
    } });
  const promptsMenu = (at: { x: number; y: number }) => setMenu({ label: 'Prompts', at, sections: evalWorkflowIds.map(id => ({ label: evalWorkflows[id].label, items: [
    ...(prompts ?? []).filter(prompt => prompt.workflow === id).map(prompt => ({ label: prompt.name, detail: `v${latestVersion(prompt).version}${prompt.archivedAt ? ' · archived' : ''}`,
      muted: !!prompt.archivedAt, onSelect: () => go({ kind: 'prompt', id: prompt.id }) })),
    { label: `+ New ${evalWorkflows[id].label.toLowerCase()} prompt`, onSelect: () => go({ kind: 'new-prompt', workflow: id }) }
  ] })) });
  const canvas = route.kind === 'canvas' ? generated?.find(item => item.id === route.id) : undefined;

  const content = () => {
    if (route.kind === 'prompt' && current && route.version && !current.versions.some(version => version.version === route.version))
      return <p className="evals-message">Prompt v{route.version} is not available in the current catalog. Its captured text remains in the run details.</p>;
    if (route.kind === 'reference') {
      const reference = references?.find(item => item.id === route.id);
      return reference ? <ReferenceView key={reference.id} reference={reference} groups={referenceGroups} prompts={prompts ?? []} onChanged={referenceChanged} onOpenPrompt={id => go({ kind: 'prompt', id })} />
        : references && <p className="evals-message">Reference not found.</p>;
    }
    if (route.kind === 'experiment') return !experiments || !runs || !judgements ? <p role="status">Loading experiment…</p> : activeExperiment ? <ExperimentView key={`${activeExperiment.id}:${route.view}:${route.groupId}:${route.phaseId}`} experiment={activeExperiment} onChanged={refreshAll} prompts={prompts ?? []} route={route} runs={runs ?? []} judgements={judgements ?? []} onOpen={go} picked={picked} onPick={(output, on) => setPicked(current => on ? [...current.filter(p => p.canvasId !== output.canvasId), output] : current.filter(p => p.canvasId !== output.canvasId))} /> : <p>Experiment not found.</p>;
    if (route.kind === 'references') return <ReferencesLanding count={activeReferences.length} onCapture={() => go({ kind: 'new-reference', target: lastDiagram.current })} />;
    if (route.kind === 'new-reference') return <ReferenceWorkbench target={route.target} candidates={candidates} groups={referenceGroups} captures={captures} setCaptures={setCaptures}
      onCreated={referenceChanged} onGroupCreated={groupChanged} onOpenReference={id => go({ kind: 'reference', id })} />;
    if (route.kind === 'prompt') return current ? <PromptEditor references={references} key={`${current.id}:${latestVersion(current).version}:${route.version ?? ''}`} prompt={current} version={route.version} onSaved={savedPrompt} onDirty={setDirty}
      onRun={prompt => setLaunch({ workflow: prompt.workflow, promptIds: [prompt.id] })} onDuplicate={(prompt, version) => go({ kind: 'new-prompt', workflow: prompt.workflow, from: prompt.id, fromVersion: version })} />
      : prompts && <p className="evals-message">Prompt not found.</p>;
    if (route.kind === 'new-prompt') {
      const from = route.from ? prompts?.find(prompt => prompt.id === route.from) : undefined;
      if (route.from && !prompts) return null;
      return <PromptEditor references={references} key={`new:${route.workflow}:${route.from ?? ''}:${route.fromVersion ?? ''}`} draft={{ workflow: route.workflow, from, fromVersion: route.fromVersion }} onSaved={savedPrompt} onDirty={setDirty}
        onRun={() => {}} onDuplicate={() => {}} />;
    }
    if (route.kind === 'canvas') return generated && (canvas ? <div className="output-view"><CanvasPreview key={canvas.id} canvasId={canvas.id} bare /></div>
      : <p className="evals-message">This output was deleted.</p>);
    if (route.kind === 'run') {
      if (!runs) return null;
      if (!run) return <p className="evals-message">Run not found.</p>;
      return shownCell ? <>
        {outputIndex >= 0 && <nav className="output-navigation" aria-label="Output navigation">
          <button aria-keyshortcuts="ArrowLeft" disabled={outputIndex === 0} onClick={() => moveOutput(-1)}>← Previous output</button>
          <span title={outputItems[outputIndex].label} aria-live="polite">{outputIndex + 1} / {outputItems.length} · {outputItems[outputIndex].label}</span>
          <button aria-keyshortcuts="ArrowRight" disabled={outputIndex === outputItems.length - 1} onClick={() => moveOutput(1)}>Next output →</button>
        </nav>}
        <OutputView key={`${run.id}:${shownCell.key}`} cell={shownCell} run={run} />
      </> : <p className="evals-message">This run has no outputs.</p>;
    }
    if (route.kind === 'judgements') return <JudgementsPane items={judgementItems}
      selectedId={route.judgementId} initialEntry={route.entry} prompts={prompts ?? []} onSelect={(judgementId, entry) => go({ kind: 'judgements', judgementId, entry })}
      onDelete={item => remove(`Delete judgement “${item.title}”?${item.runIds.length > 1 ? ' This removes it from every attached run.' : ''}`, () => deleteJudgement(item.id), () => false)} />;
    if (route.kind === 'session') return session ? <ComparisonView key={session.id} session={session} prompts={prompts ?? []} />
      : !error && <p role="status" className="evals-message">Loading comparison…</p>;
    return home();
  };

  function home() {
    return <div className="evals-home">
      {!!experiments?.length && <section aria-label="Experiments"><h2>Experiments</h2><div className="evals-home-cards">{experiments.map(e => <section className="evals-card" key={e.id}><h3><button className="evals-link" onClick={() => go({ kind: 'experiment', id: e.id })}>{e.name}</button></h3><p>{e.description}</p><p>{e.conditions.length} conditions · {e.cases.length} input cases · {experimentJudgementIds(e).length} Judgements</p></section>)}</div></section>}
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
      <button type="button" aria-current={inReferences ? 'page' : undefined} className={inReferences ? 'is-active' : undefined} onClick={() => go({ kind: 'references' })}>References</button>
      <button type="button" aria-haspopup="menu" onClick={event => { const box = event.currentTarget.getBoundingClientRect(); promptsMenu({ x: box.left, y: box.bottom + 4 }); }}>Prompts ▾</button>
      <button type="button" className="evals-header-secondary" onClick={() => setTemplatesOpen(true)}>Layout templates</button>
      <button type="button" className="evals-header-secondary" onClick={() => setLaunch('compare')}>New comparison</button>
      <details className="evals-header-more"><summary>More</summary><div>
        <button type="button" onClick={() => setTemplatesOpen(true)}>Layout templates</button>
        <button type="button" onClick={() => setLaunch('compare')}>New comparison</button>
      </div></details>
      <button type="button" className="is-primary" onClick={() => setLaunch({ workflow: route.kind === 'prompt' && current ? current.workflow : 'roll-up' })}>New run</button>
    </header>
    <div className="evals-layout" ref={layout} style={{ gridTemplateColumns: `${navWidth}px 5px minmax(0, 1fr)` }}>
      <nav className="evals-nav" aria-label="Evals">
        {inReferences ? (references ? <ReferenceExplorer tab={route.kind === 'new-reference' ? 'canvas' : 'references'} references={activeReferences} groups={referenceGroups}
            current={route.kind === 'reference' ? route.id : undefined} captureCount={captures.length} candidates={candidates} candidatesError={candidatesError}
            currentDiagramKey={route.kind === 'new-reference' && route.target ? diagramLeafKey(route.target.source, route.target.diagramId) : undefined}
            onTab={tab => go(tab === 'canvas' ? { kind: 'new-reference', target: lastDiagram.current } : { kind: 'references' })} onExit={() => go({ kind: 'home' })}
            onOpenDiagram={openDiagram} onOpen={openReference} onMenu={setMenu} onArchive={archiveReference} onMove={moveReference}
            onCreateGroup={createGroup} onRenameGroup={renameGroup} onDeleteGroup={deleteGroup} />
          : <p role="status" className="evals-muted">Loading…</p>)
        : runs && generated && sessions && experiments && judgements ? <>
          <ExperimentExplorer experiments={experiments} runs={runs} judgements={judgements ?? []} selection={selection} onOpen={treeActions.open} />
          <details className="experiment-legacy" open={experiments.length ? undefined : true}><summary>Run history <small>{legacyRuns.length}</small></summary>
          <EvalsTree runs={legacyRuns} generated={generated.filter(c => !registeredCanvases.has(c.id))} judgements={(judgements ?? []).filter(j => !registeredReports.has(j.id))} selection={selection} actions={treeActions} renaming={renaming} onRenameEnd={() => setRenaming(undefined)}
            picked={picked} onPick={(output, on) => setPicked(current => on ? [...current.filter(item => item.canvasId !== output.canvasId), output] : current.filter(item => item.canvasId !== output.canvasId))} />
          </details></>
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
        {activeExperiment && route.kind !== 'experiment' && <div className="experiment-breadcrumb"><button className="evals-link" onClick={() => go({ kind: 'experiment', id: activeExperiment.id })}>{activeExperiment.name}</button><span>› {route.kind === 'judgements' ? 'Judgement' : 'Stage output'}</span><button className="evals-link" onClick={() => go({ kind: 'experiment', id: activeExperiment.id, view: 'outputs' })}>All outputs</button></div>}
        {loading && route.kind === 'home' ? <p role="status" className="evals-message">Loading…</p> : content()}
      </section>
    </div>
    {confirmation && <ConfirmDialog {...confirmation} onClose={() => setConfirmation(undefined)} />}
    {templatesOpen && <LayoutTemplates onClose={() => setTemplatesOpen(false)} />}
    {launch === 'compare' && <CompareLauncher onClose={() => setLaunch(undefined)} onCreated={openSession} />}
    {menu && <PopoverMenu label={menu.label} at={menu.at} sections={menu.sections} onClose={() => setMenu(undefined)} />}
    {launch && launch !== 'compare' && prompts && <RunLauncher prompts={prompts} runs={runs ?? []} initial={launch} onClose={() => setLaunch(undefined)} onStarted={started} />}
  </main>;
}
