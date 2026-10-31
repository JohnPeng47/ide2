import ts from 'typescript';
import { AnalysisContext, callable } from './context';
import { Declarations } from './declarations';

export interface Reference {
  node: ts.Node; target: string; owner: ts.FunctionLikeDeclaration | ts.SourceFile;
  access: ('read' | 'reassign' | 'object-mutate')[]; propertyPath: string[];
}
export function isValueReference(node: ts.Identifier): boolean {
  const parent = node.parent;
  if (ts.isPropertyAccessExpression(parent) && parent.name === node) return false;
  if ((ts.isVariableDeclaration(parent) || ts.isParameter(parent) || ts.isBindingElement(parent) || ts.isPropertyDeclaration(parent)
    || ts.isPropertyAssignment(parent) || ts.isMethodDeclaration(parent) || ts.isFunctionDeclaration(parent) || ts.isClassDeclaration(parent)
    || ts.isInterfaceDeclaration(parent) || ts.isTypeAliasDeclaration(parent) || ts.isPropertySignature(parent) || ts.isMethodSignature(parent)
    || ts.isFunctionExpression(parent) || ts.isGetAccessorDeclaration(parent) || ts.isSetAccessorDeclaration(parent)) && parent.name === node) return false;
  if (ts.isBindingElement(parent) && parent.propertyName === node) return false;
  if (ts.isImportSpecifier(parent) || ts.isImportClause(parent) || ts.isNamespaceImport(parent) || ts.isExportSpecifier(parent)
    || ts.isJsxAttribute(parent) && parent.name === node || ts.isLabeledStatement(parent) || ts.isBreakStatement(parent) || ts.isContinueStatement(parent)) return false;
  for (let ancestor: ts.Node | undefined = parent; ancestor && !ts.isStatement(ancestor) && !callable(ancestor); ancestor = ancestor.parent) {
    if (ts.isTypeNode(ancestor) || ts.isImportDeclaration(ancestor) || ts.isExportDeclaration(ancestor)) return false;
  }
  return true;
}
export function accessOf(node: ts.Node): Pick<Reference, 'access' | 'propertyPath'> {
  let expression = node; const propertyPath: string[] = [];
  while (expression.parent && ((ts.isPropertyAccessExpression(expression.parent) || ts.isElementAccessExpression(expression.parent)) && expression.parent.expression === expression)) {
    const parent = expression.parent;
    propertyPath.push(ts.isPropertyAccessExpression(parent) ? parent.name.text : ts.isStringLiteralLike(parent.argumentExpression) || ts.isNumericLiteral(parent.argumentExpression) ? parent.argumentExpression.text : '*');
    expression = parent;
  }
  const parent = expression.parent;
  const compound = parent && (ts.isPostfixUnaryExpression(parent) || ts.isPrefixUnaryExpression(parent))
    && [ts.SyntaxKind.PlusPlusToken, ts.SyntaxKind.MinusMinusToken].includes(parent.operator);
  const assignment = parent && ts.isBinaryExpression(parent) && parent.left === expression
    && parent.operatorToken.kind >= ts.SyntaxKind.FirstAssignment && parent.operatorToken.kind <= ts.SyntaxKind.LastAssignment;
  const deleting = parent && ts.isDeleteExpression(parent);
  if (assignment || compound || deleting) {
    if (propertyPath.length) return { access: ['read', 'object-mutate'], propertyPath };
    return { access: assignment && parent.operatorToken.kind === ts.SyntaxKind.EqualsToken ? ['reassign'] : ['read', 'reassign'], propertyPath };
  }
  return { access: ['read'], propertyPath };
}
function contains(owner: ts.Node, declaration: ts.Node) {
  for (let node: ts.Node | undefined = declaration; node; node = node.parent) if (node === owner) return true;
  return false;
}

export function extractLexical(ctx: AnalysisContext, declarations: Declarations): Reference[] {
  const references: Reference[] = [];
  const captures = new Map<string, { from: string; to: string; node: ts.Node; nodes: ts.Node[]; accesses: Set<Reference['access'][number]>; receiver: boolean; direct: boolean }>();
  const visit = (node: ts.Node) => {
    if (ts.isTypeNode(node) && !ts.isExpressionWithTypeArguments(node)) return;
    if (ts.isIdentifier(node) && isValueReference(node) || node.kind === ts.SyntaxKind.ThisKeyword) {
      const target = declarations.resolve(node);
      if (target) {
        const owner = ctx.owner(node), access = accessOf(node), reference = { node, target, owner, ...access };
        references.push(reference);
        ctx.edge('lexical', 'references', declarations.ensure(owner), target, node, { access: access.access }, 'symbol-resolution');
        const declaration = declarations.declarationOwners.get(target) ?? ctx.entityNodes.get(target)!;
        for (let enclosing: ts.Node | undefined = owner; enclosing && !ts.isSourceFile(enclosing); enclosing = enclosing.parent) if (callable(enclosing)) {
          if (contains(enclosing, declaration)) break;
          const from = declarations.ensure(enclosing), key = `${from}:${target}`;
          const existing = captures.get(key) ?? { from, to: target, node, nodes: [], accesses: new Set(), receiver: node.kind === ts.SyntaxKind.ThisKeyword, direct: false };
          existing.nodes.push(node); access.access.forEach(value => existing.accesses.add(value)); existing.direct ||= enclosing === owner; captures.set(key, existing);
        }
      }
    }
    ts.forEachChild(node, visit);
  };
  ctx.selected.forEach(visit);
  for (const capture of captures.values()) {
    const declaringScopeId = ctx.bindingScopes.get(capture.to);
    const target = ctx.entities.get(capture.to)!;
    const id = ctx.edge('lexical', capture.receiver ? 'captures-this' : 'captures', capture.from, capture.to, capture.node,
      { access: [...capture.accesses].sort(), ...(declaringScopeId ? { declaringScopeId } : {}),
        captureChannel: capture.receiver ? 'this' : target.provenance.locations[0].path !== ctx.relative(capture.node.getSourceFile().fileName) ? 'import' : 'lexical',
        reach: capture.direct ? 'direct' : 'transitive' }, 'symbol-resolution');
    if (id) ctx.relationMap.get(id)!.provenance.locations = capture.nodes.map(node => ctx.range(node));
  }
  return references;
}
