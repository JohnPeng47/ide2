import { z } from 'zod';
import { diagramContentNodes } from './diagramContentNodes';
import { diagramSubtreeRange, subtreeReplacement } from './diagramSubtreeEdit';
import type { DiagramRevision, DiagramService } from './diagramService';

const id = z.string().min(1).max(500).refine(value => !['__proto__', 'constructor', 'prototype'].includes(value));
export const diagramVariantSchema = z.object({
  id, name: z.string().trim().min(1).max(120), diagramId: id, contentId: id,
  /** 'root' is the synthetic owner of the complete diagram. */
  ownerNodeId: id, baseRevisionId: id, headRevisionId: id,
  revisionIds: z.array(id).min(1).max(1000),
  prompt: z.string().max(20000),
  decisions: z.record(id, z.enum(['accept', 'reject'])),
  /** Last installation, used as the three-way base when changing review decisions. */
  appliedRevisionId: id.optional(),
  appliedReview: z.object({ headRevisionId: id, decisions: z.record(id, z.enum(['accept', 'reject'])) }).strict().optional()
}).strict();
export type DiagramVariant = z.infer<typeof diagramVariantSchema>;
export type VariantDecision = 'accept' | 'reject';
interface NodeState { label: string; parentId?: string; childIds: string[] }
type Tree = Record<string, NodeState>;
export interface VariantChange { id: string; label: string; kind: 'added' | 'removed' | 'updated'; before?: NodeState; after?: NodeState }
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
const rootId = '$root';

export function variantRevisionIds(variant: DiagramVariant) {
  return [...new Set([variant.baseRevisionId, variant.headRevisionId, ...variant.revisionIds, ...(variant.appliedRevisionId ? [variant.appliedRevisionId] : []), ...(variant.appliedReview ? [variant.appliedReview.headRevisionId] : [])])];
}
export function validateVariant(variant: DiagramVariant, get: (id: string) => DiagramRevision) {
  diagramVariantSchema.parse(variant);
  if (!variant.revisionIds.includes(variant.headRevisionId)) throw Error('Variant head is not retained');
  const base = get(variant.baseRevisionId);
  for (const id of variantRevisionIds(variant)) {
    const revision = get(id);
    if (!revision || revision.diagramId !== variant.diagramId || revision.diagram.id !== variant.contentId) throw Error('Invalid variant revision');
    scopedTree(revision, variant.ownerNodeId);
    if (variant.ownerNodeId !== 'root' && variant.revisionIds.includes(id))
      subtreeReplacement(base.diagram, revision.diagram.content.ascii, variantRange(base, variant.ownerNodeId));
  }
  const changes = variantChanges(get(variant.baseRevisionId), get(variant.headRevisionId), variant.ownerNodeId);
  if (Object.keys(variant.decisions).some(id => !changes.some(change => change.id === id))) throw Error('Unknown variant review change');
  if (variant.appliedReview) approvedTree({ ...variant, ...variant.appliedReview }, base, get(variant.appliedReview.headRevisionId));
}
export function variantRange(revision: DiagramRevision, owner: string) {
  if (owner === 'root') return { startLine: 1, endLine: revision.diagram.content.ascii.split('\n').length };
  const parsed = Object.entries(revision.nodeRefs).find(([, ref]) => ref === owner)?.[0];
  if (!parsed) throw Error('VARIANT_SCOPE: subtree owner no longer exists');
  return diagramSubtreeRange(revision.diagram, parsed);
}
function scopedTree(revision: DiagramRevision, owner: string): Tree {
  const { content } = revision.diagram;
  if (content.structure.kind !== 'tree' || !Object.keys(content.structure.nodes).length) {
    if (owner !== 'root') throw Error('Subtree variants require a tree diagram');
    return { [rootId]: { label: content.ascii, childIds: [] } };
  }
  const nodes = diagramContentNodes(content), byId = new Map(nodes.map(node => [node.id, node]));
  const start = owner === 'root' ? content.structure.rootIds : [Object.keys(revision.nodeRefs).find(id => revision.nodeRefs[id] === owner)!];
  if (start.some(id => !byId.has(id))) throw Error('VARIANT_SCOPE: subtree owner no longer exists');
  const out: Tree = { [rootId]: { label: '', childIds: start.map(id => revision.nodeRefs[id]) } };
  const visit = (id: string, parentId: string, depth: number) => {
    if (depth > 100) throw Error('Variant tree is too deep');
    const node = byId.get(id)!, ref = revision.nodeRefs[id];
    out[ref] = { label: node.label, parentId, childIds: node.childIds.map(id => revision.nodeRefs[id]) };
    node.childIds.forEach(id => visit(id, ref, depth + 1));
  };
  start.forEach(id => visit(id, rootId, 0));
  return out;
}
export function variantChanges(base: DiagramRevision, candidate: DiagramRevision, owner: string): VariantChange[] {
  if (base.diagramId !== candidate.diagramId || base.diagram.content.structure.kind !== candidate.diagram.content.structure.kind) throw Error('Variant must preserve diagram identity and structure kind');
  const before = scopedTree(base, owner), after = scopedTree(candidate, owner);
  return [...new Set([...Object.keys(before), ...Object.keys(after)])].filter(id => !same(before[id], after[id])).map(id => ({
    id, label: id === rootId ? 'Subtree structure / content' : after[id]?.label ?? before[id].label,
    kind: !before[id] ? 'added' : !after[id] ? 'removed' : 'updated', before: before[id], after: after[id]
  }));
}
function checkTree(tree: Tree) {
  const visited = new Set<string>();
  const visit = (id: string, parentId?: string, depth = 0) => {
    const node = tree[id];
    if (!node || visited.has(id) || node.parentId !== parentId || depth > 100) throw Error('REVIEW_DEPENDENCY: accept or reject the related parent, child and move changes together');
    visited.add(id); node.childIds.forEach(child => visit(child, id, depth + 1));
  };
  visit(rootId);
  if (visited.size !== Object.keys(tree).length) throw Error('REVIEW_DEPENDENCY: a retained node would be disconnected; review its parent change');
}
function approvedTree(variant: DiagramVariant, base: DiagramRevision, candidate: DiagramRevision) {
  const result = structuredClone(scopedTree(base, variant.ownerNodeId));
  for (const change of variantChanges(base, candidate, variant.ownerNodeId)) if (variant.decisions[change.id] === 'accept') {
    if (change.after) result[change.id] = structuredClone(change.after); else delete result[change.id];
  }
  checkTree(result); return result;
}
export function reviewVariant(variant: DiagramVariant, get: (id: string) => DiagramRevision) {
  const base = get(variant.baseRevisionId), candidate = get(variant.headRevisionId);
  const changes = variantChanges(base, candidate, variant.ownerNodeId);
  let error: string | undefined;
  try { approvedTree(variant, base, candidate); } catch (e) { error = String(e instanceof Error ? e.message : e); }
  const scopeLabel = variant.ownerNodeId === 'root' ? 'Whole diagram'
    : diagramContentNodes(base.diagram.content).find(node => base.nodeRefs[node.id] === variant.ownerNodeId)?.label ?? 'Subtree';
  return { changes, error, scopeLabel, ascii: candidate.diagram.content.ascii };
}

