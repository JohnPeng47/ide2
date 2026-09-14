import { describe, expect, it } from "vitest";
import { SCHEMA_VERSION, type DiagramSetRecord } from "../../../../../domain/core/records/domain";
import { createBuiltInCodeEntityPromptTemplates } from "../../../../../domain/core/prompts/prompt";
import { createCodeEntityPromptConfig } from "../codeEntityPrompt";

const diagramSet: DiagramSetRecord = {
  schemaVersion: SCHEMA_VERSION,
  id: "set-one",
  projectId: "project-one",
  name: "SIM.DYNAMICS",
  initialPrompt: "Show the world step and observation flow",
  sourceCheckoutRoot: "/repo",
  codeEntitiesSetId: "entities-one",
  featuredViewIds: {},
  diagramIds: [],
  diagramComponentIds: [],
  generationBatchIds: [],
  agentRunIds: [],
  editSessionIds: [],
  readiness: "collecting",
  createdAt: "2026-01-01T00:00:00Z",
  updatedAt: "2026-01-01T00:00:00Z"
};

describe("createCodeEntityPromptConfig", () => {
  it("composes action-oriented collection from independently stored criteria", () => {
    const template = createBuiltInCodeEntityPromptTemplates("2026-01-01T00:00:00Z")[0];
    const config = createCodeEntityPromptConfig({
      id: "prompt-one",
      diagramSet,
      template,
      createdAt: "2026-01-01T00:00:00Z"
    });

    expect(config.template).toEqual({
      profileId: "default-code-entities",
      profileVersion: 1
    });
    expect(config.identificationCriteria.rendered).toContain("## Entity significance");
    expect(config.compactionCriteria.rendered).toContain(
      "visible inputs -> compacted transformation -> visible consumers"
    );
    expect(config.compactionCriteria.rendered).toContain("values = point.values");
    expect(config.compactionCriteria.rendered).toContain(
      "// [Lines 388-405 | 18 lines compacted]"
    );
    expect(config.compactionCriteria.rendered).toContain(
      "target_position_w = _array(scenario[\"target_origin_w\"], length=3)"
    );
    expect(config.contextPrompt.rendered).toContain("## Identify Code Entities");
    expect(config.contextPrompt.rendered).toContain("Inspect the repository and identify concepts");
    expect(config.contextPrompt.rendered).toContain("## Compact Code Entities");
    expect(config.contextPrompt.rendered).toContain("Create a compactedSource presentation");
    expect(config.contextPrompt.rendered).toContain("If the submission is rejected");
  });

  it("uses document and evidence language for document collection", () => {
    const template = createBuiltInCodeEntityPromptTemplates(
      "2026-01-01T00:00:00Z",
      "document"
    )[0];
    const config = createCodeEntityPromptConfig({
      id: "prompt-documents",
      diagramSet,
      template,
      domainProfileId: "document",
      createdAt: "2026-01-01T00:00:00Z"
    });

    expect(config.contextPrompt.rendered).toContain("Collect evidence entities");
    expect(config.contextPrompt.rendered).toContain("Inspect the documents");
    expect(config.contextPrompt.rendered).toContain("corpus-relative evidence ranges");
    expect(config.contextPrompt.rendered).not.toContain("Inspect the repository");
    expect(config.identificationCriteria.rendered).toMatch(/grounded in the supplied\s+documents/);
  });
});
