import { boundedToolText, MAX_TOOL_TEXT, type ChatItem, type CommandAction } from '../../../domain/mapping/agent-chat/agentChat';

export const record = (value: unknown): Record<string, unknown> => value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
export const string = (value: unknown) => typeof value === 'string' ? value : '';
const number = (value: unknown) => typeof value === 'number' ? value : undefined;
export const printable = (value: unknown) => value == null ? '' : typeof value === 'string' ? value : JSON.stringify(value, null, 2);
const list = (value: unknown): Record<string, unknown>[] => Array.isArray(value) ? value.map(record) : [];

/** Keep protocol meaning here; the UI never has to reverse-engineer a shell command or JSON blob. */
export function presentNativeItem(native: Record<string, unknown>, turnId: string | undefined, completed: boolean, old?: ChatItem): ChatItem {
  const sourceType = string(native.type);
  const kind: ChatItem['kind'] = sourceType === 'agentMessage' ? 'assistant' : sourceType === 'reasoning' ? 'reasoning'
    : sourceType === 'plan' ? 'plan' : ['contextCompaction', 'enteredReviewMode', 'exitedReviewMode'].includes(sourceType) ? 'notice' : 'tool';
  const status = native.success === false ? 'failed' : string(native.status) || (completed ? 'completed' : 'inProgress');
  const item: ChatItem = { ...old, id: string(native.id), kind, sourceType, turnId: turnId || old?.turnId, status, text: old?.text ?? '' };
  if (kind === 'assistant' || kind === 'plan') {
    // An explicit completed payload is canonical, even when empty. Missing fields retain partial text.
    if (typeof native.text === 'string' && (completed || native.text)) item.text = native.text;
    if (['commentary', 'partial_answer', 'final_answer'].includes(string(native.phase))) item.phase = native.phase as ChatItem['phase'];
    item.title = kind === 'plan' ? 'Proposed Plan' : undefined;
  } else if (kind === 'reasoning') {
    if (Array.isArray(native.summary) && native.summary.length) item.text = native.summary.filter(value => typeof value === 'string').join('\n\n');
    // Only summaries are exposed. Raw reasoning content is not part of this transcript.
  } else if (sourceType === 'commandExecution') {
    const command = string(native.command) || old?.command?.command || '';
    const actions = Array.isArray(native.commandActions) ? list(native.commandActions).map(action => ({
      type: string(action.type), name: string(action.name), path: string(action.path), query: string(action.query), command: string(action.command)
    } satisfies CommandAction)) : old?.command?.actions ?? [];
    item.command = { command, actions, source: string(native.source) || old?.command?.source,
      processId: string(native.processId) || old?.command?.processId, exitCode: number(native.exitCode), durationMs: number(native.durationMs) };
    item.title = command;
    if (typeof native.aggregatedOutput === 'string') Object.assign(item, boundedToolText(native.aggregatedOutput));
  } else if (sourceType === 'fileChange') {
    let remainingDiff = MAX_TOOL_TEXT;
    item.changes = list(native.changes).map(change => {
      const diff = string(change.diff), lines = diff.split('\n');
      const retained = Math.min(remainingDiff, diff.length); remainingDiff -= retained;
      const bounded = { text: retained ? diff.slice(-retained) : '', omittedChars: diff.length - retained };
      return { path: string(change.path), kind: string(record(change.kind).type) || string(change.kind), diff: bounded.text, omittedChars: bounded.omittedChars,
        added: lines.filter(line => line.startsWith('+') && !line.startsWith('+++')).length,
        removed: lines.filter(line => line.startsWith('-') && !line.startsWith('---')).length };
    });
    item.text = ''; item.title = 'File changes';
  } else if (sourceType === 'webSearch') {
    const action = record(native.action), complete = status === 'completed';
    item.title = action.type === 'openPage' ? `${complete ? 'Opened' : 'Opening'} ${string(action.url)}`
      : action.type === 'findInPage' ? `${complete ? 'Searched' : 'Searching'} ${string(action.pattern)} in ${string(action.url)}`
      : `${complete ? 'Searched' : 'Searching'} the web for ${string(native.query) || string(action.query) || (Array.isArray(action.queries) ? action.queries.join(', ') : '')}`;
    item.text = '';
  } else if (sourceType === 'contextCompaction') { item.title = completed ? 'Context compacted' : 'Compacting context'; item.text = ''; }
  else if (sourceType === 'enteredReviewMode' || sourceType === 'exitedReviewMode') { item.title = sourceType === 'enteredReviewMode' ? 'Code review started' : 'Code review finished'; item.text = string(native.review); }
  else if (sourceType === 'functionCallOutput') {
    item.title = native.name === 'read_canvas' ? 'Read Canvas' : string(native.name) || 'Tool output';
    Object.assign(item, boundedToolText(typeof native.output === 'string' ? native.output : printable(native.output)));
  } else {
    item.title = sourceType === 'mcpToolCall' ? `${string(native.server)} · ${string(native.tool)}`
      : sourceType === 'dynamicToolCall' ? string(native.tool)
      : sourceType === 'imageView' ? `Viewed image ${string(native.path)}`
      : sourceType === 'imageGeneration' ? 'Image generation'
      : sourceType === 'collabAgentToolCall' ? `${string(native.tool) || 'Agent'} · ${status}`
      : sourceType === 'subAgentActivity' ? 'Agent activity'
      : sourceType === 'sleep' ? 'Waiting' : `Activity: ${sourceType || 'unknown'}`;
    Object.assign(item, boundedToolText(printable(native.error || native.result || native.contentItems || native.arguments || native)));
  }
  return item;
}
