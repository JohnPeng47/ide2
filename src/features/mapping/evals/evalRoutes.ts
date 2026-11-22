import { readHomeView, type HomeView } from './ExperimentHome';
import type { ExperimentRoute } from './ExperimentExplorer';
import type { ReferenceTarget } from './References';
import { evalWorkflowIds, type EvalWorkflowId } from '../../../../domain/mapping/evals/evalWorkflows';

export type Route = ExperimentRoute | { kind: 'cost-statistics' } | { kind: 'home'; view?: HomeView } | { kind: 'prompt'; id: string; version?: number } | { kind: 'new-prompt'; workflow: EvalWorkflowId; from?: string; fromVersion?: number }
  | { kind: 'run'; id: string; output?: string; nav?: string; diagram?: string; comment?: string } | { kind: 'session'; id: string } | { kind: 'canvas'; id: string }
  | { kind: 'references' } | { kind: 'reference'; id: string } | { kind: 'new-reference'; target?: ReferenceTarget } | { kind: 'judgements'; id?: string; judgementId?: string; nav?: string; step?: string };
export function readRoute(url = new URL(location.href)): Route {
  const params = url.searchParams;
  const id = (key: string) => params.get(key) ?? '';
  if (params.has('cost-statistics')) return { kind: 'cost-statistics' };
  if (params.has('experiment')) return { kind: 'experiment', id: id('experiment'), ...(['overview', 'outputs', 'judgements', 'prompts'].includes(id('view')) ? { view: id('view') as ExperimentRoute['view'] } : {}), ...(params.has('focusPhase') ? { focusPhase: id('focusPhase') } : {}), ...(params.has('phase') ? { phaseId: id('phase') } : {}), ...(params.has('group') ? { groupId: id('group') } : {}) };
  if (params.has('prompt')) return { kind: 'prompt', id: id('prompt'), ...(Number(id('version')) > 0 ? { version: Number(id('version')) } : {}) };
  if (params.has('new-prompt') && evalWorkflowIds.includes(id('new-prompt') as EvalWorkflowId))
    return { kind: 'new-prompt', workflow: id('new-prompt') as EvalWorkflowId, ...(params.has('from') ? { from: id('from') } : {}), ...(Number(id('from-version')) > 0 ? { fromVersion: Number(id('from-version')) } : {}) };
  if (params.has('judgements')) return { kind: 'judgements', ...(params.has('run') ? { id: id('run') } : {}), ...(params.has('judgement') ? { judgementId: id('judgement') } : {}), ...(params.has('nav') ? { nav: id('nav') } : {}), ...(params.has('step') ? { step: id('step') } : {}) };
  if (params.has('run')) return { kind: 'run', id: id('run'), ...(params.has('output') ? { output: id('output') } : {}), ...(params.has('nav') ? { nav: id('nav') } : {}), ...(params.has('focus') ? { diagram: id('focus') } : {}), ...(params.has('comment') ? { comment: id('comment') } : {}) };
  if (params.has('reference')) return { kind: 'reference', id: id('reference') };
  if (params.has('references')) return { kind: 'references' };
  if (params.has('new-reference')) return { kind: 'new-reference', ...(params.has('document') && params.has('checkpoint') && params.has('diagram')
    ? { target: { source: { documentId: id('document'), ...(params.has('view') ? { viewId: id('view') } : {}), checkpointId: id('checkpoint') }, diagramId: id('diagram') } } : {}) };
  if (params.has('canvas')) return { kind: 'canvas', id: id('canvas') };
  if (params.has('session')) return { kind: 'session', id: id('session') };
  return { kind: 'home', view: readHomeView(id('view')) };
}
export function routeUrl(route: Route) {
  const url = new URL(location.href); url.search = '';
  if (route.kind === 'prompt' || route.kind === 'run' || route.kind === 'session' || route.kind === 'canvas' || route.kind === 'reference') url.searchParams.set(route.kind, route.id);
  if (route.kind === 'home' && route.view && route.view !== 'relationships') url.searchParams.set('view', route.view);
  if (route.kind === 'experiment') { url.searchParams.set('experiment', route.id); if (route.view) url.searchParams.set('view', route.view); if (route.groupId) url.searchParams.set('group', route.groupId); if (route.phaseId) url.searchParams.set('phase', route.phaseId); if (route.focusPhase) url.searchParams.set('focusPhase', route.focusPhase); }
  if (route.kind === 'judgements') { url.searchParams.set('judgements', ''); if (route.id) url.searchParams.set('run', route.id); if (route.judgementId) url.searchParams.set('judgement', route.judgementId); if (route.step) url.searchParams.set('step', route.step); }
  if (route.kind === 'references') url.searchParams.set('references', '');
  if (route.kind === 'cost-statistics') url.searchParams.set('cost-statistics', '');
  if (route.kind === 'new-reference') { url.searchParams.set('new-reference', ''); if (route.target) { const { source, diagramId } = route.target;
    url.searchParams.set('document', source.documentId); if (source.viewId) url.searchParams.set('view', source.viewId); url.searchParams.set('checkpoint', source.checkpointId); url.searchParams.set('diagram', diagramId); } }
  if (route.kind === 'run' && route.output) url.searchParams.set('output', route.output);
  if (route.kind === 'run' && route.comment) url.searchParams.set('comment', route.comment);
  if (route.kind === 'run' && route.diagram) url.searchParams.set('focus', route.diagram);
  if ((route.kind === 'run' || route.kind === 'judgements') && route.nav) url.searchParams.set('nav', route.nav);
  if (route.kind === 'prompt' && route.version) url.searchParams.set('version', String(route.version));
  if (route.kind === 'new-prompt') { url.searchParams.set('new-prompt', route.workflow); if (route.from) url.searchParams.set('from', route.from); if (route.fromVersion) url.searchParams.set('from-version', String(route.fromVersion)); }
  return url;
}
