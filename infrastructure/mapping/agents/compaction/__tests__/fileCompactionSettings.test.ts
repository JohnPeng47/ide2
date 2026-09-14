import { sha256 } from "../../../../../application/core/agents/hash";
import { readFile } from "node:fs/promises";
import { afterEach, expect, it, vi } from "vitest";
import { FILE_COMPACTION_SUBMISSION_CONTRACT, PREVIOUS_COMPACTION_SYSTEM_PROMPT, resolveFileCompactionSettings } from "../fileCompactionSettings";

afterEach(() => vi.unstubAllEnvs());
const input = { projectId: "project", sourceFile: "source.ts" };

it("loads the pinned Codex prompt by default with a verifiable source hash", async () => {
  vi.stubEnv("NEW_DIAGRAM_MODEL", "gpt-5.6-sol");
  const settings = await resolveFileCompactionSettings(input);
  const text = await readFile(new URL("../prompts/system/codex.md", import.meta.url), "utf8");
  const origin = JSON.parse(await readFile(new URL("../prompts/system/codex-source.json", import.meta.url), "utf8"));
  expect(settings).toMatchObject({
    modelId: "gpt-5.6-sol", thinkingLevel: "medium",
    systemPrompt: { kind: "codex", text, sha256: origin.sha256 }
  });
  expect(sha256(text)).toBe(origin.sha256);
  expect(settings.systemPrompt.effectiveText).toBe(`${text} ${FILE_COMPACTION_SUBMISSION_CONTRACT}`);
});

it("uses per-request Astra-high and the exact custom prompt without changing the next request", async () => {
  const settings = await resolveFileCompactionSettings({
    ...input, modelId: "gpt-6-astra", thinkingLevel: "high",
    systemPrompt: PREVIOUS_COMPACTION_SYSTEM_PROMPT
  });
  expect(settings.modelId).toBe("gpt-6-astra");
  expect(settings.thinkingLevel).toBe("high");
  expect(settings.systemPrompt.kind).toBe("custom");
  expect(settings.systemPrompt.effectiveText).toBe(`${PREVIOUS_COMPACTION_SYSTEM_PROMPT} ${FILE_COMPACTION_SUBMISSION_CONTRACT}`);
  expect((await resolveFileCompactionSettings(input)).systemPrompt.kind).toBe("codex");
});

it.each([
  { systemPrompt: "" }, { systemPrompt: 1 }, { systemPrompt: "x".repeat(64001) },
  { modelId: "astra-high" }, { thinkingLevel: "invalid" }
])("rejects invalid agent settings %j", async (options) => {
  await expect(resolveFileCompactionSettings({ ...input, ...options } as Parameters<typeof resolveFileCompactionSettings>[0])).rejects.toThrow();
});
