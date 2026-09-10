import {
  mkdir,
  mkdtemp,
  rm,
  writeFile
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  afterEach,
  describe,
  expect,
  it
} from "vitest";
import { initialMappingPocElementMappings, mappingPocElementMappingsAfterPatch, mappingPocSourceContextForSelection } from "./mappingPocSourceContext";

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("mapping POC corpus context", () => {
  it("resolves only mappings intersecting the selected diagram cells", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "mapping-poc-context-"));
    roots.push(root);
    await mkdir(path.join(root, "server/studio"), { recursive: true });
    const lines = Array.from({ length: 80 }, (_, index) => `source line ${index + 1}`);
    await writeFile(path.join(root, "server/studio", "codeEntityPrompt.ts"), lines.join("\n"), "utf8");

    const context = await mappingPocSourceContextForSelection({
      sourceRoot: root,
      mappings: initialMappingPocElementMappings(),
      selection: { startLine: 45, endLine: 45, startColumn: 10, endColumn: 37 }
    });

    expect(context).toHaveLength(1);
    expect(context[0]).toMatchObject({
      elementId: "a-collection-prompt",
      path: "server/studio/codeEntityPrompt.ts",
      startLine: 9,
      endLine: 48,
      diagramLine: 45
    });
    expect(context[0].lines[0]).toBe("source line 9");
    expect(context[0].lines.at(-1)).toBe("source line 48");
  });

  it("drops replaced mappings and shifts mappings below an applied patch", () => {
    const mappings = initialMappingPocElementMappings();
    const shifted = mappingPocElementMappingsAfterPatch(mappings, {
      diagramAscii: "unused",
      diagramRevision: 1,
      startLine: 127,
      oldEndLine: 152,
      newEndLine: 154,
      removedLineCount: 26,
      insertedLineCount: 28,
      verticalDelta: 2
    });
    expect(shifted.some((mapping) => mapping.entityId === "a-turn-one")).toBe(false);
    expect(shifted.some((mapping) => mapping.entityId === "a-turn-two")).toBe(false);
    expect(shifted.some((mapping) => mapping.entityId === "a-turn-three")).toBe(false);
    expect(shifted.find((mapping) => mapping.entityId === "a-submission-validation")?.line).toBe(156);
    expect(shifted.find((mapping) => mapping.entityId === "a-generate-artifact")?.line).toBe(121);
  });
});
