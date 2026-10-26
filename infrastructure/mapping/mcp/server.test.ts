import { createServer } from 'node:http';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { expect, it } from 'vitest';
import { createMappingMcpServer, registerChatMcpTools } from './server';

it('keeps one automatic attachment across direct MCP calls and supplies common methods upfront', async () => {
  const calls: { name: string; input: Record<string, any> }[] = [];
  const http = createServer(async (req, res) => {
    let body = ''; for await (const chunk of req) body += chunk;
    const input = JSON.parse(body), name = req.url!.split('/').at(-1)!;
    calls.push({name,input});
    res.setHeader('content-type','application/json');
    res.end(JSON.stringify(input.code?.includes('canvas.attach') ? {value:{sessionId:'attached'}} : {value:{version:0,nodes:[]},version:0}));
  });
  await new Promise<void>(resolve => http.listen(0,'127.0.0.1',resolve));
  const port = (http.address() as {port:number}).port;
  const server = createMappingMcpServer(`http://127.0.0.1:${port}`, '', {canvasId:'canvas',documentId:'document'});
  const client = new Client({name:'bound-canvas-test',version:'1'});
  const [a,b] = InMemoryTransport.createLinkedPair();
  try {
    await Promise.all([server.connect(a),client.connect(b)]);
    const tool = (await client.listTools()).tools.find(tool => tool.name === 'exec')!;
    expect(tool.description).toContain('"name":"nodes.highlight"');
    expect(tool.description).toContain('markdownUrl');
    expect(tool.inputSchema.properties?.mode).toMatchObject({default:'batched'});
    const contextTool = (await client.listTools()).tools.find(tool => tool.name === 'diagram-agent-context')!;
    expect(contextTool.description).toContain('Prepare, read, or delete');
    const results = await Promise.all([1,2].map(i => client.callTool({name:'exec',arguments:{requestId:`read-${i}`,code:'return canvas.read({});'}})));
    expect(results.every(result => !result.isError)).toBe(true);
    expect(calls.filter(call => call.input.code?.includes('canvas.attach'))).toHaveLength(1);
    expect(calls.filter(call => call.input.code === 'return canvas.read({});').map(call => call.input.sessionId)).toEqual(['attached','attached']);
    const contextRead = await client.callTool({ name: 'diagram-agent-context', arguments: { operation: 'read', nodeId: 'grid:overview', requestId: 'context-read' } });
    expect(contextRead.isError).not.toBe(true);
    expect(calls.at(-1)).toMatchObject({ name: 'diagram-agent-context', input: { sessionId: 'attached', operation: 'read' } });
    expect(calls.some(call => call.name === 'canvas-api-search')).toBe(false);
    const wrong = await client.callTool({name:'exec',arguments:{requestId:'wrong',sessionId:'another',code:'return canvas.read({});'}});
    expect(wrong.isError).toBe(true);
    expect(calls).toHaveLength(4);
    const editTool = (await client.listTools()).tools.find(tool => tool.name === 'edit-diagram')!;
    expect(editTool.inputSchema.properties?.['edit-mode']).toMatchObject({ enum: ['in-place', 'variant'] });
    expect(editTool.inputSchema.properties).toHaveProperty('operations');
    const edit = await client.callTool({ name: 'edit-diagram', arguments: { nodeId: 'grid:overview',
      expectedVersion: 0, baseRevisionId: 'base', prompt: 'Improve it', requestId: 'variant-edit', 'replace-mode': 'diagram', 'edit-mode': 'variant' } });
    expect(edit.isError).not.toBe(true);
    expect(calls.at(-1)).toMatchObject({ name: 'edit-diagram', input: { sessionId: 'attached', 'edit-mode': 'variant' } });
    const viewTool = (await client.listTools()).tools.find(tool => tool.name === 'canvas-view')!;
    expect(viewTool.inputSchema.properties?.operation).toMatchObject({ enum: expect.arrayContaining(['start', 'stop', 'list', 'read', 'apply', 'delete', 'cancel']) });
    const view = await client.callTool({ name: 'canvas-view', arguments: { operation: 'start', name: 'A', expectedVersion: 0, requestId: 'view-start' } });
    expect(view.isError).not.toBe(true);
    expect(calls.at(-1)).toMatchObject({ name: 'canvas-view', input: { sessionId: 'attached', operation: 'start', name: 'A' } });
    const group = await client.callTool({ name: 'canvas-view', arguments: {
      operation: 'alternatives', viewId: 'A', names: ['A.1', 'A.2', 'A.3'], expectedVersion: 1, requestId: 'group' } });
    expect(group.isError).not.toBe(true);
    expect(calls.at(-1)).toMatchObject({ name: 'canvas-view', input: {
      sessionId: 'attached', operation: 'alternatives', viewId: 'A', names: ['A.1', 'A.2', 'A.3'] } });
    const keep = await client.callTool({ name: 'canvas-view', arguments: { operation: 'keep', viewId: 'A.1', expectedVersion: 2, requestId: 'keep' } });
    expect(keep.isError).not.toBe(true);
    expect(calls.at(-1)).toMatchObject({ name: 'canvas-view', input: { sessionId: 'attached', operation: 'keep', viewId: 'A.1' } });
  } finally {
    await client.close(); await server.close();
    await new Promise<void>((resolve,reject) => http.close(error => error ? reject(error) : resolve()));
  }
});

