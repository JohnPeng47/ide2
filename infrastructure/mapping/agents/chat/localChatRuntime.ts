import { requireAiEnabled } from '../../../../application/core/errors';
import { spawn, type ChildProcess } from "node:child_process";
import type { LocalChatRuntime } from "../../../../application/mapping/chat/agent";
import type { LocalChatReplyRequest } from "../../../../domain/mapping/chat/localChat";
import { renderLocalChatPrompt } from "../../../../domain/mapping/chat/localChatPrompt";
export type { LocalChatRuntime } from "../../../../application/mapping/chat/agent";

export const LOCAL_CHAT_MODEL = "gpt-6-astra";

/** Each turn is an ephemeral agent with the original context plus raw chat history. */
export class CodexLocalChatRuntime implements LocalChatRuntime {
  constructor(private readonly enabled = false) {}
  private readonly cancellations = new Map<ChildProcess, () => void>();

  async reply(request: LocalChatReplyRequest, context: Parameters<LocalChatRuntime["reply"]>[1]): Promise<string> {
    requireAiEnabled(this.enabled);
    context.signal.throwIfAborted();
    return new Promise<string>((resolve, reject) => {
      const child = spawn(process.env.NEW_DIAGRAM_CODEX_BIN || "codex", [
        "exec", "--model", LOCAL_CHAT_MODEL, "--sandbox", "read-only",
        "-c", 'approval_policy="never"', "--ephemeral", "--skip-git-repo-check",
        "--json", "--color", "never", "--cd", context.sourceRoot, "-"
      ], { cwd: context.sourceRoot, stdio: ["pipe", "pipe", "pipe"] });
      let buffer = "";
      let reply = "";
      let failure = "";
      let settled = false;
      let bytes = 0;
      let forceKill: ReturnType<typeof setTimeout> | undefined;
      const stop = () => {
        if (child.exitCode !== null || child.signalCode !== null) return;
        child.kill("SIGTERM");
        forceKill ??= setTimeout(() => child.kill("SIGKILL"), 2000);
        forceKill.unref();
      };
      const finish = (error?: Error) => {
        if (settled) return;
        settled = true;
        clearTimeout(timeout);
        context.signal.removeEventListener("abort", abort);
        if (error) { stop(); reject(error); }
        else resolve(reply);
      };
      const abort = () => finish(new Error("Chat request cancelled"));
      this.cancellations.set(child, abort);
      const timeout = setTimeout(() => finish(new Error("Codex chat timed out; retry the question")), 300000);
      context.signal.addEventListener("abort", abort, { once: true });
      const consume = (line: string) => {
        if (!line.trim()) return;
        try {
          const event = JSON.parse(line);
          if (event.type === "item.completed" && event.item?.type === "agent_message") reply = event.item.text;
          if (event.type === "item.started" && event.item?.type === "command_execution") context.onProgress("Inspecting project files…");
          if (event.type === "turn.started") context.onProgress("Thinking…");
          if (event.type === "turn.failed") failure = event.error?.message || "Codex chat failed";
        } catch { /* Ignore non-event diagnostics; they are never added to the transcript. */ }
      };
      child.stdout.setEncoding("utf8");
      child.stdout.on("data", (chunk: string) => {
        bytes += Buffer.byteLength(chunk);
        if (bytes > 8 * 1024 * 1024) return finish(new Error("Codex chat output exceeded its limit"));
        buffer += chunk;
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";
        lines.forEach(consume);
      });
      child.stderr.resume();
      child.stdin.on("error", (error) => finish(new Error(`Could not send chat context to Codex: ${error.message}`)));
      child.on("error", (error) => finish(new Error(`Could not start Codex (${LOCAL_CHAT_MODEL}): ${error.message}`)));
      child.on("close", (code) => {
        this.cancellations.delete(child);
        clearTimeout(forceKill);
        consume(buffer);
        finish(failure || code !== 0 || !reply.trim()
          ? new Error(failure || `Codex (${LOCAL_CHAT_MODEL}) exited ${code ?? "without a status"} without an answer. Check Codex authentication and model access.`)
          : undefined);
      });
      if (context.signal.aborted) abort();
      else child.stdin.end(renderLocalChatPrompt(request, context.sourceRanges));
    });
  }

  dispose(): void {
    for (const cancel of this.cancellations.values()) cancel();
  }
}

/** Explicit server test mode; the production client always goes through HTTP. */
export class FakeLocalChatRuntime implements LocalChatRuntime {
  async reply(request: LocalChatReplyRequest, context: Parameters<LocalChatRuntime["reply"]>[1]): Promise<string> {
    context.signal.throwIfAborted();
    return `Test answer for ${request.context.contentId}: ${request.history.at(-1)!.text} (${request.history.length} messages, ${context.sourceRanges.length} source ranges, ${request.verbosity}).`;
  }
  dispose(): void { }
}
