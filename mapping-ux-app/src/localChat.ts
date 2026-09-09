import type { MappingPocGridRect } from "./mappingPoc";

export type LocalChatVariant = "compact" | "floating" | "docked";
export type LocalChatRole = "user" | "assistant";

export interface LocalChatMessage {
  id: string;
  role: LocalChatRole;
  text: string;
}

export interface LocalChatSelection {
  /** Rendering box identity; rect remains diagram-local. */
  boxId?: string;
  nodeIds: string[];
  rect: MappingPocGridRect;
  summary: string;
}

export interface LocalChatThread {
  id: string;
  title: string;
  anchor: { x: number; y: number };
  selection: LocalChatSelection;
  messages: LocalChatMessage[];
  pending: boolean;
}

export interface LocalChatReplyRequest {
  query: string;
  selection: LocalChatSelection;
  history: readonly LocalChatMessage[];
}

export interface LocalChatResponder {
  reply(request: LocalChatReplyRequest): Promise<string>;
}

export function isLocalChatSubmitHotkey(event: {
  key: string;
  ctrlKey: boolean;
  isComposing?: boolean;
}): boolean {
  return event.key === "Enter" && event.ctrlKey && !event.isComposing;
}

export const MOCK_LOCAL_CHAT_RESPONSES = [
  "Demo reply: This selection is part of the prompt, reference, lineage, and portability diagram. Open its call tree with N to inspect the linked execution paths and source compactions.",
  "Demo reply: This conversation remains attached to the selected region. The extracted app includes the original saved source evidence and projections for inspection.",
  "Demo reply: You can continue this conversation, move or collapse the canvas boxes, and save your layout locally. No language model is connected in this UX copy."
] as const;

export function createCyclingMockLocalChatResponder(
  responses: readonly string[] = MOCK_LOCAL_CHAT_RESPONSES,
  options: { delayMs?: number | (() => number) } = {}
): LocalChatResponder {
  if (responses.length === 0) throw new Error("Local chat mock responses cannot be empty");
  let nextIndex = 0;

  return {
    async reply(_request) {
      const response = responses[nextIndex];
      nextIndex = (nextIndex + 1) % responses.length;
      const configuredDelay = typeof options.delayMs === "function"
        ? options.delayMs()
        : options.delayMs ?? 0;
      const delayMs = Math.max(0, configuredDelay);
      if (delayMs > 0) {
        await new Promise<void>((resolve) => globalThis.setTimeout(resolve, delayMs));
      }
      return response;
    }
  };
}
