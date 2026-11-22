import { promptTemplateIds } from '../../../../domain/mapping/evals/promptTemplateIncludes';
import { EvalHistory, EvalHistoryContext, useHistoryGestures } from './evalHistory';
import type { Route } from './evalRoutes';
import { CostStatistics } from './CostStatistics';
import { ExperimentHome } from './ExperimentHome';
import { hasEvalOutput } from '../../../../domain/mapping/evals/evalRun';
import { useArrowNavigation } from './evalNavigation';
import { ALL_PHASES, commentNavigationOrder, withReportSteps, navigationContext, navigationKey, navigationOrder, navigationPhase, parseNavigationContext, type NavigationTarget } from '../../../../domain/mapping/evals/experimentNavigation';
import { ViewTreeSidebar } from './ViewTreeSidebar';
import { ItemToolbarContext } from './ItemToolbar';
import { OutputSidebarContext } from './OutputSidebar';
import { OutputCommentContext, OutputCommentsPanel } from './OutputComments';
import { loadCanvasPreview } from './canvasPreviewCache';
import { projectExperimentOverview } from '../../../../domain/mapping/evals/experimentOverviewProjection';
import { ExperimentExplorer } from './ExperimentExplorer';
import { ExperimentView } from './ExperimentView';
import { experimentJudgementIds, type EvalExperiment } from '../../../../domain/mapping/evals/experiment';
import { LayoutTemplates } from './LayoutTemplates';
import { useCallback, useEffect, useLayoutEffect, useSyncExternalStore, useMemo, useRef, useState } from 'react';
import { ConfirmDialog, type Confirmation } from './ConfirmDialog';
import { generatedWorkflow } from '../../../../domain/core/diagrams/generatedCanvas';
import type { ComparePageSession } from '../../../../domain/mapping/compare/comparePageSession';
import type { ComparisonRunSummary } from '../../../../domain/mapping/compare/comparisonGeneration';
import { latestVersion, type EvalPrompt } from '../../../../domain/mapping/evals/evalPrompt';
import type { EvalRunSummary } from '../../../../domain/mapping/evals/evalRun';
import { evalWorkflowIds, evalWorkflows } from '../../../../domain/mapping/evals/evalWorkflows';
import { comparisonRuns, deleteCompareSession, deleteComparisonRun, listCompareSessions, readCompareSession } from './compareApi';
import { listExperiments, listJudgements, deleteJudgement, listReferences, listReferenceGroups, createReferenceGroup, renameReferenceGroup, deleteReferenceGroup, updateReference, readPrompt, rerunChat, cancelRun, renameRun, deleteContextOutputs, deleteGenerated, deleteRun, deleteRuns, listGenerated, listPrompts, listRuns, migrateGenerated } from './evalsApi';
import { errorMessage, runActive, runNumbers } from './evalsFormat';
import type { EvalsSelection, PickedOutput, TreeActions } from './EvalsTree';
import { PopoverMenu, type MenuSection } from './PopoverMenu';
import { CanvasPreview } from './CanvasPreview';
import { candidateKey } from './CanvasPicker';
import { PromptEditor } from './PromptEditor';
import { promptSnippets } from './promptSnippets';
import { Drawer } from './Drawer';
import { RunLauncher, type RunLaunch } from './RunLauncher';
import { OutputView } from './OutputView';
import { EvalsSidebarResize } from './EvalsSidebarResize';
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

/** Polls quickly only while work is running. */
function usePolled<T>(load: () => Promise<T>, active: (value: T) => boolean, onError: (error: unknown) => void) {
  const [value, setValue] = useState<T>();
  const refresh = useRef<() => Promise<void>>(async () => {});
  const revision = useRef(0);
  const snapshot = useRef<string | undefined>(undefined);
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
          if (at === revision.current) {
            // Polls return fresh objects even when nothing changed. Preserve the
            // existing catalog references so idle readers do not rebuild the UI.
            const serialized = JSON.stringify(result);
            if (snapshot.current !== serialized) { snapshot.current = serialized; setValue(result); }
          }
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
  const update = useCallback((change: (current: T | undefined) => T | undefined) => { revision.current++; snapshot.current = undefined; setValue(change); }, []);
  return [value, useCallback(() => refresh.current(), []), update] as const;
}

