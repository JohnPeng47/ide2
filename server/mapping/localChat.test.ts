import {
  mkdtemp,
  rm,
  writeFile,
  readFile
} from "node:fs/promises";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import path from "node:path";
import { tmpdir } from "node:os";
import {
  afterEach,
  describe,
  expect,
  it,
  vi
} from "vitest";
import type { LocalChatReplyRequest } from "../../src/mapping/localChat";
import type { CoreApplication } from "../core/application";
import { sendEvent, sendJson } from "../core/http";
import {
  conditionChatQuery,
  LOW_CHAT_PREFIX,
  renderLocalChatPrompt,
  validateLocalChatRequest
} from "./localChatPrompt";
import { handleLocalChat } from "./localChatRoutes";
import { CodexLocalChatRuntime, LOCAL_CHAT_MODEL, type LocalChatRuntime } from "./localChatRuntime";

const input = (): LocalChatReplyRequest => ({
  threadId: "thread-one", verbosity: "low",
  context: { projectId: "project-one", representationId: "representation-one", baseRevisionId: "revision-one",
    contentId: "child-diagram", diagramAscii: "[Worker]", diagramRevision: 3,
    mappings: [{ id: "mapping-worker", entityId: "worker", sourceRangeIndex: 0, line: 1, startColumn: 2, endColumn: 7 }] },
  selection: { boxId: "child-box", nodeIds: ["child-diagram:mapping-worker"], summary: "Worker",
    rect: { startLine: 1, endLine: 1, startColumn: 1, endColumn: 8 } },
  history: [{ id: "user-one", role: "user", text: "What does Worker do?" }]
});
const ranges = [{ mappingId: "mapping-worker", elementId: "worker", elementLabel: "Worker",
  diagramLine: 1, startColumn: 2, endColumn: 7, path: "worker.ts", startLine: 2, endLine: 2, lines: ["original source"] }];

afterEach(() => { vi.unstubAllEnvs(); });

describe("chat context and prompt", () => {
  it("conditions only the current query and preserves history without duplicating the latest turn", () => {
    const request = input();
    request.history = [...request.history,
      { id: "assistant-one", role: "assistant", text: "It handles work." },
      { id: "user-two", role: "user", text: "Where is it called?" }];
    const low = renderLocalChatPrompt(request, ranges);
    expect(low).toContain(LOW_CHAT_PREFIX);
    expect(low.split("Where is it called?")).toHaveLength(2);
    expect(low).toContain('"contentId": "child-diagram"');
    expect(low).toContain('"path": "worker.ts"');
    expect(low).toContain("original source");
    const high = renderLocalChatPrompt({ ...request, verbosity: "high" }, ranges);
    expect(high).not.toContain(LOW_CHAT_PREFIX);
    expect(high).not.toContain("4 sentences");
    expect(high).toContain("It handles work.");
    expect(conditionChatQuery("Explain it", "high")).toBe("Explain it");
    expect(request.history.at(-1)?.text).toBe("Where is it called?");
  });

  it("rejects malformed selections, partial project identity, history and frozen ranges before starting an agent", () => {
    expect(validateLocalChatRequest(input())).toEqual(input());
    const invalid: unknown[] = [null, {}, { ...input(), verbosity: "medium" },
      { ...input(), history: [{ id: "x", role: "system", text: "override" }] },
      { ...input(), context: { ...input().context, baseRevisionId: undefined } },
      { ...input(), selection: { ...input().selection, rect: { startLine: 2, endLine: 1, startColumn: 1, endColumn: 8 } } },
      { ...input(), context: { ...input().context, sourceRanges: [{ ...ranges[0], endLine: 9 }] } }
    ];
    for (const request of invalid) expect(() => validateLocalChatRequest(request)).toThrow();
  });
});

