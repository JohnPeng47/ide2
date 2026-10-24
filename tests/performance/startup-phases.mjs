// Isolated phase attribution; use node --import tsx. No timing thresholds.
import { cp, mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { Session } from 'node:inspector/promises';
import { DiagramStore } from '../../infrastructure/core/persistence/store.ts';
import { MappingWorkspaceStore } from '../../infrastructure/mapping/persistence/workspace/mappingWorkspaceStore.ts';
import { recordsWorkspace } from '../../domain/mapping/workspace/workspaceRecords.ts';
import { deserializeWorkspace } from '../../domain/mapping/workspace/mappingWorkspaceCodec.ts';
import { reconcileWorkspaceDocument } from '../../domain/mapping/workspace/reconcileWorkspace.ts';
import { CanvasWorkspace } from '../../src/features/mapping/workspace/canvasWorkspace.ts';
import { DefaultCanvasHistoryService } from '../../domain/core/diagrams/canvasHistoryService.ts';
const source = process.env.STARTUP_STORE;
if (!source) throw Error('Set STARTUP_STORE to the store to copy');
const output = path.resolve(process.env.STARTUP_REPORT ?? 'artifacts/startup-performance');
const profiling = process.env.STARTUP_PROFILE === '1';
const historyValidation = process.env.STARTUP_HISTORY ?? 'all';
const temp = await mkdtemp(path.join(tmpdir(), 'startup-phases-'));
const inspector = new Session();
const report = { date: new Date().toISOString(), profiling, historyValidation, phases: [] };
await mkdir(output, { recursive: true });
if (profiling) { inspector.connect(); await inspector.post('Profiler.enable'); }
async function phase(name, run) {
  if (profiling) await inspector.post('Profiler.start');
  const before = performance.now(), cpu = process.cpuUsage();
  const result = await run();
  const used = process.cpuUsage(cpu);
  const row = { name, ms: performance.now() - before, cpuMs: (used.user + used.system) / 1000 };
  report.phases.push(row); console.log(JSON.stringify(row));
  if (profiling) await writeFile(path.join(output, `${name}.cpuprofile`), JSON.stringify((await inspector.post('Profiler.stop')).profile));
  return result;
}
try {
  await cp(source, temp, { recursive: true });
  const store = new DiagramStore(process.cwd(), temp);
  const project = await store.loadProject();
  const catalog = await phase('catalog-cold', () => store.canvases.loadRepresentationCatalog(project.id, historyValidation));
  const catalogJson = await phase('catalog-serialize', () => JSON.stringify({ project, catalog }));
  report.catalog = { bytes: Buffer.byteLength(catalogJson), representations: Object.keys(catalog.representations).length, revisions: Object.keys(catalog.revisions).length };
  await phase('catalog-warm', () => store.canvases.loadRepresentationCatalog(project.id, historyValidation));
  const storage = new MappingWorkspaceStore(temp, store.diagramPersistence);
  const state = await phase('records-cold', () => storage.loadRecords(project.id, historyValidation));
  await phase('records-warm', () => storage.loadRecords(project.id, historyValidation));
  const json = await phase('records-serialize', () => JSON.stringify(state));
  report.records = { bytes: Buffer.byteLength(json), count: Object.keys(state.records).length };
  const wire = await phase('worker-parse', () => JSON.parse(json));
  await phase('worker-known-records', () => new Map(Object.entries(wire.records).map(([k,v]) => [k, JSON.stringify(v)])));
  const workspace = await phase('worker-records-workspace', () => recordsWorkspace(wire.records));
  const restored = await phase('worker-deserialize', () => deserializeWorkspace(workspace, historyValidation));
  report.workspace = { documents: restored.documents.length, active: restored.activeDocumentId, docs: restored.documents.map(d => ({ name:d.name, id:d.representationId, historyBytes:JSON.stringify(d.history).length, snapshots:Object.keys(d.history?.snapshots ?? {}).length, revisions:Object.keys(d.history?.diagramRevisions ?? {}).length })) };
  const delivered = await phase('worker-result-clone', () => structuredClone({ state: wire, workspace: restored }));
  const drafts = await phase('page-reconcile', () => Object.fromEntries(delivered.workspace.documents.map(doc => {
    const refreshed = !(restored.transfers ?? []).some(tx => tx.sourceId === doc.representationId || tx.destinationId === doc.representationId) ? reconcileWorkspaceDocument(doc, catalog) : { document: doc, newerRevision: false };
    return [doc.representationId, { ...refreshed.document, newerRevision: refreshed.newerRevision, representationId: doc.savedRepresentationId, busy: false }];
  })));
  const registry = new CanvasWorkspace(new DefaultCanvasHistoryService(historyValidation));
  await phase('page-create-sessions', () => registry.setDrafts(drafts));
  registry.dispose();
  await writeFile(path.join(output, `phases${profiling ? '-profile' : ''}.json`), JSON.stringify(report, null, 2));
} finally { if (profiling) inspector.disconnect(); await rm(temp, { recursive: true, force: true }); }
