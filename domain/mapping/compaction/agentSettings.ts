import type { FileCompactionThinkingLevel } from "./fileCompaction";

export interface FileCompactionAgentSettings {
  modelId: string;
  thinkingLevel: FileCompactionThinkingLevel;
  systemPrompt: {
    kind: "codex" | "custom";
    text: string;
    sha256: string;
    effectiveText: string;
    effectiveSha256: string;
  };
}
