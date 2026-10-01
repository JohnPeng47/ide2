/** Offline, explicit migration. Never imported by the application or used as a read fallback. */
import { createHash } from 'node:crypto';
import { cp, readFile, readdir, rename, writeFile, access } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { CanvasHistory, documentFromHistory, stateKey, validateCanvasHistory } from '../../domain/core/diagrams/canvasHistory';
import { validateDiagram } from '../../domain/core/diagrams/diagram';
import { diagramContentNodes } from '../../domain/core/diagrams/diagramContentNodes';
import { diagramRevisions } from '../../domain/core/diagrams/internal/revisionRegistry';
import { DiagramPersistence } from '../../domain/core/diagrams/diagramPersistence';
import { DiagramRevisionStore } from '../../infrastructure/core/persistence/diagramRevisionStore';
import { ImmutableRecords, publishJson } from '../../infrastructure/core/persistence/immutableRecords';
import { validateChangeSession } from '../../domain/mapping/changes/diagramChangeSession';
import { deserializeWorkspace } from '../../domain/mapping/workspace/mappingWorkspaceCodec';
import { recordHistory, validateRecordUpdate } from '../../domain/mapping/workspace/workspaceRecords';
import { CanvasCatalogStore } from '../../infrastructure/core/persistence/canvasCatalogStore';
import { MappingWorkspaceStore } from '../../infrastructure/mapping/persistence/workspace/mappingWorkspaceStore';
import { ChangeSessionRecords } from '../../infrastructure/mapping/changes/changeSessionRecords';
import { DIAGRAM_STORAGE_VERSION } from '../../infrastructure/core/persistence/diagramStorageFormat';

const hash = (value: string) => createHash('sha256').update(value).digest('hex');
const object = (v: any) => v && typeof v === 'object' && !Array.isArray(v);
const diagram = (v: any) => object(v) && typeof v.id === 'string' && v.content?.ascii !== undefined && v.sourceContext;
const history = (v: any) => object(v) && v.contextId && v.snapshots && v.diagramRevisions;
const signature = (v: any) => { const { diagramId: _, revisionId: __, ...payload } = v; return hash(stateKey(payload)); };
const exists = async (file: string) => access(file).then(() => true, () => false);
const json = async (file: string) => JSON.parse(await readFile(file, 'utf8'));

