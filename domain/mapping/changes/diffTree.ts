import { importDiagramRevision, reviseStoredDiagram, createStoredDiagram } from '../../core/diagrams/diagramRevisionStore';
import { z } from 'zod';
import { diagramJumpSchema, type DiagramJumpTarget } from '../../core/diagrams/diagramJump';
import { validateDiagram } from '../../core/diagrams/diagram';
import { diagramContentNodes } from '../../core/diagrams/diagramContentNodes';
import type { DiagramRevision } from '../../core/diagrams/diagramRevision';
import { resolveNodeResources } from '../../core/diagrams/diagramResourceMappings';
import { gitDiffHunkSchema, type GitDiffHunk } from '../../core/diffs/gitDiffHunk';

const id = z.string().min(1).max(500);
const target = z.object({ kind: z.literal('diff-hunk'), hunkId: id }).strict();
const mappingInput = z.object({ id, source: z.union([
  z.object({ line: z.number().int().positive() }).strict(), z.object({ nodeId: id }).strict()
]), targets: z.array(target).max(2000), diagramTargets: z.array(diagramJumpSchema.shape.target).max(100).optional() }).strict()
  .refine(mapping => mapping.targets.length > 0 || !!mapping.diagramTargets?.length, 'A mapping needs hunks or diagram destinations');
export const diffTreeInputSchema = z.object({
  ascii: z.string().min(1).max(20000).optional(), structureKind: z.literal('tree').optional(),
  expectedRevisionId: id.optional(), mappings: z.array(mappingInput).max(2000)
}).strict();
export type DiffTreeInput = z.infer<typeof diffTreeInputSchema>;
export interface DiffTreeMapping { id: string; nodeId: string; targets: { kind: 'diff-hunk'; hunkId: string }[]; diagramTargets?: DiagramJumpTarget[] }
export interface ChangeSessionDiffTree { revision: DiagramRevision; mappings: DiffTreeMapping[]; hunks: GitDiffHunk[] }
export const diffTreeSummarySchema = z.object({ diagramId: id, revisionId: id,
  nodeCount: z.number().int().nonnegative(), mappingCount: z.number().int().nonnegative(), hunkCount: z.number().int().nonnegative() }).strict();
