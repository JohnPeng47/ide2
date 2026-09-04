import { describe, expect, it } from "vitest";
import { createStudioPaneState, pageFromPath } from "./App";
import { resolveDomainProfile } from "./domainProfiles";
import { setPaneTabs } from "./panes/model";

function explorerIds(profileId: "source-code" | "document") {
  return createStudioPaneState(resolveDomainProfile(profileId), null).panes.files.tabs.map((tab) => tab.id);
}

describe("profile-driven studio panes", () => {
  it("creates the exact source-code and document explorer tabs", () => {
    expect(explorerIds("source-code")).toEqual([
      "files",
      "representations",
      "plans"
    ]);
    expect(explorerIds("document")).toEqual(["files", "markdown-sections", "highlights", "plans"]);
  });

  it("removes a restored tab that is invalid for source-code and falls back safely", () => {
    const initial = createStudioPaneState(resolveDomainProfile("document"), null);
    const restored = setPaneTabs(initial, "files", [
      { id: "files", label: "Diagram Files" },
      { id: "highlights", label: "Highlights" }
    ], "highlights");
    const normalized = createStudioPaneState(resolveDomainProfile("source-code"), restored);

    expect(normalized.panes.files.tabs.map((tab) => tab.id)).toEqual([
      "files",
      "representations",
      "plans"
    ]);
    expect(normalized.panes.files.activeTabId).toBe("files");
  });

  it("preserves a restored tab when the active profile contributes it", () => {
    const restored = createStudioPaneState(resolveDomainProfile("document"), null);
    const withHighlightsActive = setPaneTabs(
      restored,
      "files",
      restored.panes.files.tabs,
      "highlights"
    );
    const normalized = createStudioPaneState(resolveDomainProfile("document"), withHighlightsActive);

    expect(normalized.panes.files.activeTabId).toBe("highlights");
  });
});

describe("application page routing", () => {
  it("routes mapping paths to the representation mapping POC", () => {
    expect(pageFromPath("/mapping")).toBe("mapping");
    expect(pageFromPath("/mapping/graph-a")).toBe("mapping");
    expect(pageFromPath("/experiments")).toBe("experiments");
    expect(pageFromPath("/")).toBe("studio");
  });
});
