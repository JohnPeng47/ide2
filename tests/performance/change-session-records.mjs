// Read the input store; perform migration and all benchmarks in a disposable copy.
import assert from 'node:assert/strict';
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { performance } from 'node:perf_hooks';
import { DiagramChangeSessionStore } from '../../infrastructure/mapping/changes/diagramChangeSessionStore.ts';
import { RevisionedDiagramService } from '../../domain/core/diagrams/diagramService.ts';
import { DiagramRevisionStore } from '../../infrastructure/core/persistence/diagramRevisionStore.ts';
import { validateChangeSession } from '../../domain/mapping/changes/diagramChangeSession.ts';
const source = process.env.CHANGE_BENCH_STORE, projectId = process.env.CHANGE_BENCH_PROJECT, id = process.env.CHANGE_BENCH_SESSION;
if (!source || !projectId || !id) throw Error('Set CHANGE_BENCH_STORE, CHANGE_BENCH_PROJECT and CHANGE_BENCH_SESSION');
const root = await mkdtemp(path.join(tmpdir(), 'change-records-bench-'));
const report = { createdAt: new Date().toISOString(), sessionId: id, measurements: [] };
const measure = async (name, fn) => { const start=performance.now(); const result=await fn(); const row={name,ms:performance.now()-start,bytes:Buffer.byteLength(JSON.stringify(result))};report.measurements.push(row);console.log(row);return result; };
try {
  for(const dir of ['diagrams','mapping-change-sessions']) await cp(path.join(source,dir),path.join(root,dir),{recursive:true,
    filter:file=>!file.endsWith('.manifest.json')&&!file.endsWith('.summary.json')});
  const raw=JSON.parse(await readFile(path.join(root,'mapping-change-sessions',projectId,id+'.json'),'utf8'));
  const diagrams = new RevisionedDiagramService(new DiagramRevisionStore(root));
  const full=await measure('legacy full preview',async()=>{const {receipts,...body}=validateChangeSession(await diagrams.restore(raw));return body;});
  const store=new DiagramChangeSessionStore(root,undefined,true);
  await measure('legacy cold summary index',()=>store.listSummaries(projectId));
  await measure('cached summary index',()=>store.listSummaries(projectId));
  const docId=full.changes[0]?.documentId ?? full.documents[0].id;
  const first=await measure('scoped preview including migration',()=>store.readPreview(projectId,id,docId));
  const again=await measure('scoped preview cached',()=>store.readPreview(projectId,id,docId));
  await measure('version metadata',()=>store.readSummary(projectId,id));
  assert.deepEqual(first,again);
  const {history,past,future,...expected}=full.documents.find(doc=>doc.id===docId);
  assert.deepEqual(first.document,expected);
  assert.deepEqual(first.documents,JSON.parse(JSON.stringify(full.documents.map(({id,name,representationId,version})=>({id,name,representationId,version})))));
  assert.equal('receipts' in first,false);assert.equal('history' in first.document,false);
  const reopened=new DiagramChangeSessionStore(root);
  await measure('scoped preview new reader',()=>reopened.readPreview(projectId,id,docId));
  const fullRead=store.read(projectId,id);
  await measure('summary index during full history hydration',()=>store.listSummaries(projectId));
  const {receipts,...roundTrip}=await fullRead;
  assert.deepEqual(roundTrip,full);
  await mkdir('artifacts/change-session-performance',{recursive:true});
  await writeFile(process.env.CHANGE_BENCH_REPORT ?? 'artifacts/change-session-performance/latest.json',JSON.stringify(report,null,2));
} finally { await rm(root,{recursive:true,force:true}); }
