import type { ChatSessionSummary } from '../../../../domain/mapping/agent-chat/agentChat';
export const newChatTab = () => `draft:${crypto.randomUUID()}`;
export const chatSessionId = (tab: string) => tab.startsWith('draft:') ? '' : tab;
export interface ChatTabs { ids: string[]; selected: string }
const storageKey = (cwd: string) => `agent-chat-tabs:${cwd}`;
export function restoreChatTabs(cwd: string, sessions: readonly ChatSessionSummary[]): ChatTabs | undefined {
  try {
    const saved = JSON.parse(localStorage.getItem(storageKey(cwd)) ?? 'null');
    if (!saved || !Array.isArray(saved.ids)) return;
    const valid = new Set(sessions.map(session => session.id));
    const ids = [...new Set<string>(saved.ids.filter((id: unknown): id is string => typeof id === 'string' && valid.has(id)))];
    if (ids.length) return { ids, selected: ids.includes(saved.selected) ? saved.selected : ids[0] };
  } catch { /* A missing or invalid preference falls back to the latest conversation. */ }
}
export function saveChatTabs(cwd: string, tabs: ChatTabs) {
  try { localStorage.setItem(storageKey(cwd), JSON.stringify({ ids: tabs.ids.filter(chatSessionId), selected: chatSessionId(tabs.selected) })); }
  catch { /* Tabs also work without browser storage. */ }
}
export function activateChatTab(tabs: ChatTabs, id: string): ChatTabs {
  return { ids: tabs.ids.includes(id) ? tabs.ids : [...tabs.ids, id], selected: id };
}
export function closeChatTab(tabs: ChatTabs, id: string): ChatTabs {
  const index = tabs.ids.indexOf(id), ids = tabs.ids.filter(entry => entry !== id);
  if (!ids.length) { const selected = newChatTab(); return { ids: [selected], selected }; }
  return { ids, selected: tabs.selected === id ? ids[Math.min(index, ids.length - 1)] : tabs.selected };
}
export function cycleChatTab(tabs: ChatTabs, direction: -1 | 1): ChatTabs {
  return { ...tabs, selected: tabs.ids[(tabs.ids.indexOf(tabs.selected) + direction + tabs.ids.length) % tabs.ids.length] };
}
export type ChatTabCommand = { serial: number; action: 'focus' | 'new' | 'previous' | 'next' };