export class IdentityMigration {
  private revisions = new Map<string, any>();
  private upgraded = new Map<string, any>();
  private visiting = new Set<string>();
  private signatures = new WeakMap<object, string>();
  private key(v: any): string { if (!this.signatures.has(v)) this.signatures.set(v, signature(v)); return this.signatures.get(v)!; }
  collect(v: any): void {
    if (!object(v) && !Array.isArray(v)) return;
    if (v.id?.startsWith('diagram-revision-') && diagram(v.diagram) && v.nodeRefs) {
      const prior = this.revisions.get(v.id);
      if (prior && stateKey(prior) !== stateKey(v)) throw Error(`Conflicting stored revision: ${v.id}`);
      this.revisions.set(v.id, v); return;
    }
    if (diagram(v) || (v.sourceRanges && v.category)) return;
    for (const child of Object.values(v)) this.collect(child);
  }
  revision(old: any): any {
    if (this.upgraded.has(old.id)) return this.upgraded.get(old.id);
    if (this.visiting.has(old.id)) throw Error(`Cyclic revision ancestry: ${old.id}`);
    this.visiting.add(old.id);
    const parent = old.parentId ? this.revisions.get(old.parentId) : undefined;
    if (old.parentId && !parent) throw Error(`Missing revision parent: ${old.parentId}`);
    const diagramId = old.diagram.diagramId ?? (parent ? this.revision(parent).diagramId : `diagram-${hash(old.id)}`);
    const next = { ...old, diagramId, diagram: { ...old.diagram, diagramId, revisionId: old.id } };
    validateDiagram(next.diagram); diagramRevisions.register(next);
    this.visiting.delete(old.id); this.upgraded.set(old.id, next); return next;
  }
  upgradeHistory(old: any): any {
    const next = { ...old, diagramRevisions: Object.fromEntries(Object.entries(old.diagramRevisions).map(([id, r]) => [id, this.revision(r)])) };
    validateCanvasHistory(next); return next;
  }
  private upgradeDiagram(old: any, scope: string, candidates: any[]): any {
    if (old.diagramId && old.revisionId) { validateDiagram(old); return old; }
    const match = candidates.find(r => r.diagram.id === old.id && this.key(r.diagram) === this.key(old));
    if (match) return match.diagram;
    // Unversioned snapshots have no authoritative revision ID. Scope identities to
    // their owner; identical text in unrelated canvases must never merge entities.
    const diagramId = `diagram-${hash(scope + '/' + old.id)}`;
    const revisionId = `diagram-revision-${hash(diagramId + '/' + this.key(old))}`;
    const next = { ...old, diagramId, revisionId };
    validateDiagram(next);
    diagramRevisions.register({ id: revisionId, diagramId, diagram: next,
      nodeRefs: Object.fromEntries(diagramContentNodes(next.content).map(n => [n.id, `node-${hash(revisionId + '/' + n.id)}`])) });
    return next;
  }
  transform(v: any, scope: string, candidates: any[] = []): any {
    if (!v || typeof v !== 'object') return v;
    if (diagram(v)) return this.upgradeDiagram(v, scope, candidates);
    if (history(v)) return this.upgradeHistory(v);
    if (v.sourceRanges && v.category) return v;
    if (Array.isArray(v)) return v.map(x => this.transform(x, scope, candidates));
    return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, k === 'savedScene' && typeof x === 'string'
      ? JSON.stringify(this.transform(JSON.parse(x), scope, candidates)) : this.transform(x, scope, candidates)]));
  }
  private candidates(h: any, snapshotId = h.headId): any[] {
    return [...Object.values(h.snapshots[snapshotId].diagramBindings).map((id: any) => h.diagramRevisions[id]), ...Object.values(h.diagramRevisions)];
  }
  document(old: any, scope: string): any {
    if (!old.history) {
      const next = this.transform(old, scope);
      if (next.document && next.canvas) next.history = new CanvasHistory(next.document, next.canvas).export();
      return next;
    }
    const h = this.upgradeHistory(old.history);
    const next = this.transform(old, scope, this.candidates(h));
    next.history = h;
    // Proposed/current state must resolve to precisely its existing checkpoint.
    if (next.proposed) next.proposed = this.transform(old.proposed, scope, this.candidates(h));
    if (next.baseline) next.baseline = this.transform(old.baseline, scope, this.candidates(h, h.baselineId));
    return next;
  }
  session(old: any): any {
    const next = { ...old, documents: old.documents.map((d: any) => {
      const doc = this.document(d, `session/${old.id}/${d.id}`);
      if (!doc.history) {
        // Preserve the old undo/redo stacks, including a baseline distinct from
        // the undo stack. Future is stored in pop order.
        const initial = doc.baseline ?? doc.past[0] ?? doc.proposed;
        const h = new CanvasHistory(initial.document, initial.canvas);
        const baselineId = h.headId;
        const checkpoint = (s: any) => h.append(s.document, s.canvas).id;
        const past = doc.past.map(checkpoint), headId = checkpoint(doc.proposed);
        const future = [...doc.future].reverse().map(checkpoint).reverse();
        doc.history = { ...h.export(), baselineId, headId, past, future };
        // Preserve the correspondence already captured by the legacy proposal.
        for (const [id, s] of [[baselineId, initial], ...past.map((id: string, i: number) => [id, doc.past[i]]),
          [headId, doc.proposed], ...future.map((id: string, i: number) => [id, doc.future[i]])] as any[])
          if (s.nodeOrigins) doc.history.snapshots[id].nodeOrigins = structuredClone(s.nodeOrigins);
      }
      return doc;
    }), receipts: this.transform(old.receipts, `session/${old.id}/receipts`) };
    validateChangeSession(next); return next;
  }
  catalog(old: any): any {
    return { ...old, revisions: Object.fromEntries(Object.entries(old.revisions).map(([id, raw]) => {
      const r = raw as any;
      if (r.content?.kind === 'canvas-history') return [id, { ...r, content: { kind: 'canvas-history', history: this.upgradeHistory(r.content.history) } }];
      if (r.content?.kind !== 'mapping-canvas') throw Error(`Unsupported catalog content in ${id}: ${r.content?.kind}`);
      const document = this.transform({ scene: r.content.scene, edges: r.content.edges ?? [], sections: r.content.sections ?? {},
        ...(r.content.jumps ? { jumps: r.content.jumps } : {}) }, `catalog/${r.representationId}`);
      const h = new CanvasHistory(document, {});
      return [id, { ...r, content: { kind: 'canvas-history', history: h.export() } }];
    })) };
  }
}

