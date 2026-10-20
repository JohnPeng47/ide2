import { z } from 'zod';
import { promptReferenceSchema } from '../agent/diagramEdit';

export const chatSettingsSchema = z.object({
  model: z.string().max(200).default(''),
  effort: z.string().max(40).default(''),
  sandbox: z.enum(['read-only', 'workspace-write', 'danger-full-access']).default('danger-full-access')
});
export type ChatSettings = z.infer<typeof chatSettingsSchema>;
export const chatCanvasTargetSchema = z.object({ workspaceInstanceId: z.string().min(1).max(200), documentId: z.string().min(1).max(200) }).strict();
export type ChatCanvasTarget = z.infer<typeof chatCanvasTargetSchema>;
/** Browser-captured context, pinned to the same revision as the visible selection. */
export const chatReferenceSchema = z.object({
  canvas: chatCanvasTargetSchema, canvasName: z.string().max(200), displayNodeId: z.string().min(1).max(200),
  reference: promptReferenceSchema, ascii: z.string().max(100_000)
}).strict();
export type ChatReference = z.infer<typeof chatReferenceSchema>;
export const chatReferencesSchema = z.array(chatReferenceSchema).max(20, 'Select at most 20 references.')
  .refine(refs => refs.reduce((size, ref) => size + ref.ascii.length, 0) <= 100_000, 'Selected references are too large. Select a smaller region.');
export const chatSendSchema = chatSettingsSchema.extend({ text: z.string().trim().min(1).max(100_000), requestId: z.string().uuid(), references: chatReferencesSchema.optional(), canvas: chatCanvasTargetSchema.optional() });
export type ChatSend = z.infer<typeof chatSendSchema>;
export const chatReadCanvasSchema = chatSettingsSchema.extend({ requestId: z.string().uuid(), canvas: chatCanvasTargetSchema });
export type ChatReadCanvas = z.infer<typeof chatReadCanvasSchema>;
export const chatAnswerSchema = z.object({
  decision: z.enum(['accept', 'decline']).optional(),
  answers: z.record(z.string(), z.array(z.string().max(20_000))).optional()
});
export type ChatAnswer = z.infer<typeof chatAnswerSchema>;
export interface CommandAction { type: string; name?: string; path?: string; query?: string; command?: string }
export interface ChatFileChange { path: string; kind: string; diff: string; added: number; removed: number; omittedChars?: number }
export interface ChatItem {
  id: string; kind: 'user' | 'assistant' | 'reasoning' | 'tool' | 'plan' | 'interaction' | 'notice';
  title?: string; text: string; status: string; turnId?: string; sourceType?: string;
  references?: ChatReference[];
  phase?: 'commentary' | 'partial_answer' | 'final_answer';
  command?: { command: string; actions: CommandAction[]; source?: string; processId?: string; exitCode?: number; durationMs?: number };
  changes?: ChatFileChange[];
  plan?: { step: string; status: string }[];
  omittedChars?: number;
  /** Transport preview only. Canonical retained details remain on the server. */
  detailAvailable?: boolean;
}
export interface ChatQuestion { id: string; header: string; question: string; isSecret?: boolean; options?: { label: string; description: string }[] | null }
export interface ChatApproval { id: string; kind: 'approval' | 'input' | 'permissions'; title: string; detail: string; questions?: ChatQuestion[]; turnId?: string }
export interface ChatSession {
  canvasTools?: boolean;
  canvasContext?: { canvas?: ChatCanvasTarget; references: ChatReference[] };
  id: string; threadId: string; title: string; cwd: string; createdAt: string; updatedAt: string;
  settings: ChatSettings; status: 'idle' | 'running' | 'interrupted' | 'failed'; turnId?: string | null;
  items: ChatItem[]; pending: ChatApproval[]; error?: string | null; usage?: number;
  requestIds: string[];
  schemaVersion?: 2;
  activity?: string | null;
  turnStartedAt?: string;
  completedAt?: string | null;
}
export type ChatSessionSummary = Pick<ChatSession, 'id' | 'title' | 'cwd' | 'updatedAt' | 'status'>;
export interface ChatModel { id: string; name: string; efforts: string[]; defaultEffort: string; isDefault: boolean }
export interface ChatInfo { cwd: string; models: ChatModel[]; account: string }
export type ChatUpdate =
  | { type: 'item'; item: ChatItem }
  | { type: 'delta'; id: string; kind: ChatItem['kind']; text: string; turnId?: string; sourceType?: string }
  | { type: 'state'; patch: Partial<Pick<ChatSession, 'status' | 'turnId' | 'pending' | 'error' | 'usage' | 'updatedAt' | 'settings' | 'title' | 'activity' | 'turnStartedAt' | 'completedAt'>> };
