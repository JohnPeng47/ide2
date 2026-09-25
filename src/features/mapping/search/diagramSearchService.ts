import type { DiagramContent } from '../../../../domain/core/diagrams/diagramContent';
import type { MappingGridDocument } from '../../../../domain/mapping/workspace/mappingGrid';
import type { DiagramLineSearchResult, SearchPlacement, SearchQuery, SearchWorkerRequest, SearchWorkerResponse } from '../../../../domain/mapping/search/diagramSearch';

export interface SearchDocument { id: string; name: string; scope: 'project' | 'proposal'; document: MappingGridDocument }
export interface SearchWorkerPort {
  postMessage(message: SearchWorkerRequest): void;
  onmessage: ((event: MessageEvent<SearchWorkerResponse>) => void) | null;
  onerror: ((event: ErrorEvent) => void) | null;
  terminate(): void;
}
export interface DiagramSearchState { results: DiagramLineSearchResult[]; searching: boolean; truncated: boolean; error?: string }
const emptyState = (): DiagramSearchState => ({ results: [], searching: false, truncated: false });

export class DiagramSearchService {
  private worker?: SearchWorkerPort;
  private contentKeys = new Set<string>();
  private placementSignature = '';
  private documents: readonly SearchDocument[] = [];
  private generation = 0;
  private requestId = 0;
  private query?: SearchQuery;
  private state = emptyState();
  private listeners = new Set<() => void>();
  constructor(private readonly createWorker: () => SearchWorkerPort) {}
  getSnapshot = () => this.state;
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };
  private publish(state: DiagramSearchState) { this.state = state; this.listeners.forEach(listener => listener()); }
  private connect() {
    if (this.worker) return this.worker;
    const worker = this.createWorker(); this.worker = worker;
    worker.onmessage = ({ data }) => {
      if (data.type === 'error') { this.publish({ ...this.state, searching: false, error: data.message }); return; }
      if (data.requestId !== this.requestId || data.generation !== this.generation) return;
      this.publish({ results: [...this.state.results, ...data.results], searching: !data.done, truncated: data.truncated });
    };
    worker.onerror = () => this.publish({ ...this.state, searching: false, error: 'Diagram search worker failed. Reopen the page to retry.' });
    return worker;
  }
  /** No history, source files, view geometry, or source evidence crosses this boundary. */
  sync(documents: readonly SearchDocument[]) {
    // Selection and camera updates must not walk every diagram or serialize its placements.
    if (documents.length === this.documents.length && documents.every((doc, i) => {
      const old = this.documents[i];
      return doc.id === old.id && doc.name === old.name && doc.scope === old.scope && doc.document.scene === old.document.scene;
    })) return;
    const contents = new Map<string, DiagramContent>(), placements: SearchPlacement[] = [];
    for (const doc of documents) {
      const visit = (box: MappingGridDocument['scene']['root']) => {
        if (box.kind === 'container') { box.children.forEach(visit); return; }
        const diagram = doc.document.scene.contents[box.contentId];
        if (!diagram) return;
        const content = diagram.content;
        const key = JSON.stringify([content.revisionId, content.asciiSha256, content.structure.kind,
          content.structure.kind === 'tree' ? content.structure.parserVersion : '']);
        contents.set(key, content);
        placements.push({ canvasDocumentId: doc.id, canvasName: doc.name, scope: doc.scope,
          displayNodeId: `grid:${box.id}`, diagramId: diagram.id, diagramName: content.ascii.split('\n', 1)[0], contentKey: key });
      };
      visit(doc.document.scene.root);
    }
    const signature = JSON.stringify(placements);
    if (signature === this.placementSignature) { this.documents = documents; return; }
    try {
      this.connect().postMessage({ type: 'sync', update: { generation: ++this.generation, placements,
        upsert: [...contents].filter(([key]) => !this.contentKeys.has(key)).map(([key, content]) => ({ key, content })),
        remove: [...this.contentKeys].filter(key => !contents.has(key)) } });
      this.contentKeys = new Set(contents.keys()); this.placementSignature = signature;
      this.documents = documents;
      if (this.query) this.search(this.query);
    } catch (error) { this.publish({ ...emptyState(), error: String(error) }); }
  }
  search(query: SearchQuery) {
    this.query = query; this.requestId++;
    if (!query.text) { this.worker?.postMessage({ type: 'cancel' }); this.publish(emptyState()); return; }
    this.publish({ ...emptyState(), searching: true });
    try { this.connect().postMessage({ type: 'search', query, requestId: this.requestId, generation: this.generation }); }
    catch (error) { this.publish({ ...emptyState(), error: String(error) }); }
  }
  cancel() { this.query = undefined; this.requestId++; this.worker?.postMessage({ type: 'cancel' }); this.publish(emptyState()); }
  dispose() { this.cancel(); this.worker?.terminate(); this.worker = undefined; this.contentKeys.clear(); this.placementSignature = ''; this.documents = []; }
}