/** Decode old storage envelopes without invoking the new domain validator. Hashes
 * are still verified before consuming a record. The migration owns this adapter. */
export function legacyReader(root: string) {
  const store = new DiagramRevisionStore(root);
  const cache = new Map<string, Promise<any>>();
  const expand = async (v: any): Promise<any> => {
    if (!v || typeof v !== 'object') return v;
    if (diagram(v) || (v.sourceRanges && v.category)) return v;
    if (v.$diagramRecord) {
      const key = v.$diagramRecord + ':' + v.id;
      if (!cache.has(key)) cache.set(key, store.get(v.$diagramRecord, v.id).then(expand));
      return cache.get(key);
    }
    if (v.diagramHistory) {
      const table = await expand(v.diagramHistory);
      const { diagramHistory: _, ...rest } = v;
      return { ...rest, diagramRevisions: table.revisions, snapshots: Object.fromEntries(await Promise.all(Object.entries(v.snapshots).map(async ([id, raw]) => {
        const { diagramCheckpointId, ...s } = raw as any;
        if (diagramCheckpointId !== id || !table.bindings[id]) throw Error('Invalid stored checkpoint');
        return [id, { ...await expand(s), diagramBindings: table.bindings[id] }];
      }))) };
    }
    if (Array.isArray(v)) return Promise.all(v.map(expand));
    return Object.fromEntries(await Promise.all(Object.entries(v).map(async ([k, x]) => [k, await expand(x)])));
  };
  return expand;
}

async function files(root: string, sub = ''): Promise<string[]> {
  const out: string[] = [];
  for (const entry of await readdir(path.join(root, sub), { withFileTypes: true })) {
    const name = path.join(sub, entry.name);
    if (entry.isDirectory()) out.push(...await files(root, name));
    else if (entry.isFile() && name.endsWith('.json')) out.push(name);
  }
  return out.sort();
}
export async function fingerprint(root: string) {
  const h = createHash('sha256');
  for (const name of await files(root)) { h.update(name); h.update(await readFile(path.join(root, name))); }
  return h.digest('hex');
}

