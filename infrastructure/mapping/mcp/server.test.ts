import { createServer } from 'node:http';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { expect, it } from 'vitest';
import { createMappingMcpServer } from './server';

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
    const results = await Promise.all([1,2].map(i => client.callTool({name:'exec',arguments:{requestId:`read-${i}`,code:'return canvas.read({});'}})));
    expect(results.every(result => !result.isError)).toBe(true);
    expect(calls.filter(call => call.input.code?.includes('canvas.attach'))).toHaveLength(1);
    expect(calls.filter(call => call.input.code === 'return canvas.read({});').map(call => call.input.sessionId)).toEqual(['attached','attached']);
    expect(calls.some(call => call.name === 'canvas-api-search')).toBe(false);
    const wrong = await client.callTool({name:'exec',arguments:{requestId:'wrong',sessionId:'another',code:'return canvas.read({});'}});
    expect(wrong.isError).toBe(true);
    expect(calls).toHaveLength(3);
  } finally {
    await client.close(); await server.close();
    await new Promise<void>((resolve,reject) => http.close(error => error ? reject(error) : resolve()));
  }
});
