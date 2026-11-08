import { expect, it } from 'vitest';
import { AgentContext } from '../../../../../domain/core/agents/agentContext';
import { sourceFileHash } from '../../../../../domain/core/agents/agentContextSource';
import { captureDiagramAgentContext } from '../diagramAgentContext';

it('restores section structure and pinned sources after recapturing the model-visible prefix', async () => {
  const file = { startLine: 5, lines: ['Pinned evidence'] }, hash = sourceFileHash(file);
  const context = AgentContext.fromMessages('source', [{ role: 'user', timestamp: 0, content: [{
    type: 'section', name: 'Payments', content: [{ type: 'sourceRange', sourceId: 'source', path: 'facts.txt',
      startLine: 5, endLine: 5, version: { kind: 'snapshot', contentHash: hash } }]
  }] }]);
  const original = AgentContext.fromSnapshot({ ...context.toSnapshot(), sourceFiles: { [hash]: file } });
  const resolved = await original.resolveSources();
  const messages = [...resolved.toPiMessages(), { role: 'user' as const, timestamp: 1, content: [{ type: 'text' as const, text: 'New task' }] }];
  const captured = AgentContext.fromSnapshot(captureDiagramAgentContext('child', messages, { original, resolved }));
  expect(captured.toSnapshot().messages[0]).toEqual(original.toSnapshot().messages[0]);
  expect(captured.toSnapshot().sourceFiles).toEqual({ [hash]: file });
  expect(captured.toSnapshot().version).toBe(3);
  expect((await captured.resolveSources()).toPiMessages().map(m => m.content)).toEqual(messages.map(m => m.content));
  messages[0].content[1] = { type: 'text', text: 'Changed evidence' };
  const changed = captureDiagramAgentContext('child', messages, { original, resolved });
  expect(changed.version).toBe(1);
  expect(changed.sourceFiles).toBeUndefined();
  expect(JSON.stringify(changed)).toContain('Changed evidence');
});
