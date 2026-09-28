import { open, readdir, readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { RevisionedDiagramService, type DiagramService } from '../../../domain/core/diagrams/diagramService';
import { DiagramRevisionStore } from '../../core/persistence/diagramRevisionStore';
import { ImmutableRecords, publishJson } from '../../core/persistence/immutableRecords';
import { changeId, validateChangeSession, validateChangeSessionSummary, type ChangeSessionDocument, type ChangePreviewDocument,
  type ChangeSessionSummary, type ChangeSessionPreview, type DiagramChangeSession } from '../../../domain/mapping/changes/diagramChangeSession';
import { deserializeWorkspace } from '../../../domain/mapping/workspace/mappingWorkspaceCodec';

interface Manifest { format: 2; summary: ChangeSessionSummary; documents: Record<string, string>; receipts: string }
interface StoredDocument {
  metadata: Omit<ChangeSessionDocument, 'baseline'|'proposed'|'past'|'future'|'history'>;
  baseline: string | null; proposed: string; past: string[]; future: string[];
  history?: { header: string; checkpoints: Record<string, string> };
}
export interface SessionWrite {
  summary: ChangeSessionSummary;
  documents: ChangeSessionDocument[];
  receipts: DiagramChangeSession['receipts'];
  expected?: string;
}
const queues = new Map<string, Promise<unknown>>();
export class ChangeSessionRecords {
  private blobs: ImmutableRecords;
  private validated = new Map<string, ChangeSessionDocument>();
  private previews = new Map<string, ChangePreviewDocument>();
  constructor(private readonly root: string, private readonly diagrams: DiagramService = new RevisionedDiagramService(new DiagramRevisionStore(root))) {
    this.blobs = new ImmutableRecords(path.join(root, 'change-session-records'));
  }
  private directory(projectId: string) { return path.join(this.root, 'mapping-change-sessions', changeId.parse(projectId)); }
  private manifestFile(projectId: string, id: string) { return path.join(this.directory(projectId), `${changeId.parse(id)}.manifest.json`); }
  private async serial<T>(projectId: string, id: string, run: () => Promise<T>): Promise<T> {
    const key = this.manifestFile(projectId, id), next = (queues.get(key) ?? Promise.resolve()).catch(() => {}).then(run);
    queues.set(key, next);
    try { return await next; } finally { if (queues.get(key) === next) queues.delete(key); }
  }
  private token(manifest: Manifest) { return JSON.stringify(manifest); }
  private async existing(projectId: string, id: string): Promise<Manifest | undefined> {
    let raw: string;
    try { raw = await readFile(this.manifestFile(projectId, id), 'utf8'); }
    catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return; throw error; }
    const manifest = JSON.parse(raw) as Manifest;
    if (manifest.format !== 2 || manifest.summary.id !== id || manifest.summary.projectId !== projectId) throw Error('Change session identity mismatch');
    validateChangeSessionSummary(manifest.summary);
    if (!manifest.documents || manifest.summary.documents.some(doc => !Object.hasOwn(manifest.documents, doc.id))) throw Error('Incomplete change session');
    return manifest;
  }
  async listSummaries(projectId: string, load = (id: string) => this.readSummary(projectId, id)): Promise<ChangeSessionSummary[]> {
    const names = await readdir(this.directory(projectId)).catch(error => { if (error.code === 'ENOENT') return []; throw error; });
    const ids = new Set(names.filter(name => name.endsWith('.manifest.json')).map(name => name.slice(0, -14)));
    names.filter(name => name.endsWith('.json') && !name.endsWith('.manifest.json') && !name.endsWith('.summary.json')).forEach(name => ids.add(name.slice(0, -5)));
    const summaries = [];
    for (const id of ids) summaries.push(await load(id));
    return summaries;
  }
  async readSummary(projectId: string, id: string, cold?: () => Promise<ChangeSessionSummary>): Promise<ChangeSessionSummary> {
    const manifest = await this.existing(projectId, id);
    if (manifest) return manifest.summary;
    // Legacy summaries have their own small, generation-stamped cache. No hydration.
    const file = path.join(this.directory(projectId), `${changeId.parse(id)}.json`);
    const handle = await open(file, 'r');
    try {
      const info = await handle.stat({ bigint: true }), stamp = `${info.ino}:${info.size}:${info.mtimeNs}:${info.ctimeNs}`;
      const cache = `${file.slice(0, -5)}.summary.json`;
      try {
        const saved = JSON.parse(await readFile(cache, 'utf8'));
        if (saved.stamp === stamp) {
          const summary = validateChangeSessionSummary(saved.summary);
          if (summary.id !== id || summary.projectId !== projectId) throw Error('Change session identity mismatch');
          return summary;
        }
      } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
      if (cold) return cold();
      const summary = validateChangeSessionSummary(JSON.parse(await handle.readFile('utf8')));
      if (summary.projectId !== projectId || summary.id !== id) throw Error('Change session identity mismatch');
      await publishJson(cache, { stamp, summary }); return summary;
    } finally { await handle.close(); }
  }
  private async splitDocument(raw: any): Promise<string> {
    if (!raw || !Object.hasOwn(raw, 'baseline') || !raw.proposed || !Array.isArray(raw.past) || !Array.isArray(raw.future)) throw Error('Invalid change-session document');
    // Already-externalized legacy references pass through unchanged. Embedded
    // legacy diagrams are normalized once into the shared immutable diagram store.
    const { baseline, proposed, past, future, history, ...metadata } = await this.diagrams.persist(raw) as any;
    const historyRefs = history ? { header: await this.blobs.put(Object.fromEntries(Object.entries(history).filter(([key]) => key !== 'snapshots'))),
      checkpoints: Object.fromEntries(await Promise.all(Object.entries(history.snapshots).map(async ([id, snapshot]) => [id, await this.blobs.put(snapshot)]))) } : undefined;
    return this.blobs.put({ metadata, baseline: baseline ? await this.blobs.put(baseline) : null, proposed: await this.blobs.put(proposed),
      past: await Promise.all(past.map((state: unknown) => this.blobs.put(state))), future: await Promise.all(future.map((state: unknown) => this.blobs.put(state))),
      ...(historyRefs ? { history: historyRefs } : {}) } satisfies StoredDocument);
  }
  private async migrate(projectId: string, id: string): Promise<Manifest> {
    return this.serial(projectId, id, async () => {
      const existing = await this.existing(projectId, id); if (existing) return existing;
      const raw = JSON.parse(await readFile(path.join(this.directory(projectId), `${changeId.parse(id)}.json`), 'utf8'));
      const summary = validateChangeSessionSummary(raw);
      if (summary.id !== id || summary.projectId !== projectId) throw Error('Change session identity mismatch');
      const documents: Record<string, string> = {}, receipts: Record<string, string> = {};
      // Split stored references directly. Preview migration must not restore every history.
      for (const doc of raw.documents) documents[doc.id] = await this.splitDocument(doc);
      for (const [key, receipt] of Object.entries(raw.receipts)) receipts[key] = await this.blobs.put(receipt);
      const manifest: Manifest = { format: 2, summary, documents, receipts: await this.blobs.put(receipts) };
      await publishJson(this.manifestFile(projectId, id), manifest); return manifest;
    });
  }
  private async manifest(projectId: string, id: string) { return await this.existing(projectId, id) ?? this.migrate(projectId, id); }
  private async rawDocument(ref: string, full: boolean) {
    const doc = await this.blobs.get<StoredDocument>(ref);
    const states = { ...doc.metadata, baseline: doc.baseline ? await this.blobs.get(doc.baseline) : null, proposed: await this.blobs.get(doc.proposed) };
    if (!full) return states;
    const history = doc.history ? { ...await this.blobs.get<object>(doc.history.header),
      snapshots: Object.fromEntries(await Promise.all(Object.entries(doc.history.checkpoints).map(async ([id, ref]) => [id, await this.blobs.get(ref)]))) } : undefined;
    return { ...states, past: await Promise.all(doc.past.map(ref => this.blobs.get(ref))), future: await Promise.all(doc.future.map(ref => this.blobs.get(ref))), ...(history ? { history } : {}) };
  }
  async readPreview(projectId: string, id: string, documentId: string): Promise<ChangeSessionPreview> {
    const manifest = await this.manifest(projectId, id), ref = manifest.documents[changeId.parse(documentId)];
    if (!ref) throw Error('Unknown change-session document');
    let document = this.previews.get(ref);
    if (!document) {
      document = await this.diagrams.restore<ChangePreviewDocument>(await this.rawDocument(ref, false));
      if (document.id !== documentId) throw Error('Change document identity mismatch');
      for (const state of [document.baseline, document.proposed]) if (state) deserializeWorkspace({ schemaVersion: 3, projectId,
        documents: [{ ...state, representationId: document.id, name: document.name, savedName: document.name,
          revisionId: document.savedRevisionId ?? 'session-baseline', savedScene: JSON.stringify(state.document.scene), savedEdges: JSON.stringify(state.document.edges) }] });
      if (this.previews.size >= 16) this.previews.delete(this.previews.keys().next().value!);
      this.previews.set(ref, document);
    }
    return { ...manifest.summary, document: structuredClone(document) };
  }
  async read(projectId: string, id: string): Promise<{ session: DiagramChangeSession; token: string }> {
    const manifest = await this.manifest(projectId, id), documents = [];
    for (const metadata of manifest.summary.documents) {
      const ref = manifest.documents[metadata.id]; let doc = this.validated.get(ref);
      if (!doc) {
        const restored = await this.diagrams.restore<ChangeSessionDocument>(await this.rawDocument(ref, true));
        doc = validateChangeSession({ ...manifest.summary, documents: [restored], receipts: {} }).documents[0];
        if (doc.id !== metadata.id) throw Error('Change document identity mismatch');
        if (this.validated.size >= 16) this.validated.delete(this.validated.keys().next().value!);
        this.validated.set(ref, doc);
      }
      documents.push(structuredClone(doc));
    }
    const refs = await this.blobs.get<Record<string, string>>(manifest.receipts), receipts: DiagramChangeSession['receipts'] = {};
    for (const [key, ref] of Object.entries(refs)) receipts[key] = structuredClone(await this.blobs.get<DiagramChangeSession['receipts'][string]>(ref));
    return { session: { ...manifest.summary, documents, receipts }, token: this.token(manifest) };
  }
  async write(input: SessionWrite): Promise<string> {
    const summary = validateChangeSessionSummary(input.summary), { projectId, id } = summary;
    validateChangeSession({ ...summary, documents: [], receipts: input.receipts });
    // A legacy record must be captured before entering the publication queue.
    let prior = await this.existing(projectId, id);
    if (!prior) {
      try { await stat(path.join(this.directory(projectId), `${id}.json`)); prior = await this.migrate(projectId, id); }
      catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
    }
    return this.serial(projectId, id, async () => {
      const previous = await this.existing(projectId, id);
      if (input.expected !== undefined && (!previous || this.token(previous) !== input.expected)) throw Error('VERSION_CONFLICT: change session was updated');
      const documents = { ...previous?.documents }, receipts = previous ? { ...await this.blobs.get<Record<string, string>>(previous.receipts) } : {};
      for (const doc of input.documents) {
        validateChangeSession({ ...summary, documents: [doc], receipts: {} });
        documents[doc.id] = await this.splitDocument(doc);
      }
      for (const metadata of summary.documents) if (!documents[metadata.id]) throw Error('Incomplete change session');
      for (const key of Object.keys(documents)) if (!summary.documents.some(doc => doc.id === key)) delete documents[key];
      for (const [key, receipt] of Object.entries(input.receipts)) receipts[key] = await this.blobs.put(receipt);
      const manifest: Manifest = { format: 2, summary, documents, receipts: await this.blobs.put(receipts) };
      await publishJson(this.manifestFile(projectId, id), manifest);
      return this.token(manifest);
    });
  }
}
