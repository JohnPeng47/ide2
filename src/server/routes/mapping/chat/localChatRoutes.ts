import type { ServerResponse } from "node:http";
import type { Connect } from "vite";
import type { LocalChatService } from '../../../../../application/mapping/chat/chatService';
import { readBody, sendEvent, sendJson } from "../../../http/http";

export async function handleLocalChat(request: Connect.IncomingMessage, response: ServerResponse, chat: LocalChatService): Promise<void> {
  if (request.method !== "POST") return sendJson(response, 405, { error: "method not allowed" });
  const prepared = await chat.prepare(await readBody(request));
  const { sourceRanges } = prepared;
  if (response.destroyed) return;
  const controller = new AbortController();
  const onClose = () => { if (!response.writableEnded) controller.abort(); };
  response.on("close", onClose);
  try {
    response.statusCode = 200;
    response.setHeader("content-type", "application/x-ndjson; charset=utf-8");
    response.setHeader("cache-control", "no-cache, no-transform");
    response.flushHeaders();
    sendEvent(response, { type: "context", sourceRanges });
    const text = await chat.reply(prepared, {
      signal: controller.signal,
      onProgress: (message) => sendEvent(response, { type: "progress", message })
    });
    sendEvent(response, { type: "result", text });
    response.end();
  } finally {
    response.off("close", onClose);
  }
}
