import type { FileCompactionAgentSettings } from "../../../domain/mapping/compaction/agentSettings";
import type { FileCompactionSource } from "../../../domain/mapping/compaction/validation";

import type { FileCompactionDraft } from "../../../domain/mapping/compaction/fileCompaction";
import type { AgentStepRequest } from "../../core/agents/agentWorkflow";

export interface FileCompactionSession {
  runStep(request: AgentStepRequest, onProgress: (message: string) => void): Promise<{ draft: FileCompactionDraft; model: string; sessionId?: string }>;
  dispose(): void;
}

export interface FileCompactionContext {
  sourceRoot: string;
  source: FileCompactionSource;
  agent: FileCompactionAgentSettings;
  signal?: AbortSignal;
}

export interface FileCompactionRuntime {
  openSession(context: FileCompactionContext): Promise<FileCompactionSession>;
  dispose(): void;
}
