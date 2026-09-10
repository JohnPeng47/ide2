import {
  mkdir,
  mkdtemp,
  rm,
  writeFile
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { expect, it } from "vitest";
import { generatedGridNodes } from "../../src/mapping/mappingGrid";
import { MAPPING_POC_GRAPH_A, projectASelectionToB } from "../../src/mapping/mappingPoc";
import { generatedMappingPocResult } from "../../src/mapping/mappingPocPrompt";
import { FakeMappingAgentRuntime } from "./agentRuntime";

it("generates mapped local content and can edit it without patching the source diagram", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "mapping-grid-prompt-"));
  try {
    await mkdir(path.join(root, "server/studio"), { recursive: true });
    await writeFile(path.join(root, "server/studio/codeEntityPrompt.ts"), Array.from({ length: 80 }, (_, i) => `source ${i}`).join("\n"));
    const runtime = new FakeMappingAgentRuntime();
    const generated = await runtime.promptDiagramSelection({
      clientSessionId: "generate-local", operation: "generate", sourceRoot: root,
      diagramAscii: MAPPING_POC_GRAPH_A, diagramRevision: 0,
      selection: { startLine: 45, endLine: 45, startColumn: 10, endColumn: 37 }, instruction: "Collection detail"
    });
    expect(generated.diagramAscii).toBe("Collection detail\n +-- code entity collection prompt");
    expect(generated.mappings).toEqual([expect.objectContaining({ entityId: "a-collection-prompt", line: 2, startColumn: 6 })]);
    const nodes = generatedGridNodes({ id: "child", revision: 0, ascii: generated.diagramAscii, mappings: generated.mappings! });
    expect(projectASelectionToB([nodes[0].id], nodes).selectedANodeIds).toEqual([nodes[0].id]);
    const edited = await runtime.promptDiagramSelection({
      clientSessionId: "edit-local", sourceRoot: root,
      diagramAscii: generated.diagramAscii, diagramRevision: generated.diagramRevision,
      mappings: generated.mappings, selection: { startLine: 2, endLine: 2, startColumn: 6, endColumn: 30 },
      instruction: "Add detail"
    });
    expect(edited.diagramAscii).toBe(`${generated.diagramAscii}\n[edited: Add detail]`);
    expect(edited.startLine).toBe(2);
    expect(edited.diagramRevision).toBe(1);
    expect(edited.diagramAscii).not.toContain("CurrentLLMPromptStack");
  } finally { await rm(root, { recursive: true, force: true }); }
});

it("rejects generated mappings outside local content or selected evidence", () => {
  const mapping = { id: "m", entityId: "a-collection-prompt", sourceRangeIndex: 0, line: 1, startColumn: 1, endColumn: 3 };
  expect(() => generatedMappingPocResult(["ABC"], [{ ...mapping, endColumn: 4 }], [mapping])).toThrow("local source mapping");
  expect(() => generatedMappingPocResult(["ABC"], [{ ...mapping, entityId: "unknown" }], [mapping])).toThrow("outside the selection");
  expect(() => generatedMappingPocResult(["ABC"], [], [mapping])).toThrow("require source mappings");
});