export type DiffTreeSummary = z.infer<typeof diffTreeSummarySchema>;
export function diffTreeSummary(tree: ChangeSessionDiffTree): DiffTreeSummary {
  return { diagramId: tree.revision.diagramId, revisionId: tree.revision.id, nodeCount: diagramContentNodes(tree.revision.diagram.content).length,
    mappingCount: tree.mappings.length, hunkCount: tree.hunks.length };
}
export function diffTreeNodes(tree: ChangeSessionDiffTree) {
  const refs = tree.revision.nodeRefs;
  return diagramContentNodes(tree.revision.diagram.content).map(node => ({ ...node, id: refs[node.id],
    parentId: node.parentId ? refs[node.parentId] : undefined, childIds: node.childIds.map(id => refs[id]) }));
}
export function validateDiffTree(tree: ChangeSessionDiffTree): void {
  if (!tree?.revision?.diagram || !Array.isArray(tree.mappings) || !Array.isArray(tree.hunks)) throw Error('Invalid DiffTree');
  const { revision } = tree;
  validateDiagram(revision.diagram);
  if (revision.diagram.content.structure.kind !== 'tree' || revision.id !== revision.diagram.revisionId || revision.diagramId !== revision.diagram.diagramId)
    throw Error('Invalid DiffTree diagram revision');
  const rawNodes = diagramContentNodes(revision.diagram.content), refs = rawNodes.map(node => revision.nodeRefs?.[node.id]);
  if (refs.some(ref => typeof ref !== 'string' || !ref) || new Set(refs).size !== refs.length || Object.keys(revision.nodeRefs).length !== refs.length) throw Error('Invalid DiffTree node identities');
  z.array(gitDiffHunkSchema).max(2000).parse(tree.hunks);
  const hunkIds = new Set(tree.hunks.map(hunk => hunk.id));
  if (hunkIds.size !== tree.hunks.length) throw Error('Duplicate hunk ID');
  const mappings = z.array(z.object({ id, nodeId: id, targets: z.array(target).max(2000), diagramTargets: z.array(diagramJumpSchema.shape.target).max(100).optional() }).strict()
    .refine(mapping => mapping.targets.length > 0 || !!mapping.diagramTargets?.length, 'Empty mapping')).max(2000).parse(tree.mappings);
  if (new Set(mappings.map(mapping => mapping.id)).size !== mappings.length) throw Error('Duplicate DiffTree mapping ID');
  const nodes = new Set(refs);
  for (const mapping of mappings) {
    if (!nodes.has(mapping.nodeId)) throw Error('STALE_CONTENT_NODE: unknown DiffTree node');
    if (mapping.targets.some(target => !hunkIds.has(target.hunkId))) throw Error('Unknown DiffTree hunk');
    if (new Set(mapping.targets.map(target => target.hunkId)).size !== mapping.targets.length) throw Error('Duplicate mapping target');
  }
}
/** Full mapping replacement is atomic with a tree replacement. No text-label guessing. */
export function writeDiffTree(input: DiffTreeInput, hunks: GitDiffHunk[], previous?: ChangeSessionDiffTree): ChangeSessionDiffTree {
  input = diffTreeInputSchema.parse(input);
  if (previous && input.expectedRevisionId !== previous.revision.id) throw Error('VERSION_CONFLICT: reread DiffTree revision');
  if (!previous && input.expectedRevisionId) throw Error('VERSION_CONFLICT: DiffTree does not exist');
  if (!previous && !input.ascii) throw Error('ascii is required to initialize a DiffTree');
  if (previous) importDiagramRevision(previous.revision);
  const revision = previous
    ? input.ascii === undefined ? previous.revision : reviseStoredDiagram(previous.revision.id, { kind: 'replace', input: { ascii: input.ascii, structureKind: 'tree' } }).revision
    : createStoredDiagram({ id: 'diff-tree', revision: 0, ascii: input.ascii!, structureKind: 'tree' }).revision;
  const nodes = diagramContentNodes(revision.diagram.content);
  const mappings = input.mappings.map(mapping => {
    const source = mapping.source;
    const nodeId = 'line' in source ? revision.nodeRefs[nodes.find(node => node.line === source.line)?.id ?? ''] : source.nodeId;
    if (!nodeId) throw Error('DiffTree mapping line is not a tree node');
    return { id: mapping.id, nodeId, targets: mapping.targets, ...(mapping.diagramTargets ? { diagramTargets: mapping.diagramTargets } : {}) };
  });
  const tree = { revision, mappings, hunks }; validateDiffTree(tree); return tree;
}
export function defaultDiffTree(hunks: GitDiffHunk[]) {
  // One mapped node per commit keeps the initial tree within the Diagram size limit.
  const commits = [...new Set(hunks.map(hunk => hunk.commit))];
  if (!commits.length) return writeDiffTree({ ascii: 'Changes\n`-- No captured hunks', mappings: [] }, hunks);
  const ascii = ['Changes', ...commits.map((commit, index) => `${index === commits.length - 1 ? '`--' : '|--'} ${commit.slice(0, 12)}`)].join('\n');
  if (ascii.length > 20000) return writeDiffTree({ ascii: 'Changes\n`-- Selected commits', mappings: [{ id: 'all-changes', source: { line: 2 }, targets: hunks.map(hunk => ({ kind: 'diff-hunk', hunkId: hunk.id })) }] }, hunks);
  return writeDiffTree({ ascii, mappings: commits.map((commit, index) => ({ id: `commit-${commit}`, source: { line: index + 2 },
    targets: hunks.filter(hunk => hunk.commit === commit).map(hunk => ({ kind: 'diff-hunk' as const, hunkId: hunk.id })) })) }, hunks);
}
export function resolveDiffTreeHunks(tree: ChangeSessionDiffTree, nodeIds: string[]) {
  const direct = new Map<string, DiffTreeMapping['targets']>();
  for (const mapping of tree.mappings) direct.set(mapping.nodeId, [...direct.get(mapping.nodeId) ?? [], ...mapping.targets]);
  const { matches, unmappedNodeIds } = resolveNodeResources(diffTreeNodes(tree), nodeIds, direct);
  return { hunkIds: [...new Set(matches.flatMap(match => match.resources.map(resource => resource.hunkId)))], unmappedNodeIds };
}
