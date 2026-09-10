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
  "This region defines the handoff from the experiment manifest into prompt construction. The important contract is that the axis and iteration choose the prompt block before generation begins.",
  "The mapped corpus ranges provide the source context for this slice. I would keep that context attached to the conversation so follow-up questions can refer to the same selected nodes without another selection gesture.",
  "The next useful inspection point is the runtime boundary: it owns artifact generation, while the model session remains an implementation detail below that seam."
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
