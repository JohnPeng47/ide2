import { diffTreeSummary, diffTreeSummarySchema, validateDiffTree, type ChangeSessionDiffTree, type DiffTreeSummary } from './diffTree';
import { repositoryContextSchema } from '../../core/repositories/repository';
import { CanvasHistory, validateCanvasHistory, type CanvasHistoryRecord } from '../workspace/canvasHistory';
import { z } from 'zod';
import { diagramMigrationSchema, type DiagramMigration } from './diagramMigration';
import type { MappingGridDocument } from '../workspace/mappingGrid';
import type { MappingCanvasState } from '../workspace/mappingWorkspace';
import { deserializeWorkspace } from '../workspace/mappingWorkspaceCodec';
import type { ChangeSessionAcceptance } from '../../core/representations/changeAcceptance';

export const changeId = z.string().min(1).max(200).regex(/^[a-zA-Z0-9_.:-]+$/).refine(id => !['__proto__','constructor','prototype'].includes(id));
export const diagramChangeSchema = z.object({
  id: changeId, title: z.string().trim().min(1).max(200), type: z.union([z.literal(1), z.literal(2), z.literal(3), z.literal(4)]),
  reasons: z.array(z.enum(['1a', '1b'])).default([]), documentId: changeId, nodeId: changeId.optional(),
  dependsOn: z.array(changeId).max(100).default([])
}).strict();
export type DiagramChange = z.infer<typeof diagramChangeSchema>;
export interface ChangeDocumentState { nodeOrigins?: Record<string, string>; document: MappingGridDocument; canvas: MappingCanvasState }
export interface ChangeSessionDocument {
  repositoryId?: string;
  history?: CanvasHistoryRecord;
  id: string; name: string; representationId?: string; savedRevisionId?: string; capturedVersion?: number;
  baseline: ChangeDocumentState | null;
  proposed: ChangeDocumentState;
  version: number;
  past: ChangeDocumentState[];
  future: ChangeDocumentState[];
}
export interface DiagramChangeSession {
  /** Absent on legacy sessions whose historical Git context is unknown. */
  repositoryId?: string; commits?: string[]; head?: string;
  diffTree?: ChangeSessionDiffTree;
  schemaVersion: 1; id: string; projectId: string; title: string; description: string;
  status: 'draft' | 'ready' | 'accepted' | 'archived'; version: number; createdAt: string; updatedAt: string;
  acceptance?: ChangeSessionAcceptance;
  documents: ChangeSessionDocument[]; changes: DiagramChange[]; migrations?: DiagramMigration[];
  receipts: Record<string, { signature: string; result: unknown }>;
}
export type ChangeSessionSummary = Omit<DiagramChangeSession, 'documents' | 'receipts' | 'diffTree'> & {
  diffTree?: DiffTreeSummary;
  documents: Pick<ChangeSessionDocument, 'id' | 'name' | 'representationId' | 'repositoryId' | 'version'>[];
};
export type ChangePreviewDocument = Omit<ChangeSessionDocument, 'history' | 'past' | 'future'>;
export type ChangeSessionPreview = ChangeSessionSummary & { document: ChangePreviewDocument };
const checkpoint = z.object({ revisionId: changeId, checkpointId: changeId }).strict();
const acceptance = z.object({ changeSessionId: changeId, sessionVersion: z.number().int().nonnegative(), requestId: z.string().min(1),
  acceptedAt: z.string(), changeIds: z.array(changeId), documents: z.array(z.object({ documentId: changeId, representationId: changeId,
    before: checkpoint.nullable(), after: checkpoint, proposedCheckpointId: changeId }).strict()) }).strict();
