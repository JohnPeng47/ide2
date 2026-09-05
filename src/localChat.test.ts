import { describe, expect, it } from "vitest";
import {
  createCyclingMockLocalChatResponder,
  isLocalChatSubmitHotkey,
  type LocalChatReplyRequest
} from "./localChat";

const request: LocalChatReplyRequest = {
  query: "What does this do?",
  selection: {
    nodeIds: ["manifest"],
    rect: { startLine: 1, endLine: 2, startColumn: 1, endColumn: 20 },
    summary: "1 selected diagram node"
  },
  history: []
};

describe("createCyclingMockLocalChatResponder", () => {
  it("returns the next predefined message and wraps around", async () => {
    const responder = createCyclingMockLocalChatResponder(["first", "second"]);

    await expect(responder.reply(request)).resolves.toBe("first");
    await expect(responder.reply(request)).resolves.toBe("second");
    await expect(responder.reply(request)).resolves.toBe("first");
  });

  it("requires at least one mock response", () => {
    expect(() => createCyclingMockLocalChatResponder([])).toThrow(/cannot be empty/i);
  });
});

describe("isLocalChatSubmitHotkey", () => {
  it("accepts Ctrl+Enter outside IME composition", () => {
    expect(isLocalChatSubmitHotkey({ key: "Enter", ctrlKey: true })).toBe(true);
    expect(isLocalChatSubmitHotkey({ key: "Enter", ctrlKey: false })).toBe(false);
    expect(isLocalChatSubmitHotkey({ key: "Enter", ctrlKey: true, isComposing: true })).toBe(false);
    expect(isLocalChatSubmitHotkey({ key: "a", ctrlKey: true })).toBe(false);
  });
});
