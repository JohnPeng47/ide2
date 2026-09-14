import { afterEach, describe, expect, it, vi } from "vitest";
import type { FileCompactionDraft } from "../../../../../domain/mapping/compaction/fileCompaction";

type SubmissionTool = { execute(id: string, draft: FileCompactionDraft): Promise<{ details: { accepted: boolean } }> };
const harness = vi.hoisted(() => ({
  create: vi.fn(),
  model: vi.fn(),
  resources: vi.fn(),
  actions: [] as ((tool: SubmissionTool) => Promise<void>)[],
  chats: [] as { prompts: string[]; abort: ReturnType<typeof vi.fn>; dispose: ReturnType<typeof vi.fn> }[]
}));
vi.mock("@earendil-works/pi-coding-agent", () => ({
  ModelRuntime: { create: async () => ({ getModel: (provider: string, id: string) => {
    harness.model(provider, id); return { id };
  }, hasConfiguredAuth: () => true }) },
  DefaultResourceLoader: class { constructor(options: unknown) { harness.resources(options); } async reload() {} },
  getAgentDir: () => "/tmp",
  SessionManager: { inMemory: () => ({}) },
  SettingsManager: { inMemory: () => ({}) },
  defineTool: (tool: unknown) => tool,
  createAgentSession: async (options: { customTools: SubmissionTool[] }) => {
    harness.create(options);
    const chat = { prompts: [] as string[], abort: vi.fn(async () => {}), dispose: vi.fn() };
    harness.chats.push(chat);
    return { session: {
      sessionId: `chat-${harness.chats.length}`, ...chat,
      subscribe: () => () => {},
      prompt: async (text: string) => {
        chat.prompts.push(text);
        await harness.actions.shift()?.(options.customTools[0]);
      }
    } };
  }
}));

import { PiFileCompactionRuntime } from "../fileCompactionRuntime";
import { sha256 } from "../fileCompactionWorkflow";
import { resolveFileCompactionSettings } from "../fileCompactionSettings";

const draft = (label = "original"): FileCompactionDraft => ({ ascii: `source.ts\n\\-- ${label}`, mappings: [
  { treeLine: 1, sourceRanges: [{ startLine: 1, endLine: 1 }] },
  { treeLine: 2, sourceRanges: [{ startLine: 1, endLine: 1 }] }
] });
const context = { sourceRoot: "/tmp", agent: await resolveFileCompactionSettings({
  projectId: "test", sourceFile: "source.ts", modelId: "gpt-6-astra", thinkingLevel: "high", systemPrompt: "Test base system prompt"
}), source: {
  sourceFile: "source.ts", text: "export const a = 1;", lineCount: 1, sourceSha256: sha256("export const a = 1;")
} };
const step = (stepId: string) => ({ workflowId: "single-file-compaction", stepId, prompt: stepId });

afterEach(() => { harness.actions.length = 0; harness.chats.length = 0; vi.clearAllMocks(); });

describe("compaction agent session", () => {
  it("uses one chat for both turns and keeps a rejected-submission correction in that chat", async () => {
    const runtime = new PiFileCompactionRuntime();
    const session = await runtime.openSession(context);
    expect(harness.model).toHaveBeenCalledWith("openai-codex", "gpt-6-astra");
    expect(harness.create).toHaveBeenCalledWith(expect.objectContaining({ thinkingLevel: "high" }));
    expect(harness.resources).toHaveBeenCalledWith(expect.objectContaining({ systemPrompt: context.agent.systemPrompt.effectiveText }));
    harness.actions.push(async (tool) => {
      expect((await tool.execute("bad", { ascii: "bad", mappings: [] })).details.accepted).toBe(false);
      expect((await tool.execute("good", draft())).details.accepted).toBe(true);
    }, async (tool) => { await tool.execute("refined", draft("refined")); });
    expect((await session.runStep(step("compact"), () => {})).draft).toEqual(draft());
    expect(harness.chats[0].dispose).not.toHaveBeenCalled();
    expect((await session.runStep(step("refine"), () => {})).draft).toEqual(draft("refined"));
    expect(harness.create).toHaveBeenCalledTimes(1);
    expect(harness.chats[0].prompts).toEqual(["compact", "refine"]);
    session.dispose(); runtime.dispose();
    expect(harness.chats[0].dispose).toHaveBeenCalledTimes(1);
  });

  it("requires a new submission in the second turn", async () => {
    const runtime = new PiFileCompactionRuntime();
    const session = await runtime.openSession(context);
    harness.actions.push(async (tool) => { await tool.execute("first", draft()); });
    try {
      await session.runStep(step("compact"), () => {});
      await expect(session.runStep(step("refine"), () => {})).rejects.toThrow("refine finished without an accepted compaction");
    } finally { session.dispose(); runtime.dispose(); }
    expect(harness.chats[0].dispose).toHaveBeenCalledTimes(1);
  });

  it("aborts the active chat and disposes it on cancellation", async () => {
    const runtime = new PiFileCompactionRuntime();
    const controller = new AbortController();
    const session = await runtime.openSession({ ...context, signal: controller.signal });
    harness.actions.push(async () => { controller.abort(new Error("cancelled")); });
    try {
      await expect(session.runStep({ ...step("compact"), signal: controller.signal }, () => {})).rejects.toThrow("cancelled");
    } finally { session.dispose(); runtime.dispose(); }
    expect(harness.chats[0].abort).toHaveBeenCalledTimes(1);
    expect(harness.chats[0].dispose).toHaveBeenCalledTimes(1);
  });

  it("creates independent chats for separate workflow runs", async () => {
    const runtime = new PiFileCompactionRuntime();
    const first = await runtime.openSession(context);
    const second = await runtime.openSession(context);
    harness.actions.push(async (tool) => { await tool.execute("first", draft("A")); },
      async (tool) => { await tool.execute("second", draft("B")); });
    try {
      expect((await first.runStep(step("first-run"), () => {})).draft.ascii).toContain("A");
      expect((await second.runStep(step("second-run"), () => {})).draft.ascii).toContain("B");
      expect(harness.chats.map((chat) => chat.prompts)).toEqual([["first-run"], ["second-run"]]);
    } finally { first.dispose(); second.dispose(); runtime.dispose(); }
  });
});
