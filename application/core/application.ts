import type { ProjectFileCompactionInput } from "../../domain/core/representations/projectCatalog";
import type { CoreContext } from './context';
import type { CorpusAccess } from "./corpus/corpusAccess";
import { DiagramRepository } from "./ports/diagramRepository";
import * as representationsOperations from './representations/service';

/** Project catalog reads and source-validated compaction writes. */
export class CoreApplication {
  private readonly context: CoreContext;
  constructor(readonly store: DiagramRepository, readonly corpus: CorpusAccess) { this.context = { store, corpus }; }

  async projectRepresentations(historyValidation: import('../../domain/core/diagrams/canvasHistory').HistoryValidation = 'all') {
    return representationsOperations.projectRepresentations(this.context, historyValidation);
  }

  async upsertProjectFileCompaction(input: ProjectFileCompactionInput) {
    return representationsOperations.upsertProjectFileCompaction(this.context, input);
  }
}
