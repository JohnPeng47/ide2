import { apiFetch, errorFrom } from "../core/http";
import type { MappingPocPromptRequest, MappingPocPromptResult } from "./mappingPocPrompt";

export async function promptMappingPocSelection(
  request: MappingPocPromptRequest,
  onProgress: (message: string) => void
): Promise<MappingPocPromptResult> {
  const response = await apiFetch("/api/mapping/prompt", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(request)
  });
  if (!response.ok) throw await errorFrom(response);
  if (!response.body) throw new Error("diagram prompt response did not include a stream");
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let result: MappingPocPromptResult | undefined;
  const consume = (line: string) => {
    if (!line.trim()) return;
    const event = JSON.parse(line) as {
      type?: string;
      message?: string;
      error?: string;
      result?: MappingPocPromptResult;
    };
    if (event.type === "error") throw new Error(event.error || "diagram prompt failed");
    if (event.type === "progress" && event.message) onProgress(event.message);
    if (event.type === "result" && event.result) result = event.result;
  };
  while (true) {
    const { done, value } = await reader.read();
    buffer += decoder.decode(value, { stream: !done });
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";
    for (const line of lines) consume(line);
    if (done) break;
  }
  if (buffer.trim()) consume(buffer);
  if (!result) throw new Error("diagram prompt stream ended without a patch result");
  return result;
}
export const localChatResponder: import("./localChat").LocalChatResponder = {
  async reply(request, options) {
    const response = await apiFetch("/api/mapping/chat", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(request),
      signal: options?.signal
    });
    if (!response.ok) throw await errorFrom(response);
    if (!response.body) throw new Error("Chat response did not include a stream");
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let reply: string | undefined;
    const consume = (line: string) => {
      if (!line.trim()) return;
      const event = JSON.parse(line);
      if (event.type === "error") throw new Error(event.error || "Chat failed");
      if (event.type === "context") options?.onContext?.(event.sourceRanges);
      if (event.type === "progress") options?.onProgress?.(event.message);
      if (event.type === "result") reply = event.text;
    };
    try {
      while (true) {
        const { done, value } = await reader.read();
        buffer += decoder.decode(value, { stream: !done });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";
        for (const line of lines) consume(line);
        if (done) break;
      }
      consume(buffer);
      if (!reply?.trim()) throw new Error("Chat ended without an answer");
      return reply;
    } finally {
      await reader.cancel().catch(() => {});
      reader.releaseLock();
    }
  }
};
