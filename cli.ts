#!/usr/bin/env node

import { spawn } from "node:child_process";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const DEFAULT_SERVER_URL = "http://127.0.0.1:5173";
const PACKAGE_ROOT = path.dirname(fileURLToPath(import.meta.url));

interface ServerEvent {
  type: "created" | "progress" | "workspace" | "result" | "error";
  message?: string;
  error?: string;
  diagramSetId?: string;
  projectRoot?: string;
  promptTemplateId?: string;
  promptTemplateVersion?: number;
  generationPromptConfigId?: string;
  codeEntityPromptTemplateId?: string;
  codeEntityPromptTemplateVersion?: number;
  codeEntityPromptConfigId?: string;
}

interface PromptTemplateSummary {
  id: string;
  label: string;
  description: string;
  builtIn: boolean;
  version: number;
}

function option(args: string[], name: string): string | undefined {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : undefined;
}

function usage(): never {
  throw new Error(
    "usage:\n"
    + "  npm run diagram -- serve --path <repo> [--diagrams-dir <dir>] [--port <port>]\n"
    + "  npm run diagram -- prompt-templates [--server <url>]\n"
    + "  npm run diagram -- create --path <repo> --name <name> --prompt <prompt> "
    + "[--prompt-template <id>] [--reference-prompt <prompt>] [--no-reference-prompt] "
    + "[--server <url>]"
  );
}

async function serve(args: string[]): Promise<void> {
  const projectRoot = path.resolve(option(args, "--path") ?? process.cwd());
  const diagramsDirectory = option(args, "--diagrams-dir") ?? ".diagrams";
  const host = option(args, "--host") ?? "127.0.0.1";
  const portText = option(args, "--port") ?? "5173";
  const port = Number(portText);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error(`invalid server port: ${portText}`);
  }
  const diagramsRoot = path.resolve(projectRoot, diagramsDirectory);
  await mkdir(diagramsRoot, { recursive: true });
  const serverUrl = `http://${host}:${port}`;
  process.stdout.write(`${JSON.stringify({
    event: "server-starting",
    serverUrl,
    projectRoot,
    diagramsRoot
  })}\n`);

  const server = spawn(
    process.execPath,
    [
      path.join(PACKAGE_ROOT, "node_modules/vite/bin/vite.js"),
      "--host", host,
      "--port", String(port),
      "--strictPort"
    ],
    {
      cwd: PACKAGE_ROOT,
      env: {
        ...process.env,
        NEW_DIAGRAM_PROJECT_ROOT: projectRoot,
        NEW_DIAGRAMS_DIR: diagramsDirectory
      },
      stdio: "inherit"
    }
  );
  const forward = (signal: NodeJS.Signals) => server.kill(signal);
  process.once("SIGINT", () => forward("SIGINT"));
  process.once("SIGTERM", () => forward("SIGTERM"));
  const result = await new Promise<{ code: number | null; signal: NodeJS.Signals | null }>(
    (resolve, reject) => {
      server.once("error", reject);
      server.once("exit", (code, signal) => resolve({ code, signal }));
    }
  );
  if (result.signal) return;
  if (result.code !== 0) process.exitCode = result.code ?? 1;
}

function endpointFor(serverUrl: string): URL {
  let server: URL;
  try {
    server = new URL(serverUrl);
  } catch {
    throw new Error(`invalid diagram server URL: ${serverUrl}`);
  }
  return new URL("/api/diagram-sets", server);
}

function serverUrlFrom(args: string[]): string {
  return option(args, "--server")
    ?? process.env.NEW_DIAGRAM_SERVER_URL
    ?? DEFAULT_SERVER_URL;
}

async function listPromptTemplates(args: string[]): Promise<void> {
  const serverUrl = serverUrlFrom(args);
  const endpoint = new URL("/api/system-prompt-templates", endpointFor(serverUrl));
  let response: Response;
  try {
    response = await fetch(endpoint, { headers: { accept: "application/json" } });
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    throw new Error(`cannot reach diagram server at ${endpoint.origin}: ${reason}`);
  }
  if (!response.ok) throw await responseError(response);
  const payload = await response.json() as { templates?: PromptTemplateSummary[] };
  if (!Array.isArray(payload.templates)) {
    throw new Error("diagram server returned an invalid prompt-template list");
  }
  process.stdout.write(`${JSON.stringify({
    event: "prompt-templates",
    serverUrl: endpoint.origin,
    templates: payload.templates.map(({ id, label, description, builtIn, version }) => ({
      id,
      label,
      description,
      builtIn,
      version
    }))
  })}\n`);
}

