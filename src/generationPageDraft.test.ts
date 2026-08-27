import { describe, expect, it } from "vitest";
import {
  generationPageDraftKey,
  legacyGenerationPromptDraftKey,
  readGenerationPageDraft,
  saveGenerationPageDraft,
  type GenerationPageDraft
} from "./generationPageDraft";

function memoryStorage(): Storage {
  const values = new Map<string, string>();
  return {
    get length() { return values.size; },
    clear: () => values.clear(),
    getItem: (key) => values.get(key) ?? null,
    key: (index) => [...values.keys()][index] ?? null,
    removeItem: (key) => { values.delete(key); },
    setItem: (key, value) => { values.set(key, value); }
  };
}

const draft: GenerationPageDraft = {
  version: 4,
  prompt: "Refine @diagram/source",
  referencePrompt: "Use the visual style of @diagram/reference",
  selectedCodeEntityIds: ["entity-a"],
  excludedReferenceKeys: ["diagram:diagram-source"],
  excludedReferencePromptKeys: ["diagram:diagram-reference"],
  count: 2,
  targetKind: "diagram-component",
  modelId: "gpt-5.6-terra",
  promptProfileId: "compact"
};

describe("generation page drafts", () => {
  it("isolates new and derivative generation state", () => {
    expect(generationPageDraftKey("project", "set")).toBe(
      "new-diagram:generation-draft:project:set:new"
    );
    expect(generationPageDraftKey("project", "set", {
      sourceArtifactKind: "diagram",
      sourceArtifactId: "diagram-source"
    })).toBe("new-diagram:generation-draft:project:set:diagram:diagram-source");
    expect(legacyGenerationPromptDraftKey("project", "set")).toBe(
      "new-diagram:generation-prompt:project:set:new"
    );
  });

  it("round-trips complete generation state and rejects invalid records", () => {
    const storage = memoryStorage();
    saveGenerationPageDraft(storage, "draft", draft);
    expect(readGenerationPageDraft(storage, "draft")).toEqual(draft);

    storage.setItem("draft", JSON.stringify({ ...draft, count: 99 }));
    expect(readGenerationPageDraft(storage, "draft")).toBeNull();
    storage.setItem("draft", "not json");
    expect(readGenerationPageDraft(storage, "draft")).toBeNull();
  });

  it("migrates version 3 drafts without a reference prompt", () => {
    const storage = memoryStorage();
    const { referencePrompt: _referencePrompt, excludedReferencePromptKeys: _excluded, ...legacy } = draft;
    storage.setItem("draft", JSON.stringify({ ...legacy, version: 3 }));
    expect(readGenerationPageDraft(storage, "draft")).toMatchObject({
      version: 4,
      referencePrompt: "",
      excludedReferencePromptKeys: []
    });
  });
});
