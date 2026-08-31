import { describe, expect, it } from "vitest";
import {
  profileSupportsCommand,
  representationKindForArtifact,
  resolveDomainProfile
} from "./domainProfiles";

describe("domain profiles", () => {
  it("keeps the source-code workspace and presentation code-oriented", () => {
    const profile = resolveDomainProfile("source-code");

    expect(profile.workspace.explorerTabs.map(({ id, label }) => ({ id, label }))).toEqual([
      { id: "files", label: "Diagram Files" },
      { id: "diagram-sets", label: "Diagram Sets" }
    ]);
    expect(profile.workspace.diagramViews).toEqual(["diagram", "call-graph", "dir-view"]);
    expect(profile.content).toEqual({
      syntaxHighlighting: "code",
      markdownRendering: "source",
      wrap: false,
      sourceCompaction: true
    });
    expect(profileSupportsCommand(profile, "collapse-subtree", "tree")).toBe(true);
    expect(profileSupportsCommand(profile, "toggle-highlight", "tree")).toBe(false);
  });

  it("keeps the document workspace and presentation transcript-oriented", () => {
    const profile = resolveDomainProfile("document");

    expect(profile.workspace.explorerTabs.map(({ id, label }) => ({ id, label }))).toEqual([
      { id: "files", label: "Diagram Files" },
      { id: "markdown-sections", label: "Sections" },
      { id: "highlights", label: "Highlights" }
    ]);
    expect(profile.workspace.diagramViews).toEqual(["diagram", "call-graph"]);
    expect(profile.content).toEqual({
      syntaxHighlighting: "plain",
      markdownRendering: "terminal",
      wrap: true,
      sourceCompaction: false
    });
    expect(profileSupportsCommand(profile, "toggle-highlight", "tree")).toBe(true);
  });

  it("falls back unknown and missing persisted values to source-code", () => {
    expect(resolveDomainProfile(undefined).id).toBe("source-code");
    expect(resolveDomainProfile("future-profile").id).toBe("source-code");
  });

  it("uses explicit representation kinds and metadata-only legacy fallbacks", () => {
    expect(representationKindForArtifact({ representationKind: "tree", viewKind: "diagram" }))
      .toBe("tree");
    expect(representationKindForArtifact({ viewKind: "call-graph" })).toBe("tree");
    expect(representationKindForArtifact({ viewKind: "diagram" })).toBe("diagram");
  });
});
