import { describe, expect, it } from 'vitest';
import type { Message } from '@earendil-works/pi-ai';
import { SessionManager } from '@earendil-works/pi-coding-agent';
import { AgentContext, type AgentTrajectoryInput } from '../agentContext';

const trajectory = (): AgentTrajectoryInput => ({
  agentType: 'codex', sourceSessionId: 'coding-session', format: 'messages-v1', fromEntryId: 'u', throughEntryId: 'done',
  entries: [
    { id: 'u', parentId: null, message: { role: 'user', content: [{ type: 'text', text: 'Inspect the save flow' }] } },
    { id: 'call', parentId: 'u', message: { role: 'assistant', content: [
      { type: 'text', text: 'Reading the implementation' },
      { type: 'toolCall', id: 'read-1', name: 'read', arguments: { path: 'save.ts', limit: 10 } }
    ] } },
    { id: 'result', parentId: 'call', message: { role: 'toolResult', toolCallId: 'read-1', toolName: 'read',
      content: [{ type: 'text', text: 'save()\n  flush()' }] } },
    { id: 'discarded', parentId: 'u', message: { role: 'assistant', content: [{ type: 'text', text: 'Unselected branch' }] } },
    { id: 'done', parentId: 'result', message: { role: 'assistant', content: [{ type: 'text', text: 'Save flushes storage.' }] } }
  ]
});

describe('AgentContext', () => {
  it('captures only the selected branch and seeds a real Pi manager with coherent structured history', () => {
    const input = trajectory(), context = AgentContext.fromTrajectory(input);
    const messages: Message[] = context.toPiMessages(); // Compile-time compatibility with installed Pi SDK.
    const manager = SessionManager.inMemory('/tmp');
    messages.forEach(message => manager.appendMessage(message));
    expect(manager.buildSessionContext().messages).toEqual(messages);
    expect(messages.map(message => message.role)).toEqual(['user', 'assistant', 'toolResult', 'assistant']);
    expect(JSON.stringify(messages)).not.toContain('Unselected branch');
    expect(messages[2]).toMatchObject({ content: [{ text: 'save()\n  flush()' }], toolCallId: 'read-1' });
    expect(AgentContext.fromSnapshot(structuredClone(context.toSnapshot())).toPiMessages()).toEqual(messages);
    expect(input.entries[0].message.timestamp).toBeUndefined();
  });

  it('is immutable through both inputs and outputs and detects snapshot tampering', () => {
    const input = trajectory(), context = AgentContext.fromTrajectory(input), before = context.toSnapshot();
    input.entries[0].message.content.length = 0;
    const snapshot = context.toSnapshot(); snapshot.source.agentType = 'claude';
    expect(() => AgentContext.fromSnapshot(snapshot)).toThrow('hash mismatch');
    context.toPiMessages()[0].content.length = 0;
    expect(context.toSnapshot()).toEqual(before);
  });

  it('hashes canonical arguments and includes source agent identity', () => {
    const input = trajectory(), first = AgentContext.fromTrajectory(input);
    const message = input.entries[1].message;
    if (message.role !== 'assistant' || message.content[1].type !== 'toolCall') throw Error('fixture');
    message.content[1].arguments = { limit: 10, path: 'save.ts' };
    expect(AgentContext.fromTrajectory(input).contentHash).toBe(first.contentHash);
    expect(AgentContext.fromTrajectory({ ...input, agentType: 'claude' }).contentHash).not.toBe(first.contentHash);
  });

  it('rejects orphan results, missing results, mismatched names and duplicate calls', () => {
    expect(() => AgentContext.fromTrajectory({ ...trajectory(), fromEntryId: 'result' })).toThrow('orphan');
    expect(() => AgentContext.fromTrajectory({ ...trajectory(), throughEntryId: 'call' })).toThrow('before tool results');
    const mismatch = trajectory();
    if (mismatch.entries[2].message.role === 'toolResult') mismatch.entries[2].message.toolName = 'other';
    expect(() => AgentContext.fromTrajectory(mismatch)).toThrow('mismatched');
    const duplicate = trajectory(); duplicate.entries[4].message = structuredClone(duplicate.entries[1].message);
    expect(() => AgentContext.fromTrajectory(duplicate)).toThrow('duplicate tool call');
    const missing = trajectory(); missing.entries[4].parentId = 'call';
    expect(() => AgentContext.fromTrajectory(missing)).toThrow('missing tool results');
  });

  it('rejects invalid branch ranges, duplicate entries, cycles and missing entries', () => {
    expect(() => AgentContext.fromTrajectory({ ...trajectory(), fromEntryId: 'discarded' })).toThrow('one branch');
    const duplicate = trajectory(); duplicate.entries.push(duplicate.entries[0]);
    expect(() => AgentContext.fromTrajectory(duplicate)).toThrow('duplicate entry');
    const cycle = trajectory(); cycle.entries[2].parentId = 'done';
    expect(() => AgentContext.fromTrajectory(cycle)).toThrow('cyclic');
    const missing = trajectory(); missing.entries[2].parentId = 'missing';
    expect(() => AgentContext.fromTrajectory(missing)).toThrow('missing entry');
  });

  it('supports slices starting after omitted ancestors and rejects unsupported records and oversized data', () => {
    expect(AgentContext.fromTrajectory({ ...trajectory(), fromEntryId: 'done' }).toSnapshot().messages).toHaveLength(1);
    expect(() => AgentContext.fromTrajectory({ ...trajectory(), format: 'codex-jsonl' })).toThrow();
    const large = trajectory(); large.entries[0].message = { role: 'user', content: Array.from({ length: 18 }, () => ({ type: 'text', text: 'x'.repeat(1_000_000) })) };
    expect(() => AgentContext.fromTrajectory(large)).toThrow('TOO_LARGE');
    const expanded = trajectory();
    expanded.entries[0].message = { role: 'user', content: Array.from({ length: 4 }, () => ({ type: 'text', text: 'x'.repeat(900_000) })) };
    expect(AgentContext.fromTrajectory(expanded).toSnapshot().messages).toHaveLength(4);
    const unknown = trajectory();
    expect(() => AgentContext.fromTrajectory({ ...unknown, agentType: '' })).toThrow();
  });
});

