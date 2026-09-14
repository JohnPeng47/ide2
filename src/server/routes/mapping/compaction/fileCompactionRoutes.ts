import type { ServerResponse } from "node:http";
import type { Connect } from "vite";
import type { FileCompactionService } from "../../../../../application/mapping/compaction/fileCompactionService";
import { readBody, sendEvent, sendJson } from "../../../http/http";

export async function handleFileCompaction(request: Connect.IncomingMessage, response: ServerResponse,
  url: URL, service: FileCompactionService): Promise<void> {
  if (url.pathname !== "/api/mapping/compactions") {
    if (request.method !== "GET") return sendJson(response, 405, { error: "method not allowed" });
    const run = await service.get(url.pathname.slice("/api/mapping/compactions/".length));
    return sendJson(response, run ? 200 : 404, run ?? { error: "Compaction run not found" });
  }
  if (request.method !== "POST") return sendJson(response, 405, { error: "method not allowed" });
  const input = await readBody(request);
  const controller = new AbortController();
  const onClose = () => { if (!response.writableEnded) controller.abort(new Error("Compaction request cancelled")); };
  response.on("close", onClose);
  try {
    const prepared = await service.prepare(input);
    if (response.destroyed) return;
    controller.signal.throwIfAborted();
    response.statusCode = 200;
    response.setHeader("content-type", "application/x-ndjson; charset=utf-8");
    response.setHeader("cache-control", "no-cache, no-transform");
    response.flushHeaders();
    await service.run(prepared, { signal: controller.signal, onEvent: (event) => sendEvent(response, event) });
    response.end();
  } finally {
    response.off("close", onClose);
  }
}
