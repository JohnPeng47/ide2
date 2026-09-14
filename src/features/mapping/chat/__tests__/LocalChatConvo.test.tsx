import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { LocalChatThread } from "../../../../../domain/mapping/chat/localChat";
import { LocalChatConvo } from "../LocalChatConvo";

const thread: LocalChatThread = {
  id: "thread-1",
  title: "2 selected nodes",
  context: { contentId: "overview", diagramAscii: "Diagram", diagramRevision: 0, mappings: [] },
  verbosity: "low",
  selection: {
    boxId: "overview",
    nodeIds: ["one", "two"],
    rect: { startLine: 1, endLine: 3, startColumn: 2, endColumn: 20 },
    summary: "2 selected nodes"
  },
  messages: [
    { id: "m1", role: "user", text: "Explain this region" },
    { id: "m2", role: "assistant", text: "It constructs the prompt." }
  ],
  pending: false
};

describe("LocalChatConvo", () => {
  it("renders a local thread in the selected UI variant", () => {
    const html = renderToStaticMarkup(
      <LocalChatConvo thread={thread} variant="floating" onSubmit={() => undefined} onClose={() => undefined} onVerbosityChange={() => undefined} onRetry={() => undefined} />
    );

    expect(html).toContain('data-local-chat-convo="floating"');
    expect(html).toContain("Explain this region");
    expect(html).toContain("It constructs the prompt.");
    expect(html).toContain("Follow up");
  });
});