export async function prepareMigration(source: string, target: string) {
  source = path.resolve(source); target = path.resolve(target);
  if (target === source || target.startsWith(source + path.sep)) throw Error('Stage must be outside the source directory');
  if (await exists(target)) throw Error('Stage already exists');
  if (await exists(path.join(source, 'diagram-storage-format.json'))) {
    const format = await json(path.join(source, 'diagram-storage-format.json'));
    if (format.version === 2) return { alreadyMigrated: true };
    throw Error(`Unsupported storage version: ${format.version}`);
  }
  const before = await fingerprint(source);
  await cp(source, target, { recursive: true, errorOnExist: true, force: false });
  if (await fingerprint(source) !== before || await fingerprint(target) !== before) throw Error('Source changed during copy; retry with app writes paused');
  const expand = legacyReader(target), migration = new IdentityMigration();
  const roots = new Map<string, any>();
  for (const name of ['canvases/catalog.json', 'representations/catalog.json', 'mapping-workspace.json']) {
    if (await exists(path.join(target, name))) roots.set(name, await expand(await json(path.join(target, name))));
  }
  const workspaceFile = path.join(target, 'workspace-records.json');
  const workspace = await exists(workspaceFile) ? await json(workspaceFile) : undefined;
  const workspaceBlobs = new ImmutableRecords(path.join(target, 'workspace-records'));
  const records: any = workspace ? Object.fromEntries(await Promise.all(Object.entries(workspace.records).map(async ([key, id]) => [key, await workspaceBlobs.get(id as string)]))) : undefined;
  const sessions: { file: string; session: any; manifest?: any }[] = [];
  const sessionBlobs = new ImmutableRecords(path.join(target, 'change-session-records'));
  for (const file of (await files(target)).filter(n => n.startsWith('mapping-change-sessions/') && !n.endsWith('.summary.json'))) {
    const raw = await json(path.join(target, file));
    if (!file.endsWith('.manifest.json')) { sessions.push({ file, session: await expand(raw) }); continue; }
    const documents = [];
    for (const ref of Object.values(raw.documents)) {
      const d: any = await sessionBlobs.get(ref as string);
      const h: any = d.history ? { ...await sessionBlobs.get<any>(d.history.header), snapshots: Object.fromEntries(await Promise.all(Object.entries(d.history.checkpoints).map(async ([id, ref]) => [id, await sessionBlobs.get(ref as string)]))) } : undefined;
      documents.push(await expand({ ...d.metadata, baseline: d.baseline ? await sessionBlobs.get(d.baseline) : null,
        proposed: await sessionBlobs.get(d.proposed), past: await Promise.all(d.past.map((ref: string) => sessionBlobs.get(ref))), future: await Promise.all(d.future.map((ref: string) => sessionBlobs.get(ref))), ...(h ? { history: h } : {}) }));
    }
    const receiptRefs: any = await sessionBlobs.get(raw.receipts);
    const receipts = await expand(Object.fromEntries(await Promise.all(Object.entries(receiptRefs).map(async ([key, ref]) => [key, await sessionBlobs.get(ref as string)]))));
    sessions.push({ file, manifest: raw, session: { ...raw.summary, documents, receipts } });
  }
  for (const v of [...roots.values(), records, ...sessions.map(s => s.session)]) migration.collect(v);
  const persistence = new DiagramPersistence(new DiagramRevisionStore(target));
  const report: any = { source, target, sourceFingerprint: before, version: 2, catalogs: 0, workspaceCheckpoints: 0, sessions: 0 };
  for (const [file, old] of roots) {
    let next;
    if (file.endsWith('catalog.json')) { next = migration.catalog(old); report.catalogs++; }
    else {
      next = { ...old, documents: old.documents.map((doc: any) => migration.document(doc, `workspace/${doc.representationId}`)) };
      deserializeWorkspace(next);
    }
    await publishJson(path.join(target, file), await persistence.persist(next));
  }
  if (workspace) {
    const next = { ...records };
    for (const id of records.workspace.documentIds) {
      const prefix = `document/${encodeURIComponent(id)}/`, h = migration.upgradeHistory(recordHistory(records, id));
      const candidates = [...Object.values(h.snapshots[h.headId].diagramBindings).map((id: any) => h.diagramRevisions[id]), ...Object.values(h.diagramRevisions)];
      for (const key of Object.keys(records).filter(k => k.startsWith(prefix))) {
        next[key] = key.startsWith(prefix + 'revision/') ? h.diagramRevisions[key.slice((prefix + 'revision/').length)] : migration.transform(records[key], `workspace/${id}`, candidates);
      }
      report.workspaceCheckpoints += Object.keys(h.snapshots).length;
    }
    validateRecordUpdate(next, Object.keys(next), workspace.projectId);
    const refs = Object.fromEntries(await Promise.all(Object.entries(next).map(async ([key, value]) => [key, await workspaceBlobs.put(value)])));
    await publishJson(workspaceFile, { ...workspace, revision: workspace.revision + 1, records: refs });
  }
  for (const entry of sessions) {
    const migrated = migration.session(entry.session);
    const saved: any = await persistence.persist(migrated);
    if (!entry.manifest) await publishJson(path.join(target, entry.file), saved);
    else {
      const documents: Record<string, string> = {};
      for (const doc of saved.documents) {
        const { baseline, proposed, past, future, history: h, ...metadata } = doc;
        const { snapshots, ...header } = h;
        documents[doc.id] = await sessionBlobs.put({ metadata, baseline: baseline ? await sessionBlobs.put(baseline) : null,
          proposed: await sessionBlobs.put(proposed), past: await Promise.all(past.map((s: any) => sessionBlobs.put(s))), future: await Promise.all(future.map((s: any) => sessionBlobs.put(s))),
          history: { header: await sessionBlobs.put(header), checkpoints: Object.fromEntries(await Promise.all(Object.entries(snapshots).map(async ([id, s]) => [id, await sessionBlobs.put(s)]))) } });
      }
      const receipts = await sessionBlobs.put(Object.fromEntries(await Promise.all(Object.entries(saved.receipts).map(async ([key, value]) => [key, await sessionBlobs.put(value)]))));
      await publishJson(path.join(target, entry.file), { ...entry.manifest, documents, receipts });
    }
    report.sessions++;
  }
  await publishJson(path.join(target, 'diagram-storage-format.json'), { version: DIAGRAM_STORAGE_VERSION });
  // Report is outside the data directory so it is not part of the store itself.
  await writeFile(target + '.migration.json', JSON.stringify(report, null, 2) + '\n');
  return report;
}

