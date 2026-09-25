import { expect, it } from 'vitest';
import { DiagramSearchService, type SearchWorkerPort } from '../diagramSearchService';
import { singleDiagramScene } from '../../../../../domain/core/diagrams/projectDiagramCanvas';
import { mappingDocumentFromScene } from '../../../../../domain/mapping/workspace/mappingDocument';
import type { SearchWorkerRequest, SearchWorkerResponse } from '../../../../../domain/mapping/search/diagramSearch';

function fixture() {
  const messages: SearchWorkerRequest[] = [];
  const worker: SearchWorkerPort = { onmessage: null, onerror: null, terminate() {}, postMessage(message) { messages.push(message); } };
  const service = new DiagramSearchService(() => worker);
  const doc = { id: 'a', name: 'Canvas', scope: 'project' as const, document: mappingDocumentFromScene(singleDiagramScene('Root\n`-- Needle')) };
  const reply = (data: SearchWorkerResponse) => worker.onmessage?.({ data } as MessageEvent<SearchWorkerResponse>);
  return { service, messages, doc, reply };
}

it('transfers content once, ignores layout-only changes, and removes unreferenced content', () => {
  const { service, messages, doc } = fixture();
  service.sync([doc]);
  const sync = messages[0]; expect(sync.type).toBe('sync');
  if (sync.type !== 'sync') throw Error('Expected sync');
  expect(sync.update.upsert).toHaveLength(1);
  expect(Object.keys(sync.update.upsert[0].content).sort()).toEqual(['ascii', 'asciiSha256', 'revisionId', 'structure']);
  service.sync([{ ...doc, document: { ...doc.document, scene: { ...doc.document.scene,
    root: { ...doc.document.scene.root, position: { column: 90, row: 90 } } } } }]);
  expect(messages).toHaveLength(1);
  service.sync([doc, { ...doc, id: 'b' }]);
  expect(messages.at(-1)).toMatchObject({ type: 'sync', update: { upsert: [], remove: [] } });
  service.sync([]);
  expect(messages.at(-1)).toMatchObject({ type: 'sync', update: { placements: [], remove: [sync.update.upsert[0].key] } });
});

it('discards old queries and generations and reruns the current query after edits', () => {
  const { service, messages, doc, reply } = fixture();
  service.sync([doc]);
  service.search({ text: 'Needle', caseSensitive: false, scope: { kind: 'global' } });
  const first = messages.at(-1); if (first?.type !== 'search') throw Error('Expected search');
  service.sync([{ ...doc, document: mappingDocumentFromScene(singleDiagramScene('Changed')) }]);
  const second = messages.at(-1); if (second?.type !== 'search') throw Error('Expected search');
  reply({ type: 'results', requestId: first.requestId, generation: first.generation, results: [], done: true, truncated: true });
  expect(service.getSnapshot().searching).toBe(true); expect(service.getSnapshot().truncated).toBe(false);
  reply({ type: 'results', requestId: second.requestId, generation: second.generation, results: [], done: true, truncated: false });
  expect(service.getSnapshot().searching).toBe(false);
  service.cancel();
  reply({ type: 'results', requestId: second.requestId, generation: second.generation, results: [], done: true, truncated: true });
  expect(service.getSnapshot().truncated).toBe(false);
});
