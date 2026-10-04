import type { Diagram } from '../../core/diagrams/diagram';
import type { DiagramContent, DiagramContentNode } from '../../core/diagrams/diagramContent';
import type { CanvasDisplayNode } from '../workspace/canvasDisplayNode';

/** Agent wire format only. Persistence and the canvas continue to use domain objects. */
export const canvasApiFormatVersion = 1 as const;
export type ApiDiagramContent = Omit<DiagramContent, 'structure'> & {
  structure: (DiagramContent['structure']) & { nodes: Readonly<Record<string, DiagramContentNode>> };
};
export type ApiDisplayNode = { apiFormatVersion: typeof canvasApiFormatVersion } & (
  | (Omit<Extract<CanvasDisplayNode, { layout: 'grid' }>, 'content' | 'contentNodes' | 'diagram'> & {
    content?: ApiDiagramContent;
    diagram?: Omit<Diagram, 'content'>;
  })
  | Extract<CanvasDisplayNode, { layout: 'floating' }>
);
