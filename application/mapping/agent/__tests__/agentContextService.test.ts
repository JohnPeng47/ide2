import { expect, it } from 'vitest';
import { AgentContextService } from '../agentContextService';

const input = { agentType: 'claude', sourceSessionId: 'source', format: 'messages-v1', fromEntryId: '1', throughEntryId: '1',
  entries: [{ id: '1', parentId: null, message: { role: 'user', content: [{ type: 'text', text: 'Explain the new owner' }] } }] };
const scope = { workspaceInstanceId: 'workspace', documentId: 'doc' };
it('keeps uploads immutable, scopes access and replays uploads without allocating another context', () => {
  const service = new AgentContextService({ count: 1, bytes: 10000 });
  const receipt = service.upload(scope, 'upload', input);
  expect(receipt).toMatchObject({ agentType: 'claude', sourceSessionId: 'source', messageCount: 1 });
  expect(service.upload(scope, 'upload', structuredClone(input))).toEqual(receipt);
  const snapshot = service.get(scope, receipt.agentContextId); snapshot.messages.length = 0;
  expect(service.get(scope, receipt.agentContextId).messages).toHaveLength(1);
  expect(() => service.get({ ...scope, documentId: 'other' }, receipt.agentContextId)).toThrow('unavailable');
  expect(() => service.get({ ...scope, workspaceInstanceId: 'other' }, receipt.agentContextId)).toThrow('unavailable');
  expect(() => service.upload(scope, 'upload', { ...input, agentType: 'codex' })).toThrow('different context');
  expect(() => service.upload(scope, 'new', input)).toThrow('storage is full');
});
it('rejects a context when the total byte budget is exhausted', () => {
  const service = new AgentContextService({ count: 100, bytes: 1 });
  expect(() => service.upload(scope, 'upload', input)).toThrow('storage is full');
});
