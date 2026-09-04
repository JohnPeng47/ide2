import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  initialMappingPocElementMappings,
  mappingPocElementMappingsAfterPatch,
  mappingPocSourceContextForSelection
} from "./mappingPocSourceContext";

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("mapping POC corpus context", () => {
  it("resolves only mappings intersecting the selected diagram cells", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "mapping-poc-context-"));
    roots.push(root);
    await mkdir(path.join(root, "experiments"));
    const lines = Array.from({ length: 220 }, (_, index) => `source line ${index + 1}`);
    await writeFile(path.join(root, "experiments", "runtime.ts"), lines.join("\n"), "utf8");

    const context = await mappingPocSourceContextForSelection({
      sourceRoot: root,
      mappings: initialMappingPocElementMappings(),
      selection: { startLine: 50, endLine: 50, startColumn: 14, endColumn: 24 }
    });

    expect(context).toHaveLength(1);
    expect(context[0]).toMatchObject({
      elementId: "a-analyze",
      path: "experiments/runtime.ts",
      startLine: 169,
      endLine: 190,
      diagramLine: 50
    });
    expect(context[0].lines[0]).toBe("source line 169");
    expect(context[0].lines.at(-1)).toBe("source line 190");
  });

  it("drops replaced mappings and shifts mappings below an applied patch", () => {
    const mappings = initialMappingPocElementMappings();
    const shifted = mappingPocElementMappingsAfterPatch(mappings, {
      diagramAscii: "unused",
      diagramRevision: 1,
      startLine: 36,
      oldEndLine: 53,
      newEndLine: 55,
      removedLineCount: 18,
      insertedLineCount: 20,
      verticalDelta: 2
    });
    expect(shifted.some((mapping) => mapping.entityId === "a-analyze")).toBe(false);
    expect(shifted.find((mapping) => mapping.entityId === "a-experiment-output")?.line).toBe(59);
    expect(shifted.find((mapping) => mapping.entityId === "a-generation-record")?.line).toBe(30);
  });
});
