import { DiagramSearchIndex, type SearchWorkerRequest, type SearchWorkerResponse } from '../../../../domain/mapping/search/diagramSearch';

const index = new DiagramSearchIndex();
let task = 0;
const send = (message: SearchWorkerResponse) => postMessage(message);
onmessage = async ({ data }: MessageEvent<SearchWorkerRequest>) => {
  const current = ++task;
  try {
    if (data.type === 'cancel') return;
    if (data.type === 'sync') { index.update(data.update); return; }
    if (data.generation !== index.generation) return;
    for (const batch of index.search(data.query)) {
      if (current !== task) return;
      send({ type: 'results', requestId: data.requestId, generation: data.generation, ...batch });
      if (!batch.done) await new Promise(resolve => setTimeout(resolve, 0));
    }
  } catch (error) { send({ type: 'error', message: error instanceof Error ? error.message : String(error) }); }
};
