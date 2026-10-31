import ts from 'typescript';
import { AnalysisContext, callable } from './context';
import type { AnalysisEntity } from '../../../domain/core/static-analysis/schema';

export class Declarations {
  readonly resolvedValues = new WeakMap<ts.Node, string | undefined>();
  readonly resolvedCallables = new WeakMap<ts.Node, string | undefined>();
  readonly receivers = new Map<ts.Node, string>();
  readonly declarationOwners = new Map<string, ts.Node>();
  readonly scopeBindings = new Map<string, Map<string, string>>();
  constructor(readonly ctx: AnalysisContext) {}

  name(node: ts.Node): string {
    const named = node as ts.NamedDeclaration;
    if (named.name && (ts.isIdentifier(named.name) || ts.isStringLiteral(named.name) || ts.isNumericLiteral(named.name))) return named.name.text;
    if (ts.isConstructorDeclaration(node)) return 'constructor';
    if (ts.isArrowFunction(node) || ts.isFunctionExpression(node)) {
      const parent = node.parent;
      if ((ts.isVariableDeclaration(parent) || ts.isPropertyDeclaration(parent) || ts.isPropertyAssignment(parent)) && ts.isIdentifier(parent.name)) return parent.name.text;
      return `<callback:${this.ctx.fingerprint(node).slice(0, 12)}>`;
    }
    return ts.SyntaxKind[node.kind];
  }
  structuralParent(node: ts.Node): string {
    let parent = node.parent;
    while (parent) {
      if (ts.isSourceFile(parent)) return this.ctx.module(parent);
      const known = this.ctx.nodeEntities.get(parent); if (known) return known;
      if (callable(parent) || ts.isClassDeclaration(parent) || ts.isInterfaceDeclaration(parent)) return this.ensure(parent);
      parent = parent.parent;
    }
    return this.ctx.rootId;
  }
  ensure(node: ts.Node, at: ts.Node = node): string {
    if (ts.isIdentifier(node) && node.parent && (ts.isBindingElement(node.parent) || ts.isParameter(node.parent)
      || ts.isVariableDeclaration(node.parent) || ts.isPropertyDeclaration(node.parent))) node = node.parent;
    const existing = this.ctx.nodeEntities.get(node); if (existing) return existing;
    if (!this.ctx.inside(node) || node.getSourceFile().isDeclarationFile && !this.ctx.selectedPaths.has(this.ctx.relative(node.getSourceFile().fileName))) {
      const name = this.name(node), module = this.ctx.module(at.getSourceFile());
      const id = this.ctx.addEntity('external', name, at, module, `external:${node.getSourceFile().fileName.split('/node_modules/').pop()}:${name}`, 'external');
      this.ctx.nodeEntities.set(node, id); return id;
    }
    if (ts.isSourceFile(node)) return this.ctx.module(node);
    const parent = this.structuralParent(node);
    let kind: AnalysisEntity['kind'] = 'binding';
    if (ts.isClassDeclaration(node) || ts.isClassExpression(node)) kind = 'class';
    else if (ts.isInterfaceDeclaration(node)) kind = 'interface';
    else if (ts.isTypeAliasDeclaration(node) || ts.isTypeParameterDeclaration(node)) kind = 'type';
    else if (ts.isConstructorDeclaration(node)) kind = 'constructor';
    else if (ts.isMethodDeclaration(node) || ts.isMethodSignature(node)) kind = 'method';
    else if (ts.isGetAccessorDeclaration(node) || ts.isSetAccessorDeclaration(node)) kind = 'accessor';
    else if (callable(node) || ts.isFunctionTypeNode(node)) kind = 'function';
    else if (ts.isParameter(node) || ts.isBindingElement(node) && this.isParameterBinding(node)) kind = 'parameter';
    else if (ts.isPropertyDeclaration(node) || ts.isPropertySignature(node) || ts.isPropertyAssignment(node)) kind = 'field';
    const name = this.name(node), anonymous = name.startsWith('<callback:');
    const id = this.ctx.addEntity(kind, name, node, parent, ts.isGetAccessorDeclaration(node) ? 'get' : ts.isSetAccessorDeclaration(node) ? 'set' : kind, 'source', anonymous);
    this.ctx.nodeEntities.set(node, id);
    const entity = this.ctx.entities.get(id)!;
    if (kind === 'interface' || kind === 'type') entity.metadata.namespace = 'type';
    else entity.metadata.namespace = kind === 'class' ? 'both' : 'value';
    if (kind === 'parameter') entity.metadata.bindingKind = 'parameter';
    if (ts.isVariableDeclaration(node) || ts.isBindingElement(node)) {
      let ancestor: ts.Node = node; while (ancestor.parent && !ts.isVariableDeclarationList(ancestor.parent) && !ts.isParameter(ancestor.parent)) ancestor = ancestor.parent;
      if (ancestor.parent && ts.isVariableDeclarationList(ancestor.parent)) entity.metadata.bindingKind = ancestor.parent.flags & ts.NodeFlags.Const ? 'const' : ancestor.parent.flags & ts.NodeFlags.Let ? 'let' : 'var';
    }
    if (ts.isImportSpecifier(node) || ts.isImportClause(node) || ts.isNamespaceImport(node)) entity.metadata.bindingKind = 'import';
    this.declarationOwners.set(id, node);
    return id;
  }
  isParameterBinding(node: ts.Node) { for (let parent = node.parent; parent; parent = parent.parent) { if (ts.isParameter(parent)) return true; if (ts.isVariableDeclaration(parent)) return false; } return false; }
  symbol(node: ts.Node): ts.Symbol | undefined {
    const symbol = this.ctx.checker.getSymbolAtLocation(node);
    if (!symbol) return undefined;
    if (symbol.flags & ts.SymbolFlags.Alias) { try { return this.ctx.checker.getAliasedSymbol(symbol); } catch { return symbol; } }
    return symbol;
  }
  resolve(node: ts.Node, preferCallable = false): string | undefined {
    const cache = preferCallable ? this.resolvedCallables : this.resolvedValues;
    if (cache.has(node)) return cache.get(node);
    const result = this.resolveUncached(node, preferCallable); cache.set(node, result); return result;
  }
  private resolveUncached(node: ts.Node, preferCallable = false): string | undefined {
    if (ts.isParenthesizedExpression(node) || ts.isAsExpression(node) || ts.isNonNullExpression(node) || ts.isTypeAssertionExpression(node)) return this.resolve(node.expression, preferCallable);
    if (node.kind === ts.SyntaxKind.ThisKeyword) return this.receiver(node);
    const local = this.local(node);
    if (local) {
      const declaration = this.ctx.entityNodes.get(local);
      if (preferCallable && declaration && (ts.isVariableDeclaration(declaration) || ts.isPropertyDeclaration(declaration))
        && declaration.initializer && callable(declaration.initializer)) return this.ensure(declaration.initializer);
      return local;
    }
    const symbol = this.symbol(ts.isPropertyAccessExpression(node) ? node.name : node);
    const declaration = symbol?.valueDeclaration ?? symbol?.declarations?.[0];
    if (declaration) {
      if (preferCallable && (ts.isVariableDeclaration(declaration) || ts.isPropertyDeclaration(declaration) || ts.isPropertyAssignment(declaration))
        && declaration.initializer && callable(declaration.initializer)) return this.ensure(declaration.initializer, node);
      return this.ensure(declaration, node);
    }
    return this.ctx.nodeEntities.get(node);
  }
  /** Resolve data-flow inputs while compiler caches are live, then retain only IDs. */
  prepareDataflow() {
    const visit = (node: ts.Node) => {
      if (ts.isTypeNode(node)) return;
      if (ts.isPropertyAccessExpression(node)) this.resolve(node);
      if (ts.isVariableDeclaration(node) && ts.isObjectBindingPattern(node.name) && node.initializer) this.resolve(node.initializer);
      ts.forEachChild(node, visit);
    };
    this.ctx.selected.forEach(visit);
  }
  /** Local binding lookup needs no library types; imports/member dispatch still use TypeChecker. */
  local(node: ts.Node): string | undefined {
    if (!ts.isIdentifier(node)) return undefined;
    for (let owner: ts.Node | undefined = node.parent; owner; owner = owner.parent) {
      const scope = this.ctx.scopes.get(owner), binding = scope && this.scopeBindings.get(scope)?.get(node.text);
      if (binding) return binding;
    }
    return undefined;
  }
  receiver(node: ts.Node): string {
    let owner: ts.Node = node;
    while (owner.parent) { owner = owner.parent; if (callable(owner) && !ts.isArrowFunction(owner)) break; if (ts.isClassDeclaration(owner)) break; }
    let id = this.receivers.get(owner);
    if (!id) {
      const parent = ts.isSourceFile(owner) ? this.ctx.module(owner) : this.ensure(owner);
      id = this.ctx.addEntity('binding', 'this', owner, parent, 'receiver', 'synthetic');
      this.ctx.entities.get(id)!.metadata.bindingKind = 'this'; this.receivers.set(owner, id); this.declarationOwners.set(id, owner);
    }
    return id;
  }
  scope(node: ts.Node, parentScope?: string): string {
    let id = this.ctx.scopes.get(node); if (id) return id;
    const scopeKind = ts.isSourceFile(node) ? 'module' : callable(node) ? 'function' : ts.isClassDeclaration(node) ? 'class' : ts.isCatchClause(node) ? 'catch' : 'block';
    const owner = ts.isSourceFile(node) ? this.ctx.module(node) : this.ctx.nodeEntities.get(node) ?? this.structuralParent(node);
    id = this.ctx.addEntity('scope', `${this.name(node)} scope`, node, owner, `${scopeKind}-scope`, 'synthetic', scopeKind === 'block');
    this.ctx.entities.get(id)!.metadata.scopeKind = scopeKind; this.ctx.scopes.set(node, id);
    if (parentScope) this.ctx.edge('lexical', 'scope-parent', id, parentScope, node);
    return id;
  }
  index() {
    for (const source of this.ctx.selected) {
      const visit = (node: ts.Node, scope: string, functionScope: string) => {
        const hasDeclaration = ts.isClassDeclaration(node) || ts.isClassExpression(node) || ts.isInterfaceDeclaration(node) || ts.isTypeAliasDeclaration(node)
          || callable(node) || ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) || ts.isParameter(node) && ts.isIdentifier(node.name)
          || ts.isBindingElement(node) && ts.isIdentifier(node.name) || ts.isPropertyDeclaration(node) || ts.isPropertySignature(node)
          || ts.isMethodSignature(node) || ts.isPropertyAssignment(node) && ts.isIdentifier(node.name);
        if (hasDeclaration) {
          const id = this.ensure(node), entity = this.ctx.entities.get(id)!;
          const bindingScope = entity.metadata.bindingKind === 'var' ? functionScope : scope;
          this.ctx.bindingScopes.set(id, bindingScope); this.ctx.edge('lexical', 'declares', bindingScope, id, node);
          if (entity.metadata.namespace !== 'type' && (['binding', 'parameter', 'class'].includes(entity.kind) || ts.isFunctionDeclaration(node))) {
            const bindings = this.scopeBindings.get(bindingScope) ?? new Map<string, string>();
            bindings.set(entity.name, id); this.scopeBindings.set(bindingScope, bindings);
          }
        }
        let nextScope = scope, nextFunction = functionScope;
        if (callable(node)) { nextScope = this.scope(node, scope); nextFunction = nextScope; this.ctx.callableNodes.push(node); }
        else if (ts.isClassDeclaration(node) || ts.isCatchClause(node) || ts.isBlock(node) && !callable(node.parent)) nextScope = this.scope(node, scope);
        ts.forEachChild(node, child => visit(child, nextScope, nextFunction));
      };
      this.ctx.module(source); const scope = this.scope(source); ts.forEachChild(source, node => visit(node, scope, scope));
      for (const diagnostic of this.ctx.program.getSyntacticDiagnostics(source)) this.ctx.issue('containment', 'parse-error', source, [], ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n'), 'diagnostic');
    }
  }
  imports() {
    for (const source of this.ctx.selected) for (const statement of source.statements) {
      if (!(ts.isImportDeclaration(statement) || ts.isExportDeclaration(statement)) || !statement.moduleSpecifier || !ts.isStringLiteral(statement.moduleSpecifier)) continue;
      const symbol = this.symbol(statement.moduleSpecifier), target = symbol?.declarations?.find(ts.isSourceFile);
      const to = target && this.ctx.inside(target) ? this.ctx.module(target)
        : this.ctx.addEntity('external', statement.moduleSpecifier.text, statement.moduleSpecifier, this.ctx.module(source), 'external-module', 'external');
      const typeOnly = ts.isImportDeclaration(statement) ? !!statement.importClause?.isTypeOnly : statement.isTypeOnly;
      this.ctx.edge('containment', ts.isImportDeclaration(statement) ? 'imports' : 'reexports', this.ctx.module(source), to, statement,
        { typeOnly, specifier: statement.moduleSpecifier.text }, 'symbol-resolution');
    }
  }
  composition() {
    const visit = (node: ts.Node) => {
      if (ts.isJsxSelfClosingElement(node) || ts.isJsxOpeningElement(node)) {
        const tag = node.tagName;
        if (!ts.isIdentifier(tag) || /^[A-Z]/.test(tag.text)) {
          const to = this.resolve(tag, true);
          if (to) this.ctx.edge('containment', 'jsx-child', this.ensure(this.ctx.owner(node)), to, node, {}, 'symbol-resolution');
        }
      }
      ts.forEachChild(node, visit);
    };
    this.ctx.selected.forEach(visit);
  }
}
