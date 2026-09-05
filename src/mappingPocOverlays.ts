import { MAPPING_POC_GRAPH_A, type MappingPocNodeHead } from "./mappingPoc";

export interface MappingPocASection {
  id: string;
  label: string;
  startLine: number;
  endLine: number;
  anchorToken: string;
}

export interface MappingPocDetailOverlay {
  id: string;
  label: string;
  sectionId: string;
  anchorToken: string;
  ascii: string;
}

export interface MappingPocOverlayPlacement {
  overlayId: string;
  sectionId: string;
  originLine: number;
  originColumn: number;
  aAnchor: MappingPocNodeHead;
  overlayAnchor: MappingPocNodeHead;
}

export const MAPPING_POC_A_SECTIONS: readonly MappingPocASection[] = [
  { id: "profiles", label: "Persisted prompt profiles", startLine: 1, endLine: 30, anchorToken: "persistedPromptProfiles" },
  { id: "collection", label: "Diagram set and evidence collection", startLine: 31, endLine: 67, anchorToken: "evidenceCollection" },
  { id: "configuration", label: "Request and prompt configuration", startLine: 68, endLine: 120, anchorToken: "runtimeGenerationRequest" },
  { id: "agent-turns", label: "Agent session and prompt turns", startLine: 121, endLine: 153, anchorToken: "PiDiagramAgentRuntime.generateArtifact()" },
  { id: "outputs", label: "Validation and persisted outputs", startLine: 154, endLine: 183, anchorToken: "submissionValidation" }
];

export const MAPPING_POC_DETAIL_OVERLAYS: readonly MappingPocDetailOverlay[] = [
  {
    id: "profiles",
    label: "Prompt profile detail",
    sectionId: "profiles",
    anchorToken: "persistedPromptProfiles",
    ascii: `persistedPromptProfiles
      |
      +--> system-prompt-templates.json
      |       |
      |       +--> artifact-generation
      |       |      domain instruction
      |       |      one artifact
      |       |      7-bit ASCII
      |       |      submit_diagram contract
      |       |
      |       +--> diagram-reference
      |       |      complete replacement
      |       |      preserve source meaning
      |       |      apply reference grammar
      |       |
      |       \`--> diagram-mapping
      |              artifact unchanged
      |              exact entity spans
      |              no overlap
      |
      \`--> code-entity-prompt-templates.json
              |
              +--> identificationCriteria
              |      relevant evidence
              |      exact source ranges
              |
              \`--> compactionCriteria
                     retained/collapsed views
                     evidence-node mappings`
  },
  {
    id: "collection",
    label: "Evidence collection detail",
    sectionId: "collection",
    anchorToken: "evidenceCollection",
    ascii: `evidenceCollection
      |
      +--> DiagramSet
      |      name
      |      initialPrompt
      |      sourceCheckoutRoot
      |      codeEntitiesSetId
      |      readiness
      |
      +--> createCodeEntityPromptConfig()
      |      profile + revision
      |      identification criteria
      |      compaction criteria
      |      rendered context
      |
      +--> codeEntityCollectionPrompt()
      |      original request
      |      expected entity fields
      |      submit/retry instruction
      |
      \`--> PiDiagramAgentRuntime.collectEntities()
             |
             +--> corpus inspection tools
             +--> fixed collection system prompt
             +--> rendered context user prompt
             +--> submit_code_entities
             |
             \`--> validated CodeEntitiesSetRecord
                    exact files and ranges
                    status="finalized"`
  },
  {
    id: "configuration",
    label: "Generation configuration detail",
    sectionId: "configuration",
    anchorToken: "runtimeGenerationRequest",
    ascii: `runtimeGenerationRequest
      |
      +--> instruction + selectedCodeEntityIds[]
      +--> count + outputKind + viewKind + modelId
      +--> promptProfileId
      +--> references + referenceInstruction
      \`--> derivationCorrection
      |
      v
generateArtifacts()
      |
      v
generation HTTP route
      parse / validate / stream NDJSON
      |
      v
DiagramApplication.generate()
      |
      +--> finalized evidence gate
      +--> load entities and references
      +--> createGenerationPromptConfig()
      |       resolve templates
      |       resolve mentions
      |       create readable aliases
      |       render system/context/reference/mapping prompts
      |
      +--> persist immutable GenerationPromptConfigRecord
      |
      \`--> beginBatch()
             create AgentRun per slot
             invoke candidates concurrently`
  },
  {
    id: "agent-turns",
    label: "Agent prompt-turn detail",
    sectionId: "agent-turns",
    anchorToken: "PiDiagramAgentRuntime.generateArtifact()",
    ascii: `PiDiagramAgentRuntime.generateArtifact()
      |
      +--> resolve selected model
      +--> load rendered systemPrompt
      +--> expose submit_diagram only
      \`--> create isolated in-memory session
      |
      v
turn 1: generate
      contextPrompt
      slot + candidate total
      readable aliases
      entity/artifact allowlists
      |
      v
turn 2: apply reference               [optional]
      previous candidate
      reference instruction/context
      complete replacement required
      |
      v
turn 3: map final artifact             [mandatory]
      numbered final ASCII
      allowed CodeEntities
      exact evidence ranges
      artifact must remain unchanged
      |
      v
submit_diagram
      name + ASCII + entity IDs + mappings`
  },
  {
    id: "outputs",
    label: "Validation and output detail",
    sectionId: "outputs",
    anchorToken: "submissionValidation",
    ascii: `submissionValidation
      |
      +--> resolve aliases to persisted entity IDs
      +--> require nonblank name
      +--> require 7-bit ASCII
      +--> reject entities outside allowlist
      +--> require final mappings
      +--> verify sourceRangeIndex
      +--> verify visible in-bounds spans
      +--> reject overlapping mappings
      \`--> mapping turn cannot change artifact
      |
      v
persistedOutputs
      |
      +--> DiagramRecord | DiagramComponentRecord
      |      normalized ASCII
      |      promptConfigId
      |      agentRunId
      |      derivation lineage
      |
      +--> DiagramCodeEntityMapRecord
      |      artifact hash
      |      entity + source range
      |      exact visible span
      |
      \`--> completeBatch()
             deduplicate candidates
             persist artifacts + maps + runs
             update DiagramSet IDs
             return workspace`
  }
];

