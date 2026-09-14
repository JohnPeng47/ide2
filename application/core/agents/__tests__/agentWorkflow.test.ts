import { describe, expect, it, vi } from "vitest";
import { runAgentWorkflow, type AgentWorkflow } from "../agentWorkflow";

describe("agent workflows", () => {
  it("awaits validation before handing the accepted output to the next step", async () => {
    const events: string[] = [];
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const workflow: AgentWorkflow<string> = {
      id: "file-compaction",
      steps: [
        {
          id: "compact", prompt: () => "Read source", validate: async () => {
            events.push("validating");
            await gate;
            events.push("validated");
          }
        },
        {
          id: "refine", before: (previous) => { events.push(`before:${previous}`); },
          prompt: (previous) => `Refine ${previous}`
        }
      ]
    };
    const running = runAgentWorkflow(workflow, async ({ prompt }) => {
      events.push(prompt);
      return prompt === "Read source" ? "draft" : "final";
    });
    await vi.waitFor(() => expect(events).toEqual(["Read source", "validating"]));
    release();
    await expect(running).resolves.toBe("final");
    expect(events).toEqual(["Read source", "validating", "validated", "before:draft", "Refine draft"]);
  });

  it.each(["missing", "invalid", "failed"])("stops after a %s first step", async (failure) => {
    const execute = vi.fn(async () => {
      if (failure === "failed") throw new Error("agent failed");
      return failure === "missing" ? undefined : "bad";
    });
    const workflow: AgentWorkflow<string> = {
      id: "test", steps: [
        { id: "first", prompt: () => "first", validate: () => { throw new Error("invalid output"); } },
        { id: "second", prompt: () => "second" }
      ]
    };
    await expect(runAgentWorkflow(workflow, execute)).rejects.toThrow(
      failure === "missing" ? "test/first finished without an accepted submission"
        : failure === "invalid" ? "invalid output" : "agent failed"
    );
    expect(execute).toHaveBeenCalledTimes(1);
  });

  it("forwards cancellation and prevents advancing after an aborted execution", async () => {
    const controller = new AbortController();
    const execute = vi.fn(async ({ signal }) => {
      expect(signal).toBe(controller.signal);
      controller.abort(new Error("cancelled"));
      return "draft";
    });
    const workflow: AgentWorkflow<string> = {
      id: "test", steps: [
        { id: "first", prompt: () => "first" }, { id: "second", prompt: () => "second" }
      ]
    };
    await expect(runAgentWorkflow(workflow, execute, { signal: controller.signal })).rejects.toThrow("cancelled");
    expect(execute).toHaveBeenCalledTimes(1);
    execute.mockClear();
    await expect(runAgentWorkflow(workflow, execute, { signal: controller.signal })).rejects.toThrow("cancelled");
    expect(execute).not.toHaveBeenCalled();
  });

  it("rejects empty sequences and duplicate step ids before executing", async () => {
    const execute = vi.fn();
    await expect(runAgentWorkflow({ id: "empty", steps: [] }, execute)).rejects.toThrow("at least one step");
    const step = { id: "duplicate", prompt: () => "prompt" };
    await expect(runAgentWorkflow({ id: "duplicates", steps: [step, step] }, execute)).rejects.toThrow("duplicate");
    expect(execute).not.toHaveBeenCalled();
  });
});
