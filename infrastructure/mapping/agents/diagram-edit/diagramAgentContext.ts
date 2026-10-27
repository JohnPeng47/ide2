import type { AgentSession } from '@earendil-works/pi-coding-agent';
import { AgentContext, type AgentContextMessage } from '../../../../domain/core/agents/agentContext';

/** Strip SDK metadata and private reasoning blocks while preserving the complete
 * user/assistant/tool transcript used for subsequent composer requests. */
export function captureDiagramAgentContext(sessionId: string, messages: Readonly<AgentSession['messages']>, imported?: { original: AgentContext; resolved: AgentContext }) {
  const captured: AgentContextMessage[] = [];
  for (const message of messages) {
    if (message.role === 'user') {
      const content = typeof message.content === 'string' ? [{ type: 'text' as const, text: message.content }]
        : message.content.filter(block => block.type === 'text').map(block => ({ type: 'text' as const, text: block.text }));
      if (content.length) captured.push({ role: 'user', content, timestamp: message.timestamp });
    } else if (message.role === 'assistant') {
      const content: Extract<AgentContextMessage, { role: 'assistant' }>['content'] = [];
      for (const block of message.content) {
        if (block.type === 'text') content.push({ type: 'text', text: block.text });
        else if (block.type === 'toolCall') content.push({ type: 'toolCall', id: block.id, name: block.name, arguments: block.arguments });
      }
      if (content.length) captured.push({ role: 'assistant', content, timestamp: message.timestamp });
    } else if (message.role === 'toolResult') {
      const content = message.content.filter(block => block.type === 'text').map(block => ({ type: 'text' as const, text: block.text }));
      captured.push({ role: 'toolResult', toolCallId: message.toolCallId, toolName: message.toolName,
        content: content.length ? content : [{ type: 'text', text: '[Non-text tool result]' }], isError: message.isError, timestamp: message.timestamp });
    } else if (message.role === 'compactionSummary' || message.role === 'branchSummary') {
      captured.push({ role: 'user', content: [{ type: 'text', text: `Previous conversation summary:\n${message.summary}` }], timestamp: message.timestamp });
    }
  }
  // Replace only an unchanged imported prefix. A compacted/edited transcript must not
  // have unrelated messages replaced merely because their text happens to match.
  const original = imported?.original.toSnapshot(), resolved = imported?.resolved.toSnapshot();
  const semantic = ({ timestamp: _, ...message }: AgentContextMessage) => JSON.stringify(message);
  const normalized = AgentContext.fromMessages(sessionId, captured).toSnapshot().messages;
  if (original && resolved && resolved.messages.every((message, index) => normalized[index] && semantic(normalized[index]) === semantic(message))) {
    normalized.splice(0, resolved.messages.length, ...original.messages);
    const context = AgentContext.fromMessages(sessionId, normalized);
    return AgentContext.fromSnapshot({ ...context.toSnapshot(), ...(original.sourceFiles ? { sourceFiles: original.sourceFiles } : {}) }).toSnapshot();
  }
  return AgentContext.fromMessages(sessionId, normalized).toSnapshot();
}
