import path from 'node:path';
import type { AgentDiagrammingSessionService } from '../../../application/mapping/agent/sessionService';
import type { ChatCanvasTarget } from '../../../domain/mapping/agent-chat/agentChat';
import type { ChatMcpBinding } from '../../../application/mapping/agent-chat/ports';

export class MappingChatMcpBinding implements ChatMcpBinding {
  private tokens = new Map<string, string>();
  private origin?: string;
  constructor(private agent: AgentDiagrammingSessionService, private appRoot: string) {}
  setOrigin(origin: string) { this.origin = origin; }
  config(chatId: string) {
    if (!this.origin) throw Error('MCP_UNAVAILABLE: application address is not initialized');
    let token = this.tokens.get(chatId);
    if (!token) { token = this.agent.chatBindings.create(); this.tokens.set(chatId, token); }
    return { 'mcp_servers.mapping': { command: process.execPath,
      args: ['--import', 'tsx', path.join(this.appRoot, 'scripts/mapping/mcp.ts'), this.origin], cwd: this.appRoot,
      env: { MAPPING_CHAT_BINDING: token }, enabled: true } };
  }
  bind(chatId: string, target: ChatCanvasTarget | undefined, readOnly: boolean) {
    const token = this.tokens.get(chatId); if (!token) throw Error('CHAT_BINDING_UNAVAILABLE');
    this.agent.chatBindings.bind(token, target, readOnly);
  }
  clear(chatId: string) { const token = this.tokens.get(chatId); if (token) this.agent.chatBindings.clear(token); }
}
