import type { DiagramRepository } from '../../../application/core/ports/diagramRepository';
export type PersistenceContext = Pick<DiagramRepository, 'checkoutRoot' | 'storeRoot' | 'projectCatalogs' | 'ids'>;
