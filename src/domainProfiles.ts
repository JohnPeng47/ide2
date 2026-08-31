import type { CodeEntityRecord, DiagramViewKind } from "./domain";
import type {
  BuiltInDomainProfileId,
  DomainProfile,
  DomainProfileId,
  ElementCommandId,
  EvidenceSchema
} from "./domainProfile";

function evidenceSchema(
  id: string,
  label: string,
  entityNoun: string,
  collectionNoun: string
): EvidenceSchema {
  return {
    id,
    label,
    entityNoun,
    collectionNoun,
    fromCodeEntity(record: CodeEntityRecord) {
      return {
        id: record.id,
        handle: record.handle,
        label: record.label,
        kind: record.category,
        summary: record.summary,
        anchors: record.sourceRanges
      };
    }
  };
}

const SOURCE_CODE_PROFILE: DomainProfile = {
  id: "source-code",
  label: "Source code",
  corpusKind: "git-worktree",
  evidenceSchema: evidenceSchema(
    "code-entities",
    "Code entities",
    "code entity",
    "code entities"
  ),
  workspace: {
    diagramViews: ["diagram", "call-graph", "dir-view"],
    explorerTabs: [
      { id: "files", label: "Diagram Files", domId: "files-tab" },
      { id: "diagram-sets", label: "Diagram Sets", domId: "diagram-sets-tab" }
    ]
  },
  content: {
    syntaxHighlighting: "code",
    markdownRendering: "source",
    wrap: false,
    sourceCompaction: true
  },
  commands: [
    { id: "reveal-evidence", representationKinds: ["tree", "diagram"], requiresEvidence: true },
    { id: "collapse-subtree", representationKinds: ["tree"] },
    { id: "buffer-reference", representationKinds: ["tree", "diagram"], requiresEvidence: true }
  ]
};

const DOCUMENT_PROFILE: DomainProfile = {
  id: "document",
  label: "Document",
  corpusKind: "filesystem-documents",
  evidenceSchema: evidenceSchema(
    "document-evidence",
    "Document evidence",
    "evidence item",
    "evidence"
  ),
  workspace: {
    diagramViews: ["diagram", "call-graph"],
    explorerTabs: [
      { id: "files", label: "Diagram Files", domId: "files-tab" },
      { id: "markdown-sections", label: "Sections", domId: "markdown-sections-tab" },
      { id: "highlights", label: "Highlights", domId: "highlights-tab" }
    ]
  },
  content: {
    syntaxHighlighting: "plain",
    markdownRendering: "terminal",
    wrap: true,
    sourceCompaction: false
  },
  commands: [
    { id: "reveal-evidence", representationKinds: ["tree", "diagram"], requiresEvidence: true },
    { id: "collapse-subtree", representationKinds: ["tree"] },
    { id: "toggle-highlight", representationKinds: ["tree"], requiresEvidence: true },
    { id: "buffer-reference", representationKinds: ["tree", "diagram"], requiresEvidence: true }
  ]
};

export const BUILT_IN_DOMAIN_PROFILES: Readonly<Record<BuiltInDomainProfileId, DomainProfile>> = {
  "source-code": SOURCE_CODE_PROFILE,
  document: DOCUMENT_PROFILE
};

/** Resolve persisted profile metadata at the project boundary. Unknown legacy values stay usable. */
export function resolveDomainProfile(profileId: DomainProfileId | null | undefined): DomainProfile {
  return profileId === "document" ? DOCUMENT_PROFILE : SOURCE_CODE_PROFILE;
}

export function profileSupportsCommand(
  profile: DomainProfile,
  commandId: ElementCommandId,
  representationKind?: "tree" | "diagram"
): boolean {
  return profile.commands.some((command) => command.id === commandId
    && (!representationKind || command.representationKinds.includes(representationKind)));
}

/** Resolve legacy artifacts from declared metadata, never from ASCII or file content. */
export function representationKindForArtifact(artifact: {
  representationKind?: "tree" | "diagram";
  viewKind?: DiagramViewKind;
}): "tree" | "diagram" {
  if (artifact.representationKind) return artifact.representationKind;
  return artifact.viewKind === "call-graph" || artifact.viewKind === "dir-view"
    ? "tree"
    : "diagram";
}