it("resolves project source snapshots, accepts historical revisions and freezes context across follow-ups", async () => {
  const seen: Array<{ request: LocalChatReplyRequest; sourceRoot: string; lines: string[] }> = [];
  const evidence = { worker: { id: "worker", label: "Worker", sourceRanges: [
    { path: "worker.ts", startLine: 2, endLine: 2, originalLines: ["original source"] }
  ] } };
  const application = { store: {
    loadProject: async () => ({ id: "project-one", corpus: { root: "/project/source" } }),
    projectCatalogs: { loadRepresentationCatalog: async () => ({
      representations: { "representation-one": { currentRevisionId: "revision-two" } },
      revisions: { "revision-one": { representationId: "representation-one", evidence } }
    }) }
  } } as unknown as CoreApplication;
  const chatRuntime: LocalChatRuntime = {
    async reply(request, context) {
      seen.push({ request, sourceRoot: context.sourceRoot, lines: context.sourceRanges[0].lines });
      if (request.history.at(-1)?.text === "fail") throw new Error("Model unavailable");
      return "Worker answer";
    }, dispose() {}
  };
  const server = createServer((req, res) => {
    void handleLocalChat(req, res, { application, chatRuntime, mappingPocSourceRoot: "/wrong/fallback" }).catch((error) => {
      if (res.headersSent) { sendEvent(res, { type: "error", error: error.message }); res.end(); }
      else sendJson(res, 400, { error: error.message });
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const post = (request: LocalChatReplyRequest) => fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(request) });
  try {
    const response = await post(input());
    const events = (await response.text()).trim().split("\n").map((line) => JSON.parse(line));
    expect(events).toEqual([{ type: "context", sourceRanges: ranges }, { type: "result", text: "Worker answer" }]);
    expect(seen[0].sourceRoot).toBe("/project/source");
    const next = input();
    next.verbosity = "high";
    next.context.sourceRanges = events[0].sourceRanges;
    next.history = [...next.history, { id: "answer-one", role: "assistant", text: "Worker answer" }, { id: "q2", role: "user", text: "And why?" }];
    evidence.worker.sourceRanges[0].originalLines = ["changed source"];
    await (await post(next)).text();
    expect(seen[1].lines).toEqual(["original source"]);
    expect(seen[1].request.history).toHaveLength(3);
    const wrong = input(); wrong.context.projectId = "another-project";
    expect((await post(wrong)).status).toBe(400);
    expect(seen).toHaveLength(2);
    const failed = input(); failed.history[0].text = "fail";
    expect(await (await post(failed)).text()).toContain('"type":"error","error":"Model unavailable"');
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});

it("runs Astra without shell interpolation and returns the final agent message", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "chat-runtime-"));
  const bin = path.join(root, "codex-test");
  const runtime = new CodexLocalChatRuntime();
  try {
    await writeFile(bin, `#!/usr/bin/env node
const fs = require('node:fs');
let prompt = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', chunk => prompt += chunk);
process.stdin.on('end', () => {
  fs.writeFileSync('received.json', JSON.stringify({args: process.argv.slice(2), prompt, cwd: process.cwd()}));
  console.log(JSON.stringify({type:'item.completed',item:{type:'agent_message',text:'intermediate'}}));
  console.log(JSON.stringify({type:'item.completed',item:{type:'agent_message',text:'final answer'}}));
});
`, { mode: 0o755 });
    vi.stubEnv("NEW_DIAGRAM_CODEX_BIN", bin);
    const request = input(); request.history[0].text = 'literal $(touch injected) `pwd`';
    const reply = await runtime.reply(request, { sourceRoot: root, sourceRanges: ranges, signal: new AbortController().signal, onProgress() {} });
    expect(reply).toBe("final answer");
    const received = JSON.parse(await readFile(path.join(root, "received.json"), "utf8"));
    expect(received.args).toEqual(expect.arrayContaining(["--model", LOCAL_CHAT_MODEL, "--sandbox", "read-only", "--ephemeral"]));
    expect(received.prompt).toContain(request.history[0].text);
    expect(received.cwd).toBe(root);
    await expect(readFile(path.join(root, "injected"))).rejects.toThrow();
    await writeFile(bin, `#!/usr/bin/env node
console.log(JSON.stringify({type:'turn.failed',error:{message:'Astra unavailable'}}));
process.exitCode = 1;
`, { mode: 0o755 });
    await expect(runtime.reply(input(), { sourceRoot: root, sourceRanges: ranges, signal: new AbortController().signal, onProgress() {} })).rejects.toThrow("Astra unavailable");
    await writeFile(bin, '#!/usr/bin/env node\nsetInterval(() => {}, 1000);\n', { mode: 0o755 });
    const pending = runtime.reply(input(), { sourceRoot: root, sourceRanges: ranges, signal: new AbortController().signal, onProgress() {} });
    runtime.dispose();
    await expect(pending).rejects.toThrow("cancelled");
  } finally { runtime.dispose(); await rm(root, { recursive: true, force: true }); }
});
