import type { ChatSession } from '../../../domain/mapping/agent-chat/agentChat';
import type { ShortCanvasContext } from '../../../domain/mapping/agent/shortContext';

export interface ChatCanvasReader {
  shortContextForCanvas(workspaceInstanceId: string, documentId: string): Promise<ShortCanvasContext & {
    workspaceInstanceId: string; documentId: string; canvasEpoch: string;
  }>;
}

export interface CodexMessage { method: string; params: Record<string, unknown>; id?: string | number }
export interface CodexConnection {
  request<T>(method: string, params: Record<string, unknown>): Promise<T>;
  respond(id: string | number, result: unknown): void;
  reject(id: string | number, message: string): void;
  subscribe(listener: (message: CodexMessage) => void, onExit: (error: string) => void): () => void;
  dispose(): void;
}
export interface ChatStore { list(): Promise<ChatSession[]>; save(session: ChatSession): Promise<void> }
export type ChatToolSession = Pick<ChatSession, 'id' | 'settings' | 'canvasContext'>;
export interface ChatTools {
  definitions: { type: 'function'; name: string; description: string; inputSchema: Record<string, unknown> }[];
  call(name: string, input: unknown, session: ChatToolSession): Promise<unknown>;
}

export interface ChatMcpBinding {
  setOrigin(origin: string): void;
  config(chatId: string): Record<string, unknown>;
  bind(chatId: string, target: import('../../../domain/mapping/agent-chat/agentChat').ChatCanvasTarget | undefined, readOnly: boolean): void;
  clear(chatId: string): void;
}
