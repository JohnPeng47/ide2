import type { GeneratedArtifactDraft } from "../../../../domain/core/records/domain";
import type { AgentWorkflow, AgentWorkflowStep } from "../../../infrastructure/agents/agentWorkflow";

export function createGenerationWorkflow(input: {
  initialPrompt: string;
  referencePrompt?: string;
  mappingPrompt(artifact: GeneratedArtifactDraft): string;
  artifactLabel: string;
  onReferenceTurn?(): void;
  onMappingTurn?(artifact: GeneratedArtifactDraft): void;
}): AgentWorkflow<GeneratedArtifactDraft> {
  const steps: AgentWorkflowStep<GeneratedArtifactDraft>[] = [
    { id: "generate", prompt: () => input.initialPrompt }
  ];
  const referencePrompt = input.referencePrompt;
  if (referencePrompt) steps.push({
    id: "reference",
    before: () => input.onReferenceTurn?.(),
    prompt: () => referencePrompt
  });
  steps.push({
    id: "map",
    before: (artifact) => input.onMappingTurn?.(artifact!),
    prompt: (artifact) => input.mappingPrompt(artifact!),
    validate: (artifact) => {
      if (!artifact.mappings) throw new Error(`${input.artifactLabel} agent submitted no mappings in the mapping turn`);
    }
  });
  return { id: "artifact-generation", steps };
}
