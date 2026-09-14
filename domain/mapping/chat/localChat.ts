import type { DiagramElementMapping } from "../../core/records/domain";
import type { MappingPocCorpusRangeContext } from "../selection/mappingPocPrompt";
import type { MappingPocGridRect } from "../selection/mappingPoc";

export type LocalChatVariant = "compact" | "floating" | "docked";
export type LocalChatVerbosity = "low" | "high";

export interface LocalChatContext {
  projectId?: string;
  representationId?: string;
  baseRevisionId?: string;
  contentId: string;
  diagramAscii: string;
  diagramRevision: number;
  mappings: DiagramElementMapping[];
  /** Frozen excerpts returned by the server, reused by follow-ups. */
  sourceRanges?: MappingPocCorpusRangeContext[];
}

export type LocalChatRole = "user" | "assistant";

export interface LocalChatMessage {
  id: string;
  role: LocalChatRole;
  text: string;
}

export interface LocalChatSelection {
  /** Rendering box identity; rect remains diagram-local. */
  boxId: string;
  nodeIds: string[];
  rect: MappingPocGridRect;
  summary: string;
}

export interface LocalChatThread {
  id: string;
  title: string;
  /** Older workspace snapshots may contain messages without captured source context. */
  context?: LocalChatContext;
  verbosity: LocalChatVerbosity;
  error?: string;
  progress?: string;
  selection: LocalChatSelection;
  messages: LocalChatMessage[];
  pending: boolean;
}

export interface LocalChatReplyRequest {
  threadId: string;
  context: LocalChatContext;
  verbosity: LocalChatVerbosity;
  selection: LocalChatSelection;
  /** Ordered raw messages, ending with the current user query exactly once. */
  history: readonly LocalChatMessage[];
}

export interface LocalChatResponder {
  reply(request: LocalChatReplyRequest, options?: {
    signal?: AbortSignal;
    onContext?: (ranges: MappingPocCorpusRangeContext[]) => void;
    onProgress?: (message: string) => void;
  }): Promise<string>;
}

export function isLocalChatSubmitHotkey(event: {
  key: string;
  ctrlKey: boolean;
  isComposing?: boolean;
}): boolean {
  return event.key === "Enter" && event.ctrlKey && !event.isComposing;
}
