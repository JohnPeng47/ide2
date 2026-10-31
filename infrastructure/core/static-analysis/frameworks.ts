import ts from 'typescript';
import { AnalysisContext, callable } from './context';
import { Declarations } from './declarations';
import { Resources } from './resources';
import type { CallSite } from './calls';

export function extractFrameworks(ctx: AnalysisContext, declarations: Declarations, resources: Resources, sites: CallSite[]) {
  for (const { node, caller, targets } of sites) {
    const expression = node.expression, args = node.arguments ?? [], name = resources.calleeName(node);
    const library = resources.library(expression), receiver = ts.isPropertyAccessExpression(expression) ? expression.expression : undefined;
    const resource = receiver && resources.resource(receiver), mechanism = receiver ? resources.mechanism(receiver) : library ?? 'language';
    const call = (kind: 'registers' | 'schedules', target: string) => ctx.edge('calls', kind, caller, target, node, { dispatch: 'callback' }, 'framework-summary', 'inferred');
    if (receiver && resource) {
      if (['subscribe', 'onCommit'].includes(name) && mechanism !== 'language') {
        const callback = args[0] && resources.callback(args[0]);
        if (callback) {
          call('registers', callback);
          ctx.edge('dependencies', 'reactive', resource, callback, node, { mechanism }, 'framework-summary', 'inferred');
          ctx.edge('ownership', 'retains', resource, callback, node, {}, 'framework-summary', 'inferred');
        }
        ctx.edge('ownership', 'subscribes', caller, resource, node, { capability: 'subscribe' }, 'framework-summary', 'inferred');
      }
      const writes = mechanism === 'zustand' && name === 'setState' || mechanism === 'tldraw' && name === 'set'
        || ['add', 'delete', 'clear', 'push', 'pop', 'splice', 'set'].includes(name) && ctx.resourceKinds.get(resource) === 'collection';
      if (writes) {
        ctx.edge('dependencies', 'writes', caller, resource, node, { mechanism }, 'framework-summary', 'inferred');
        ctx.edge('ownership', 'can-mutate', caller, resource, node, { capability: 'write' }, 'framework-summary', 'inferred');
      }
      if (mechanism === 'zustand' && name === 'getState' || mechanism === 'tldraw' && name === 'get') ctx.edge('dependencies', 'reads', resource, caller, node, { mechanism }, 'framework-summary', 'inferred');
      if (['dispose', 'unsubscribe', 'close', 'abort'].includes(name)) {
        const symbolic = ts.isPropertyAccessExpression(receiver) && !['this', 'super'].includes(receiver.expression.getText())
          ? ctx.addEntity('state-resource', receiver.getText(), receiver, caller, 'access-resource', 'source', true) : resource;
        ctx.edge('ownership', name === 'unsubscribe' ? 'unsubscribes' : 'disposes', caller, symbolic, node, { capability: 'dispose' }, 'framework-summary', 'inferred');
      }
    }
    if (library === 'react' && ctx.request.frameworks.includes('react')) {
      if (['useEffect', 'useLayoutEffect', 'useInsertionEffect', 'useMemo', 'useCallback'].includes(name) && args[0]) {
        const callback = resources.callback(args[0]);
        if (callback) {
          call('schedules', callback);
          if (args[1] && ts.isArrayLiteralExpression(args[1])) for (const dependency of args[1].elements) {
            const producer = declarations.resolve(dependency);
            if (producer) ctx.edge('dependencies', 'effect-dependency', producer, callback, dependency, { mechanism: 'react' }, 'framework-summary');
          }
        }
      }
    }
    if (library === 'zustand' && name === 'useStore' && args[0] && args[1] && ctx.request.frameworks.includes('zustand')) {
      const store = declarations.resolve(args[0]), selector = resources.callback(args[1]);
      if (store && selector) {
        ctx.edge('dependencies', 'selects', store, selector, node, { mechanism: 'zustand' }, 'framework-summary', 'inferred');
        ctx.edge('dependencies', 'reactive', ctx.canonical(store), selector, node, { mechanism: 'zustand' }, 'framework-summary', 'inferred');
      }
    }
    if (library === 'tldraw' && name === 'computed' && args[1] && ctx.request.frameworks.includes('tldraw')) {
      const callback = resources.callback(args[1]);
      const parent = node.parent;
      if (callback && (ts.isVariableDeclaration(parent) || ts.isPropertyDeclaration(parent))) {
        ctx.edge('dependencies', 'reactive', callback, declarations.ensure(parent), node, { mechanism: 'tldraw' }, 'framework-summary', 'inferred');
      }
    }
    const setter = declarations.resolve(expression), state = setter && ctx.setters.get(setter);
    if (state) {
      ctx.edge('dependencies', 'writes', caller, state, node, { mechanism: 'react' }, 'framework-summary', 'inferred');
      ctx.edge('ownership', 'can-mutate', caller, state, node, { capability: 'write' }, 'framework-summary', 'inferred');
    }
    // Unknown external recipients can retain mutable objects or callbacks. Do not invent their behavior.
    if (targets.some(target => ctx.entities.get(target)?.identity.origin === 'external' || (() => {
      const declaration = ctx.entityNodes.get(target); return declaration && ts.isFunctionDeclaration(declaration) && !declaration.body;
    })())) {
      for (const argument of args) {
        const id = resources.callback(argument) ?? resources.resource(argument);
        if (id && (ctx.resourceKinds.has(ctx.canonical(id)) || callable(ctx.entityNodes.get(id)!))) {
          ctx.edge('ownership', 'escapes', ctx.canonical(id), targets[0], node, {}, 'local-alias', 'inferred');
          ctx.issue('ownership', 'escaped-reference', node, [ctx.canonical(id)], 'External code may retain this reference; no exclusive lifetime or mutation claim is made.', 'escape');
        }
      }
    }
  }
  if (ctx.request.frameworks.includes('react')) {
    const visit = (node: ts.Node) => {
      if (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) {
        const target = declarations.resolve(node.tagName, true), declaration = target && ctx.entityNodes.get(target);
        if (declaration && callable(declaration)) {
          const parameter = declaration.parameters[0];
          for (const attribute of node.attributes.properties) if (ts.isJsxAttribute(attribute) && attribute.initializer && ts.isJsxExpression(attribute.initializer) && attribute.initializer.expression && parameter) {
            const source = declarations.resolve(attribute.initializer.expression, true);
            if (!source) continue;
            if (ts.isObjectBindingPattern(parameter.name)) {
              const binding = parameter.name.elements.find(element => (element.propertyName ?? element.name).getText() === attribute.name.getText());
              if (binding) ctx.edge('dependencies', 'prop-flow', source, declarations.ensure(binding), attribute, { mechanism: 'react' }, 'framework-summary', 'inferred');
            } else ctx.edge('dependencies', 'prop-flow', source, declarations.ensure(parameter), attribute, { mechanism: 'react', propertyPath: [attribute.name.getText()] }, 'framework-summary', 'inferred');
          }
        }
      }
      ts.forEachChild(node, visit);
    };
    ctx.selected.forEach(visit);
  }
}