function uniqueTokenHead(ascii: string, token: string, context: string): MappingPocNodeHead {
  const matches = ascii.split("\n").flatMap((line, index) => {
    const offset = line.indexOf(token);
    return offset < 0 ? [] : [{
      line: index + 1,
      startColumn: offset + 1,
      endColumn: offset + token.length
    }];
  });
  if (matches.length !== 1) {
    throw new Error(`${context} anchor must occur exactly once: ${token}`);
  }
  return matches[0];
}

export function parseOverlayPlacement(
  overlay: MappingPocDetailOverlay,
  graphA = MAPPING_POC_GRAPH_A
): MappingPocOverlayPlacement {
  const section = MAPPING_POC_A_SECTIONS.find((candidate) => candidate.id === overlay.sectionId);
  if (!section) throw new Error(`Unknown A section for overlay ${overlay.id}: ${overlay.sectionId}`);
  if (section.anchorToken !== overlay.anchorToken) {
    throw new Error(`Overlay ${overlay.id} anchor differs from section ${section.id}`);
  }
  const aAnchor = uniqueTokenHead(graphA, overlay.anchorToken, `Graph A/${section.id}`);
  const overlayAnchor = uniqueTokenHead(overlay.ascii, overlay.anchorToken, `Overlay/${overlay.id}`);
  if (aAnchor.line < section.startLine || aAnchor.line > section.endLine) {
    throw new Error(`Graph A anchor for ${overlay.id} falls outside section ${section.id}`);
  }
  return {
    overlayId: overlay.id,
    sectionId: section.id,
    originLine: aAnchor.line - overlayAnchor.line + 1,
    originColumn: aAnchor.startColumn - overlayAnchor.startColumn + 1,
    aAnchor,
    overlayAnchor
  };
}

export const MAPPING_POC_OVERLAY_PLACEMENTS: readonly MappingPocOverlayPlacement[] =
  MAPPING_POC_DETAIL_OVERLAYS.map((overlay) => parseOverlayPlacement(overlay));
