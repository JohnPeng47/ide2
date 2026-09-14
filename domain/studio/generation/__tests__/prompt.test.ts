import { describe, expect, it } from "vitest";
import {
  isDiagramComponentArchived,
  SCHEMA_VERSION,
  type CodeEntitiesSetRecord,
  type DiagramComponentRecord,
  type DiagramRecord,
  type DiagramSetRecord
} from "../../../core/records/domain";
import {
  createBuiltInCodeEntityPromptTemplates,
  createBuiltInSystemPromptTemplates,
  createSystemPromptTemplate,
  DEFAULT_REFERENCE_FOLLOW_UP_PROMPT,
  generationPromptBindings,
  promptOptions,
  promptTemplate,
  renderArtifactSystemPrompt,
  renderMappingPromptTemplate,
  renderReferencePromptTemplate,
  renderSystemPromptTemplate
} from "../../../core/prompts/prompt";
import { createGenerationPromptConfig } from "../prompt";

describe("prompt template records", () => {
  it("constructs arbitrary named prompt dictionaries without imposing workflow names", () => {
    const template = createSystemPromptTemplate({
      id: "custom",
      label: "Custom",
      description: "Different workflow names",
      createdAt: "2026-01-01T00:00:00Z",
      prompts: {
        "architecture-overview-system": "Overview instructions",
        "map-overview": { template: "Map the supplied artifact." }
      }
    });
    expect(template.prompts).toEqual({
      "architecture-overview-system": { template: "Overview instructions" },
      "map-overview": { template: "Map the supplied artifact." }
    });
  });

  it("constructs one named prompt dictionary for every generation profile", () => {
    const [template] = createBuiltInSystemPromptTemplates("2026-01-01T00:00:00Z");
    const diagram = generationPromptBindings("diagram");
    const component = generationPromptBindings("diagram-component");
    expect(promptTemplate(template, diagram.system)).toContain("architecture diagram");
    expect(promptTemplate(template, diagram.reference!)).toContain("system-managed reference instruction");
    expect(promptTemplate(template, diagram.mapping)).toContain("system-managed final artifact");
    expect(promptTemplate(template, component.system)).toContain("DiagramComponent");
    expect(Object.values(template.prompts).every(({ template: value }) => (
      !value.includes("{{")
    ))).toBe(true);
  });

  it("renders the hidden mapping follow-up with numbered ASCII and readable aliases", () => {
    const [template] = createBuiltInSystemPromptTemplates("2026-01-01T00:00:00Z");
    const bindings = generationPromptBindings("diagram");
    const entity = codeEntities.entities[0];
    const rendered = renderMappingPromptTemplate({
      template: promptTemplate(template, bindings.mapping),
      targetKind: "diagram",
      artifact: {
        name: "Queue",
        ascii: "+-- Queue --+",
        codeEntityIds: [entity.id]
      },
      codeEntities: [entity],
      aliases: [{ id: entity.id, alias: "alias-readable-queue" }]
    });
    expect(rendered).toContain("   1: +-- Queue --+");
    expect(rendered).toContain("System-managed final artifact (read-only):");
    expect(rendered).toContain("System-managed CodeEntities and source ranges (read-only):");
    expect(rendered).toContain("alias-readable-queue:");
    expect(rendered).toContain("submit_diagram");
    expect(rendered).not.toContain(entity.id);
  });

  it("appends workflow context as read-only sections and rejects template variables", () => {
    const rendered = renderReferencePromptTemplate({
      template: "Apply the supplied visual reference.",
      targetKind: "diagram",
      instruction: "Runtime instruction",
      referenceContext: "Runtime context"
    });
    expect(rendered).toContain("System-managed reference instruction (read-only):\nRuntime instruction");
    expect(rendered).toContain("System-managed reference context (read-only):\nRuntime context");
    expect(rendered).toContain("System-managed output requirements (read-only):");
    expect(() => renderSystemPromptTemplate("{{outputKind}}", "diagram"))
      .toThrow("prompt template variables are not supported");
  });

  it("defines CodeEntity criteria through the same versioned prompts interface", () => {
    const [template] = createBuiltInCodeEntityPromptTemplates("2026-01-01T00:00:00Z");
    expect(template).toMatchObject({
      id: "default-code-entities",
      builtIn: true,
      version: 1,
      prompts: {
        "code-entity-identification": expect.stringContaining("A useful CodeEntity"),
        "code-entity-compaction": expect.stringContaining("visible consumers")
      }
    });
  });
});

