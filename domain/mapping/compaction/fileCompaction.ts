import type { CompactionSnapshot } from "../../core/representations/compactionProjection";

export type FileCompactionStage = "compact" | "refine";
export type FileCompactionThinkingLevel = "low" | "medium" | "high" | "xhigh" | "max";

export interface FileCompactionRequest {
  sourceId?: string;
  projectId: string;
  sourceFile: string;
  modelId?: string;
  thinkingLevel?: FileCompactionThinkingLevel;
  /** Replaces the base system prompt. The file-compaction submission contract is always appended. */
  systemPrompt?: string;
}

export type FileCompactionDraft = Pick<CompactionSnapshot, "ascii" | "mappings">;

export interface FileCompactionResult {
  runId: string;
  snapshot: CompactionSnapshot;
  sourceStale: boolean;
  /** Artifact paths relative to the configured diagrams store. */
  artifacts: Record<FileCompactionStage, { text: string; mappings: string }>;
}

export type FileCompactionEvent =
  | { type: "started"; runId: string; sourceSha256: string }
  | { type: "progress"; runId: string; stage: FileCompactionStage; message: string }
  | { type: "result"; result: FileCompactionResult }
  | { type: "error"; runId: string; stage: FileCompactionStage; error: string };