it('preserves named sections in snapshots and emits ordered, labeled evidence to the SDK', () => {
  const context = AgentContext.fromMessages('sections', [{ role: 'user', timestamp: 0, content: [
    { type: 'text', text: 'Shared preface' },
    { type: 'section', name: 'Payments', content: [{ type: 'text', text: 'First evidence' }, { type: 'text', text: 'Second evidence' }] },
    { type: 'section', name: 'Allocation', content: [{ type: 'text', text: 'Third evidence' }] },
    { type: 'text', text: 'Shared ending' }
  ] }]);
  expect(context.toSnapshot().version).toBe(3);
  expect(AgentContext.fromSnapshot(context.toSnapshot()).toSnapshot()).toEqual(context.toSnapshot());
  const messages: Message[] = context.toPiMessages();
  expect(messages[0].content).toEqual([
    { type: 'text', text: 'Shared preface' },
    { type: 'text', text: '[ContextSection: "Payments"]' },
    { type: 'text', text: 'First evidence' }, { type: 'text', text: 'Second evidence' },
    { type: 'text', text: '[/ContextSection]' },
    { type: 'text', text: '[ContextSection: "Allocation"]' },
    { type: 'text', text: 'Third evidence' }, { type: 'text', text: '[/ContextSection]' },
    { type: 'text', text: 'Shared ending' }
  ]);
  const renamed = context.toSnapshot().messages;
  const section = renamed[0].content[1];
  if (section.type !== 'section') throw Error('fixture');
  section.name = 'Different meaning';
  expect(context.withMessages(renamed).contentHash).not.toBe(context.contentHash);
  expect(() => AgentContext.fromSnapshot({ ...context.toSnapshot(), version: 2 })).toThrow('sections require version 3');
  const invalid = (section: unknown) => AgentContext.fromTrajectory({ agentType: 'saved-context', sourceSessionId: 'invalid', format: 'messages-v1', fromEntryId: 'm', throughEntryId: 'm', entries: [{ id: 'm', parentId: null, message: { role: 'user', content: [section] } }] });
  expect(() => invalid({ type: 'section', name: ' ', content: [{ type: 'text', text: 'Facts' }] })).toThrow();
  expect(() => invalid({ type: 'section', name: 'Empty', content: [] })).toThrow();
  expect(() => invalid({ type: 'section', name: 'Nested', content: [{ type: 'section', name: 'Child', content: [{ type: 'text', text: 'Facts' }] }] })).toThrow();
});