/** Read list metadata without restoring document references, histories, or replay receipts. */
export function validateChangeSessionSummary(input: unknown): ChangeSessionSummary {
  const summary = z.object({
    diffTree: diffTreeSummarySchema.optional(),
    repositoryId: changeId.optional(), commits: repositoryContextSchema.shape.commits.optional(), head: repositoryContextSchema.shape.head.optional(),
    schemaVersion: z.literal(1), id: changeId, projectId: changeId, title: z.string().min(1).max(200), description: z.string().max(100000),
    status: z.enum(['draft', 'ready', 'accepted', 'archived']), acceptance: acceptance.optional(),
    version: z.number().int().nonnegative(), createdAt: z.string(), updatedAt: z.string(),
    changes: z.array(diagramChangeSchema).max(2000), migrations: z.array(diagramMigrationSchema).max(1000).default([]),
    documents: z.array(z.object({ id: changeId, name: z.string().min(1).max(200), repositoryId: changeId.optional(), representationId: changeId.optional(),
      version: z.number().int().nonnegative() })).max(100)
  }).parse(input);
  validateRepositoryContext(summary);
  if ((summary.status === 'accepted') !== !!summary.acceptance || summary.acceptance && summary.acceptance.changeSessionId !== summary.id)
    throw new Error('Invalid change-session acceptance');
  if (new Set(summary.documents.map(doc => doc.id)).size !== summary.documents.length) throw new Error('Duplicate change-session document');
  return summary;
}
export function summarizeChangeSession(session: DiagramChangeSession): ChangeSessionSummary {
  const { receipts: _, documents, diffTree, ...summary } = session;
  return { ...summary, ...(diffTree ? { diffTree: diffTreeSummary(diffTree) } : {}), documents: documents.map(({ id, name, representationId, repositoryId, version }) => ({ id, name, representationId, repositoryId, version })) };
}
export function validateChangeSession(input: unknown): DiagramChangeSession {
  const state = z.custom<ChangeDocumentState>(value => !!value && typeof value === 'object' && 'document' in value && 'canvas' in value);
  const parsed = z.object({
    diffTree: z.custom<ChangeSessionDiffTree>().optional(),
    repositoryId: changeId.optional(), commits: repositoryContextSchema.shape.commits.optional(), head: repositoryContextSchema.shape.head.optional(),
    schemaVersion: z.literal(1), id: changeId, projectId: changeId, title: z.string().min(1).max(200), description: z.string().max(100000),
    status: z.enum(['draft','ready','accepted','archived']), acceptance: acceptance.optional(), version: z.number().int().nonnegative(), createdAt: z.string(), updatedAt: z.string(),
    documents: z.array(z.object({ history: z.custom<CanvasHistoryRecord>().optional(), id: changeId, name: z.string().min(1).max(200), repositoryId: changeId.optional(), representationId: changeId.optional(), savedRevisionId: changeId.optional(),
      capturedVersion: z.number().int().nonnegative().optional(), baseline: state.nullable(), proposed: state, version: z.number().int().nonnegative(),
      past: z.array(state).max(50), future: z.array(state).max(50) }).strict()).max(100),
    changes: z.array(diagramChangeSchema).max(2000), migrations: z.array(diagramMigrationSchema).max(1000).default([]),
    receipts: z.record(z.string(), z.object({ signature: z.string(), result: z.unknown() }))
  }).strict().parse(input);
  validateRepositoryContext(parsed);
  if (parsed.diffTree) {
    validateDiffTree(parsed.diffTree);
    if (!parsed.repositoryId || parsed.diffTree.hunks.some(hunk => hunk.repositoryId !== parsed.repositoryId || !parsed.commits?.includes(hunk.commit)))
      throw Error('DiffTree hunks belong to another repository or commit selection');
  }
  if ((parsed.status === 'accepted') !== !!parsed.acceptance || parsed.acceptance && parsed.acceptance.changeSessionId !== parsed.id)
    throw new Error('Invalid change-session acceptance');
  const ids = new Set<string>();
  for (const doc of parsed.documents) {
    if (ids.has(doc.id)) throw new Error('Duplicate change-session document');
    ids.add(doc.id);
    if (doc.history) { validateCanvasHistory(doc.history); new CanvasHistory(doc.proposed.document, doc.proposed.canvas, doc.history); }
    for (const snapshot of [doc.baseline, doc.proposed, ...doc.past, ...doc.future]) if (snapshot) {
      deserializeWorkspace({ schemaVersion: 3, projectId: parsed.projectId, documents: [{ representationId: doc.id,
        name: doc.name, savedName: doc.name, revisionId: doc.savedRevisionId ?? 'session-baseline', savedScene: JSON.stringify(snapshot.document.scene),
        savedEdges: JSON.stringify(snapshot.document.edges), ...snapshot }] });
    }
  }
  return parsed;
}

function validateRepositoryContext(session: { repositoryId?: string; commits?: string[]; head?: string }) {
  if (session.repositoryId !== undefined || session.commits !== undefined || session.head !== undefined)
    repositoryContextSchema.parse({ repositoryId: session.repositoryId, commits: session.commits, head: session.head });
}