/** Three-way application touches only changed logical nodes in the chosen subtree. */
export function applyVariant(variant: DiagramVariant, current: DiagramRevision, diagrams: DiagramService) {
  validateVariant(variant, id => diagrams.getRevision(id));
  if (current.diagramId !== variant.diagramId || current.diagram.id !== variant.contentId) throw Error('Variant belongs to another diagram');
  const base = diagrams.getRevision(variant.baseRevisionId), candidate = diagrams.getRevision(variant.headRevisionId);
  const desired = approvedTree(variant, base, candidate);
  const before = variant.appliedReview ? approvedTree({ ...variant, ...variant.appliedReview }, base, diagrams.getRevision(variant.appliedReview.headRevisionId)) : scopedTree(base, variant.ownerNodeId);
  const live = scopedTree(current, variant.ownerNodeId), merged = structuredClone(live);
  for (const id of new Set([...Object.keys(before), ...Object.keys(desired)])) {
    if (same(before[id], desired[id])) continue;
    // Fields merge separately, so a label review does not overwrite newly added children.
    const from = before[id], to = desired[id], now = live[id];
    if (from && to && now) {
      for (const field of ['label', 'parentId', 'childIds'] as const) if (!same(from[field], to[field])) {
        if (!same(now[field], from[field]) && !same(now[field], to[field])) throw Error(`VARIANT_CONFLICT: ${now.label} changed since this review`);
        (merged[id] as any)[field] = structuredClone(to[field]);
      }
    } else {
      if (!same(now, from) && !same(now, to)) throw Error(`VARIANT_CONFLICT: ${to?.label ?? from?.label ?? id} changed since this review`);
      if (to) merged[id] = structuredClone(to); else delete merged[id];
    }
  }
  checkTree(merged);
  if (same(merged, live)) return { diagram: current.diagram, revision: current, nodeIds: new Map(Object.keys(current.nodeRefs).map(id => [id, id])) };
  const range = variantRange(current, variant.ownerNodeId), oldLines = current.diagram.content.ascii.split('\n');
  const lines: string[] = [], refs: Record<string, number> = {};
  const sameTopology = Object.keys(merged).length === Object.keys(live).length && Object.entries(merged).every(([id, node]) =>
    live[id] && node.parentId === live[id].parentId && same(node.childIds, live[id].childIds));
  if (current.diagram.content.structure.kind === 'diagram' || merged[rootId].label) lines.push(...merged[rootId].label.split('\n'));
  else if (sameTopology) {
    lines.push(...oldLines.slice(range.startLine - 1, range.endLine));
    for (const node of diagramContentNodes(current.diagram.content)) {
      const ref = current.nodeRefs[node.id];
      if (!merged[ref]) continue;
      const index = node.line - range.startLine;
      lines[index] = lines[index].slice(0, node.startColumn - 1) + merged[ref].label + lines[index].slice(node.endColumn);
      refs[ref] = node.line;
    }
  } else {
    const nodeLines = new Set(diagramContentNodes(current.diagram.content).map(node => node.line));
    if (oldLines.slice(range.startLine - 1, range.endLine).some((line, index) =>
      !nodeLines.has(range.startLine + index) && /[^ |+`\-]/.test(line)))
      throw Error('VARIANT_LAYOUT: structural review cannot safely reposition non-node text; make that text a tree node first');
    const root = diagramContentNodes(current.diagram.content).find(n => current.nodeRefs[n.id] === variant.ownerNodeId);
    const rootPrefix = root ? oldLines[root.line - 1].slice(0, root.startColumn - 1) : '';
    const render = (id: string, prefix: string, childPrefix: string) => {
      refs[id] = range.startLine + lines.length;
      lines.push(prefix + merged[id].label);
      merged[id].childIds.forEach((child, i, all) => render(child, childPrefix + (i === all.length - 1 ? '`-- ' : '|-- '), childPrefix + (i === all.length - 1 ? '    ' : '|   ')));
    };
    const branchWidth = root ? root.startColumn - 1 - root.branchColumn : 0;
    const childPrefix = root && root.branchColumn >= 0 ? rootPrefix.slice(0, root.branchColumn)
      + (rootPrefix[root.branchColumn] === '`' ? ' '.repeat(branchWidth) : '|' + ' '.repeat(Math.max(0, branchWidth - 1))) : rootPrefix;
    merged[rootId].childIds.forEach(id => render(id, rootPrefix, childPrefix));
  }
  const ascii = [...oldLines.slice(0, range.startLine - 1), ...lines, ...oldLines.slice(range.endLine)].join('\n');
  const delta = lines.length - (range.endLine - range.startLine + 1);
  for (const node of diagramContentNodes(current.diagram.content)) if (node.line < range.startLine || node.line > range.endLine)
    refs[current.nodeRefs[node.id]] = node.line + (node.line > range.endLine ? delta : 0);
  // Source mappings are retained only where their label-relative span still denotes the same text.
  const outputLines = ascii.split('\n'), mappings: any[] = [], ids = new Set<string>();
  for (const revision of [current, candidate, base]) {
    const nodes = diagramContentNodes(revision.diagram.content), sourceLines = revision.diagram.content.ascii.split('\n');
    for (const mapping of revision.diagram.sourceContext.mappings) {
      if (ids.has(mapping.id)) continue;
      const node = nodes.find(n => n.line === mapping.line && mapping.startColumn >= n.startColumn && mapping.endColumn <= n.endColumn);
      const ref = node && revision.nodeRefs[node.id], line = ref && refs[ref];
      if (!node || !line) continue;
      const text = sourceLines[mapping.line - 1].slice(mapping.startColumn - 1, mapping.endColumn);
      const label = merged[ref!]?.label ?? node.label, labelStart = outputLines[line - 1].lastIndexOf(label);
      const startColumn = labelStart + 1 + mapping.startColumn - node.startColumn, endColumn = startColumn + text.length - 1;
      if (labelStart < 0 || outputLines[line - 1].slice(startColumn - 1, endColumn) !== text) continue;
      ids.add(mapping.id); mappings.push({ ...mapping, line, startColumn, endColumn });
    }
  }
  const result = diagrams.derive(current.id, { ascii, structureKind: current.diagram.content.structure.kind,
    source: current.diagram.sourceContext.binding, evidence: { ...base.diagram.sourceContext.evidence, ...candidate.diagram.sourceContext.evidence, ...current.diagram.sourceContext.evidence }, mappings },
    refs, [current.id, base.id, candidate.id]);
  const rendered = scopedTree(result.revision, variant.ownerNodeId);
  if (Object.keys(rendered).length !== Object.keys(merged).length || Object.entries(merged).some(([id, node]) => !same(node, rendered[id])))
    throw Error('VARIANT_LAYOUT: the reviewed structure cannot be represented safely in this diagram');
  return result;
}
