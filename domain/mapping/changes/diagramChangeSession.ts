import { CanvasHistory, validateCanvasHistory, type CanvasHistoryRecord } from '../workspace/canvasHistory';
import { z } from 'zod';
import type { MappingGridDocument } from '../workspace/mappingGrid';
import type { MappingCanvasState } from '../workspace/mappingWorkspace';
import { deserializeWorkspace } from '../workspace/mappingWorkspaceCodec';

export const changeId = z.string().min(1).max(200).regex(/^[a-zA-Z0-9_.:-]+$/).refine(id => !['__proto__','constructor','prototype'].includes(id));
export const diagramChangeSchema = z.object({
  id: changeId, title: z.string().trim().min(1).max(200), type: z.union([z.literal(1), z.literal(2), z.literal(3), z.literal(4)]),
  reasons: z.array(z.enum(['1a', '1b'])).default([]), documentId: changeId, nodeId: changeId.optional(),
  dependsOn: z.array(changeId).max(100).default([])
}).strict();
export type DiagramChange = z.infer<typeof diagramChangeSchema>;
export interface ChangeDocumentState { nodeOrigins?: Record<string, string>; document: MappingGridDocument; canvas: MappingCanvasState }
export interface ChangeSessionDocument {
  history?: CanvasHistoryRecord;
  id: string; name: string; representationId?: string; savedRevisionId?: string; capturedVersion?: number;
  baseline: ChangeDocumentState | null;
  proposed: ChangeDocumentState;
  version: number;
  past: ChangeDocumentState[];
  future: ChangeDocumentState[];
}
export interface DiagramChangeSession {
  schemaVersion: 1; id: string; projectId: string; title: string; description: string;
  status: 'draft' | 'ready' | 'archived'; version: number; createdAt: string; updatedAt: string;
  documents: ChangeSessionDocument[]; changes: DiagramChange[];
  receipts: Record<string, { signature: string; result: unknown }>;
}
export type ChangeSessionSummary = Omit<DiagramChangeSession, 'documents' | 'receipts'> & {
  documents: Pick<ChangeSessionDocument, 'id' | 'name' | 'representationId' | 'version'>[];
};
export function summarizeChangeSession(session: DiagramChangeSession): ChangeSessionSummary {
  const { receipts: _, documents, ...summary } = session;
  return { ...summary, documents: documents.map(({ id, name, representationId, version }) => ({ id, name, representationId, version })) };
}
export function validateChangeSession(input: unknown): DiagramChangeSession {
  const state = z.custom<ChangeDocumentState>(value => !!value && typeof value === 'object' && 'document' in value && 'canvas' in value);
  const parsed = z.object({
    schemaVersion: z.literal(1), id: changeId, projectId: changeId, title: z.string().min(1).max(200), description: z.string().max(100000),
    status: z.enum(['draft','ready','archived']), version: z.number().int().nonnegative(), createdAt: z.string(), updatedAt: z.string(),
    documents: z.array(z.object({ history: z.custom<CanvasHistoryRecord>().optional(), id: changeId, name: z.string().min(1).max(200), representationId: changeId.optional(), savedRevisionId: changeId.optional(),
      capturedVersion: z.number().int().nonnegative().optional(), baseline: state.nullable(), proposed: state, version: z.number().int().nonnegative(),
      past: z.array(state).max(50), future: z.array(state).max(50) }).strict()).max(100),
    changes: z.array(diagramChangeSchema).max(2000),
    receipts: z.record(z.string(), z.object({ signature: z.string(), result: z.unknown() }))
  }).strict().parse(input);
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
