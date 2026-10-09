import { resolveNodeResources } from '../../core/diagrams/diagramResourceMappings';
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
/** Preserve diagram order, starting another section when files change or source lines go backwards. */
export function buildSourceRangeDisplayModel(items: readonly ResolvedMapping[]): SourceDisplayFile[] {
  const files: SourceDisplayFile[] = [];
  for (const item of items) {
    const t = item.resource.target;
    let file = files.at(-1);
    if (!file || file.path !== t.path || file.repo.projectId !== t.repo.projectId || file.repo.sourceId !== t.repo.sourceId
      || t.startLine < file.ranges.at(-1)!.startLine) {
      file = { id: sourceResourceIdentity(item.resource), repo: t.repo, path: t.path, ranges: [] };
      files.push(file);
    }
    const previous = file.ranges.at(-1);
    if (previous && t.startLine <= previous.endLine) {
      previous.endLine = Math.max(previous.endLine, t.endLine); previous.items.push(item);
    } else file.ranges.push({ startLine: t.startLine, endLine: t.endLine, items: [item] });
  }
  return files;
}
/** Domain handlers contain no React or file I/O. Renderers are registered in the UI. */
export const mappedResourceHandlers = {
  'source-range': { index: sourceRangeIndex, identity: sourceResourceIdentity, buildDisplayModel: buildSourceRangeDisplayModel },
} satisfies Record<MappedResourceType, unknown>;

export function resolveSelectedNodes(context: DiagramContext, selected: readonly DiagramContentNode[],
  mappedResourceType: MappedResourceType = DEFAULT_MAPPED_RESOURCE_TYPE) {
  const direct = mappedResourceHandlers[mappedResourceType].index(context);
  const { matches, unmappedNodeIds } = resolveNodeResources(diagramContentNodes(context.diagram.content), selected.map(node => node.id), direct);
  const results: ResolvedMapping[] = matches.flatMap(({ selectedNode, mappedNode, resources }) => resources.map(item => ({
    ...item, origins: item.origins.map(origin => ({ ...origin, selectedNodeId: selectedNode.id,
      selectedLabel: selectedNode.label, mappedNodeId: mappedNode.id, mappedLabel: mappedNode.label }))
  })));
  return { results, unmappedNodeIds };
}
export function handleNodeSelect(context: DiagramContext, nodes: readonly DiagramContentNode[],
  mappedResourceType: MappedResourceType = DEFAULT_MAPPED_RESOURCE_TYPE): PanelContent {
  nodes = [...nodes].sort((a, b) => a.line - b.line || a.startColumn - b.startColumn);
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
