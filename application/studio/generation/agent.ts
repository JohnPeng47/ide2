import type { BuiltInDomainProfileId, CorpusBinding } from "../../../domain/core/profiles/domainProfile";
import {
  type AgentProgress,
  type ArtifactEditDraft,
  type CodeEntityDraft,
  type CodeEntityPromptAlias,
  type CodeEntityPromptConfigRecord,
  type CodeEntityRecord,
  type DiagramElementMappingDraft,
  type DiagramModelId,
  type GeneratedArtifactDraft,
  type GenerationOutputKind,
  type GenerationPromptConfigRecord
} from "../../../domain/core/records/domain";

export interface EntityCollectionRequest {
  sourceRoot: string;
  domainProfileId: BuiltInDomainProfileId;
  corpus: CorpusBinding;
  diagramSetName: string;
  promptConfig: CodeEntityPromptConfigRecord;
}

export interface ArtifactGenerationRequest {
  sourceRoot: string;
  diagramSetName: string;
  promptConfig: GenerationPromptConfigRecord;
  allowedCodeEntityAliases: CodeEntityPromptAlias[];
  codeEntities: CodeEntityRecord[];
  allowedDiagramIds: string[];
  allowedDiagramComponentIds: string[];
  slot: number;
  total: number;
}

export interface ArtifactEditRequest {
  sourceRoot: string;
  diagramSetName: string;
  artifactKind: GenerationOutputKind;
  artifactName: string;
  artifactHandle: string;
  currentAscii: string;
  instruction: string;
  modelId: DiagramModelId;
  markers: Array<{ token: string; character: string; originalCharacter: string }>;
}

export interface ArtifactEntityMappingRequest {
  sourceRoot: string;
  diagramSetName: string;
  artifactKind: GenerationOutputKind;
  artifactName: string;
  artifactHandle: string;
  ascii: string;
  codeEntityIds: string[];
  codeEntities: CodeEntityRecord[];
  domainProfileId?: BuiltInDomainProfileId;
}

export interface DiagramAgentRuntime {

  collectEntities(
    request: EntityCollectionRequest,
    onProgress?: (progress: AgentProgress) => void
  ): Promise<CodeEntityDraft[]>;

  generateArtifact(
    request: ArtifactGenerationRequest,
    onProgress?: (progress: AgentProgress) => void
  ): Promise<GeneratedArtifactDraft>;

  mapArtifactEntities(
    request: ArtifactEntityMappingRequest,
    onProgress?: (progress: AgentProgress) => void
  ): Promise<DiagramElementMappingDraft[]>;

  editArtifact(
    request: ArtifactEditRequest,
    onProgress?: (progress: AgentProgress) => void
  ): Promise<ArtifactEditDraft>;

  dispose(): void;
}
