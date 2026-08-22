import {
  SCHEMA_VERSION,
  type CodeEntityPromptConfigRecord,
  type CodeEntityPromptTemplateRecord,
  type DiagramSetRecord
} from "../src/domain";

export interface CodeEntityPromptInput {
  diagramSetName: string;
  initialPrompt: string;
  codeEntityIdentificationCriteria: string;
  codeEntityCompactionCriteria: string;
}

/** Action-oriented workflow composed from independently configurable criteria. */
export function codeEntityCollectionPrompt(input: CodeEntityPromptInput): string {
  return `Collect code entities for "${input.diagramSetName}".

Request:
${input.initialPrompt || "Map the requested code feature."}

## Identify Code Entities

Inspect the repository and identify concepts that satisfy these criteria:

${input.codeEntityIdentificationCriteria}

For each match, return its classification, concise label and summary, symbol,
and exact repo-relative source ranges.

## Compact Code Entities

Create a compactedSource presentation for every identified source range,
following these criteria:

${input.codeEntityCompactionCriteria}

Return retained source sections, collapsed-comment sections, and exact semantic
node mappings.

## Submission

Submit all identified and compacted CodeEntities together.

Finish by calling submit_code_entities. If the submission is rejected, correct the reported issues and call it again.`;
}

export function createCodeEntityPromptConfig(input: {
  id: string;
  diagramSet: DiagramSetRecord;
  template: CodeEntityPromptTemplateRecord;
  createdAt: string;
}): CodeEntityPromptConfigRecord {
  const identificationCriteria = input.template.prompts["code-entity-identification"].trim();
  const compactionCriteria = input.template.prompts["code-entity-compaction"].trim();
  if (!identificationCriteria || !compactionCriteria) {
    throw new Error("CodeEntity prompt template requires identification and compaction criteria");
  }
  const rendered = codeEntityCollectionPrompt({
    diagramSetName: input.diagramSet.name,
    initialPrompt: input.diagramSet.initialPrompt,
    codeEntityIdentificationCriteria: identificationCriteria,
    codeEntityCompactionCriteria: compactionCriteria
  });
  return {
    schemaVersion: SCHEMA_VERSION,
    id: input.id,
    diagramSetId: input.diagramSet.id,
    template: {
      profileId: input.template.id,
      profileVersion: input.template.version
    },
    identificationCriteria: { rendered: identificationCriteria },
    compactionCriteria: { rendered: compactionCriteria },
    contextPrompt: { templateVersion: 1, rendered },
    createdAt: input.createdAt
  };
}
