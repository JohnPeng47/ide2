import type { GitDiffHunk } from '../../core/diffs/gitDiffHunk';
import type { DiagramJumpTarget } from '../../core/diagrams/diagramJump';
import { diagramContentNodes } from '../../core/diagrams/diagramContentNodes';
import type { GridBox, LineGridScene } from '../../core/diagrams/lineGrid';
import type { ChangePreviewDocument } from './diagramChangeSession';
import { diffTreeNodes, type ChangeSessionDiffTree } from './diffTree';

export interface ChangeTreemapNode {
  id: string; label: string; kind: 'root' | 'directory' | 'file' | 'diagram' | 'node' | 'direct' | 'unmapped';
  value: number; added: number; deleted: number; hunkIds: string[]; children: ChangeTreemapNode[];
  target?: DiagramJumpTarget; previous?: boolean;
  allocation?: { rawLoc: number; sharedLoc: number; minDestinations: number; maxDestinations: number };
}
export interface ChangeTreemaps {
  files: ChangeTreemapNode; diagrams: ChangeTreemapNode;
  actual: number; mapped: number; rawMapped: number; covered: number; unmapped: number; extra: number;
  unmappedHunkIds: string[]; nonTextHunks: number; unresolvedTargets: number;
}
interface Builder {
  id: string; label: string; kind: ChangeTreemapNode['kind']; own: Set<string>; children: Builder[];
  target?: DiagramJumpTarget; previous?: boolean;
}
const node = (id: string, label: string, kind: Builder['kind']): Builder => ({ id, label, kind, own: new Set(), children: [] });
const key = (...parts: string[]) => JSON.stringify(parts);

/** Count changed lines in captured hunks, never context, metadata or live source files. */
export function hunkLoc(hunk: GitDiffHunk) {
  let added = 0, deleted = 0;
  if (hunk.kind === 'text') for (const line of hunk.patch.split('\n').slice(1)) {
    if (line.startsWith('+')) added++;
    else if (line.startsWith('-')) deleted++;
  }
  return { added, deleted, value: added + deleted };
}

/** A read-only projection. Split each hunk equally across its resolved destinations;
 * preserve unassigned hunks in an Unmapped region. Count destinations before summing
 * the hierarchy so parent totals do not participate in allocation.
 * Inherited destinations apply to direct hunks below their DiffTree heading;
 * they do not invent leaf-level mappings inside the destination diagram.
 */
