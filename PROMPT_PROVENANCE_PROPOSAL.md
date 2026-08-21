# Prompt Provenance and Generation Profiles

## Current State

Most generation inputs are already persisted, but they are attached to a
`GenerationBatchRecord` rather than directly addressable from each generated
artifact.

- `GenerationBatchRecord` stores the user instruction, references, selected
  CodeEntities, resolved context prompt, model, and output ids.
- A generated Diagram or DiagramComponent stores `producedByRunId`; reaching
  its batch requires an artifact -> AgentRun -> GenerationBatch lookup.
- The effective system prompt is hardcoded in `agentRuntime.ts` and is not
  persisted.
- `create derivative` currently discards the previous instruction and only
  inserts the selected artifact reference.

## Proposed Data Model

Introduce one immutable prompt-config record shared by every artifact produced
by the same parallel generation batch.

```ts
interface GenerationPromptConfigRecord {
  schemaVersion: 1;
  id: string;
  diagramSetId: string;

  outputKind: "diagram" | "diagram-component";
  modelId: DiagramModelId;

  instruction: string;
  selectedCodeEntityIds: string[];

  references: Array<{
    kind: "code-entity" | "diagram" | "diagram-component";
    targetId: string;
    handle: string;
    token: string;

    // Exact PromptRepresentation supplied during this generation.
    promptRepresentation: string;
  }>;

  contextPrompt: {
    templateVersion: 1;
    rendered: string;
  };

  systemPrompt: {
    templateId: "artifact-generation";
    templateVersion: 1;
    profileId: GenerationPromptProfileId;
    profileVersion: 1;
    rendered: string;
  };

  createdAt: string;
}
```

Persist prompt configs at:

```text
.diagrams/
`-- diagram-sets/
    `-- <set-id>/
        `-- generation-prompts/
            `-- <prompt-config-id>.json
```

Each generated Diagram or DiagramComponent receives:

```ts
generationPromptConfigId: string;
```

The prompt config is shared across parallel outputs because those agents use
the same generation configuration. Slot-specific values remain on the
`AgentRunRecord`.

`GenerationBatchRecord` should reference `promptConfigId` and stop duplicating
the user prompt, references, selected ids, resolved prompt, model, and output
kind. Existing batch prompt data should be moved into the new records with a
one-time structural migration; there should not be two continuing prompt
formats.

Imported and captured artifacts have no generation config. Edited artifacts
retain their source-generation link alongside their existing EditSession
history.

## Derivative Behavior

When `create derivative` is selected:

1. Load the artifact's `GenerationPromptConfigRecord`.
2. Restore its:
   - Generation Instruction
   - selected CodeEntities
   - model
   - output kind
   - system-prompt profile
3. Prepend the selected artifact as the primary reference:

```text
@diagram/current-diagram-handle

<original persisted instruction and references>
```

For DiagramComponents, use `@component/current-component-handle`.

Putting the new artifact reference first preserves the current lineage
convention while keeping the original references visible and editable.
Unavailable historical references should be displayed as unresolved before
generation instead of being silently removed.

Add a small `prompt` action beside `rename` in the lineage tree. It opens a
read-only view of the instruction, profile, model, references, and rendered
prompts.

## System-Prompt Profiles

The menu selects a small design directive. It does not replace the complete
system prompt.

Use one renderer:

```ts
renderArtifactSystemPrompt({
  outputKind,
  profileId
});
```

The renderer owns this stable structure:

```text
{artifact contract}

{fixed naming requirements}

{profile design directive}

{fixed safety, ASCII, and submission requirements}
```

Initial profiles can remain brief:

```ts
const GENERATION_PROMPT_PROFILES = {
  default: {
    label: "Default",
    diagramDirective: "",
    componentDirective: "Be creative."
  },

  structureFirst: {
    label: "Structure first",
    diagramDirective:
      "Emphasize ownership, boundaries, and hierarchy.",
    componentDirective:
      "Emphasize a reusable structural relationship."
  },

  flowFirst: {
    label: "Flow first",
    diagramDirective:
      "Emphasize directional control and data flow.",
    componentDirective:
      "Emphasize one clear input-to-output interaction."
  },

  compact: {
    label: "Compact",
    diagramDirective:
      "Prefer a dense layout with minimal crossing edges.",
    componentDirective:
      "Prefer a small fragment that composes cleanly."
  }
};
```

The default profile must render the current system prompts exactly:

- Diagram inserts no design directive.
- DiagramComponent inserts the existing `Be creative.` sentence in its current
  position.

This preserves the current prompt as the default while allowing only the
intended design-guidance section to vary.

## UI

Add a `SYSTEM STYLE` selector beside the model selector above the Generation
Instruction textarea.

The generation request becomes:

```ts
{
  prompt,
  selectedCodeEntityIds,
  count,
  outputKind,
  modelId,
  promptProfileId
}
```

The server remains authoritative. It resolves references, renders both prompt
templates, persists the immutable config, and then starts the agents.

## Implementation Plan

```text
Prompt provenance
|
+-- Data model
|   +-- GenerationPromptConfigRecord
|   +-- direct artifact promptConfigId
|   `-- replace duplicated GenerationBatch prompt fields
|
+-- Prompt rendering
|   +-- context-prompt renderer
|   +-- system-prompt template
|   `-- versioned profile registry
|
+-- Persistence
|   +-- generation-prompts/*.json
|   +-- workspace loading
|   `-- migrate existing batch prompt data
|
+-- Generation
|   +-- render and save config before agents start
|   +-- attach config id to every output
|   `-- pass persisted rendered prompts to Pi
|
+-- UX
|   +-- System Style selector
|   +-- derivative form rehydration
|   `-- lineage prompt-inspection action
|
`-- Validation
    +-- exact default-template parity
    +-- prompt-config persistence
    +-- parallel outputs share config
    +-- derivative restores all settings
    `-- browser coverage for profile selection
```

This keeps prompt construction centralized and makes each generated node
reproducible without copying a large prompt blob into every Diagram record.
