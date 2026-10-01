import { diagramSource, type Diagram } from '../../core/diagrams/diagram';
import type { DiagramContentNode } from '../../core/diagrams/diagramContent';
import { diagramContentNodes } from '../../core/diagrams/diagramContentNodes';
import { mappingContentNodeId } from '../../core/diagrams/diagramText';
import { sha256 } from '../../core/sha256';
import type { CodeRepoReference } from '../../core/source/codeRepoService';

/** Mapped source coordinates are inclusive, one-based lines, unlike LSP positions. */
export interface SourceRangeReference {
  repo: CodeRepoReference;
  path: string;
  startLine: number;
  endLine: number;
  rangeSha256: string;
}
export type MappedResource = { type: 'source-range'; target: SourceRangeReference };
export type MappedResourceType = MappedResource['type'];
export const DEFAULT_MAPPED_RESOURCE_TYPE: MappedResourceType = 'source-range';
export interface DiagramContext { diagram: Diagram; projectId: string }
export interface MappingOrigin {
  selectedNodeId: string; selectedLabel: string;
  mappedNodeId: string; mappedLabel: string; mappingId: string;
}
export interface ResolvedMapping { resource: MappedResource; origins: MappingOrigin[] }
export interface PanelContent {
  mappedResourceType: MappedResourceType;
  diagramId: string; revisionId: string; contentHash: string;
  selectedNodeIds: string[]; unmappedNodeIds: string[];
  items: ResolvedMapping[];
}
export interface SourceDisplayRange { startLine: number; endLine: number; items: ResolvedMapping[] }
export interface SourceDisplayFile {
  id: string; repo: CodeRepoReference; path: string; ranges: SourceDisplayRange[];
}

function sourceRangeIndex({ diagram, projectId }: DiagramContext): Map<string, ResolvedMapping[]> {
  const index = new Map<string, ResolvedMapping[]>();
  if (diagram.sourceContext.contentHash !== diagram.content.asciiSha256) throw new Error('Diagram mappings are stale');
  for (const { mapping, entity, range, binding } of diagramSource(diagram).entries()) {
    const nodeId = mappingContentNodeId(diagram.content, mapping);
    if (!nodeId || !entity || !range) continue;
    const list = index.get(nodeId) ?? [];
    list.push({ resource: { type: 'source-range', target: {
      repo: { projectId, sourceId: entity.sourceId ?? binding?.sourceId ?? '' },
      path: range.path, startLine: range.startLine, endLine: range.endLine,
      rangeSha256: sha256(range.originalLines.join('\n')),
    } }, origins: [{ selectedNodeId: '', selectedLabel: '', mappedNodeId: nodeId, mappedLabel: '', mappingId: mapping.id }] });
    index.set(nodeId, list);
  }
  return index;
}
export function sourceResourceIdentity(resource: MappedResource): string {
  const t = resource.target;
  return JSON.stringify([resource.type, t.repo.projectId, t.repo.sourceId, t.path, t.startLine, t.endLine, t.rangeSha256]);
}
export function buildSourceRangeDisplayModel(items: readonly ResolvedMapping[], previousOrder: readonly string[] = []): SourceDisplayFile[] {
  const files = new Map<string, SourceDisplayFile>();
  for (const item of items) {
    const t = item.resource.target;
    const id = JSON.stringify([t.repo.projectId, t.repo.sourceId, t.path]);
    const file = files.get(id) ?? { id, repo: t.repo, path: t.path, ranges: [] };
    file.ranges.push({ startLine: t.startLine, endLine: t.endLine, items: [item] });
    files.set(id, file);
  }
  for (const file of files.values()) {
    const merged: SourceDisplayRange[] = [];
    for (const range of file.ranges.sort((a, b) => a.startLine - b.startLine || a.endLine - b.endLine)) {
      const previous = merged.at(-1);
      if (previous && range.startLine <= previous.endLine) {
        previous.endLine = Math.max(previous.endLine, range.endLine); previous.items.push(...range.items);
      } else merged.push({ ...range });
    }
    file.ranges = merged;
  }
  const rank = (id: string) => previousOrder.includes(id) ? previousOrder.indexOf(id) : previousOrder.length;
  return [...files.values()].sort((a, b) => rank(a.id) - rank(b.id) || a.id.localeCompare(b.id));
}
/** Domain handlers contain no React or file I/O. Renderers are registered in the UI. */
export const mappedResourceHandlers = {
  'source-range': { index: sourceRangeIndex, identity: sourceResourceIdentity, buildDisplayModel: buildSourceRangeDisplayModel },
} satisfies Record<MappedResourceType, unknown>;

export function resolveSelectedNodes(context: DiagramContext, selected: readonly DiagramContentNode[],
  mappedResourceType: MappedResourceType = DEFAULT_MAPPED_RESOURCE_TYPE) {
  const nodes = new Map(diagramContentNodes(context.diagram.content).map(node => [node.id, node]));
  const direct = mappedResourceHandlers[mappedResourceType].index(context);
  const results: ResolvedMapping[] = [], unmappedNodeIds: string[] = [];
  for (const requested of new Map(selected.map(node => [node.id, node])).values()) {
    const selectedNode = nodes.get(requested.id);
    if (!selectedNode) throw new Error('Selected node belongs to another diagram revision');
    let node: DiagramContentNode | undefined = selectedNode;
    const visited = new Set<string>();
    let found = false;
    while (node && !visited.has(node.id)) {
      visited.add(node.id);
      const mappings = direct.get(node.id);
      if (mappings?.length) {
        for (const item of mappings) results.push({ ...item, origins: item.origins.map(origin => ({ ...origin,
          selectedNodeId: selectedNode.id, selectedLabel: selectedNode.label, mappedLabel: node!.label })) });
        found = true; break;
      }
      node = node.parentId ? nodes.get(node.parentId) : undefined;
    }
    if (!found) unmappedNodeIds.push(selectedNode.id);
  }
  return { results, unmappedNodeIds };
}
export function handleNodeSelect(context: DiagramContext, nodes: readonly DiagramContentNode[],
  mappedResourceType: MappedResourceType = DEFAULT_MAPPED_RESOURCE_TYPE): PanelContent {
  const { results, unmappedNodeIds } = resolveSelectedNodes(context, nodes, mappedResourceType);
  const combined = new Map<string, ResolvedMapping>();
  for (const result of results) {
    const key = mappedResourceHandlers[mappedResourceType].identity(result.resource);
    const prior = combined.get(key);
    if (prior) prior.origins.push(...result.origins); else combined.set(key, { ...result, origins: [...result.origins] });
  }
  return { mappedResourceType, diagramId: context.diagram.id, revisionId: context.diagram.content.revisionId,
    contentHash: context.diagram.content.asciiSha256, selectedNodeIds: [...new Set(nodes.map(n => n.id))],
    unmappedNodeIds, items: [...combined.values()] };
}
