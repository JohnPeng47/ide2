import type { ServerResponse } from "node:http";
import type { Connect } from "vite";
import { mappingsForSelection } from "../../src/core/diagramSelection";
import type { CoreApplication } from "../core/application";
import type { ProjectRepresentationEvidenceRecord } from "../../src/core/projectCatalog";
import { readBody, sendEvent, sendJson } from "../core/http";
import { validateLocalChatRequest } from "./localChatPrompt";
import type { LocalChatRuntime } from "./localChatRuntime";
import { mappingPocSourceContextForSelection } from "./mappingPocSourceContext";

export async function handleLocalChat(request: Connect.IncomingMessage, response: ServerResponse, dependencies: {
  application: CoreApplication;
  chatRuntime: LocalChatRuntime;
  mappingPocSourceRoot: string;
}): Promise<void> {
  if (request.method !== "POST") return sendJson(response, 405, { error: "method not allowed" });
  const input = validateLocalChatRequest(await readBody(request));
  const { context, selection } = input;
  let sourceRoot = dependencies.mappingPocSourceRoot;
  let projectEvidence: Record<string, ProjectRepresentationEvidenceRecord> | undefined;
  if (context.projectId) {
    const project = await dependencies.application.store.loadProject();
    if (!project || project.id !== context.projectId) throw new Error("Diagram belongs to another Project");
    const catalog = await dependencies.application.store.projectCatalogs.loadRepresentationCatalog(project.id);
    const revision = catalog.revisions[context.baseRevisionId!];
    // Historical revisions remain valid: existing chats retain their original selection.
    if (!revision || revision.representationId !== context.representationId) throw new Error("Diagram revision does not belong to this representation");
    projectEvidence = revision.evidence;
    sourceRoot = project.corpus.root;
  }
  const sourceRanges = context.sourceRanges ?? (mappingsForSelection(context.mappings, selection.rect).length
    ? await mappingPocSourceContextForSelection({ sourceRoot, projectEvidence, mappings: context.mappings, selection: selection.rect })
    : []);
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
    const text = await dependencies.chatRuntime.reply(input, {
      sourceRoot, sourceRanges, signal: controller.signal,
      onProgress: (message) => sendEvent(response, { type: "progress", message })
    });
    sendEvent(response, { type: "result", text });
    response.end();
  } finally {
    response.off("close", onClose);
  }
}
