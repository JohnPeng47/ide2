import ts from 'typescript';
import { AnalysisContext, callable } from './context';
import { Declarations } from './declarations';
import { accessOf, isValueReference, type Reference } from './lexical';
import { Resources } from './resources';
import type { CallSite } from './calls';

export function extractDataflow(ctx: AnalysisContext, declarations: Declarations, resources: Resources, references: Reference[], sites: CallSite[] = []) {
  const mechanism = (id: string) => {
    const kind = ctx.resourceKinds.get(id);
    return kind === 'zustand-store' ? 'zustand' : kind?.startsWith('tldraw') ? 'tldraw' : kind?.startsWith('react') ? 'react' : 'language';
  };
  for (const reference of references) {
    const target = reference.access.includes('reassign') ? reference.target : ctx.canonical(reference.target), owner = declarations.ensure(reference.owner), entity = ctx.entities.get(target)!;
    if (entity.metadata.namespace === 'type' || entity.kind === 'external' || reference.node.kind === ts.SyntaxKind.ThisKeyword) continue;
    const isWrite = reference.access.includes('reassign') || reference.access.includes('object-mutate');
    if (isWrite) {
      ctx.edge('dependencies', 'writes', owner, target, reference.node.parent, { mechanism: mechanism(target), propertyPath: reference.propertyPath }, 'local-alias', target === reference.target ? 'resolved' : 'inferred');
      ctx.edge('ownership', 'can-mutate', owner, target, reference.node.parent, { capability: 'write' }, 'local-alias', 'inferred');
    }
    if (reference.access.includes('read') && !['function', 'method', 'class', 'constructor'].includes(entity.kind))
      ctx.edge('dependencies', 'reads', target, owner, reference.node, { mechanism: mechanism(target), propertyPath: reference.propertyPath }, 'local-alias');
  }
  // Explicit member accesses of `this` use the field as resource, not the entire receiver.
  const members = (node: ts.Node) => {
    if (ts.isAwaitExpression(node)) {
      const owner = declarations.ensure(ctx.owner(node));
      const value = ctx.nodeEntities.get(node.expression) ?? ctx.addEntity('expression', 'awaited value', node.expression, owner, 'call-result', 'source', true);
      ctx.nodeEntities.set(node.expression, value);
      ctx.edge('dependencies', 'awaits', value, owner, node, { mechanism: 'language' }, 'control-flow');
      const continuation = ctx.addEntity('statement', 'continuation after await', node, owner, 'continuation', 'source', true);
      ctx.edge('calls', 'resumes', value, continuation, node, { dispatch: 'callback' }, 'control-flow', 'inferred');
    }
    if (ts.isPropertyAccessExpression(node) && node.expression.kind === ts.SyntaxKind.ThisKeyword) {
      const target = resources.resource(node), access = accessOf(node);
      if (target && ctx.entities.get(target)?.kind === 'field') {
        const owner = declarations.ensure(ctx.owner(node));
        if (access.access.includes('reassign') || access.access.includes('object-mutate')) {
          ctx.edge('dependencies', 'writes', owner, target, node.parent, { mechanism: mechanism(target), propertyPath: access.propertyPath }, 'symbol-resolution');
          ctx.edge('ownership', 'can-mutate', owner, target, node.parent, { capability: 'write' }, 'symbol-resolution');
        } else ctx.edge('dependencies', 'reads', target, owner, node, { mechanism: mechanism(target) }, 'symbol-resolution');
      }
    }
    ts.forEachChild(node, members);
  };
  ctx.selected.forEach(members);
  if (!ctx.active('dependencies')) return;
  type Environment = Map<string, string>;
  const callSites = new Map(sites.map(site => [site.node, site]));
  const callResult = (node: ts.CallExpression | ts.NewExpression, environment: Environment): string => {
    const owner = declarations.ensure(ctx.owner(node));
    const result = ctx.nodeEntities.get(node) ?? ctx.addEntity('expression', 'call result', node, owner, 'call-result', 'source', true);
    ctx.nodeEntities.set(node, result);
    for (const target of callSites.get(node)?.targets ?? []) {
      ctx.edge('dependencies', 'return', target, result, node, { mechanism: 'language' }, 'interprocedural-summary', 'inferred');
      const targetNode = ctx.entityNodes.get(target);
      const implementation = targetNode && (callable(targetNode) ? targetNode : ts.isClassDeclaration(targetNode) ? targetNode.members.find(ts.isConstructorDeclaration) : undefined);
      if (!implementation || ctx.entities.get(target)?.identity.origin !== 'source') continue;
      for (let index = 0; index < (node.arguments?.length ?? 0); index++) {
        const argument = node.arguments![index], parameter = implementation.parameters[index];
        if (!parameter) continue;
        if (ts.isSpreadElement(argument)) { ctx.issue('dependencies', 'unsupported-syntax', argument, [owner, target], 'Spread arguments require tuple/rest parameter expansion.', 'unsupported'); break; }
        const values = inputs(argument, environment);
        if (!values.length) values.push(ctx.addEntity('expression', 'argument value', argument, owner, 'argument-value', 'source', true));
        for (const value of values) ctx.edge('dependencies', 'argument', value, declarations.ensure(parameter), node,
          { mechanism: 'language', argumentIndex: index }, 'interprocedural-summary', 'inferred');
      }
    }
    return result;
  };
  const inputs = (node: ts.Node, environment: Environment): string[] => {
    const values = new Set<string>();
    const visit = (child: ts.Node) => {
      if (callable(child)) { values.add(declarations.ensure(child)); return; }
      if (ts.isClassDeclaration(child) || ts.isClassExpression(child)) { values.add(declarations.ensure(child)); return; }
      if (ts.isCallExpression(child) || ts.isNewExpression(child)) { values.add(callResult(child, environment)); return; }
      if (ts.isIdentifier(child) && isValueReference(child) || ts.isPropertyAccessExpression(child)) {
        const binding = declarations.resolve(child);
        if (binding && ctx.entities.get(binding)?.metadata.namespace !== 'type') values.add(environment.get(binding) ?? ctx.canonical(binding));
        if (ts.isPropertyAccessExpression(child)) return;
      }
      ts.forEachChild(child, visit);
    };
    visit(node); return [...values];
  };
  for (const fn of [...ctx.selected, ...ctx.callableNodes]) {
    const body = ts.isSourceFile(fn) ? fn : fn.body;
    if (!body) continue;
    const owner = declarations.ensure(fn);
    const terminated = new WeakSet<Environment>();
    const define = (binding: string, node: ts.Node, value: ts.Node | undefined, environment: Environment, controls: string[]) => {
      const entity = ctx.entities.get(binding)!;
      const definition = ctx.addEntity('definition', entity.name, node, binding, 'definition', 'source', true);
      for (const source of value ? inputs(value, environment) : []) ctx.edge('dependencies', 'value-flow', source, definition, node, { mechanism: 'language' }, 'def-use');
      for (const control of controls) ctx.edge('dependencies', 'control', control, definition, node, { mechanism: 'language' }, 'control-flow');
      environment.set(binding, definition);
    };
    const merge = (base: Environment, branches: Environment[], node: ts.Node): Environment => {
      const next = new Map(base), bindings = new Set(branches.flatMap(branch => [...branch.keys()]));
      for (const binding of bindings) {
        const definitions = new Set(branches.map(branch => branch.get(binding) ?? base.get(binding) ?? binding));
        if (definitions.size === 1) { next.set(binding, [...definitions][0]); continue; }
        const id = ctx.addEntity('merge', ctx.entities.get(binding)!.name, node, binding, 'control-join', 'source', true);
        for (const source of definitions) ctx.edge('dependencies', 'value-flow', source, id, node, { mechanism: 'language' }, 'control-flow', 'inferred');
        next.set(binding, id);
      }
      return next;
    };
    const walk = (node: ts.Node, environment: Environment, controls: string[] = []): Environment => {
      if (callable(node) || ts.isClassDeclaration(node) || ts.isClassExpression(node)) return environment;
      if (ts.isIfStatement(node)) {
        environment = walk(node.expression, environment, controls);
        const predicates = inputs(node.expression, environment);
        const yes = walk(node.thenStatement, new Map(environment), [...controls, ...predicates]);
        const no = node.elseStatement ? walk(node.elseStatement, new Map(environment), [...controls, ...predicates]) : new Map(environment);
        const continuing = [yes, no].filter(branch => !terminated.has(branch));
        if (!continuing.length) { terminated.add(environment); return environment; }
        return merge(environment, continuing, node);
      }
      if (ts.isConditionalExpression(node)) {
        environment = walk(node.condition, environment, controls);
        const predicates = [...controls, ...inputs(node.condition, environment)];
        return merge(environment, [walk(node.whenTrue, new Map(environment), predicates), walk(node.whenFalse, new Map(environment), predicates)], node);
      }
      if (ts.isBinaryExpression(node) && [ts.SyntaxKind.AmpersandAmpersandToken, ts.SyntaxKind.BarBarToken, ts.SyntaxKind.QuestionQuestionToken].includes(node.operatorToken.kind)) {
        environment = walk(node.left, environment, controls);
        return merge(environment, [environment, walk(node.right, new Map(environment), [...controls, ...inputs(node.left, environment)])], node);
      }
      if (ts.isForStatement(node) || ts.isWhileStatement(node) || ts.isDoStatement(node) || ts.isForOfStatement(node) || ts.isForInStatement(node)) {
        const predicates = 'expression' in node && node.expression ? inputs(node.expression, environment) : [];
        let body = new Map(environment);
        if ('initializer' in node && node.initializer) body = walk(node.initializer, body, controls);
        body = walk(node.statement, body, [...controls, ...predicates]);
        if (ts.isForStatement(node) && node.incrementor) body = walk(node.incrementor, body, controls);
        ctx.issue('dependencies', 'unsupported-syntax', node, [owner], 'Loop transfer is conservatively merged once; full loop-carried SSA fixed-point precision is not implemented.', 'unsupported');
        return merge(environment, [environment, body], node);
      }
      if (ts.isTryStatement(node) || ts.isSwitchStatement(node)) {
        ctx.issue('dependencies', 'unsupported-syntax', node, [owner], 'Exceptional/switch control flow is not yet modeled precisely; facts inside are conservative.', 'unsupported');
        if (ts.isSwitchStatement(node)) {
          const branches = node.caseBlock.clauses.map(clause => walk(clause, new Map(environment), [...controls, ...inputs(node.expression, environment)]));
          // Retain the entering state for unmatched cases and fallthrough uncertainty.
          return merge(environment, [environment, ...branches.filter(branch => !terminated.has(branch))], node);
        }
        const branches = [walk(node.tryBlock, new Map(environment), controls)];
        if (node.catchClause) branches.push(walk(node.catchClause.block, new Map(environment), controls));
        const next = merge(environment, [environment, ...branches.filter(branch => !terminated.has(branch))], node);
        return node.finallyBlock ? walk(node.finallyBlock, next, controls) : next;
      }
      if (ts.isVariableDeclaration(node)) {
        if (node.initializer) environment = walk(node.initializer, environment, controls);
        if (ts.isIdentifier(node.name)) {
          const binding = declarations.ensure(node); define(binding, node, node.initializer, environment, controls);
        } else if (node.initializer && ts.isObjectBindingPattern(node.name)) {
          const source = declarations.resolve(node.initializer);
          for (const element of node.name.elements) if (ts.isIdentifier(element.name)) {
            const binding = declarations.ensure(element);
            if (source) ctx.edge('dependencies', 'value-flow', source, binding, element,
              { mechanism: 'language', propertyPath: [(element.propertyName ?? element.name).getText()] }, 'def-use');
          }
        }
        return environment;
      }
      if (ts.isBinaryExpression(node) && node.operatorToken.kind >= ts.SyntaxKind.FirstAssignment && node.operatorToken.kind <= ts.SyntaxKind.LastAssignment) {
        environment = walk(node.right, environment, controls);
        const binding = ts.isIdentifier(node.left) ? declarations.resolve(node.left) : undefined;
        if (binding) define(binding, node, node.operatorToken.kind === ts.SyntaxKind.EqualsToken ? node.right : node, environment, controls);
        return environment;
      }
      if ((ts.isPostfixUnaryExpression(node) || ts.isPrefixUnaryExpression(node)) && [ts.SyntaxKind.PlusPlusToken, ts.SyntaxKind.MinusMinusToken].includes(node.operator)) {
        const binding = ts.isIdentifier(node.operand) ? declarations.resolve(node.operand) : undefined;
        if (binding) define(binding, node, node.operand, environment, controls);
        return environment;
      }
      if (ts.isReturnStatement(node)) {
        if (node.expression) environment = walk(node.expression, environment, controls);
        if (node.expression) for (const source of inputs(node.expression, environment)) ctx.edge('dependencies', 'return', source, owner, node, { mechanism: 'language' }, 'def-use');
        terminated.add(environment);
        return environment;
      }
      if (ts.isThrowStatement(node)) { terminated.add(environment); return environment; }
      if (ts.isCallExpression(node) || ts.isNewExpression(node)) { callResult(node, environment); return environment; }
      let next = environment;
      ts.forEachChild(node, child => { if (!terminated.has(next)) next = walk(child, next, controls); });
      return next;
    };
    const environment = new Map<string, string>();
    if (ts.isBlock(body) || ts.isSourceFile(body)) walk(body, environment);
    else for (const source of inputs(body, environment)) ctx.edge('dependencies', 'return', source, owner, body, { mechanism: 'language' }, 'def-use');
  }
}
