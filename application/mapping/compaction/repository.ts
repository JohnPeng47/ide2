import type { CompactionSnapshot } from "../../../domain/core/representations/compactionProjection";
import type { FileCompactionRun } from '../../../domain/mapping/compaction/compactionRun';

import type { FileCompactionResult, FileCompactionStage } from "../../../domain/mapping/compaction/fileCompaction";
export interface FileCompactionRepository {
  directory(id: string): string;
  create(run: FileCompactionRun, source: Buffer): Promise<void>;
  save(run: FileCompactionRun): Promise<void>;
  load(id: string): Promise<FileCompactionRun | null>;
  artifacts(id: string): FileCompactionResult["artifacts"];
  savePass(id: string, stage: FileCompactionStage, snapshot: CompactionSnapshot): Promise<void>;
}
