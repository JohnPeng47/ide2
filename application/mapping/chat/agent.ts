import type { LocalChatReplyRequest } from "../../../domain/mapping/chat/localChat";
import type { MappingPocCorpusRangeContext } from "../../../domain/mapping/selection/mappingPocPrompt";

export interface LocalChatRuntime {
  reply(request: LocalChatReplyRequest, context: {
    sourceRoot: string;
    sourceRanges: MappingPocCorpusRangeContext[];
    signal: AbortSignal;
    onProgress: (message: string) => void;
  }): Promise<string>;
  dispose(): void;
}