export function buildChangeTreemaps(tree: ChangeSessionDiffTree | undefined, documents: readonly ChangePreviewDocument[]): ChangeTreemaps {
  const hunks = new Map((tree?.hunks ?? []).map(h => [h.id, h]));
  const weights = new Map([...hunks].map(([id, hunk]) => [id, hunkLoc(hunk)]));
  const files = node('files', 'All files', 'root'), diagrams = node('diagrams', 'All diagrams', 'root');
  for (const hunk of hunks.values()) {
    let parent = files, path = '';
    const parts = hunk.path.split('/');
    parts.forEach((part, index) => {
      path += `${path ? '/' : ''}${part}`;
      const id = key('file', path);
      let child = parent.children.find(child => child.id === id);
      if (!child) { child = node(id, part, index === parts.length - 1 ? 'file' : 'directory'); parent.children.push(child); }
      parent = child;
    });
    parent.own.add(hunk.id);
  }
  const destinations = new Map<string, Builder>();
  const register = (doc: ChangePreviewDocument, display: string, content: string, value: Builder) => {
    for (const documentId of new Set([doc.id, doc.representationId].filter((id): id is string => !!id)))
      destinations.set(key(documentId, display, content), value);
  };
  const boxes = (scene?: LineGridScene) => {
    const result = new Map<string, Extract<GridBox, { kind: 'diagram' }>>();
    const visit = (box: GridBox) => { if (box.kind === 'diagram') result.set(box.id, box); else box.children.forEach(visit); };
    if (scene) visit(scene.root);
    return result;
  };
  for (const doc of documents) {
    const before = boxes(doc.baseline?.document.scene), after = boxes(doc.proposed.document.scene);
    for (const boxId of new Set([...after.keys(), ...before.keys()])) {
      const display = `grid:${boxId}`, nextBox = after.get(boxId), oldBox = before.get(boxId);
      const next = nextBox && doc.proposed.document.scene.contents[nextBox.contentId];
      const old = oldBox && doc.baseline?.document.scene.contents[oldBox.contentId];
      const content = next ?? old;
      if (!content) continue;
      const root = node(key('diagram', doc.id, boxId), `${doc.name} / ${content.content.ascii.split('\n').find(line => line.trim())?.trim() ?? boxId}`, 'diagram');
      root.previous = !next;
      root.target = { representationId: doc.id, displayNodeId: display };
      diagrams.children.push(root); register(doc, display, '', root);
      const addContent = (diagram: typeof content, parent: Builder, previous: boolean) => {
        const nodes = diagramContentNodes(diagram.content);
        const entries = new Map(nodes.map(n => {
          const value = node(key('node', doc.id, boxId, n.id), n.label, 'node');
          value.previous = previous;
          value.target = { representationId: doc.id, displayNodeId: display, contentNodeId: n.id };
          register(doc, display, n.id, value);
          return [n.id, value] as const;
        }));
        for (const n of nodes) (n.parentId && entries.get(n.parentId) || parent).children.push(entries.get(n.id)!);
      };
      addContent(content, root, !next);
      // Old revision destinations remain inspectable, but are never used as live anchors.
      if (next && old && (old.content.revisionId !== next.content.revisionId || old.content.asciiSha256 !== next.content.asciiSha256)) {
        const previous = node(key(root.id, 'previous'), 'Previous revision', 'node');
        previous.previous = true; root.children.push(previous); addContent(old, previous, true);
      }
    }
  }
  let unresolvedTargets = 0;
  if (tree) {
    const nodes = new Map(diffTreeNodes(tree).map(n => [n.id, n]));
    const links = new Map<string, DiagramJumpTarget[]>();
    for (const mapping of tree.mappings) if (mapping.diagramTargets?.length)
      links.set(mapping.nodeId, [...links.get(mapping.nodeId) ?? [], ...mapping.diagramTargets]);
    const inherited = (id: string): DiagramJumpTarget[] => {
      const visited = new Set<string>();
      let current: string | undefined = id;
      while (current && !visited.has(current)) {
        visited.add(current);
        const targets = links.get(current);
        if (targets?.length) return targets;
        current = nodes.get(current)?.parentId;
      }
      return [];
    };
    for (const mapping of tree.mappings) {
      if (!mapping.targets.length) continue;
      for (const target of inherited(mapping.nodeId)) {
        const destination = destinations.get(key(target.representationId, target.displayNodeId ?? '', target.contentNodeId ?? ''));
        if (!destination) { unresolvedTargets++; continue; }
        mapping.targets.forEach(h => { if (hunks.has(h.hunkId)) destination.own.add(h.hunkId); });
      }
    }
  }
  const usage = new Map<string, number>();
  const countUsage = (source: Builder) => {
    source.own.forEach(id => usage.set(id, (usage.get(id) ?? 0) + 1));
    source.children.forEach(countUsage);
  };
  countUsage(diagrams);
  const unmappedHunkIds = [...hunks.keys()].filter(id => !usage.has(id));
  const unmapped = node('unmapped', 'Unmapped', 'unmapped');
  unmappedHunkIds.forEach(id => unmapped.own.add(id));
  diagrams.children.push(unmapped);
  const allocation = (ids: string[]) => {
    const shared = ids.filter(id => (usage.get(id) ?? 0) > 1 && weights.get(id)!.value > 0);
    return { rawLoc: ids.reduce((sum, id) => sum + weights.get(id)!.value, 0),
      sharedLoc: shared.reduce((sum, id) => sum + weights.get(id)!.value, 0),
      minDestinations: shared.length ? Math.min(...shared.map(id => usage.get(id)!)) : 1,
      maxDestinations: shared.length ? Math.max(...shared.map(id => usage.get(id)!)) : 1 };
  };
  const finish = (source: Builder, allocate: boolean): ChangeTreemapNode => {
    const own = [...source.own];
    const allChildren = source.children.map(child => finish(child, allocate));
    const children = allChildren.filter(child => child.value > 0);
    const direct = own.reduce((sum, id) => {
      const weight = weights.get(id)!;
      const divisor = allocate ? usage.get(id) ?? 1 : 1;
      return { added: sum.added + weight.added / divisor, deleted: sum.deleted + weight.deleted / divisor, value: sum.value + weight.value / divisor };
    }, { added: 0, deleted: 0, value: 0 });
    if (children.length && direct.value) children.push({ id: key(source.id, 'direct'), label: 'Directly mapped here', kind: 'direct',
      ...direct, allocation: allocate ? allocation(own) : undefined, hunkIds: own, children: [], target: source.target, previous: source.previous });
    const totals = children.length ? children.reduce((sum, child) => ({ value: sum.value + child.value,
      added: sum.added + child.added, deleted: sum.deleted + child.deleted }), { value: 0, added: 0, deleted: 0 }) : direct;
    const hunkIds = [...new Set([...own, ...allChildren.flatMap(child => child.hunkIds)])];
    return { id: source.id, label: source.label, kind: source.kind, ...totals,
      hunkIds, allocation: allocate && source.kind !== 'unmapped' ? allocation(hunkIds) : undefined,
      children: children.sort((a, b) => b.value - a.value || a.id.localeCompare(b.id)), target: source.target, previous: source.previous };
  };
  const fileTree = finish(files, false), diagramTree = finish(diagrams, true);
  const covered = [...usage.keys()].reduce((sum, id) => sum + weights.get(id)!.value, 0);
  const rawMapped = [...usage].reduce((sum, [id, count]) => sum + weights.get(id)!.value * count, 0);
  return { files: fileTree, diagrams: diagramTree, actual: fileTree.value, mapped: covered, rawMapped, covered,
    unmapped: fileTree.value - covered, extra: rawMapped - covered, unmappedHunkIds,
    nonTextHunks: [...hunks.values()].filter(h => h.kind !== 'text').length, unresolvedTargets };
}
