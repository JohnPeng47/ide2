import ts from 'typescript';
import { AnalysisContext, callable } from './context';
import { Declarations } from './declarations';
import type { AnalysisEntity } from '../../../domain/core/static-analysis/schema';

export class Resources {
  constructor(readonly ctx: AnalysisContext, readonly declarations: Declarations) {}
  calleeName(node: ts.CallExpression | ts.NewExpression): string {
    const expression = node.expression;
    const local = this.declarations.local(expression);
    if (local) return this.ctx.entities.get(local)!.name;
    if (ts.isIdentifier(expression)) return this.declarations.symbol(expression)?.name ?? expression.text;
    return ts.isPropertyAccessExpression(expression) ? expression.name.text : '';
  }
  library(expression: ts.Expression): 'react' | 'zustand' | 'tldraw' | undefined {
    const local = this.declarations.local(expression);
    if (local) {
      const declaration = this.ctx.entityNodes.get(local)!;
      if (ts.isVariableDeclaration(declaration) && declaration.initializer && ts.isIdentifier(declaration.initializer)) return this.library(declaration.initializer);
      return undefined;
    }
    const symbol = this.declarations.symbol(ts.isPropertyAccessExpression(expression) ? expression.name : expression);
    const declaration = symbol?.valueDeclaration ?? symbol?.declarations?.[0];
    if (!declaration) return undefined;
    const file = declaration.getSourceFile().fileName.replaceAll('\\', '/');
    let moduleName = file.includes('/node_modules/') ? file.split('/node_modules/').pop()! : '';
    for (let node: ts.Node | undefined = declaration; node; node = node.parent) if (ts.isModuleDeclaration(node) && ts.isStringLiteral(node.name)) { moduleName = node.name.text; break; }
    if (/^react(?:\/|$)/.test(moduleName)) return 'react';
    if (/^zustand(?:\/|$)/.test(moduleName)) return 'zustand';
    if (/^(?:@tldraw|tldraw)(?:\/|$)/.test(moduleName)) return 'tldraw';
    return undefined;
  }
  kindForInitializer(initializer: ts.Expression): AnalysisEntity['metadata']['resourceKind'] | undefined {
    if (ts.isObjectLiteralExpression(initializer) || ts.isArrayLiteralExpression(initializer)) return 'object';
    if (ts.isNewExpression(initializer)) return ['Map', 'Set', 'WeakMap', 'WeakSet'].includes(initializer.expression.getText()) ? 'collection' : initializer.expression.getText().includes('Controller') ? 'controller' : 'object';
    if (!ts.isCallExpression(initializer)) return undefined;
    const name = this.calleeName(initializer);
    const library = this.library(initializer.expression);
    if (name === 'createStore' && library === 'zustand' && this.ctx.request.frameworks.includes('zustand')) return 'zustand-store';
    if (['atom', 'computed'].includes(name) && library === 'tldraw' && this.ctx.request.frameworks.includes('tldraw')) return name === 'atom' ? 'tldraw-atom' : 'tldraw-computed';
    if (['useState', 'useReducer', 'useRef'].includes(name) && library === 'react' && this.ctx.request.frameworks.includes('react')) return name === 'useRef' ? 'react-ref' : 'react-state';
    return undefined;
  }
  initialize() {
    const initializers: (ts.VariableDeclaration | ts.PropertyDeclaration | ts.PropertyAssignment)[] = [];
    const visit = (node: ts.Node) => {
      if ((ts.isVariableDeclaration(node) || ts.isPropertyDeclaration(node) || ts.isPropertyAssignment(node)) && node.initializer) initializers.push(node);
      ts.forEachChild(node, visit);
    };
    this.ctx.selected.forEach(visit);
    for (const declaration of initializers) {
      const initializer = declaration.initializer!;
      if (ts.isVariableDeclaration(declaration) && ts.isArrayBindingPattern(declaration.name) && ts.isCallExpression(initializer)
        && ['useState', 'useReducer'].includes(this.calleeName(initializer)) && this.library(initializer.expression) === 'react' && this.ctx.request.frameworks.includes('react')) {
        const [state, setter] = declaration.name.elements;
        if (state && ts.isBindingElement(state)) {
          const id = this.declarations.ensure(state); this.mark(id, 'react-state');
          if (setter && ts.isBindingElement(setter)) this.ctx.setters.set(this.declarations.ensure(setter), id);
        }
        continue;
      }
      if (!ts.isIdentifier(declaration.name) && !ts.isStringLiteralLike(declaration.name)) continue;
      const id = this.declarations.ensure(declaration), kind = this.kindForInitializer(initializer);
      if (kind) this.mark(id, kind);
      if (ts.isIdentifier(initializer) || ts.isPropertyAccessExpression(initializer)) {
        const target = this.declarations.resolve(initializer);
        if (target && target !== id) { this.ctx.aliases.set(id, target); this.ctx.edge('ownership', 'aliases', id, target, declaration, {}, 'local-alias'); }
      }
      if (ts.isNewExpression(initializer) || ts.isObjectLiteralExpression(initializer) || ts.isArrayLiteralExpression(initializer)
        || kind && ts.isCallExpression(initializer)) {
        const owner = this.declarations.ensure(this.ctx.owner(declaration));
        const allocation = this.ctx.addEntity('allocation', `${this.declarations.name(declaration)} allocation`, initializer, id, 'allocation', 'source', true);
        this.ctx.nodeEntities.set(initializer, allocation);
        this.ctx.edge('ownership', 'creates', owner, allocation, initializer);
        this.ctx.edge('ownership', 'retains', id, allocation, declaration);
      }
      // A literal facade that exposes getState/subscribe but no setState restricts its API only.
      if (ts.isObjectLiteralExpression(initializer)) {
        const properties = initializer.properties.filter(ts.isPropertyAssignment);
        const names = properties.map(property => property.name.getText());
        if (names.includes('getState') && names.includes('subscribe') && !names.includes('setState')) {
          const get = properties.find(property => property.name.getText() === 'getState')!;
          if (ts.isPropertyAccessExpression(get.initializer)) {
            const target = this.declarations.resolve(get.initializer.expression);
            if (target) { this.ctx.aliases.set(id, target); this.ctx.edge('ownership', 'exposes-read-api', id, target, initializer, { depth: 'shallow', capability: 'read' }, 'framework-summary', 'inferred'); }
          }
        }
      }
    }
    // A wrapper function may return the same shallow facade (e.g. readable(store)).
    for (const source of this.ctx.selected) {
      const visit = (node: ts.Node) => {
        if (ts.isReturnStatement(node) && node.expression && ts.isObjectLiteralExpression(node.expression)) {
          const names = node.expression.properties.filter(ts.isPropertyAssignment).map(property => property.name.getText());
          if (names.includes('getState') && names.includes('subscribe') && !names.includes('setState')) {
            const property = node.expression.properties.filter(ts.isPropertyAssignment).find(property => property.name.getText() === 'getState')!;
            if (ts.isPropertyAccessExpression(property.initializer)) {
              const target = this.declarations.resolve(property.initializer.expression);
              if (target) this.ctx.edge('ownership', 'exposes-read-api', this.declarations.ensure(this.ctx.owner(node)), target, node, { depth: 'shallow', capability: 'read' }, 'framework-summary', 'inferred');
            }
          }
        }
        if (ts.isNewExpression(node) && !this.ctx.nodeEntities.has(node)) {
          const owner = this.declarations.ensure(this.ctx.owner(node)), allocation = this.ctx.addEntity('allocation', `${node.expression.getText()} allocation`, node, owner, 'new-site', 'source', true);
          this.ctx.nodeEntities.set(node, allocation);
          this.ctx.edge('ownership', 'creates', owner, allocation, node);
        }
        ts.forEachChild(node, visit);
      };
      visit(source);
    }
  }
  mark(id: string, kind: NonNullable<AnalysisEntity['metadata']['resourceKind']>) { this.ctx.resourceKinds.set(id, kind); this.ctx.entities.get(id)!.metadata.resourceKind = kind; }
  resource(node: ts.Expression): string | undefined {
    const resolved = this.declarations.resolve(node);
    return resolved ? this.ctx.canonical(resolved) : undefined;
  }
  mechanism(node: ts.Expression): 'zustand' | 'tldraw' | 'controller' | 'react' | 'language' {
    const id = this.resource(node), kind = id && this.ctx.resourceKinds.get(id);
    if (kind === 'zustand-store') return 'zustand';
    if (kind === 'tldraw-atom' || kind === 'tldraw-computed') return 'tldraw';
    if (kind === 'react-state' || kind === 'react-ref') return 'react';
    const type = this.ctx.checker.getTypeAtLocation(node), name = type.getSymbol()?.name ?? '';
    if (name.includes('MappingDocumentController') && this.ctx.request.frameworks.includes('controller')) return 'controller';
    if ((name === 'StoreApi' || name === 'Store') && this.ctx.request.frameworks.includes('zustand')) return 'zustand';
    if (['Atom', 'Computed', 'Signal'].includes(name) && this.ctx.request.frameworks.includes('tldraw')) return 'tldraw';
    return 'language';
  }
  callback(node: ts.Expression) {
    if (callable(node)) return this.declarations.ensure(node);
    return this.declarations.resolve(node, true);
  }
}
