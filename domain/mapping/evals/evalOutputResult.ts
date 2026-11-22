import { placementSnapshot, type PlacementSnapshot } from '../../core/diagrams/diagramPlacement';
import { summarizeChangeSession, validateChangeSession, type ChangePreviewDocument, type ChangeSessionSummary, type DiagramChangeSession } from '../changes/diagramChangeSession';
import { CanvasHistory } from '../../core/diagrams/canvasHistory';
import type { DiagramRevision } from '../../core/diagrams/diagramRevision';
import { z } from 'zod';
import { canvasLayoutSchema, type CanvasLayout } from './canvasLayout';

export const captureEvalOutputSchema = z.union([
  z.object({ cellKey: z.string().min(1).max(300), format: z.literal('canvas-layout'), layout: canvasLayoutSchema }).strict(),
  z.object({ cellKey: z.string().min(1).max(300), changeSessionId: z.string().min(1).max(200), expectedVersion: z.number().int().nonnegative() }).strict(),
  z.object({ cellKey: z.string().min(1).max(300), format: z.literal('markdown'),
    markdown: z.string().max(1_000_000).refine(text => text.trim().length > 0, 'Markdown output must not be empty.') }).strict()
]);

interface NonCanvasOutputResult {
  schemaVersion: 1;
  canvases: [];
  diagramRevisions: Record<string, never>;
  changeSession?: never;
  placementSnapshot?: never;
}

export interface MarkdownOutputResult extends NonCanvasOutputResult {
  format: 'markdown';
  markdown: string;
}
export interface LayoutOutputResult extends NonCanvasOutputResult {
  format: 'canvas-layout';
  layout: CanvasLayout;
}
export function layoutOutput(layout: CanvasLayout): LayoutOutputResult {
  return { schemaVersion: 1, format: 'canvas-layout', layout, canvases: [], diagramRevisions: {} };
}
export type EvalOutputResult = CanvasOutputResult | MarkdownOutputResult | LayoutOutputResult;

/** One execution result, regardless of the number of affected canvases. */
export interface CanvasOutputResult {
  /** Historical canvas results omit the format. */
  format?: 'canvas';
  placementSnapshot?: PlacementSnapshot;
  schemaVersion: 1;
  canvases: ChangePreviewDocument[];
  /** Portable revision dependencies, including logical node identities and selected variants. */
  diagramRevisions: Record<string, DiagramRevision>;
  /** Frozen review metadata. Never dereference this ID to render an eval output. */
  changeSession?: ChangeSessionSummary;
}

export interface EvalOutputSummary {
  format?: 'canvas' | 'markdown' | 'canvas-layout';
  canvases: { id: string; name: string; kind: 'existing' | 'new' }[];
  changeSession?: { id: string; version: number; title: string };
}

export function summarizeEvalOutput(result: EvalOutputResult): EvalOutputSummary {
  if (result.format === 'markdown') return { format: 'markdown', canvases: [] };
  if (result.format === 'canvas-layout') return { format: result.format, canvases: [] };
  const session = result.changeSession;
  return { canvases: result.canvases.map(doc => ({ id: doc.id, name: doc.name, kind: doc.baseline ? 'existing' : 'new' })),
    ...(session ? { changeSession: { id: session.id, version: session.version, title: session.title } } : {}) };
}

/** Copy the complete before/after evidence, excluding undo history and mutation receipts. */
export function captureChangeSessionOutput(source: DiagramChangeSession): CanvasOutputResult {
  const session = validateChangeSession(source);
  if (!session.documents.length) throw Error('An output must contain at least one canvas.');
  const diagramRevisions: Record<string, DiagramRevision> = {};
  for (const doc of session.documents) for (const state of [doc.baseline, doc.proposed]) if (state)
    Object.assign(diagramRevisions, new CanvasHistory(state.document, state.canvas).export(true).diagramRevisions);
  return structuredClone({ schemaVersion: 1, placementSnapshot: placementSnapshot(session.documents.map(doc => ({ id: doc.id, scene: doc.proposed.document.scene }))), diagramRevisions, changeSession: summarizeChangeSession(session),
    canvases: session.documents.map(({ history: _history, past: _past, future: _future, ...doc }) => doc) });
}
