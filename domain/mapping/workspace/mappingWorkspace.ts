import type { DisplayState } from './displayModel';
import { emptyDisplayState } from './displayModel';
import type { MappingGridDocument } from './mappingGrid';
import type { SelectionState } from '../selection/selectionState';
import type { CanvasTransform } from '../../core/diagrams/diagramCanvas';

/** Control surfaces are persisted separately from the display ownership tree. */
export interface SelectionSurfaceState {
  actionsOpen: boolean;
  presentation: 'compact' | 'floating' | 'docked';
  projectionChoice: string;
  promptOperation: 'edit' | 'generate';
  promptOpen: boolean;
  promptText: string;
  askOpen: boolean;
  askText: string;
  askVerbosity: "low" | "high";
  promptPhase: 'ready' | 'composing' | 'generating' | 'applied' | 'error';
  statusMessage: string;
}
export const selectionSurfaceKeys = ['actionsOpen', 'presentation', 'projectionChoice', 'promptOperation', 'promptOpen', 'promptText',
  'askOpen', 'askText', 'askVerbosity', 'promptPhase', 'statusMessage'] as const;
export const initialSelectionSurface = (): SelectionSurfaceState => ({ actionsOpen: true, presentation: 'compact', projectionChoice: '', promptOperation: 'edit',
  promptOpen: false, promptText: '', askOpen: false, askText: '', askVerbosity: 'low', promptPhase: 'ready', statusMessage: 'Ctrl + drag to select' });
export interface MappingControls {
  activeBoxId: string;
  /** Action-menu focus only; selection membership lives in selection.items. */
  selectionFocusId: string | null;
  activeThreadId: string | null;
  surfaces: Record<string, SelectionSurfaceState>;
}
/** A control accessor resolves these values against the active selection's surface. */
export type MappingControlValues = MappingControls & SelectionSurfaceState;
export interface MappingCanvasState { viewport?: CanvasTransform; projectionLayout?: import('../../core/diagrams/highlightProjection').ProjectionLayout; selection: SelectionState; diagramViews?: import('./diagramViewState').DiagramViews; display: DisplayState; controls: MappingControls }
export function initialCanvasState(): MappingCanvasState {
  return { selection: { items: [] }, diagramViews: {}, display: emptyDisplayState(), controls: { activeBoxId: 'overview', selectionFocusId: null, activeThreadId: null, surfaces: { draft: initialSelectionSurface() } } };
}
export interface MappingDocumentSnapshot {
  parentCanvasId?: string;
  hidden?: boolean;
  history?: import('./canvasHistory').CanvasHistoryRecord;
  repositoryId?: string;
  savedRepresentationId?: string;
  representationId: string; name: string; revisionId: string; savedName: string; savedScene: string; savedEdges?: string;
  document: MappingGridDocument; canvas: MappingCanvasState; viewport?: CanvasTransform;
}
export interface MappingWorkspaceSnapshot {
  transfers?: import('../../core/diagrams/canvasTransfer').CanvasTransfer[];
  schemaVersion: 3; projectId: string; activeDocumentId?: string; documents: MappingDocumentSnapshot[];
}
