import { diagramSource, type DiagramSourceBinding } from '../../core/diagrams/diagram';
import { diagramContentNodes } from '../../core/diagrams/diagramContentNodes';
import { mappingContentNodeId } from '../../core/presentation/diagramText';
import type { GridBox, LineGridScene } from '../../core/diagrams/lineGrid';
import type { SourceRange } from '../../core/records/domain';
import type { DeepReadonly } from '../../core/immutability';
import type { ChangeTreemapNode } from '../changes/changeTreemap';

export type CanvasTreemapScope = 'mapped' | 'files';
export interface CanvasSourceFile { key: string; path: string; binding: DiagramSourceBinding }
export interface CanvasSourceRead { text?: string; error?: string }
export interface CanvasTreemapInput {
  diagrams: ChangeTreemapNode;
  files: CanvasSourceFile[];
  mappings: { file: string; nodeId: string; range: DeepReadonly<SourceRange> }[];
  unresolved: number;
}
const key = (...parts: unknown[]) => JSON.stringify(parts);
const node = (id: string, label: string, kind: ChangeTreemapNode['kind']): ChangeTreemapNode =>
  ({ id, label, kind, value: 0, added: 0, deleted: 0, hunkIds: [], children: [] });

/** Read only source mappings that belong to actual diagram instances, including folded ones. */
export function canvasTreemapInput(scene: LineGridScene, documentId: string): CanvasTreemapInput {
  const diagrams = node('diagrams', 'All diagrams', 'root');
  const files = new Map<string, CanvasSourceFile>();
  const mappings: CanvasTreemapInput['mappings'] = [];
  let unresolved = 0;
  const visit = (box: GridBox) => {
    if (box.kind === 'container') { box.children.forEach(visit); return; }
    const diagram = scene.contents[box.contentId], displayNodeId = `grid:${box.id}`;
    if (!diagram) return;
    const root = node(key(documentId, box.id), diagram.content.ascii.split('\n').find(line => line.trim())?.trim() ?? box.id, 'diagram');
    root.target = { representationId: documentId, displayNodeId };
    diagrams.children.push(root);
    const contentNodes = diagramContentNodes(diagram.content);
    const entries = new Map(contentNodes.map(n => {
      const child = node(key(documentId, box.id, n.id), n.label, 'node');
      child.target = { ...root.target!, contentNodeId: n.id };
      return [n.id, child] as const;
    }));
    for (const n of contentNodes) (n.parentId && entries.get(n.parentId) || root).children.push(entries.get(n.id)!);
    for (const { mapping, range, binding } of diagramSource(diagram).entries()) {
      if (!range || !binding) { unresolved++; continue; }
      // Different checkouts/revisions are separate line universes, even with equal paths.
      const file = key(binding.repositoryIdentity, binding.corpus, range.path);
      files.set(file, { key: file, path: range.path, binding });
      const owner = mappingContentNodeId(diagram.content, mapping);
      mappings.push({ file, nodeId: owner ? entries.get(owner)!.id : root.id, range });
    }
  };
  visit(scene.root);
  return { diagrams, files: [...files.values()], mappings, unresolved };
}

/** Physical lines: a final newline terminates a line rather than creating an extra one. */
export function sourceLines(text: string): string[] {
  if (!text) return [];
  const lines = text.replace(/\r\n/g, '\n').split('\n');
  if (lines.at(-1) === '') lines.pop();
  return lines;
}

/** Sweep range boundaries instead of allocating a Set for every source line. */
export function buildCanvasTreemaps(input: CanvasTreemapInput, reads: ReadonlyMap<string, CanvasSourceRead>, scope: CanvasTreemapScope) {
  const diagrams = structuredClone(input.diagrams), files = node('files', 'All files', 'root');
  const own = new Map<string, number>();
  let mapped = 0, total = 0, extra = 0, unresolved = input.unresolved;
  const issues: string[] = [];
  const multiSource = new Set(input.files.map(file => key(file.binding.repositoryIdentity, file.binding.corpus))).size > 1;
  for (const file of input.files) {
    const read = reads.get(file.key);
    if (read?.text === undefined || read.text.includes('\0')) {
      issues.push(`${file.path}: ${read?.error ?? (read?.text?.includes('\0') ? 'binary file' : 'source unavailable')}`);
      continue;
    }
    const lines = sourceLines(read.text); total += lines.length;
    const events = new Map<number, { nodeId: string; delta: number }[]>();
    const event = (line: number, nodeId: string, delta: number) => events.set(line, [...events.get(line) ?? [], { nodeId, delta }]);
    for (const { nodeId, range } of input.mappings.filter(mapping => mapping.file === file.key)) {
      const valid = range.startLine >= 1 && range.endLine >= range.startLine && range.endLine <= lines.length
        && range.originalLines?.length === range.endLine - range.startLine + 1
        && range.originalLines.every((line, i) => line.replace(/\r$/, '') === lines[range.startLine - 1 + i]);
      if (!valid) { unresolved++; continue; }
      event(range.startLine, nodeId, 1); event(range.endLine + 1, nodeId, -1);
    }
    const boundaries = [...events.keys()].sort((a, b) => a - b), active = new Map<string, number>();
    let covered = 0;
    for (let i = 0; i < boundaries.length; i++) {
      const start = boundaries[i];
      for (const { nodeId, delta } of events.get(start)!) {
        const count = (active.get(nodeId) ?? 0) + delta;
        if (count) active.set(nodeId, count); else active.delete(nodeId);
      }
      const length = (boundaries[i + 1] ?? start) - start;
      if (!active.size || !length) continue;
      covered += length; extra += length * (active.size - 1);
      for (const nodeId of active.keys()) own.set(nodeId, (own.get(nodeId) ?? 0) + length / active.size);
    }
    mapped += covered;
    let parent = files;
    const parts = file.path.split('/');
    if (multiSource) parts.unshift(`${file.binding.sourceId} · ${file.binding.corpus.root}`);
    parts.forEach((part, i) => {
      const id = key('file', file.binding.repositoryIdentity, file.binding.corpus, parts.slice(0, i + 1));
      let child = parent.children.find(n => n.id === id);
      if (!child) { child = node(id, part, i === parts.length - 1 ? 'file' : 'directory'); parent.children.push(child); }
      parent = child;
    });
    own.set(parent.id, scope === 'mapped' ? covered : lines.length);
  }
  const finish = (n: ChangeTreemapNode): ChangeTreemapNode => {
    n.children = n.children.map(finish).filter(child => child.value > 0);
    const direct = own.get(n.id) ?? 0;
    if (direct && n.children.length) n.children.push({ ...node(key(n.id, 'direct'), 'Directly mapped here', 'direct'), value: direct, target: n.target });
    n.value = n.children.length ? n.children.reduce((sum, child) => sum + child.value, 0) : direct;
    n.children.sort((a, b) => b.value - a.value || a.id.localeCompare(b.id));
    return n;
  };
  const unmapped = total - mapped;
  if (scope === 'files' && unmapped) {
    const remainder = node('unmapped', 'Unmapped', 'unmapped');
    diagrams.children.push(remainder); own.set(remainder.id, unmapped);
  }
  if (unresolved) issues.push(`${unresolved} stale or unresolved source mappings excluded. Refresh their mappings to include them.`);
  return { diagrams: finish(diagrams), files: finish(files), actual: scope === 'mapped' ? mapped : total,
    mapped, unmapped: scope === 'files' ? unmapped : 0, extra, total, issues };
}
