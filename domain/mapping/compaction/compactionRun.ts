import type { FileCompactionPrompts } from "./validation";
import type { FileCompactionAgentSettings } from "./agentSettings";

import type { CompactionSnapshot } from "../../core/representations/compactionProjection";
import type { FileCompactionResult, FileCompactionStage } from "./fileCompaction";

export interface FileCompactionRun {
  schemaVersion: 1;
  id: string;
  projectId: string;
  sourceFile: string;
  sourceSha256: string;
  workflowId: "single-file-compaction";
  status: "running" | "completed" | "failed" | "cancelled" | "interrupted";
  stage: FileCompactionStage;
  createdAt: string;
  updatedAt: string;
  prompts: FileCompactionPrompts;
  /** Absent on historical runs created before per-request agent settings. */
  agent?: FileCompactionAgentSettings;
  steps: Partial<Record<FileCompactionStage, { prompt: string; model?: string; sessionId?: string; snapshot?: CompactionSnapshot }>>;
  result?: FileCompactionResult;
  error?: string;
}
