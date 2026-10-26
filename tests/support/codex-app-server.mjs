#!/usr/bin/env node
// Disposable protocol peer for the port's transport and browser tests. Never calls a model.
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { createInterface } from 'node:readline';
const output = value => process.stdout.write(`${JSON.stringify(value)}\n`);
const notification = (method, params) => output({ method, params });
let nextThread = 0, nextTurn = 0;
const pending = new Map();
const canvasContexts = new Map();
const threadTools = new Map();
const threadMcp = new Map(), mcpClients = new Map();
async function canvasMcpClient(threadId) {
  let client = mcpClients.get(threadId);
  if (!client) {
    const config = threadMcp.get(threadId)?.['mcp_servers.mapping'];
    if (!config?.env?.MAPPING_CHAT_BINDING) throw Error('Missing host MCP binding');
    client = new Client({ name: 'canvas-fixture', version: '1' });
    await client.connect(new StdioClientTransport({ command: config.command, args: config.args, cwd: config.cwd,
      env: { ...process.env, ...config.env }, stderr: 'pipe' }));
    mcpClients.set(threadId, client);
  }
  return client;
}
async function canvasMcpTurn(threadId, turnId, publish) {
  try {
    const client = await canvasMcpClient(threadId);
    const call = async (name, args) => {
      const result = await client.callTool({ name, arguments: args });
      if (result.isError) throw Error(JSON.stringify(result.content));
      return result.structuredContent?.result ?? JSON.parse(result.content[0].text);
    };
    const read = (await call('exec', { requestId: `read-${turnId}`, code: 'return canvas.read({level:"small"});' })).value;
    if (publish) await call('save_diagram', { requestId: `publish-${turnId}`, expectedVersion: read.version, name: 'MCP published canvas' });
    else {
      const node = read.nodes[0], anchor = Object.values(node.content.structure.nodes).find(n => n.label === 'Root');
      await call('exec', { requestId: `highlight-${turnId}`, expectedVersion: read.version,
        code: `return nodes.highlight(${JSON.stringify({ nodeId: node.id, contentNodeId: anchor.id, color: 'green' })});` });
    }
    answer(threadId, turnId, publish ? 'MCP publication complete.' : 'MCP highlight complete.');
  } catch (error) { answer(threadId, turnId, `MCP failed: ${String(error)}`); }
}
process.on('SIGTERM', async () => { await Promise.all([...mcpClients.values()].map(client => client.close())); process.exit(0); });
let nextTool = 0;
function diagramTool(threadId, turnId, tool, args, polls = 0) {
  if (!threadTools.get(threadId)?.some(entry => entry.name === tool)) throw Error(`Missing registered tool: ${tool}`);
  const callId = `diagram-tool-${++nextTool}`, id = `request-${callId}`;
  const item = { type: 'dynamicToolCall', id: callId, tool, arguments: args, status: 'inProgress' };
  notification('item/started', { threadId, turnId, item });
  pending.set(id, { kind: 'diagram-tool', threadId, turnId, item, polls });
  output({ id, method: 'item/tool/call', params: { threadId, turnId, callId, namespace: null, tool, arguments: args } });
}
const finish = (threadId, turnId, status = 'completed') => notification('turn/completed', { threadId, turn: { id: turnId, status, error: null } });
const markdown = '# Markdown port\n\n**Streaming response** with [a link](https://example.com).\n\n- [x] Persistent conversation\n- [ ] Follow up\n\n> [!NOTE]\n> Markdown survives reopening.\n\n```typescript\nconst answer: number = 42;\n```\n\n| Feature | Description |\n| --- | --- |\n| Markdown | Tables adapt to a narrow panel and preserve their complete content. |\n| Streaming | Completed code blocks stay stable as new text arrives. |\n\n<script>window.chatUnsafe = true</script>';
const answer = (threadId, turnId, text = markdown) => {
  notification('item/started', { threadId, item: { type: 'agentMessage', id: `answer-${turnId}`, text: '' } });
  notification('item/agentMessage/delta', { threadId, itemId: `answer-${turnId}`, delta: text.slice(0, 40) });
  notification('item/agentMessage/delta', { threadId, itemId: `answer-${turnId}`, delta: text.slice(40) });
  notification('item/completed', { threadId, item: { type: 'agentMessage', id: `answer-${turnId}`, text } });
  finish(threadId, turnId);
};
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
async function transcript(threadId, turnId) {
  const emit = (method, params) => notification(method, { threadId, turnId, ...params });
  const start = item => emit('item/started', { item });
  const complete = item => emit('item/completed', { item });
  const command = (id, name, type = 'read') => ({ type: 'commandExecution', id: `${id}-${turnId}`, command: `cat ${name}`, commandActions: [{ type, name, query: name }], exitCode: 0, durationMs: 20, status: 'completed', aggregatedOutput: 'Retained exploration output' });
  complete({ type: 'reasoning', id: `reason-${turnId}`, summary: ['**Inspecting the parser**'] });
  start({ type: 'agentMessage', id: `comment-${turnId}`, phase: 'commentary', text: '' });
  emit('item/agentMessage/delta', { itemId: `comment-${turnId}`, delta: 'I will inspect the parser and run its tests.' });
  await pause(700);
  complete({ type: 'agentMessage', id: `comment-${turnId}`, phase: 'commentary', text: 'I will inspect the parser and run its tests.' });
  await pause(700);
  complete(command('read-a', 'parser.ts'));
  complete({ type: 'reasoning', id: `reason-two-${turnId}`, summary: ['**Checking the edge cases**'] });
  complete(command('read-b', 'parser.test.ts'));
  const run = { type: 'commandExecution', id: `run-${turnId}`, command: 'npm test', commandActions: [{ type: 'unknown', command: 'npm test' }], status: 'inProgress' };
  start(run);
  for (let i = 0; i < 30; i++) {
    emit('item/commandExecution/outputDelta', { itemId: run.id, delta: `test ${i}: passing\n` });
    await pause(25);
  }
  complete({ ...run, status: 'completed', exitCode: 0, durationMs: 750, aggregatedOutput: 'head\n'.repeat(30000) + '28 passed\n29 passed\n30 passed' });
  complete({ type: 'fileChange', id: `patch-${turnId}`, status: 'completed', changes: [{ path: 'src/parser.ts', kind: { type: 'update' }, diff: '@@ -1 +1 @@\n-old parser\n+new parser' }] });
  emit('turn/plan/updated', { plan: [{ step: 'Inspect parser', status: 'completed' }, { step: 'Run tests', status: 'completed' }] });
  complete({ type: 'webSearch', id: `web-${turnId}`, status: 'completed', query: 'parser reference', action: { type: 'search', query: 'parser reference' } });
  start({ type: 'agentMessage', id: `final-${turnId}`, phase: 'final_answer', text: '' });
  emit('item/agentMessage/delta', { itemId: `final-${turnId}`, delta: 'The parser is ' });
  await pause(400);
  complete({ type: 'agentMessage', id: `final-${turnId}`, phase: 'final_answer', text: 'The parser is updated. **All 30 tests pass.** [parser.ts](src/parser.ts:2)\n\n```ts\nconst parsed = true;\n```\n\n| Check | Result |\n| --- | --- |\n| Parser | Passed |' });
  finish(threadId, turnId);
}
async function stress(threadId, turnId) {
  for (let i = 0; i < 250; i++) notification('item/completed', { threadId, turnId, item: { type: 'commandExecution', id: `stress-${turnId}-${i}`, command: `test ${i}`, commandActions: [], status: 'completed', exitCode: 0, aggregatedOutput: 'test output\n'.repeat(1000) } });
  answer(threadId, turnId, 'Stress fixture complete.');
}
createInterface({ input: process.stdin }).on('line', line => {
  const message = JSON.parse(line), { id, method, params: p = {} } = message;
  if (!method) {
    const task = pending.get(id); if (!task) return;
    if (task.kind === 'diagram-tool') {
      pending.delete(id);
      const response = message.result;
      notification('item/completed', { threadId: task.threadId, turnId: task.turnId, item: { ...task.item, status: response.success ? 'completed' : 'failed', ...response } });
      const result = JSON.parse(response.contentItems[0].text);
      if (response.success && task.item.tool === 'highlight-node') {
        answer(task.threadId, task.turnId, result.highlights.map((item, i) => `[Highlighted reference ${i + 1}](${item.markdownUrl})`).join('\n\n')); return;
      }
      if (response.success && task.item.tool === 'project-diagrams') {
        if (!task.projectedDocumentId) {
          // Redeliver the same tool call with a fresh wire ID, as after a lost acknowledgement.
          const retryId = id + '-retry';
          pending.set(retryId, { ...task, projectedDocumentId: result.documentId });
          output({ id: retryId, method: 'item/tool/call', params: { threadId: task.threadId, turnId: task.turnId,
            callId: task.item.id, namespace: null, tool: task.item.tool, arguments: task.item.arguments } });
        } else {
          if (result.documentId !== task.projectedDocumentId) throw Error('Projection retry created a duplicate canvas');
          answer(task.threadId, task.turnId, 'Projection created: ' + result.documentId);
        }
        return;
      }
      if (response.success && task.item.tool === 'remove-highlights') { answer(task.threadId, task.turnId, 'Removed highlights.'); return; }
      if (response.success && ['generating', 'applying'].includes(result.status) && task.polls < 200) {
        setTimeout(() => diagramTool(task.threadId, task.turnId, 'edit-diagram-status', { runId: result.runId }, task.polls + 1), 50);
      } else answer(task.threadId, task.turnId, response.success ? `Diagram edit ${result.status}: ${result.message || result.error || ''}` : `Diagram edit failed: ${result.error}`);
      return;
    }
    pending.delete(id); answer(task.threadId, task.turnId, `Response received: ${JSON.stringify(message.result)}`); return;
  }
  if (method === 'initialized') return;
  if (method === 'initialize') return output({ id, result: { userAgent: 'fixture' } });
  if (method === 'model/list') return output({ id, result: { data: [
    { model: 'fixture-codex', displayName: 'Fixture Codex', isDefault: true, supportedReasoningEfforts: [{ reasoningEffort: 'high' }], defaultReasoningEffort: 'high' },
    { model: 'fixture-other', displayName: 'Other Model', isDefault: false, supportedReasoningEfforts: [{ reasoningEffort: 'medium' }], defaultReasoningEffort: 'medium' }
  ], nextCursor: null } });
  if (method === 'account/read') return output({ id, result: { account: { type: 'chatgpt', email: 'fixture@example.test' } } });
  if (method === 'thread/start') {
    const threadId = `thread-${++nextThread}`; threadMcp.set(threadId, p.config); threadTools.set(threadId, (p.dynamicTools ?? []).filter(tool => !process.env.CHAT_RELOAD_FIXTURE || tool.name !== 'project-diagrams'));
    return output({ id, result: { thread: { id: threadId }, model: p.model || 'fixture-codex' } });
  }
  if (method === 'thread/fork') {
    const threadId = `thread-${++nextThread}`;
    threadTools.set(threadId, threadTools.get(p.threadId)); threadMcp.set(threadId, p.config);
    return output({ id, result: { thread: { id: threadId }, model: p.model || 'fixture-codex', reasoningEffort: p.config?.model_reasoning_effort || 'high' } });
  }
  if (method === 'thread/resume') {
    if (p.threadId === '019a0000-0000-7000-8000-000000000001') {
      if (p.developerInstructions || p.baseInstructions || p.dynamicTools || p.config) throw Error('Native resume must preserve its prompt and tools');
      if (p.sandbox !== 'danger-full-access' || p.approvalPolicy !== 'never') throw Error('Agent Chat imports must default to YOLO');
      return output({ id, result: {
        thread: { id: p.threadId, name: 'Previous CLI session', cwd: process.cwd(), createdAt: 1700000000, status: { type: 'idle' }, turns: [
          { id: 'native-turn', status: 'completed', items: [
            { type: 'userMessage', id: 'native-user', content: [{ type: 'text', text: 'A question from the CLI' }] },
            { type: 'agentMessage', id: 'native-answer', text: 'An answer from the CLI', phase: 'final_answer' }
          ] }
        ] }, model: 'fixture-other', reasoningEffort: 'medium', sandbox: { type: 'dangerFullAccess' }
      } });
    }
    if (/^[a-f0-9-]{36}$/.test(p.threadId)) return output({ id, error: { code: -32602, message: 'Codex session not found on this server.' } });
    if (p.config) threadMcp.set(p.threadId, p.config);
    return output({ id, result: { thread: { id: p.threadId } } });
  }
  if (method === 'thread/unsubscribe' || method === 'thread/inject_items' || method === 'thread/goal/clear') return output({ id, result: {} });
  if (method === 'config/mcpServer/reload') {
    void (async () => {
      await Promise.all([...mcpClients.values()].map(client => client.close())); mcpClients.clear();
      output({ id, result: {} });
    })().catch(error => output({ id, error: { code: -32603, message: String(error) } }));
    return;
  }
  if (method === 'mcpServerStatus/list') {
    void (async () => {
      const client = await canvasMcpClient(p.threadId);
      const { tools } = await client.listTools();
      output({ id, result: { data: [{ name: 'mapping', tools: Object.fromEntries(tools.map(tool => [tool.name, tool])) }] } });
    })().catch(error => output({ id, error: { code: -32603, message: String(error) } }));
    return;
  }
  if (method === 'turn/interrupt') { output({ id, result: {} }); finish(p.threadId, p.turnId, 'interrupted'); return; }
  if (method === 'turn/start') {
    const threadId = p.threadId, turnId = `turn-${++nextTurn}`, text = p.input[0]?.text;
    output({ id, result: { turn: { id: turnId } } });
    notification('turn/started', { threadId, turn: { id: turnId } });
    if (text?.startsWith('Generate this single canvas alternative.')) {
      void (async () => {
        const client = await canvasMcpClient(threadId);
        const call = async (name, args) => {
          const result = await client.callTool({ name, arguments: args });
          if (result.isError) throw Error(JSON.stringify(result.content));
          return result.structuredContent?.result ?? JSON.parse(result.content[0].text);
        };
        const read = (await call('exec', { requestId: `generation-read-${turnId}`, code: 'return canvas.read({level:"small"});' })).value;
        await new Promise(resolve => setTimeout(resolve, 1800));
        const name = text.match(/Candidate ([^:]+):/)?.[1] || 'candidate';
        await call('exec', { requestId: `generation-edit-${turnId}`, expectedVersion: read.version,
          code: `return nodes.replace(${JSON.stringify({ nodeId: read.nodes[0].id, ascii: `Generated ${name}\n|-- Payment\n|   |-- Authorize\n|   \`-- Capture\n\`-- Cart` })});` });
        notification('thread/tokenUsage/updated', { threadId, turnId, tokenUsage: {
          total: { totalTokens: 140, inputTokens: 100, cachedInputTokens: 20, outputTokens: 40, reasoningOutputTokens: 10 },
          last: { totalTokens: 140, inputTokens: 100, cachedInputTokens: 20, outputTokens: 40, reasoningOutputTokens: 10 } } });
        answer(threadId, turnId, `Generated ${name}`);
      })().catch(error => { notification('turn/completed', { threadId, turn: { id: turnId, status: 'failed', error: { message: String(error) } } }); });
      return;
    }
    if (text === 'Highlight canvas through MCP' || text === 'Publish canvas through MCP') {
      void canvasMcpTurn(threadId, turnId, text.startsWith('Publish')); return;
    }
    if (p.toolOutput) {
      if (p.input.length || p.toolOutput.name !== 'read_canvas') throw Error('Invalid canvas tool turn');
      const context = JSON.parse(p.toolOutput.output);
      if (context.view !== 'short' || !context.documentId || !Array.isArray(context.diagrams)) throw Error('Missing short canvas context');
      canvasContexts.set(threadId, context);
      notification('item/completed', { threadId, turnId, item: { type: 'functionCallOutput', id: `canvas-${turnId}`, ...p.toolOutput } });
      answer(threadId, turnId, `Canvas received: ${context.name}. ${context.diagrams.length} diagrams.`);
      return;
    }
    if (text === 'What canvas did you read?') {
      const context = canvasContexts.get(threadId);
      answer(threadId, turnId, context ? `Remembered canvas: ${context.name}` : 'No canvas context in this thread.');
      return;
    }
    if (text === 'wait') return;
    if (text === 'Project arbitrary diagrams') {
      if (process.env.CHAT_RELOAD_FIXTURE) {
        void (async () => {
          if (threadTools.get(threadId)?.some(tool => tool.name === 'project-diagrams')) throw Error('Fixture requires stale native tools');
          const client = await canvasMcpClient(threadId);
          const result = await client.callTool({ name: 'chat_project-diagrams', arguments: { diagramIds: ['grid:d3', 'grid:d0', 'grid:d1'] } });
          if (result.isError) throw Error(JSON.stringify(result.content));
          answer(threadId, turnId, 'Projection created: ' + (result.structuredContent?.result ?? JSON.parse(result.content[0].text)).documentId);
        })().catch(error => answer(threadId, turnId, 'Projection failed: ' + String(error)));
        return;
      }
      diagramTool(threadId, turnId, 'project-diagrams', { diagramIds: ['grid:d3', 'grid:d0', 'grid:d1'] }); return;
    }

    if (text?.startsWith('Highlight selected ref ')) {
      diagramTool(threadId, turnId, 'highlight-node', { reference: 1, color: /^Highlight selected ref ([a-z]+)/.exec(text)[1], requestId: `highlight-${turnId}` }); return;
    }
    if (text === 'Remove current highlights') {
      diagramTool(threadId, turnId, 'remove-highlights', { nodeId: 'grid:overview', requestId: `remove-highlights-${turnId}` }); return;
    }
    if (['Create diagram batch', 'Edit diagram batch', 'Extend diagram batch'].includes(text)) {
      const context = canvasContexts.get(threadId);
      if (!context?.diagrams.length) throw Error('Read Canvas before the batch fixture');
      const tool = text.startsWith('Create') ? 'create-diagram' : text.startsWith('Extend') ? 'extend-diagram' : 'edit-diagram';
      const diagrams = tool === 'edit-diagram' ? context.diagrams.slice(-2) : [context.diagrams[0], context.diagrams[0]];
      const operations = diagrams.map((base, index) => ({ nodeId: base.id, baseRevisionId: base.baseRevisionId,
        ...(tool === 'edit-diagram' ? { 'edit-mode': 'in-place', 'replace-mode': 'diagram', edit: { ascii: `Updated ${index + 1}\n\`-- Child`, structureKind: 'tree' } }
          : { diagram: { ascii: `${tool === 'create-diagram' ? 'Created' : 'Extended'} ${index + 1}\n\`-- Child`, structureKind: 'tree' } }),
        ...(tool === 'extend-diagram' ? { origin: { column: 80 + index * 30, row: 10 }, sources: [{ kind: 'content-node', displayNodeId: base.id, contentNodeId: base.logicalNodes[0].contentNodeId, revisionId: base.revisionId }] } : {})
      }));
      diagramTool(threadId, turnId, tool, { requestId: `batch-${turnId}`, operations }); return;
    }
    if (text?.startsWith('Edit selected ref') || text === 'Edit current diagram') {
      const selected = p.input.find(item => item.text?.startsWith('Selected canvas references'))?.text;
      const reference = selected ? JSON.parse(selected.slice(selected.indexOf('\n') + 1))[0] : undefined;
      const context = canvasContexts.get(threadId)?.diagrams.find(diagram => diagram.id === 'grid:overview');
      const ascii = reference?.ascii ?? context?.ascii ?? 'Root';
      const lines = ascii.split('\n');
      lines[0] += ' [edited: chat edit]';
      diagramTool(threadId, turnId, 'edit-diagram', { requestId: `edit-${turnId}`, operations: [{
        'edit-mode': 'in-place', 'replace-mode': reference?.reference.kind === 'nodes' ? 'subnode-single' : 'diagram',
        ...(reference ? { reference: 1 } : { nodeId: 'grid:overview', baseRevisionId: context?.baseRevisionId ?? 'unread' }),
        edit: { ascii: lines.join('\n'), structureKind: context?.structureKind ?? 'tree' }
      }] });
      return;
    }
    if (text?.startsWith('Explain selected refs')) {
      const context = p.input[1]?.text;
      if (!context?.startsWith('Selected canvas references')) throw Error('Missing selected references');
      const references = JSON.parse(context.slice(context.indexOf('\n') + 1));
      answer(threadId, turnId, `Received ${references.length} references: ${references.map(ref => ref.reference.label).join(', ')}.\n\n${references.map(ref => ref.ascii).join('\n\n')}`);
      return;
    }
    if (text === 'copy-highlight') {
      answer(threadId, turnId, markdown + '\n\n```typescript\nconst ready = true;\n```');
      return;
    }
    if (text === 'stream-block') {
      void (async () => {
        const id = `stream-block-${turnId}`;
        notification('item/started', { threadId, turnId, item: { type: 'agentMessage', id, text: '' } });
        notification('item/agentMessage/delta', { threadId, turnId, itemId: id, delta: '```text\nRoot\nFirst branch' });
        await pause(2000);
        notification('item/agentMessage/delta', { threadId, turnId, itemId: id, delta: '\n\nLast branch\n```' });
        notification('item/completed', { threadId, turnId, item: { type: 'agentMessage', id, text: '```text\nRoot\nFirst branch\n\nLast branch\n```' } });
        finish(threadId, turnId);
      })();
      return;
    }
    if (text === 'diagram') {
      answer(threadId, turnId, 'LiveCanvasService connects the browser canvas to the agent.\n\n```text\nLiveCanvasService\n\n|-- Keep spaces  \n`-- CanvasSessionBridge\n```');
      return;
    }
    if (text === 'transcript') { void transcript(threadId, turnId); return; }
    if (text === 'stress') { void stress(threadId, turnId); return; }
    if (text === 'layout') {
      const long = 'long_identifier_'.repeat(35);
      notification('item/completed', { threadId, turnId, item: { type: 'commandExecution', id: `layout-${turnId}`, command: `echo ${long}`, status: 'completed', aggregatedOutput: `${long}\nsecond output line\nlast output line` } });
      answer(threadId, turnId, `# Layout check\n\n${long}\n\n[Long link ${long}](https://example.com)\n\n> Green quotation\n\n1. Blue marker and \`inline code\`\n\n\`\`\`typescript\nconst longValue = "${long}";\n\`\`\`\n\n| Key | Value |\n| --- | --- |\n| ${long} | ${long} |\n\nLayout fixture complete.`);
      return;
    }
    if (text === 'approval' || text === 'question') {
      const requestId = `request-${turnId}`; pending.set(requestId, { threadId, turnId });
      output({ id: requestId, method: text === 'approval' ? 'item/commandExecution/requestApproval' : 'item/tool/requestUserInput', params: {
        threadId, turnId, command: 'npm test', reason: 'Run project tests', questions: [{ id: 'color', header: 'Color', question: 'Choose a color', options: [{ label: 'Blue', description: 'Use blue' }] }]
      } }); return;
    }
    notification('item/completed', { threadId, item: { type: 'commandExecution', id: `command-${turnId}`, command: 'pwd', status: 'completed', aggregatedOutput: '/fixture' } });
    answer(threadId, turnId); return;
  }
  output({ id, error: { code: -32601, message: `Unknown method ${method}` } });
});
