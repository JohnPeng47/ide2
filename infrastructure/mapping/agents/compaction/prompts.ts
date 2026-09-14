import { readFile } from "node:fs/promises";
import { sha256 } from "../../../../application/core/agents/hash";
import type { FileCompactionPrompts } from "../../../../domain/mapping/compaction/validation";

export async function loadFileCompactionPrompts(): Promise<FileCompactionPrompts> {
  const entries = await Promise.all(([
    ["compact", "compaction/single-file-compact.md"], ["refine", "compaction/single-file-compact2.md"]
  ] as const).map(async ([stage, name]) => {
    const text = await readFile(new URL(`./prompts/${name}`, import.meta.url), "utf8");
    if (!text.trim() || /{{[^{}]+}}/.test(text)) throw new Error(`Invalid compaction prompt: ${name}`);
    return [stage, { name, text, sha256: sha256(text) }];
  }));
  return Object.fromEntries(entries) as FileCompactionPrompts;
}
