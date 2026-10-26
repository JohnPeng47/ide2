/** Offline copy/verify/publish migration. Immutable blobs are never overwritten. */
import { cp, access, readFile, writeFile, rename } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { migrateDiagramAlternatives, emptyDiagramAlternatives, validateDiagramAlternatives } from '../../domain/core/presentation/diagramAlternative';
import { validateCanvasHistory, type CanvasHistoryRecord } from '../../domain/core/diagrams/canvasHistory';
import { getDiagramRevision } from '../../domain/core/diagrams/diagramRevisionStore';
import { DiagramPersistence } from '../../domain/core/diagrams/diagramPersistence';
import { DiagramRevisionStore } from '../../infrastructure/core/persistence/diagramRevisionStore';
import { MappingWorkspaceStore } from '../../infrastructure/mapping/persistence/workspace/mappingWorkspaceStore';
import { ChangeSessionRecords } from '../../infrastructure/mapping/changes/changeSessionRecords';
import { summarizeChangeSession, validateChangeSession } from '../../domain/mapping/changes/diagramChangeSession';
import { publishJson } from '../../infrastructure/core/persistence/immutableRecords';
import { fingerprint } from './migrate-diagram-identities';

const exists = (file: string) => access(file).then(() => true, () => false);
const json = async (file: string) => JSON.parse(await readFile(file, 'utf8'));
export function migrateAlternativeHistory(input: CanvasHistoryRecord): CanvasHistoryRecord {
  const result = { ...input, snapshots: Object.fromEntries(Object.entries(input.snapshots).map(([id, snapshot]) => {
    const document = migrateDiagramAlternatives(snapshot.document, id => input.diagramRevisions[id], snapshot.diagramBindings);
    return [id, { ...snapshot, document: { ...document, alternatives: document.alternatives ?? emptyDiagramAlternatives() } }];
  })) };
  validateCanvasHistory(result);
  return result;
}
/** Transform complete histories as units so every snapshot uses its own pinned bindings. */
export function migrateAlternativeRecords<T>(value: T): T {
  const visit = (value: any): any => {
    if (!value || typeof value !== 'object') return value;
    if (Array.isArray(value)) return value.map(visit);
    if (value.schemaVersion === 1 && value.contextId && value.snapshots && value.diagramRevisions) return migrateAlternativeHistory(value);
    if (value.content?.ascii !== undefined && value.sourceContext || value.sourceRanges && value.category) return value;
    if (value.scene?.root && value.scene?.contents && Array.isArray(value.edges)) {
      const bindings = Object.fromEntries(Object.entries(value.scene.contents).map(([key, diagram]: [string, any]) => [key, diagram.revisionId]));
      const document = migrateDiagramAlternatives(value, getDiagramRevision, bindings);
      return { ...document, alternatives: document.alternatives ?? emptyDiagramAlternatives() };
    }
    return Object.fromEntries(Object.entries(value).map(([key, child]) => [key, visit(child)]));
  };
  return visit(value);
}
export async function prepareAlternativeMigration(source: string, target: string) {
  source = path.resolve(source); target = path.resolve(target);
  if (source === target || target.startsWith(source + path.sep) || source.startsWith(target + path.sep)) throw Error('Stage must be outside the source directory');
  if (await exists(target)) throw Error('Stage already exists');
  const sourceFingerprint = await fingerprint(source);
  await cp(source, target, { recursive: true, errorOnExist: true, force: false });
  if (await fingerprint(source) !== sourceFingerprint || await fingerprint(target) !== sourceFingerprint) throw Error('Source changed during copy; pause application writes and retry');
  const project = await json(path.join(target, 'project.json'));
  const persistence = new DiagramPersistence(new DiagramRevisionStore(target));
  let catalogs = 0;
  for (const file of ['canvases/catalog.json', 'representations/catalog.json', 'mapping-workspace.json']) {
    const destination = path.join(target, file);
    if (!await exists(destination)) continue;
    const value = await persistence.restore(await json(destination));
    await publishJson(destination, await persistence.persist(migrateAlternativeRecords(value)));
    catalogs++;
  }
  const workspaceStore = new MappingWorkspaceStore(target);
  const workspace = await workspaceStore.load(project.id);
  if (workspace) await workspaceStore.save(project.id, migrateAlternativeRecords(workspace));
  const sessions = new ChangeSessionRecords(target), summaries = await sessions.listSummaries(project.id);
  for (const summary of summaries) {
    const { session, token } = await sessions.read(project.id, summary.id);
    const migrated = migrateAlternativeRecords(session);
    validateChangeSession(migrated);
    await sessions.write({ summary: summarizeChangeSession(migrated), documents: migrated.documents, receipts: migrated.receipts, diffTree: migrated.diffTree, expected: token });
  }
  const report = { source, target, sourceFingerprint, schemaVersion: 1, catalogs, workspaceDocuments: workspace?.documents.length ?? 0, changeSessions: summaries.length };
  await writeFile(target + '.alternatives-migration.json', JSON.stringify(report, null, 2) + '\n');
  return report;
}
export async function verifyAlternativeMigration(target: string) {
  target = path.resolve(target);
  const report = await json(target + '.alternatives-migration.json'), project = await json(path.join(target, 'project.json'));
  const persistence = new DiagramPersistence(new DiagramRevisionStore(target));
  let checkpoints = 0;
  const verify = (value: any) => {
    if (!value || typeof value !== 'object') return;
    if (value.contextId && value.snapshots && value.diagramRevisions) {
      validateCanvasHistory(value);
      for (const snapshot of Object.values(value.snapshots) as CanvasHistoryRecord['snapshots'][string][]) {
        if (!snapshot.document.alternatives) throw Error('Unmigrated canvas checkpoint');
        validateDiagramAlternatives(snapshot.document.alternatives, id => value.diagramRevisions[id]); checkpoints++;
      }
      return;
    }
    if (value.content?.ascii !== undefined && value.sourceContext || value.sourceRanges && value.category) return;
    for (const child of Object.values(value)) verify(child);
  };
  for (const file of ['canvases/catalog.json', 'representations/catalog.json', 'mapping-workspace.json']) {
    if (await exists(path.join(target, file))) verify(await persistence.restore(await json(path.join(target, file))));
  }
  verify(await new MappingWorkspaceStore(target).load(project.id));
  const sessions = new ChangeSessionRecords(target);
  for (const summary of await sessions.listSummaries(project.id)) verify((await sessions.read(project.id, summary.id)).session);
  const result = { ...report, checkpoints, verifiedFingerprint: await fingerprint(target) };
  await writeFile(target + '.alternatives-migration.json', JSON.stringify(result, null, 2) + '\n');
  return result;
}
export async function publishAlternativeMigration(target: string) {
  target = path.resolve(target);
  const report = await json(target + '.alternatives-migration.json');
  if (report.target !== target || !report.verifiedFingerprint || await fingerprint(target) !== report.verifiedFingerprint) throw Error('Stage must pass verification before publication');
  if (await fingerprint(report.source) !== report.sourceFingerprint) throw Error('Source changed since preparation; stop application writes and prepare again');
  const backup = report.source + '.before-alternatives-' + Date.now();
  await rename(report.source, backup);
  try { await rename(target, report.source); }
  catch (error) { await rename(backup, report.source); throw error; }
  return { source: report.source, backup };
}
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const [command, source, target] = process.argv.slice(2);
  const result = command === 'prepare' && source && target ? await prepareAlternativeMigration(source, target)
    : command === 'verify' && source ? await verifyAlternativeMigration(source)
    : command === 'publish' && source ? await publishAlternativeMigration(source) : undefined;
  if (!result) throw Error('Usage: tsx scripts/migrations/migrate-diagram-alternatives.ts prepare <source> <stage> | verify <stage> | publish <stage>. Stop the application before publishing.');
  console.log(JSON.stringify(result, null, 2));
}