const diagramSet: DiagramSetRecord = {
  schemaVersion: SCHEMA_VERSION,
  id: "set-one",
  projectId: "project-one",
  name: "Queue flow",
  initialPrompt: "Show queue ownership",
  sourceCheckoutRoot: "/repo",
  codeEntitiesSetId: "entities-one",
  featuredViewIds: {},
  diagramIds: ["diagram-one"],
  diagramComponentIds: ["component-one"],
  generationBatchIds: [],
  agentRunIds: [],
  editSessionIds: [],
  readiness: "ready",
  createdAt: "2026-01-01T00:00:00Z",
  updatedAt: "2026-01-01T00:00:00Z"
};

const component: DiagramComponentRecord = {
  schemaVersion: SCHEMA_VERSION,
  id: "component-one",
  diagramSetId: "set-one",
  handle: "queue-fragment",
  name: "Queue fragment",
  ascii: "[queue]",
  codeEntityIds: ["entity-queue"],
  origin: "selection",
  sourceDiagramId: "diagram-one",
  derivedFromDiagramIds: ["diagram-one"],
  derivedFromDiagramComponentIds: [],
  createdAt: "2026-01-01T00:00:00Z"
};

const codeEntities: CodeEntitiesSetRecord = {
  schemaVersion: SCHEMA_VERSION,
  id: "entities-one",
  diagramSetId: "set-one",
  revision: 1,
  status: "finalized",
  entities: [
    {
      id: "entity-queue",
      handle: "queue",
      label: "Queue",
      category: "state",
      summary: "Pending work",
      sourceRanges: [{ path: "src/queue.ts", startLine: 1, endLine: 10 }]
    },
    {
      id: "entity-unused",
      handle: "unused",
      label: "Unused",
      category: "operation",
      summary: "Not attached to the foundation",
      sourceRanges: [{ path: "src/unused.ts", startLine: 1, endLine: 3 }]
    }
  ]
};

const diagram: DiagramRecord = {
  schemaVersion: SCHEMA_VERSION,
  id: "diagram-one",
  diagramSetId: "set-one",
  viewKind: "diagram",
  handle: "current-flow",
  name: "Current flow",
  ascii: "queue -> worker",
  codeEntityIds: ["entity-queue"],
  origin: "generated",
  producedByRunId: "run-one",
  derivedFromDiagramIds: [],
  createdAt: "2026-01-01T00:00:00Z"
};

const buildPrompt = (input: {
  outputKind: "diagram" | "diagram-component";
  viewKind?: "diagram" | "call-graph" | "dir-view";
  instruction: string;
  runReferencePrompt?: boolean;
  referencePrompt?: string;
  selectedCodeEntityIds: string[];
  profileId?: string;
  domainProfileId?: "source-code" | "document";
  referenceSelections?: Parameters<typeof createGenerationPromptConfig>[0]["referenceSelections"];
  referencePromptSelections?: Parameters<typeof createGenerationPromptConfig>[0]["referencePromptSelections"];
  derivation?: Parameters<typeof createGenerationPromptConfig>[0]["derivation"];
}) => createGenerationPromptConfig({
  id: "prompt-one",
  diagramSet,
  codeEntities,
  diagrams: [diagram],
  components: [component],
  outputKind: input.outputKind,
  viewKind: input.viewKind,
  modelId: "gpt-5.6-sol",
  profile: createBuiltInSystemPromptTemplates("2026-01-01T00:00:00Z")
    .find((profile) => profile.id === (input.profileId ?? "default"))!,
  domainProfileId: input.domainProfileId,
  instruction: input.instruction,
  runReferencePrompt: input.runReferencePrompt,
  referencePrompt: input.referencePrompt,
  selectedCodeEntityIds: input.selectedCodeEntityIds,
  referenceSelections: input.referenceSelections,
  referencePromptSelections: input.referencePromptSelections,
  derivation: input.derivation,
  createdAt: "2026-01-01T00:00:00Z"
});

