import ts from 'typescript';
import { AnalysisContext, callable, sha } from './context';
import { Declarations } from './declarations';
import type { AnalysisRelation } from '../../../domain/core/static-analysis/schema';
type Dispatch = Extract<AnalysisRelation, { view: 'calls' }>['dispatch'];

export interface CallSite { node: ts.CallExpression | ts.NewExpression; caller: string; targets: string[] }
export function callableTarget(declarations: Declarations, expression: ts.Node, seen = new Set<ts.Node>()): string | undefined {
  if (seen.has(expression)) return undefined; seen.add(expression);
  if (callable(expression)) return declarations.ensure(expression);
  const local = declarations.local(expression);
  if (local) {
    const declaration = declarations.ctx.entityNodes.get(local)!;
    if (ts.isVariableDeclaration(declaration) && declaration.initializer) {
      if (callable(declaration.initializer)) return declarations.ensure(declaration.initializer);
      if (ts.isIdentifier(declaration.initializer)) return callableTarget(declarations, declaration.initializer, seen);
    }
    return local;
  }
  const symbol = declarations.symbol(ts.isPropertyAccessExpression(expression) ? expression.name : expression);
  const declaration = symbol?.valueDeclaration ?? symbol?.declarations?.[0];
  if (declaration && (ts.isVariableDeclaration(declaration) || ts.isPropertyDeclaration(declaration) || ts.isPropertyAssignment(declaration)) && declaration.initializer) {
    if (callable(declaration.initializer)) return declarations.ensure(declaration.initializer, expression);
    if (ts.isIdentifier(declaration.initializer) || ts.isPropertyAccessExpression(declaration.initializer)) return callableTarget(declarations, declaration.initializer, seen);
  }
  return declarations.resolve(expression, true);
}

export function extractCalls(ctx: AnalysisContext, declarations: Declarations): CallSite[] {
  const sites: CallSite[] = [];
  const visit = (node: ts.Node) => {
    if (ts.isTypeNode(node) && !ts.isExpressionWithTypeArguments(node)) return;
    if (ts.isCallExpression(node) || ts.isNewExpression(node)) {
      const caller = declarations.ensure(ctx.owner(node)), expression = node.expression;
      const targets: string[] = [];
      let dispatch: 'direct' | 'virtual' | 'union' | 'callback' | 'computed' | 'external' | 'unknown' = 'direct';
      let inferred = false;
      if (ts.isElementAccessExpression(expression) && !(ts.isStringLiteralLike(expression.argumentExpression) || ts.isNumericLiteral(expression.argumentExpression))) {
        const target = ctx.addEntity('unknown-target', expression.getText(), expression, caller, 'computed-call', 'synthetic', true);
        targets.push(target); dispatch = 'computed'; inferred = true;
        ctx.issue('calls', 'computed-key', node, [caller, target], 'Computed call key has no finite resolved target set.');
      } else {
        if (ts.isPropertyAccessExpression(expression)) {
          // A union member symbol carries its constituent declarations. Avoid materializing
          // every receiver's full generic type (notably test matchers and schema builders).
          const symbol = declarations.symbol(expression.name);
          const candidates = symbol?.declarations?.filter(declaration => callable(declaration) || ts.isMethodSignature(declaration)) ?? [];
          // Overload signatures share one runtime body. Union members with distinct
          // bodies remain separate candidates; bodyless contracts retain uncertainty.
          const bodies = candidates.filter(declaration => callable(declaration) && !!declaration.body);
          const implementations = bodies.length ? candidates.filter(declaration => bodies.includes(declaration)
            || !bodies.some(body => body.parent === declaration.parent)) : candidates;
          if (implementations.length > 1) {
            for (const declaration of implementations) targets.push(declarations.ensure(declaration, expression));
            if (targets.length > 1) { inferred = true; dispatch = 'union'; }
          }
        }
        if (!targets.length) {
          const target = callableTarget(declarations, expression);
          if (target) targets.push(target);
        }
        if (!targets.length) {
          const target = ctx.addEntity('unknown-target', expression.getText().slice(0, 120), expression, caller, 'unknown-call', 'synthetic', true);
          targets.push(target); inferred = true; dispatch = 'unknown';
          ctx.issue('calls', 'dynamic-dispatch', node, [caller, target], 'No callable implementation could be resolved.');
        }
      }
      for (const target of [...new Set(targets)]) {
        const entity = ctx.entities.get(target)!, declaration = ctx.entityNodes.get(target);
        let targetDispatch: Dispatch = dispatch, status: 'resolved' | 'inferred' = inferred ? 'inferred' : 'resolved';
        if (declaration && (ts.isMethodSignature(declaration) || ts.isCallSignatureDeclaration(declaration))) {
          targetDispatch = 'virtual'; status = 'inferred'; ctx.issue('calls', 'dynamic-dispatch', node, [caller, target], 'A signature specifies a callable shape, not a concrete runtime implementation.');
        } else if (['parameter', 'binding', 'field'].includes(entity.kind)) {
          targetDispatch = 'callback'; status = 'inferred'; ctx.issue('calls', 'dynamic-dispatch', node, [caller, target], 'The callable value has no single resolved implementation.');
        } else if (entity.identity.origin === 'external' || declaration && ts.isFunctionDeclaration(declaration) && !declaration.body) {
          targetDispatch = 'external'; ctx.issue('calls', 'external-body', node, [caller, target], 'Declaration resolves; dependency implementation is outside the analyzed body scope.');
        } else if (declaration && (ts.isMethodDeclaration(declaration) || ts.isPropertyAccessExpression(expression)) && dispatch === 'direct') {
          targetDispatch = 'virtual'; status = 'inferred';
        }
        ctx.edge('calls', ts.isNewExpression(node) ? 'constructs' : 'calls', caller, target, node,
          { dispatch: targetDispatch, ...(dispatch === 'union' ? { candidateSetId: `candidates:${sha(ctx.site(node))}` } : {}) }, 'symbol-resolution', status);
      }
      sites.push({ node, caller, targets: [...new Set(targets)] });
    }
    ts.forEachChild(node, visit);
  };
  ctx.selected.forEach(visit);
  return sites;
}