async function responseError(response: Response): Promise<Error> {
  const payload = await response.json().catch(() => ({})) as { error?: string };
  return new Error(payload.error || `diagram server request failed with ${response.status}`);
}

async function consumeEvents(
  response: Response,
  onEvent: (event: ServerEvent) => void
): Promise<void> {
  if (!response.body) throw new Error("diagram server response did not include a stream");
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  while (true) {
    const { done, value } = await reader.read();
    buffer += decoder.decode(value, { stream: !done });
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";
    for (const line of lines) {
      if (line.trim()) onEvent(JSON.parse(line) as ServerEvent);
    }
    if (done) break;
  }
  if (buffer.trim()) onEvent(JSON.parse(buffer) as ServerEvent);
}

async function main(): Promise<void> {
  const [command, ...args] = process.argv.slice(2);
  if (command === "serve") {
    await serve(args);
    return;
  }
  if (command === "prompt-templates") {
    await listPromptTemplates(args);
    return;
  }
  if (command !== "create") usage();
  const inputPath = option(args, "--path");
  const name = option(args, "--name");
  const prompt = option(args, "--prompt") ?? "";
  const promptTemplateId = option(args, "--prompt-template");
  const referencePrompt = option(args, "--reference-prompt");
  const runReferencePrompt = !args.includes("--no-reference-prompt");
  const serverUrl = serverUrlFrom(args);
  if (!inputPath || !name) usage();
  if (!runReferencePrompt && referencePrompt !== undefined) {
    throw new Error("--reference-prompt cannot be combined with --no-reference-prompt");
  }

  const endpoint = endpointFor(serverUrl);
  process.stdout.write(`${JSON.stringify({
    event: "server",
    serverUrl: endpoint.origin
  })}\n`);
  let response: Response;
  try {
    response = await fetch(endpoint, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        path: inputPath,
        name,
        prompt,
        runReferencePrompt,
        ...(referencePrompt !== undefined ? { referencePrompt } : {}),
        ...(promptTemplateId ? { promptTemplateId } : {})
      })
    });
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    throw new Error(`cannot reach diagram server at ${endpoint.origin}: ${reason}`);
  }
  if (!response.ok) throw await responseError(response);

  let diagramSetId: string | undefined;
  let resolvedPromptTemplateId: string | undefined;
  let promptTemplateVersion: number | undefined;
  let generationPromptConfigId: string | undefined;
  let codeEntityPromptTemplateId: string | undefined;
  let codeEntityPromptTemplateVersion: number | undefined;
  let codeEntityPromptConfigId: string | undefined;
  await consumeEvents(response, (event) => {
    if (event.type === "error") throw new Error(event.error || "diagram collection failed");
    if (event.type === "created") {
      diagramSetId = event.diagramSetId;
      resolvedPromptTemplateId = event.promptTemplateId;
      codeEntityPromptTemplateId = event.codeEntityPromptTemplateId;
      process.stdout.write(`${JSON.stringify({
        event: "created",
        projectRoot: event.projectRoot,
        diagramSetId,
        ui: `Open the studio at ${endpoint.origin}.`
      })}\n`);
      return;
    }
    if (event.type === "result") {
      resolvedPromptTemplateId = event.promptTemplateId ?? resolvedPromptTemplateId;
      promptTemplateVersion = event.promptTemplateVersion;
      generationPromptConfigId = event.generationPromptConfigId;
      codeEntityPromptTemplateId = event.codeEntityPromptTemplateId ?? codeEntityPromptTemplateId;
      codeEntityPromptTemplateVersion = event.codeEntityPromptTemplateVersion;
      codeEntityPromptConfigId = event.codeEntityPromptConfigId;
      return;
    }
    if (event.type === "progress" && event.message) {
      process.stderr.write(`[progress] ${event.message}\n`);
    }
  });
  if (!diagramSetId) throw new Error("diagram server stream ended before creating a DiagramSet");
  process.stdout.write(`${JSON.stringify({
    event: "ready",
    diagramSetId,
    promptTemplateId: resolvedPromptTemplateId,
    promptTemplateVersion,
    generationPromptConfigId,
    codeEntityPromptTemplateId,
    codeEntityPromptTemplateVersion,
    codeEntityPromptConfigId
  })}\n`);
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