describe("createGenerationPromptConfig", () => {
  it("uses document evidence terminology through generation and mapping", () => {
    const result = buildPrompt({
      outputKind: "diagram",
      viewKind: "diagram",
      instruction: "Show the argument",
      selectedCodeEntityIds: ["entity-queue"],
      domainProfileId: "document"
    });
    expect(result.config.domainProfileId).toBe("document");
    expect(result.config.systemPrompt.rendered).toContain("Treat the supplied entities as document evidence");
    expect(result.config.contextPrompt.rendered).toContain("Selected Document evidence:");
    expect(result.config.contextPrompt.rendered).toContain("Document ranges:");
    const mapping = renderMappingPromptTemplate({
      template: result.config.mappingPrompt.template,
      targetKind: "diagram",
      artifact: { name: "Argument", ascii: "claim", codeEntityIds: ["entity-queue"] },
      codeEntities: result.allowedCodeEntities,
      aliases: result.allowedCodeEntityAliases,
      domainProfileId: result.config.domainProfileId
    });
    expect(mapping).toContain("Interpret CodeEntity as an evidence item");
    expect(mapping).toContain("Document evidence and document ranges");
  });

  it("binds workflow stages to arbitrary prompt names", () => {
    const profile = createSystemPromptTemplate({
      id: "higher",
      label: "Higher",
      description: "Higher-level flow",
      createdAt: "2026-01-01T00:00:00Z",
      prompts: {
        "overview-system": "Create the architecture overview.",
        "overview-reference": DEFAULT_REFERENCE_FOLLOW_UP_PROMPT,
        "overview-mapping": "Map the supplied artifact."
      }
    });
    const result = createGenerationPromptConfig({
      id: "prompt-higher",
      diagramSet,
      codeEntities,
      diagrams: [diagram],
      components: [component],
      outputKind: "diagram",
      viewKind: "diagram",
      modelId: "gpt-5.6-sol",
      profile,
      promptBindings: {
        system: "overview-system",
        reference: "overview-reference",
        mapping: "overview-mapping"
      },
      instruction: "Create the higher layer",
      selectedCodeEntityIds: ["entity-queue"],
      createdAt: "2026-01-01T00:00:00Z"
    });
    expect(result.config.systemPrompt).toMatchObject({
      profileId: "higher",
      promptName: "overview-system"
    });
    expect(result.config.mappingPrompt).toMatchObject({
      promptName: "overview-mapping",
      template: "Map the supplied artifact."
    });
  });

  it("runs the selected profile reference template without a per-generation instruction", () => {
    const profile = createBuiltInSystemPromptTemplates("2026-01-01T00:00:00Z")[0];
    const bindings = generationPromptBindings("diagram");
    profile.prompts[bindings.reference!] = {
      template: "Restyle the previous submission using @diagram/current-flow."
    };
    const result = createGenerationPromptConfig({
      id: "prompt-default-reference",
      diagramSet,
      codeEntities,
      diagrams: [diagram],
      components: [component],
      outputKind: "diagram",
      viewKind: "diagram",
      modelId: "gpt-5.6-sol",
      profile,
      instruction: "Create a new view",
      runReferencePrompt: true,
      selectedCodeEntityIds: ["entity-unused"],
      createdAt: "2026-01-01T00:00:00Z"
    });

    expect(result.config.referencePrompt).toMatchObject({
      instruction: "",
      references: [expect.objectContaining({ targetId: diagram.id })]
    });
    expect(result.config.referencePrompt?.rendered).toContain("Restyle the previous submission");
    expect(result.config.referencePrompt?.rendered).toContain(diagram.ascii);
  });

  it("renders reference textarea mentions only into a second prompt turn", () => {
    const result = buildPrompt({
      outputKind: "diagram",
      instruction: "Show the unused operation",
      referencePrompt: "Use the visual style of @diagram/current-flow",
      selectedCodeEntityIds: ["entity-unused"]
    });

    expect(result.config.references).toEqual([]);
    expect(result.config.contextPrompt.rendered).not.toContain("Diagram @diagram/current-flow");
    expect(result.config.referencePrompt).toMatchObject({
      instruction: "Use the visual style of @diagram/current-flow",
      references: [expect.objectContaining({ targetId: diagram.id })]
    });
    expect(result.config.referencePrompt?.rendered).toContain(diagram.ascii);
    expect(result.config.referencePrompt?.rendered).toContain("Regenerate the complete artifact");
    expect(result.allowedCodeEntityIds).toEqual(["entity-unused"]);
  });

  it("embeds artifact references declared by the system prompt without adding user lineage", () => {
    const profile = createBuiltInSystemPromptTemplates("2026-01-01T00:00:00Z")[0];
    const bindings = generationPromptBindings("diagram");
    profile.prompts[bindings.system] = {
      template: `${promptTemplate(profile, bindings.system)} Use @diagram/current-flow as a visual guide.`
    };
    const result = createGenerationPromptConfig({
      id: "prompt-system-reference",
      diagramSet,
      codeEntities,
      diagrams: [diagram],
      components: [component],
      outputKind: "diagram",
      viewKind: "diagram",
      modelId: "gpt-5.6-sol",
      profile,
      instruction: "Create a new view",
      selectedCodeEntityIds: [],
      createdAt: "2026-01-01T00:00:00Z"
    });

    expect(result.config.references).toEqual([]);
    expect(result.config.systemPrompt.references).toEqual([
      expect.objectContaining({ kind: "diagram", targetId: diagram.id })
    ]);
    expect(result.config.systemPrompt.rendered).toContain("Use @diagram/current-flow as a visual guide");
    expect(result.config.systemPrompt.rendered).toContain(diagram.ascii);
    expect(result.allowedDiagramIds).toContain(diagram.id);
  });

  it("resolves typed entity and diagram references through prompt_str", () => {
    const result = buildPrompt({
      outputKind: "diagram",
      instruction: "Simplify @diagram/current-flow around @entity/queue and @component/queue-fragment",
      selectedCodeEntityIds: []
    });
    expect(result.config.references.map((reference) => reference.targetId)).toEqual([
      "diagram-one",
      "entity-queue",
      "component-one"
    ]);
    expect(result.allowedCodeEntityIds).toEqual(["entity-queue"]);
    expect(result.config.contextPrompt.rendered).toContain("CodeEntity @entity/queue");
    expect(result.config.contextPrompt.rendered).toContain("Diagram @diagram/current-flow");
    expect(result.config.contextPrompt.rendered).toContain("DiagramComponent @component/queue-fragment");
    expect(result.config.references.map((reference) => reference.promptRepresentation))
      .toEqual(expect.arrayContaining([
        expect.stringContaining("Diagram @diagram/current-flow"),
        expect.stringContaining("CodeEntity @entity/queue"),
        expect.stringContaining("DiagramComponent @component/queue-fragment")
      ]));
  });

  it("keeps global CodeEntity ids out of model-facing artifact representations", () => {
    const globalId = "entity-b71bc396-7637-4769-95af-b5b3f8f24dd6";
    const globalEntities: CodeEntitiesSetRecord = {
      ...codeEntities,
      entities: [{ ...codeEntities.entities[0], id: globalId }]
    };
    const globalDiagram: DiagramRecord = {
      ...diagram,
      codeEntityIds: [globalId]
    };
    const result = createGenerationPromptConfig({
      id: "prompt-global-id",
      diagramSet,
      codeEntities: globalEntities,
      diagrams: [globalDiagram],
      components: [],
      outputKind: "diagram",
      viewKind: "diagram",
      modelId: "gpt-5.6-sol",
      profile: createBuiltInSystemPromptTemplates("2026-01-01T00:00:00Z")[0],
      instruction: "Refine @diagram/current-flow",
      selectedCodeEntityIds: [],
      createdAt: "2026-01-01T00:00:00Z"
    });

    expect(result.allowedCodeEntityIds).toEqual([globalId]);
    expect(result.allowedCodeEntityAliases).toEqual([{
      id: globalId,
      alias: "entity-queue"
    }]);
    expect(result.config.contextPrompt.rendered).toContain("CodeEntity ids: entity-queue");
    expect(result.config.contextPrompt.rendered).not.toContain(globalId);
  });

  it("persists omitted diagram decisions without adding their context or lineage", () => {
    const result = buildPrompt({
      outputKind: "diagram",
      instruction: "Keep the history text for @diagram/current-flow",
      selectedCodeEntityIds: [],
      referenceSelections: [{
        kind: "diagram",
        targetId: diagram.id,
        token: "@diagram/current-flow",
        handle: diagram.handle,
        included: false
      }],
      derivation: {
        sourceArtifactKind: "diagram",
        sourceArtifactId: diagram.id,
        promptCorrection: "Reduce the queue detail."
      }
    });

    expect(result.config.references).toEqual([]);
    expect(result.config.omittedReferences).toEqual([{
      kind: "diagram",
      targetId: diagram.id,
      token: "@diagram/current-flow",
      handle: diagram.handle
    }]);
    expect(result.config.derivation).toBeUndefined();
    expect(result.config.contextPrompt.rendered).toContain("Keep the history text");
    expect(result.config.contextPrompt.rendered).not.toContain("Diagram @diagram/current-flow");
    expect(result.allowedDiagramIds).toEqual([]);
  });

  it("binds historical tokens by artifact id and stores derivative correction metadata", () => {
    const renamed = { ...diagram, handle: "renamed-flow", name: "Renamed flow" };
    const result = createGenerationPromptConfig({
      id: "prompt-history",
      diagramSet,
      codeEntities,
      diagrams: [renamed],
      components: [component],
      outputKind: "diagram",
      modelId: "gpt-5.6-sol",
      profile: createBuiltInSystemPromptTemplates("2026-01-01T00:00:00Z")[0],
      instruction: "Compare @diagram/current-flow",
      selectedCodeEntityIds: [],
      referenceSelections: [{
        kind: "diagram",
        targetId: renamed.id,
        token: "@diagram/current-flow",
        handle: "current-flow",
        included: true
      }],
      derivation: {
        sourceArtifactKind: "diagram",
        sourceArtifactId: renamed.id,
        promptCorrection: "  Reduce the queue detail.  "
      },
      createdAt: "2026-01-01T00:00:00Z"
    });

    expect(result.config.references[0]).toMatchObject({
      targetId: renamed.id,
      token: "@diagram/current-flow",
      handle: renamed.handle
    });
    expect(result.config.derivation).toEqual({
      sourceArtifactKind: "diagram",
      sourceArtifactId: renamed.id,
      promptCorrection: "Reduce the queue detail."
    });
  });

  it("renders the original default system prompts exactly", () => {
    const defaultTemplate = createBuiltInSystemPromptTemplates("2026-01-01T00:00:00Z")[0];
    expect(renderArtifactSystemPrompt({ outputKind: "diagram", template: defaultTemplate })).toBe(
      "Generate exactly one architecture diagram from the supplied explicit context. Give it a compact, specific name, ideally two to five words; omit redundant words such as the DiagramSet name. Never modify files. Use 7-bit ASCII only.\n\nSystem-managed output requirements (read-only):\nReturn exactly one Diagram.\nFinish this turn by calling submit_diagram exactly once."
    );
    expect(renderArtifactSystemPrompt({
      outputKind: "diagram-component",
      template: defaultTemplate
    })).toBe(
      "Generate exactly one reusable DiagramComponent from the supplied explicit context. It is a fragment for a broader ASCII Diagram, not a complete diagram. Give it a compact, specific name. Be creative. Never modify files. Use 7-bit ASCII only.\n\nSystem-managed output requirements (read-only):\nReturn exactly one DiagramComponent.\nFinish this turn by calling submit_diagram_component exactly once."
    );
  });

  it("varies only the profile directive in the system prompt", () => {
    const config = buildPrompt({
      outputKind: "diagram",
      instruction: "Show the queue",
      selectedCodeEntityIds: ["entity-queue"],
      profileId: "flow-first"
    }).config;
    expect(config.systemPrompt).toMatchObject({
      templateId: "artifact-generation",
      templateVersion: 1,
      profileId: "flow-first",
      profileVersion: 1
    });
    expect(config.systemPrompt.rendered).toContain("Emphasize directional control and data flow.");
    expect(config.contextPrompt.rendered).toContain("Show the queue");
  });

  it("requires and injects settled prerequisite views for auxiliary generation", () => {
    const auxiliarySet = {
      ...diagramSet,
      featuredViewIds: { diagram: diagram.id }
    };
    const callGraphPrompt = createGenerationPromptConfig({
      id: "prompt-call-graph",
      diagramSet: auxiliarySet,
      codeEntities,
      diagrams: [diagram],
      components: [],
      outputKind: "diagram",
      viewKind: "call-graph",
      modelId: "gpt-5.6-sol",
      profile: createBuiltInSystemPromptTemplates("2026-01-01T00:00:00Z")[0],
      instruction: "Generate an ASCII call graph based on the foundation diagram.",
      selectedCodeEntityIds: ["entity-unused"],
      createdAt: "2026-01-01T00:00:00Z"
    });
    expect(callGraphPrompt.config.viewKind).toBe("call-graph");
    expect(callGraphPrompt.config.references).toEqual([
      expect.objectContaining({ targetId: diagram.id, promptRepresentation: expect.stringContaining(diagram.ascii) })
    ]);
    expect(callGraphPrompt.config.omittedReferences).toBeUndefined();
    expect(callGraphPrompt.config.systemPrompt.rendered).toContain("source-backed call graph");
    expect(callGraphPrompt.config.selectedCodeEntityIds).toEqual(["entity-queue"]);
    expect(callGraphPrompt.config.contextPrompt.rendered).toContain("Immutable CodeEntities:\nCodeEntity @entity/queue");
    expect(callGraphPrompt.config.contextPrompt.rendered).not.toContain("@entity/unused");
    expect(callGraphPrompt.config.contextPrompt.rendered).not.toContain(diagramSet.initialPrompt);
    expect(callGraphPrompt.config.contextPrompt.rendered).not.toContain("PREVIOUS PROMPT");

    expect(() => createGenerationPromptConfig({
      id: "prompt-dir-view-missing-call-graph",
      diagramSet: auxiliarySet,
      codeEntities,
      diagrams: [diagram],
      components: [],
      outputKind: "diagram",
      viewKind: "dir-view",
      modelId: "gpt-5.6-sol",
      profile: createBuiltInSystemPromptTemplates("2026-01-01T00:00:00Z")[0],
      instruction: "Show relevant files",
      selectedCodeEntityIds: [],
      createdAt: "2026-01-01T00:00:00Z"
    })).toThrow(/settle a Call Graph/);

    const companionCallGraph: DiagramRecord = {
      ...diagram,
      id: "diagram-call-graph",
      viewKind: "call-graph",
      handle: "queue-calls",
      name: "Queue calls",
      ascii: "entry --> queue",
      codeEntityIds: ["entity-queue", "entity-unused"],
      basedOnDiagramId: diagram.id
    };
    const directorySet = {
      ...auxiliarySet,
      featuredViewIds: { diagram: diagram.id, "call-graph": companionCallGraph.id }
    };

    const directory = createGenerationPromptConfig({
      ...{
        id: "prompt-dir-view",
        diagramSet: directorySet,
        codeEntities,
        diagrams: [diagram, companionCallGraph],
        components: [],
        outputKind: "diagram" as const,
        viewKind: "dir-view" as const,
        modelId: "gpt-5.6-sol" as const,
        profile: createBuiltInSystemPromptTemplates("2026-01-01T00:00:00Z")[0],
        instruction: "Show relevant files",
        selectedCodeEntityIds: ["entity-queue"],
        createdAt: "2026-01-01T00:00:00Z"
      }
    });
    expect(directory.config.references.map((reference) => reference.targetId))
      .toEqual([diagram.id, companionCallGraph.id]);
    expect(directory.config.contextPrompt.rendered).toContain("Immutable companion Call Graph:");
    expect(directory.config.contextPrompt.rendered).toContain(companionCallGraph.ascii);
    expect(directory.config.contextPrompt.rendered).toContain("Immutable CodeEntities:\nCodeEntity @entity/queue");
    expect(directory.config.contextPrompt.rendered).toContain("CodeEntity @entity/unused");
    expect(directory.config.contextPrompt.rendered).toContain("Immutable repository path inventory:\n- src/queue.ts");
    expect(directory.config.contextPrompt.rendered).toContain("- src/unused.ts");

    expect(() => buildPrompt({
      outputKind: "diagram",
      viewKind: "call-graph",
      instruction: "Show runtime calls",
      selectedCodeEntityIds: []
    })).toThrow(/settle a main Diagram/);
  });

  it("rejects unknown references", () => {
    expect(() => buildPrompt({
      outputKind: "diagram",
      instruction: "Use @entity/missing",
      selectedCodeEntityIds: []
    })).toThrow(/unknown prompt reference/);
  });

  it("excludes archived diagrams from prompt interaction", () => {
    const archived = { ...diagram, archivedAt: "2026-01-02T00:00:00Z" };
    expect(promptOptions(codeEntities, [archived], [component]).map((option) => option.token))
      .not.toContain("@diagram/current-flow");
    expect(() => createGenerationPromptConfig({
      id: "prompt-archived",
      diagramSet,
      codeEntities,
      diagrams: [archived],
      components: [component],
      outputKind: "diagram",
      modelId: "gpt-5.6-sol",
      profile: createBuiltInSystemPromptTemplates("2026-01-01T00:00:00Z")[0],
      instruction: "Use @diagram/current-flow",
      selectedCodeEntityIds: [],
      createdAt: "2026-01-01T00:00:00Z"
    })).toThrow(/unknown prompt reference/);
  });

  it("excludes archived DiagramComponents from prompt interaction", () => {
    const archived = { ...component, archivedAt: "2026-01-02T00:00:00Z" };
    expect(isDiagramComponentArchived(archived)).toBe(true);
    expect(promptOptions(codeEntities, [diagram], [archived]).map((option) => option.token))
      .not.toContain("@component/queue-fragment");
    expect(() => createGenerationPromptConfig({
      id: "prompt-archived",
      diagramSet,
      codeEntities,
      diagrams: [diagram],
      components: [archived],
      outputKind: "diagram-component",
      modelId: "gpt-5.6-sol",
      profile: createBuiltInSystemPromptTemplates("2026-01-01T00:00:00Z")[0],
      instruction: "Use @component/queue-fragment",
      selectedCodeEntityIds: [],
      createdAt: "2026-01-01T00:00:00Z"
    })).toThrow(/unknown prompt reference/);
  });
});