/** Read with the production adapters in a fresh process before publishing. */
export async function verifyMigration(root: string) {
  root = path.resolve(root);
  const project = await json(path.join(root, 'project.json'));
  const catalog = await new CanvasCatalogStore(root).loadRepresentationCatalog(project.id);
  for (const revision of Object.values(catalog.revisions)) {
    if (revision.content?.kind !== 'canvas-history') throw Error('Migration left unsupported catalog content');
    validateCanvasHistory(revision.content.history);
  }
  const workspace = await new MappingWorkspaceStore(root).load(project.id);
  if (workspace) deserializeWorkspace(workspace);
  const sessions = new ChangeSessionRecords(root);
  const summaries = await sessions.listSummaries(project.id);
  for (const summary of summaries) {
    const { session } = await sessions.read(project.id, summary.id);
    validateChangeSession(session);
    for (const document of session.documents) await sessions.readPreview(project.id, summary.id, document.id);
  }
  const result = { canvases: Object.keys(catalog.representations).length, savedRevisions: Object.keys(catalog.revisions).length,
    workspaceDocuments: workspace?.documents.length ?? 0, changeSessions: summaries.length };
  const report = await json(root + '.migration.json');
  await writeFile(root + '.migration.json', JSON.stringify({ ...report, verification: result, verifiedFingerprint: await fingerprint(root) }, null, 2) + '\n');
  return result;
}

export async function publishMigration(target: string) {
  target = path.resolve(target);
  const report = await json(target + '.migration.json');
  if (!report.verifiedFingerprint || await fingerprint(target) !== report.verifiedFingerprint) throw Error('Stage must pass verification before publishing');
  if (report.target !== target || await fingerprint(report.source) !== report.sourceFingerprint) throw Error('Source changed after preparation; migration not published');
  const backup = report.source + '.before-diagram-identities-' + Date.now();
  await rename(report.source, backup);
  try { await rename(target, report.source); }
  catch (error) { await rename(backup, report.source); throw error; }
  return { backup, source: report.source };
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const [command, source, target] = process.argv.slice(2);
  if (command === 'prepare' && source && target) console.log(JSON.stringify(await prepareMigration(source, target), null, 2));
  else if (command === 'verify' && source) console.log(JSON.stringify(await verifyMigration(source), null, 2));
  else if (command === 'publish' && source) console.log(JSON.stringify(await publishMigration(source), null, 2));
  else throw Error('Usage: tsx scripts/migrations/migrate-diagram-identities.ts prepare <source> <stage> | verify <stage> | publish <stage> (stop app before publishing)');
}