export type ChatEvent = ChatUpdate | { type: 'snapshot'; session: ChatSession; partial?: boolean }
  | { type: 'snapshot-part'; items: ChatItem[]; final: boolean } | { type: 'batch'; events: ChatUpdate[] };

export const MAX_TOOL_TEXT = 128_000;
export function boundedToolText(text: string, omittedChars = 0) {
  const omitted = Math.max(0, text.length - MAX_TOOL_TEXT);
  return { text: omitted ? text.slice(-MAX_TOOL_TEXT) : text, omittedChars: omittedChars + omitted };
}

// Indexes and change metadata are transient; persisted history remains plain JSON.
const indexes = new WeakMap<ChatItem[], Map<string, number>>();
const changes = new WeakMap<ChatItem[], { previous: WeakRef<ChatItem[]>; start: number }>();
function indexFor(items: ChatItem[]) {
  let index = indexes.get(items);
  if (!index) { index = new Map(items.map((item, i) => [item.id, i])); indexes.set(items, index); }
  return index;
}
export function findChatItem(session: ChatSession, id: string) { return session.items[indexFor(session.items).get(id) ?? -1]; }

/** Find the affected suffix without scanning completed history on each streamed update. */
export function chatChangeStart(previous: ChatItem[], next: ChatItem[]): number {
  if (previous === next) return next.length;
  let cursor = next, start = next.length;
  for (let depth = 0; depth < 512; depth++) {
    const change = changes.get(cursor), parent = change?.previous.deref();
    if (!change || !parent) return 0;
    start = Math.min(start, change.start);
    if (parent === previous) return start;
    cursor = parent;
  }
  return 0;
}

/** Shared replay semantics keep a reconnect snapshot and live deltas equivalent. */
export function reduceChatEvent(session: ChatSession, event: ChatEvent): ChatSession {
  if (event.type === 'snapshot') return event.session;
  if (event.type === 'snapshot-part') return { ...session, items: [...session.items, ...event.items] };
  let items = session.items, index = indexFor(items), copiedIndex = false, start = items.length;
  let result = session;
  for (const update of event.type === 'batch' ? event.events : [event]) {
    if (update.type === 'state') { result = { ...result, ...update.patch }; continue; }
    const id = update.type === 'item' ? update.item.id : update.id;
    const position = index.get(id) ?? items.length;
    const old = items[position];
    let item: ChatItem = update.type === 'item' ? update.item : {
      ...(old ?? { id, kind: update.kind, status: 'inProgress', turnId: update.turnId, sourceType: update.sourceType }),
      text: (old?.text ?? '') + update.text
    };
    if (item.kind === 'tool') item = { ...item, ...boundedToolText(item.text, item.omittedChars) };
    if (items === session.items) items = items.slice();
    if (!old) {
      if (!copiedIndex) { index = new Map(index); copiedIndex = true; }
      index.set(id, position);
    }
    items[position] = item;
    start = Math.min(start, position);
  }
  if (items !== session.items) {
    indexes.set(items, index);
    changes.set(items, { previous: new WeakRef(session.items), start });
  }
  return { ...result, items };
}
