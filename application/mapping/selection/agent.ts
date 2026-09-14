import { type AgentProgress } from "../../../domain/core/records/domain";
import {
  type MappingPocPromptRequest,
  type MappingPocPromptResult
} from "../../../domain/mapping/selection/mappingPocPrompt";

export interface MappingAgentRuntime {
  promptDiagramSelection(
    request: MappingPocPromptRequest & { sourceRoot: string; projectEvidence?: Record<string, import("../../../domain/core/representations/projectCatalog").ProjectRepresentationEvidenceRecord> },
    onProgress?: (progress: AgentProgress) => void
  ): Promise<MappingPocPromptResult>;
  dispose(): void;
}
