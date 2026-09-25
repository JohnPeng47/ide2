import type { DiagramContent, DiagramContentNode } from '../../core/diagrams/diagramContent';
import { diagramContentNodes } from '../../core/diagrams/diagramContentNodes';

export interface SearchPlacement {
  canvasDocumentId: string;
  canvasName: string;
  displayNodeId: string;
  diagramId: string;
  diagramName: string;
  contentKey: string;
  scope: 'project' | 'proposal';
}
export interface DiagramLineSearchResult extends Omit<SearchPlacement, 'contentKey' | 'scope'> {
  revisionId: string;
  asciiSha256: string;
  line: number;
  text: string;
  matches: { startColumn: number; endColumn: number; contentNodeIds: string[] }[];
  contentNodes: readonly DiagramContentNode[];
}
export type DiagramSearchScope = { kind: 'global' } | { kind: 'canvas'; documentId: string };
export interface SearchQuery { text: string; caseSensitive: boolean; scope: DiagramSearchScope }
export interface SearchUpdate {
  generation: number;
  upsert: { key: string; content: DiagramContent }[];
  remove: string[];
  placements: SearchPlacement[];
}
export type SearchWorkerRequest = { type: 'sync'; update: SearchUpdate }
  | { type: 'search'; requestId: number; generation: number; query: SearchQuery }
  | { type: 'cancel' };
export interface SearchBatch {
  type: 'results'; requestId: number; generation: number;
  results: DiagramLineSearchResult[]; done: boolean; truncated: boolean;
}
export type SearchWorkerResponse = SearchBatch | { type: 'error'; message: string };

/** Lives in the worker. Only current content is indexed; placements may share content. */
export class DiagramSearchIndex {
  generation = 0;
  private contents = new Map<string, { content: DiagramContent; lines: string[]; lower: string[]; nodes: Map<number, DiagramContentNode[]> }>();
  private placements: SearchPlacement[] = [];
  update(update: SearchUpdate) {
    for (const key of update.remove) this.contents.delete(key);
    for (const { key, content } of update.upsert) {
      const lines = content.ascii.split('\n'), nodes = new Map<number, DiagramContentNode[]>();
      for (const node of diagramContentNodes(content)) {
        const bucket = nodes.get(node.line) ?? []; bucket.push(node); nodes.set(node.line, bucket);
      }
      this.contents.set(key, { content, lines, lower: lines.map(line => line.toLowerCase()), nodes });
    }
    this.placements = update.placements;
    this.generation = update.generation;
  }
  /** Yield even empty batches so the worker can receive cancellation during long scans. */
  *search(query: SearchQuery, limit = 1000): Generator<{ results: DiagramLineSearchResult[]; done: boolean; truncated: boolean }> {
    const needle = query.caseSensitive ? query.text : query.text.toLowerCase();
    if (!needle) { yield { results: [], done: true, truncated: false }; return; }
    let batch: DiagramLineSearchResult[] = [], count = 0, scanned = 0;
    for (const placement of this.placements) {
      if (query.scope.kind === 'global' ? placement.scope !== 'project' : placement.canvasDocumentId !== query.scope.documentId) continue;
      const entry = this.contents.get(placement.contentKey);
      if (!entry) continue;
      for (let i = 0; i < entry.lines.length; i++) {
        const text = entry.lines[i], haystack = query.caseSensitive ? text : entry.lower[i];
        const nodes = entry.nodes.get(i + 1) ?? [];
        const matches: DiagramLineSearchResult['matches'] = [];
        for (let from = 0, at; (at = haystack.indexOf(needle, from)) !== -1; from = at + needle.length) {
          const startColumn = at + 1, endColumn = at + needle.length;
          matches.push({ startColumn, endColumn, contentNodeIds: nodes.filter(node => node.startColumn <= endColumn && node.endColumn >= startColumn).map(node => node.id) });
        }
        if (matches.length) {
          if (count === limit) { yield { results: batch, done: true, truncated: true }; return; }
          const { contentKey: _, scope: __, ...location } = placement;
          batch.push({ ...location, revisionId: entry.content.revisionId, asciiSha256: entry.content.asciiSha256,
            line: i + 1, text, matches, contentNodes: nodes });
          count++;
        }
        if (++scanned % 250 === 0 || batch.length >= 100) { yield { results: batch, done: false, truncated: false }; batch = []; }
      }
    }
    yield { results: batch, done: true, truncated: false };
  }
}