it('exposes direct payloads on chat-bound MCP and rejects the prompt-only contract', async () => {
  const calls: { name: string; input: Record<string, unknown>; binding?: string }[] = [];
  const http = createServer(async (req, res) => {
    let body = ''; for await (const chunk of req) body += chunk;
    calls.push({ name: req.url!.split('/').at(-1)!, input: JSON.parse(body), binding: req.headers['x-canvas-chat-binding'] as string });
    res.setHeader('content-type', 'application/json'); res.end(JSON.stringify({ runId: 'batch', status: 'completed', results: [] }));
  });
  await new Promise<void>(resolve => http.listen(0, '127.0.0.1', resolve));
  const server = createMappingMcpServer(`http://127.0.0.1:${(http.address() as { port: number }).port}`, 'trusted-chat');
  const client = new Client({ name: 'direct-chat-test', version: '1' });
  const [a, b] = InMemoryTransport.createLinkedPair();
  try {
    await Promise.all([server.connect(a), client.connect(b)]);
    for (const name of ['edit-diagram', 'create-diagram', 'extend-diagram']) {
      const tool = (await client.listTools()).tools.find(tool => tool.name === name)!;
      expect(tool.inputSchema.properties).toHaveProperty('operations');
      expect(tool.description).toContain('# OUTPUT FORMAT');
      expect(tool.description).toContain('does not call another model');
    }
    const operations = [{ nodeId: 'grid:overview', baseRevisionId: 'revision', 'edit-mode': 'in-place', 'replace-mode': 'diagram', edit: { ascii: 'New', structureKind: 'tree' } }];
    const result = await client.callTool({ name: 'edit-diagram', arguments: { requestId: 'direct', expectedVersion: 0, operations } });
    expect(result.isError).not.toBe(true);
    expect(calls[0]).toMatchObject({ name: 'edit-diagram', binding: 'trusted-chat', input: { operations } });
    const rejected = await client.callTool({ name: 'edit-diagram', arguments: { nodeId: 'grid:overview', baseRevisionId: 'revision', 'edit-mode': 'in-place', 'replace-mode': 'diagram', prompt: 'Generate', expectedVersion: 0, requestId: 'old' } });
    expect(rejected.isError).toBe(true); expect(calls).toHaveLength(1);
  } finally { await client.close(); await server.close(); await new Promise<void>(resolve => http.close(() => resolve())); }
});


it('loads current chat definitions from the host and dispatches through the authenticated chat session', async () => {
  let definition = { type: 'function', name: 'project-diagrams', description: 'Current projection',
    inputSchema: { type: 'object', properties: { diagramIds: { type: 'array', items: { type: 'string' }, minItems: 1 } }, required: ['diagramIds'], additionalProperties: false } };
  const calls: any[] = [];
  const http = createServer(async (req, res) => {
    expect(req.headers['x-canvas-chat-binding']).toBe('bound');
    res.setHeader('content-type', 'application/json');
    if (req.method === 'GET') { res.end(JSON.stringify([definition])); return; }
    let body = ''; for await (const chunk of req) body += chunk;
    calls.push({ path: req.url, ...JSON.parse(body) });
    res.end(JSON.stringify({ documentId: 'child' }));
  });
  await new Promise<void>(resolve => http.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${(http.address() as { port: number }).port}`;
  try {
    for (const description of ['Current projection', 'Updated projection definition']) {
      definition = { ...definition, description };
      const server = createMappingMcpServer(base, 'bound');
      const client = new Client({ name: 'reload-tools-test', version: '1' });
      const [a, b] = InMemoryTransport.createLinkedPair();
      try {
        await registerChatMcpTools(server, base, 'bound');
        await Promise.all([server.connect(a), client.connect(b)]);
        const exposed = (await client.listTools()).tools.find(tool => tool.name === 'chat_project-diagrams')!;
        expect(exposed.description).toBe(description);
        expect(exposed.inputSchema.required).toEqual(['diagramIds']);
        const result = await client.callTool({ name: exposed.name, arguments: { diagramIds: ['grid:a'] } });
        expect(result.structuredContent).toEqual({ result: { documentId: 'child' } });
        expect(calls.at(-1)).toMatchObject({ path: '/api/mapping/agent-chat/tools/project-diagrams',
          input: { diagramIds: ['grid:a'] }, callId: expect.any(String) });
        const rejected = await client.callTool({ name: exposed.name, arguments: { diagramIds: [] } });
        expect(rejected.isError).toBe(true);
      } finally { await client.close(); await server.close(); }
    }
    expect(calls).toHaveLength(2);
  } finally { await new Promise<void>(resolve => http.close(() => resolve())); }
});
