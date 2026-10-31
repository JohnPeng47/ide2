import ts from 'typescript';
import { AnalysisContext, callable } from './context';
import { Declarations } from './declarations';
import type { CallSite } from './calls';

/** Finite may-target propagation; function identities and function return values are separate. */
export function connectCallbackCandidates(ctx: AnalysisContext, declarations: Declarations, sites: CallSite[]) {
  if (!ctx.active('calls') || !ctx.active('dependencies')) return;
  const outgoing = new Map<string, Set<string>>(), points = new Map<string, Set<string>>();
  const queue: [string, string][] = [], saturated = new Set<string>();
  const limit = 16;
  const add = (key: string, target: string) => {
    const values = points.get(key) ?? new Set<string>();
    if (values.has(target)) return;
    if (values.size >= limit) { saturated.add(key); return; }
    values.add(target); points.set(key, values); queue.push([key, target]);
  };
  const flow = (from: string, to: string) => { const edges = outgoing.get(from) ?? new Set<string>(); edges.add(to); outgoing.set(from, edges); };
  for (const entity of ctx.entities.values()) {
    const node = ctx.entityNodes.get(entity.id);
    if (node && callable(node) && node.body && entity.identity.origin === 'source') add(entity.id, entity.id);
  }
  for (const edge of ctx.relationMap.values()) {
    if (edge.view === 'dependencies') {
      if (['value-flow', 'argument', 'prop-flow'].includes(edge.kind)) flow(edge.from, edge.to);
      if (edge.kind === 'return' && edge.provenance.method === 'def-use') flow(edge.from, `result:${edge.to}`);
      if (edge.kind === 'return' && edge.provenance.method === 'interprocedural-summary') flow(`result:${edge.from}`, edge.to);
    }
    if (edge.view === 'ownership' && edge.kind === 'aliases') flow(edge.to, edge.from);
    if (edge.view === 'containment' && edge.kind === 'contains' && ctx.entities.get(edge.to)?.kind === 'definition') flow(edge.to, edge.from);
  }
  for (let index = 0; index < queue.length; index++) {
    const [key, target] = queue[index]; for (const to of outgoing.get(key) ?? []) add(to, target);
  }
  const saturationQueue = [...saturated];
  for (let index = 0; index < saturationQueue.length; index++) for (const target of outgoing.get(saturationQueue[index]) ?? []) {
    if (!saturated.has(target)) { saturated.add(target); saturationQueue.push(target); }
  }
  const issuesBySite = new Map<string, typeof ctx.artifact.uncertainties>();
  for (const issue of ctx.artifact.uncertainties) if (issue.view === 'calls') {
    const range = issue.provenance.locations[0], key = `${range.path}:${range.start.offset}`;
    const values = issuesBySite.get(key) ?? []; values.push(issue); issuesBySite.set(key, values);
  }
  for (const { node, caller, targets } of sites) {
    const callee = declarations.resolve(node.expression);
    if (!callee) continue;
    const candidates = [...(points.get(callee) ?? [])].sort();
    for (const target of candidates) if (!targets.includes(target)) ctx.edge('calls', ts.isNewExpression(node) ? 'constructs' : 'calls', caller, target, node,
      { dispatch: 'callback' }, 'interprocedural-summary', 'inferred');
    const range = ctx.range(node);
    for (const issue of issuesBySite.get(`${range.path}:${range.start.offset}`) ?? []) if (candidates.length) {
      issue.candidateEntityIds = [...new Set([...issue.candidateEntityIds, ...candidates])].sort();
      issue.provenance.explanation += ' Some candidates were recovered from static argument, return or prop flow; the set remains open to external callers.';
    }
    if (saturated.has(callee)) ctx.issue('calls', 'dynamic-dispatch', node, [callee], `May-target propagation reached its ${limit}-candidate cap; additional targets remain unknown.`);
  }
}