/** Mapping services let the reference creator reuse Mapping's selection canvas. */
export function EvalsPage({ services }: { services?: MappingServices }) {
  const page = <EvalsWorkspace />;
  return services ? <MappingServicesContext.Provider value={services}>{page}</MappingServicesContext.Provider> : page;
}
function EvalsWorkspace() {
  const [navigationHistory] = useState(() => new EvalHistory());
  const visit = useSyncExternalStore(navigationHistory.subscribe, navigationHistory.snapshot);
  const { route, view } = visit;
  const panel = view.panel;
  const openSnippet = panel?.kind === 'snippet' && promptSnippets.find(item => item.id === panel.id);
  const templatesOpen = view.panel?.kind === 'templates';
  const [error, setError] = useState('');
  const [confirmation, setConfirmation] = useState<Confirmation>();
  const onError = useCallback((error: unknown) => setError(errorMessage(error)), []);
  const [prompts, setPrompts] = useState<EvalPrompt[]>();
  const snippetUses = useMemo(() => openSnippet ? prompts?.flatMap(prompt => prompt.versions.flatMap(version =>
    Object.entries(version.templateSources ?? {}).filter(([, body]) => promptTemplateIds(body).includes(openSnippet.id))
      .map(([stage]) => ({ prompt, version: version.version, stage })))) : undefined, [openSnippet, prompts]);
  const [experiments, refreshExperiments, updateExperiments] = usePolled(listExperiments, () => false, onError);
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
  const layout = useRef<HTMLDivElement>(null);
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
  useLayoutEffect(() => navigationHistory.connect({
    dirty: () => dirty.current,
    confirmLeave: proceed => setConfirmation({ title: 'Discard edits', message: 'Discard unsaved edits?', confirmLabel: 'Discard',
      onConfirm: () => { dirty.current = false; proceed(); } }),
    onNavigate: () => { setError(''); setMenu(undefined); setLaunch(undefined); setRenaming(undefined); }
  }), [navigationHistory]);
  useHistoryGestures(navigationHistory);
  // A finished LLM comparison publishes a session; refresh the list when one completes.
  const finished = comparisons?.filter(item => item.status === 'finished').length;
  useEffect(() => { if (finished !== undefined) void refreshSessions(); }, [finished, refreshSessions]);
  // New outputs appear as runs progress.
  const produced = runs?.reduce((sum, item) => sum + item.cells.filter(hasEvalOutput).length, 0);
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

  const go = navigationHistory.go;
  const savedPrompt = (prompt: EvalPrompt) => {
    setPrompts(previous => [...(previous ?? []).filter(item => item.id !== prompt.id), prompt].sort((a, b) => Number(!!b.builtin) - Number(!!a.builtin) || a.createdAt.localeCompare(b.createdAt)));
    dirty.current = false;
    // After a save the editor shows the latest version, not the one a run link opened.
    if (route.kind !== 'prompt' || route.id !== prompt.id || route.version) { go({ kind: 'prompt', id: prompt.id }, { replace: true }); }
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
  const onExperimentSaved = (saved: EvalExperiment) => updateExperiments(current => current?.map(item => item.id === saved.id && item.revision <= saved.revision ? saved : item));
  const refreshAll = () => Promise.all([listPrompts().then(setPrompts), refreshExperiments(), refreshRuns(), refreshGenerated(), refreshSessions(), refreshComparisons(), refreshJudgements()]);
  /** Confirms, deletes, refreshes, and leaves a view whose subject is gone. */
  const remove = (question: string, task: () => Promise<unknown>, leaves: (route: Route) => boolean, removed?: () => void) => {
    setConfirmation({ title: question.startsWith('Delete output') ? 'Delete output' : 'Confirm deletion', message: question, onConfirm: async () => {
      await task(); removed?.();
      if (leaves(route)) { dirty.current = false; go({ kind: 'home' }); }
      // Remove the acknowledged output immediately; unrelated lists refresh in the background.
      if (removed) void refreshAll(); else await refreshAll();
    } });
  };
  // A run opens on the requested output, else its first finished (or first) output.
  const shownCell = run && (run.cells.find(item => item.key === (route.kind === 'run' ? route.output : undefined))
    ?? run.cells.find(item => item.status === 'finished' && !item.deleted) ?? run.cells[0]);
  // ←/→ traverse one fixed list: the experiment overview tree's viewable outputs and finished judgements.
  // The context comes from the URL (set when opening from an experiment); otherwise from the item's sole owning experiment.
  // The experiment tree in context: from the URL `nav` (set when opening from an experiment) or the item's sole owner.
  // `scope` is the explicit phase choice in the URL; without one, the tree narrows to the shown item's phase.
  // A report is positioned on a step: the one in the URL, else its first.
  const currentTarget: NavigationTarget | undefined = route.kind === 'run' && route.comment && shownCell ? { kind: 'comment', commentId: route.comment, runId: route.id, cellKey: shownCell.key }
    : route.kind === 'run' && shownCell ? { kind: 'output', runId: route.id, cellKey: shownCell.key, ...(route.diagram ? { diagram: route.diagram } : {}) }
    : route.kind === 'judgements' && route.judgementId ? (() => {
      const first = judgements?.find(item => item.id === route.judgementId)?.steps?.[0]?.key, step = route.step ?? first;
      return step ? { kind: 'step' as const, judgementId: route.judgementId, step } : { kind: 'judgement' as const, judgementId: route.judgementId };
    })() : undefined;
  const navContext = (() => {
    if (route.kind === 'experiment') {
      const experiment = experiments?.find(e => e.id === route.id);
      return experiment && { experiment, scope: route.phaseId, phaseId: route.phaseId };
    }
    if (route.kind !== 'run' && route.kind !== 'judgements') return undefined;
    let experiment: EvalExperiment | undefined, scope: string | undefined;
    if (route.nav) { const parsed = parseNavigationContext(route.nav); experiment = experiments?.find(e => e.id === parsed.experimentId); scope = parsed.phaseId; }
    else {
      const owners = (experiments ?? []).filter(e => route.kind === 'judgements' ? experimentJudgementIds(e).includes(route.judgementId ?? '')
        : e.samples.some(s => s.outputs.some(o => o.runId === route.id && o.cellKey === shownCell?.key)));
      if (owners.length === 1) experiment = owners[0];
    }
    if (!experiment) return undefined;
    const phaseId = scope === ALL_PHASES ? undefined : scope ?? (currentTarget && navigationPhase(experiment, currentTarget));
    return { experiment, scope, phaseId };
  })();
  const activeExperiment = route.kind === 'experiment' ? (experiments ?? []).find(e => e.id === route.id) : navContext?.experiment;
  useEffect(() => {
    if (!activeExperiment || !runs) return;
    const outputs = activeExperiment.samples.flatMap(sample => sample.outputs).flatMap(output => {
      const cell = runs.find(run => run.id === output.runId)?.cells.find(cell => cell.key === output.cellKey);
      return cell?.canvasId && cell.checkpointId && !cell.output ? [{ cell, source: { runId: output.runId, cellKey: output.cellKey } }] : [];
    });
    const index = Math.max(0, outputs.findIndex(output => output.cell.canvasId === shownCell?.canvasId));
    for (const output of [outputs[index], outputs[index - 1], outputs[index + 1]])
      if (output) void loadCanvasPreview(output.cell.canvasId!, output.cell.checkpointId, output.source).catch(() => {});
  }, [activeExperiment, runs, shownCell?.canvasId]);
  const judgementItems = activeExperiment
    ? experimentJudgementIds(activeExperiment).flatMap(id => judgements?.find(item => item.id === id) ?? [])
    : judgements ?? [];
  // One tree drives the sidebar, the navigation bar and ←/→.
  // Each finished report's pages and findings sit under its judgement and are stops in their own right.
  const contextTree = useMemo(() => {
    if (!navContext || !runs) return undefined;
    let root = projectExperimentOverview(navContext.experiment, runs, navContext.phaseId).overview.root;
    for (const id of experimentJudgementIds(navContext.experiment)) {
      const steps = judgements?.find(item => item.id === id)?.steps;
      if (steps?.length) root = withReportSteps(root, id, steps);
    }
    return root;
  }, [navContext?.experiment, navContext?.phaseId, runs, judgements]);
  const stepsOf = (judgementId: string) => judgements?.find(item => item.id === judgementId)?.steps;
  // A judgement with steps is reached through its first step, so it is not a separate stop.
  const isStop = useCallback((target: NavigationTarget) => target.kind !== 'judgement'
    || judgements?.find(item => item.id === target.judgementId)?.status === 'finished' && !stepsOf(target.judgementId)?.length, [judgements]);
  const reviewingComment = route.kind === 'run' && !!route.comment;
  const navigation = useMemo(() => contextTree && (reviewingComment ? commentNavigationOrder(contextTree) : navigationOrder(contextTree, isStop)), [contextTree, isStop, reviewingComment]);
  const phaseOptions = useMemo(() => navContext && runs ? (projectExperimentOverview(navContext.experiment, runs).overview.root.children ?? [])
    .flatMap(node => node.source?.phaseId ? [{ id: node.source.phaseId, label: node.label }] : []) : [], [navContext?.experiment, runs]);
  const inExperimentItem = (route.kind === 'run' || route.kind === 'judgements') && !!navContext;
  const sidebarTab = view.sidebar ?? (inExperimentItem ? 'overview' : 'experiments');
  const setSidebarTab = (sidebar: 'overview' | 'experiments') => { if (sidebar !== sidebarTab) navigationHistory.update({ sidebar }); };
  const choosePhase = (value: string) => {
    if (route.kind === 'experiment') go({ ...route, phaseId: value === ALL_PHASES ? undefined : value });
    else if ((route.kind === 'run' || route.kind === 'judgements') && navContext) go({ ...route, nav: navigationContext(navContext.experiment.id, value) });
  };
  const currentKey = currentTarget && navigationKey(currentTarget);
  const stop = currentKey ? navigation?.stops.get(currentKey) : undefined;
  const openStop = (target: NavigationTarget) => {
    const nav = navContext && navigationContext(navContext.experiment.id, navContext.scope);
    go(target.kind === 'comment' ? { kind: 'run', id: target.runId, output: target.cellKey, comment: target.commentId, nav: navContext && navigationContext(navContext.experiment.id, ALL_PHASES) }
      : target.kind === 'output' ? { kind: 'run', id: target.runId, output: target.cellKey, nav, ...(target.diagram ? { diagram: target.diagram } : {}) }
      : { kind: 'judgements', judgementId: target.judgementId, nav, ...(target.kind === 'step' ? { step: target.step } : {}) });
  };
  const moveStop = (direction: number) => {
    const key = direction > 0 ? stop?.next : stop?.prev, next = key && navigation?.stops.get(key);
    if (next) openStop(next.target);
  };
  useArrowNavigation(moveStop, !!stop);
  const backToOverview = () => navContext && go({ kind: 'experiment', id: navContext.experiment.id, view: 'overview', ...(navContext.phaseId ? { phaseId: navContext.phaseId } : {}) });
  // Full screen hides the app header for item views; it survives ←/→ and applies again when another item opens.
  const [fullScreen, setFullScreen] = useState(false);
  const [toolbarSlot, setToolbarSlot] = useState<HTMLElement | null>(null);
  const [outputSidebar, setOutputSidebar] = useState<HTMLElement | null>(null);
  const itemView = route.kind === 'run' || route.kind === 'judgements';
  useEffect(() => {
    if (!fullScreen || !itemView) return;
    const key = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || event.defaultPrevented || document.querySelector('[role="dialog"], .evals-drawer, :fullscreen')) return;
      if (event.target instanceof Element && event.target.closest('input, textarea, select, [contenteditable]:not([contenteditable="false"])')) return;
      setFullScreen(false);
    };
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  }, [fullScreen, itemView]);
  // The tree row label can repeat across samples; the breadcrumb ends with the item's own name instead.
  const stopName = (target: NavigationTarget) => target.kind === 'comment' ? navContext?.experiment.comments?.find(comment => comment.id === target.commentId)?.text.slice(0, 120) : target.kind === 'step' ? undefined : target.kind === 'judgement' ? judgements?.find(item => item.id === target.judgementId)?.title
    : (() => {
      const cell = runs?.find(item => item.id === target.runId)?.cells.find(cell => cell.key === target.cellKey);
      const diagram = target.diagram && cell?.diagrams?.find(item => item.id === target.diagram)?.title;
      return diagram ? [cell?.candidateName, diagram].filter(Boolean).join(' · ') : cell?.candidateName;
    })();
  const stopLabel = stop && (() => { const name = stopName(stop.target); return name ? [...stop.path, name].join(' · ') : stop.label; })();
  const navigationBar = stop && navigation && <nav className="output-navigation" aria-label="Experiment navigation">
    <button className="evals-link" title="Go to experiment overview" onClick={backToOverview}>↖ Overview</button>
    <button aria-keyshortcuts="ArrowLeft" aria-label="Previous" title="Previous (←)" disabled={!stop.prev} onClick={() => moveStop(-1)}>←</button>
    <span title={stopLabel} aria-live="polite">{reviewingComment ? 'Comment ' : ''}{stop.index + 1} / {navigation.order.length} · {stopLabel}</span>
    <button aria-keyshortcuts="ArrowRight" aria-label="Next" title="Next (→)" disabled={!stop.next} onClick={() => moveStop(1)}>→</button>
    <span className="item-toolbar-slot" ref={setToolbarSlot} />
    <button aria-pressed={fullScreen} aria-label={fullScreen ? 'Exit full screen' : 'Full screen'} title={fullScreen ? 'Exit full screen (Esc)' : 'Full screen'} onClick={() => setFullScreen(value => !value)}>{fullScreen ? '⤡' : '⤢'}</button>
  </nav>;
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
      const outputs = family.reduce((sum, member) => sum + member.cells.filter(hasEvalOutput).length, 0);
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
  const promptsMenu = (at: { x: number; y: number }) => setMenu({ label: 'Prompts', at, sections: [
    { label: 'Prompt snippets', items: promptSnippets.map(snippet => ({ label: snippet.name, copyId: snippet.id, onSelect: () => navigationHistory.openPanel({ kind: 'snippet', id: snippet.id }) })) },
    ...evalWorkflowIds.map(id => ({ label: evalWorkflows[id].label, items: [
      ...(prompts ?? []).filter(prompt => prompt.workflow === id).map(prompt => ({ label: prompt.name, detail: `v${latestVersion(prompt).version}${prompt.archivedAt ? ' · archived' : ''}`,
        muted: !!prompt.archivedAt, onSelect: () => go({ kind: 'prompt', id: prompt.id }) })),
      { label: `+ New ${evalWorkflows[id].label.toLowerCase()} prompt`, onSelect: () => go({ kind: 'new-prompt', workflow: id }) }
    ] }))
  ] });
  const canvas = route.kind === 'canvas' ? generated?.find(item => item.id === route.id) : undefined;

  const content = () => {
    if (route.kind === 'cost-statistics') return <CostStatistics />;
    if (route.kind === 'prompt' && current && route.version && !current.versions.some(version => version.version === route.version))
      return <p className="evals-message">Prompt v{route.version} is not available in the current catalog. Its captured text remains in the run details.</p>;
    if (route.kind === 'reference') {
      const reference = references?.find(item => item.id === route.id);
      return reference ? <ReferenceView key={reference.id} reference={reference} groups={referenceGroups} prompts={prompts ?? []} onChanged={referenceChanged} onOpenPrompt={id => go({ kind: 'prompt', id })} />
        : references && <p className="evals-message">Reference not found.</p>;
    }
    if (route.kind === 'experiment') return !experiments || !runs || !judgements ? <p role="status">Loading experiment…</p> : activeExperiment ? <ExperimentView onSaved={onExperimentSaved} key={activeExperiment.id} experiment={activeExperiment} availableExperimentTags={experiments.flatMap(item => item.tags ?? [])} availableTags={[...new Set(experiments.flatMap(item => [...(item.commentTags ?? []), ...(item.comments ?? []).flatMap(comment => comment.tags ?? [])]))]} onChanged={refreshAll} prompts={prompts ?? []} route={route} runs={runs ?? []} judgements={judgements ?? []} onOpen={next => go(next.kind === 'run' || next.kind === 'judgements' ? { ...next, nav: navigationContext(activeExperiment.id, route.phaseId) } : next)} picked={picked} onPick={(output, on) => setPicked(current => on ? [...current.filter(p => p.canvasId !== output.canvasId), output] : current.filter(p => p.canvasId !== output.canvasId))} /> : <p>Experiment not found.</p>;
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
        <OutputCommentsPanel /><OutputView cell={shownCell} run={run} focusDiagram={route.diagram} />
      </> : <p className="evals-message">This run has no outputs.</p>;
    }
    if (route.kind === 'judgements') return <>{navigationBar}<JudgementsPane items={judgementItems}
      selectedId={route.judgementId} prompts={prompts ?? []} onSelect={judgementId => go({ kind: 'judgements', judgementId, nav: route.nav })}
      step={route.step} onStep={step => go({ ...route, step })}
      onDelete={item => remove(`Delete judgement “${item.title}”?${item.runIds.length > 1 ? ' This removes it from every attached run.' : ''}`, () => deleteJudgement(item.id), () => false)} /></>;
    if (route.kind === 'session') return session ? <ComparisonView key={session.id} session={session} prompts={prompts ?? []} />
      : !error && <p role="status" className="evals-message">Loading comparison…</p>;
    return <ExperimentHome experiments={experiments} view={route.kind === 'home' && route.view || 'relationships'}
      onView={view => go({ kind: 'home', view })} onOpen={(id, focusPhase) => go({ kind: 'experiment', id, focusPhase })} />;
  };

  return <EvalHistoryContext.Provider value={navigationHistory}><main className={`evals-page${fullScreen && itemView ? ' is-full-screen' : ''}`}>
    <header className="evals-header">
      <a href={import.meta.env.BASE_URL}>← Mapping</a>
      <h1><button type="button" className="evals-home-link" onClick={() => go({ kind: 'home' })}>Evals</button></h1>
      <span className="evals-muted">Prompt workflows, runs and comparisons</span>
      <span className="evals-spacer" />
      <button type="button" aria-current={route.kind === 'home' ? 'page' : undefined} onClick={() => go({ kind: 'home' })}>Home</button>
      <button type="button" aria-current={inReferences ? 'page' : undefined} className={inReferences ? 'is-active' : undefined} onClick={() => go({ kind: 'references' })}>References</button>
      <button type="button" aria-haspopup="menu" onClick={event => { const box = event.currentTarget.getBoundingClientRect(); promptsMenu({ x: box.left, y: box.bottom + 4 }); }}>Prompts ▾</button>
      <button type="button" className="evals-header-secondary" onClick={() => navigationHistory.openPanel({ kind: 'templates' })}>Layout templates</button>
      <button type="button" className="evals-header-secondary" onClick={() => setLaunch('compare')}>New comparison</button>
      <details className="evals-header-more"><summary>More</summary><div>
        <button type="button" onClick={() => navigationHistory.openPanel({ kind: 'templates' })}>Layout templates</button>
        <button type="button" onClick={() => setLaunch('compare')}>New comparison</button>
      </div></details>
      <button type="button" aria-current={route.kind === 'cost-statistics' ? 'page' : undefined} onClick={() => go({ kind: 'cost-statistics' })}>Cost statistics</button>
      {!activeExperiment && route.kind !== 'cost-statistics' && <button type="button" className="is-primary" onClick={() => setLaunch({ workflow: route.kind === 'prompt' && current ? current.workflow : 'roll-up' })}>New run</button>}
    </header>
    <div className="evals-layout" ref={layout}>
      <nav className="evals-nav" aria-label="Evals">
        {inReferences ? (references ? <ReferenceExplorer tab={route.kind === 'new-reference' ? 'canvas' : 'references'} references={activeReferences} groups={referenceGroups}
            current={route.kind === 'reference' ? route.id : undefined} captureCount={captures.length} candidates={candidates} candidatesError={candidatesError}
            currentDiagramKey={route.kind === 'new-reference' && route.target ? diagramLeafKey(route.target.source, route.target.diagramId) : undefined}
            onTab={tab => go(tab === 'canvas' ? { kind: 'new-reference', target: lastDiagram.current } : { kind: 'references' })} onExit={() => go({ kind: 'home' })}
            onOpenDiagram={openDiagram} onOpen={openReference} onMenu={setMenu} onArchive={archiveReference} onMove={moveReference}
            onCreateGroup={createGroup} onRenameGroup={renameGroup} onDeleteGroup={deleteGroup} />
          : <p role="status" className="evals-muted">Loading…</p>)
        : runs && experiments ? <>
            <div className="explorer-tabs" role="tablist" aria-label="Explorer">
              <button type="button" role="tab" aria-selected={sidebarTab === 'experiments'} onClick={() => setSidebarTab('experiments')}>Experiments</button>
              <button type="button" role="tab" aria-selected={sidebarTab === 'overview'} disabled={!contextTree} title={navContext?.experiment.name}
                onClick={() => setSidebarTab('overview')}>Overview</button>
            </div>
            {route.kind === 'run' && <section className="explorer-output" aria-label="Current output">
              {navigationBar}
              <div className="explorer-output-controls" ref={setOutputSidebar} />
            </section>}
            {sidebarTab === 'overview' && contextTree && navContext ? <div className="explorer-overview">
              <button type="button" className="evals-link explorer-overview-title" title={navContext.experiment.name}
                onClick={() => go({ kind: 'experiment', id: navContext.experiment.id, ...(navContext.phaseId ? { phaseId: navContext.phaseId } : {}) })}>{navContext.experiment.name}</button>
              {phaseOptions.length > 1 && <select aria-label="Phase" value={navContext.phaseId ?? ALL_PHASES} onChange={event => choosePhase(event.target.value)}>
                <option value={ALL_PHASES}>All phases</option>
                {phaseOptions.map(phase => <option key={phase.id} value={phase.id}>{phase.label}</option>)}
              </select>}
              <ViewTreeSidebar root={contextTree} keyOf={navigationKey} selectable={target => target.kind !== 'judgement' || isStop(target) || !!stepsOf(target.judgementId)?.length} onOpen={openStop}
                currentKey={currentKey}
                labelOf={node => node.target ? stopName(node.target) ?? node.label : node.label} flatten={node => /\/(variants|outputs)$/.test(node.id)} />
            </div> : <ExperimentExplorer experiments={experiments} runs={runs} selection={selection} onOpen={treeActions.open} />}
          </>
          : <p role="status" className="evals-muted">Loading…</p>}
        {picked.length > 0 && runs && <CompareBar picked={picked} runs={runs} onClear={() => setPicked([])} onSession={openSession} onComparisonStarted={comparisonStarted} />}
      </nav>
      <EvalsSidebarResize layout={layout} />
      <section className="evals-content"><ItemToolbarContext.Provider value={stop ? toolbarSlot : null}>
        <OutputSidebarContext.Provider value={route.kind === 'run' ? outputSidebar : null}>
        <OutputCommentContext.Provider value={route.kind === 'run' && shownCell && activeExperiment ? {
          experiment: activeExperiment, runId: route.id, cellKey: shownCell.key,
          activeComment: activeExperiment.comments?.find(comment => comment.id === route.comment),
          onLeaveComment: () => {
            const anchor = activeExperiment.comments?.find(comment => comment.id === route.comment)?.anchor;
            navigationHistory.update({ canvas: anchor ? { id: anchor.canvasId } : view.canvas }, { ...route, comment: undefined });
          },
          onSaved: (saved, commentId) => {
            onExperimentSaved(saved);
            if (commentId) go({ ...route, comment: commentId, diagram: undefined, nav: navigationContext(saved.id, ALL_PHASES) });
            else if (route.comment && !saved.comments?.some(comment => comment.id === route.comment)) go({ ...route, comment: undefined });
          }
        } : null}>
        {error && <p role="alert" className="evals-error">{error} <button type="button" className="evals-link" onClick={() => setError('')}>Dismiss</button></p>}
        {activeExperiment && route.kind !== 'experiment' && !stop && <div className="experiment-breadcrumb"><button className="evals-link" onClick={() => go({ kind: 'experiment', id: activeExperiment.id })}>{activeExperiment.name}</button><span>› {route.kind === 'judgements' ? 'Judgement' : 'Stage output'}</span><button className="evals-link" onClick={() => go({ kind: 'experiment', id: activeExperiment.id, view: 'outputs' })}>All outputs</button></div>}
        {content()}
        </OutputCommentContext.Provider>
        </OutputSidebarContext.Provider>
      </ItemToolbarContext.Provider></section>
    </div>
    {confirmation && <ConfirmDialog {...confirmation} onClose={() => setConfirmation(undefined)} />}
    {templatesOpen && <LayoutTemplates onClose={navigationHistory.closePanel} />}
    {openSnippet && <Drawer wide title={openSnippet.name} onClose={navigationHistory.closePanel}>
      <h3>Used in prompts</h3>
      {snippetUses === undefined ? <p role="status">Loading prompts…</p> : snippetUses.length
        ? <ul>{snippetUses.map(({ prompt, version, stage }) => <li key={JSON.stringify([prompt.id, version, stage])}>
          <a href={`?prompt=${encodeURIComponent(prompt.id)}&version=${version}`} onClick={event => {
            if (event.button || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return;
            event.preventDefault();
            navigationHistory.go({ kind: 'prompt', id: prompt.id, version }, { view: { promptStage: stage } });
          }}>{prompt.name} · v{version} · {stage}</a>
        </li>)}</ul> : <p>No saved prompt versions reference this template.</p>}
      <pre className="prompt-snippet-preview">{openSnippet.text}</pre>
    </Drawer>}
    {launch === 'compare' && <CompareLauncher onClose={() => setLaunch(undefined)} onCreated={openSession} />}
    {menu && <PopoverMenu label={menu.label} at={menu.at} sections={menu.sections} onClose={() => setMenu(undefined)} />}
    {launch && launch !== 'compare' && prompts && <RunLauncher prompts={prompts} runs={runs ?? []} initial={launch} onClose={() => setLaunch(undefined)} onStarted={started} />}
  </main></EvalHistoryContext.Provider>;
}
