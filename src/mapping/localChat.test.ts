import { describe, expect, it } from "vitest";
import { isLocalChatSubmitHotkey } from "./localChat";

describe("isLocalChatSubmitHotkey", () => {
  it("accepts Ctrl+Enter outside IME composition", () => {
    expect(isLocalChatSubmitHotkey({ key: "Enter", ctrlKey: true })).toBe(true);
    expect(isLocalChatSubmitHotkey({ key: "Enter", ctrlKey: false })).toBe(false);
    expect(isLocalChatSubmitHotkey({ key: "Enter", ctrlKey: true, isComposing: true })).toBe(false);
    expect(isLocalChatSubmitHotkey({ key: "a", ctrlKey: true })).toBe(false);
  });
});
