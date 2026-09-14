import type { CorpusAccess } from './corpus/corpusAccess';
import type { DiagramRepository } from './ports/diagramRepository';
export interface CoreContext { store: DiagramRepository; corpus: CorpusAccess; }
