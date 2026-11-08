import { readFile, writeFile } from 'node:fs/promises';
import { randomUUID, createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { AgentContext } from '../../domain/core/agents/agentContext';
import { sourceFileHash } from '../../domain/core/agents/agentContextSource';

const directory = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(directory, '../..');
const manifest = JSON.parse(await readFile(path.join(directory, 'manifest.json'), 'utf8'));
const baseUrl = process.argv[2] ?? 'http://127.0.0.1:5191';
const sourceId = 'repo-ce67f2af4410036fce1ce12f';
const client = new Client({ name: 'shopify-tiered-context-capture', version: '1.0.0' });
await client.connect(new StdioClientTransport({ command: process.execPath,
  args: ['--import', 'tsx', 'scripts/mapping/mcp.ts', baseUrl], cwd: root }));
async function call(name: string, args: Record<string, unknown>) {
  const response = await client.callTool({ name, arguments: args });
  if (response.isError) throw Error(JSON.stringify(response.content));
  const content = response.content as { type: string; text?: string }[];
  return JSON.parse(content.filter(c => c.type === 'text').map(c => c.text).join(''));
}
try {
  const definitions = await client.listTools();
  const create = definitions.tools.find(t => t.name === 'create-agent-context');
  if (!create || !JSON.stringify(create.inputSchema).includes('"group"')) throw Error('Saved AgentContext groups are unavailable');
  const summaries = [];
  const allLines = new Set<string>();
  for (const tier of ['low', 'mid', 'high']) {
    const ranges = manifest.ranges.filter((r: any) => r.tier === tier);
    const requestPath = path.join(directory, `${tier}.request.json`);
    let request: any;
    try { request = JSON.parse(await readFile(requestPath, 'utf8')); }
    catch (error: any) {
      if (error.code !== 'ENOENT') throw error;
      const requestId = randomUUID();
      const sourceFiles: Record<string, { startLine: number; lines: string[] }> = {};
      const content = [];
      for (const range of ranges) {
        const bytes = await readFile(path.join(root, range.path));
        if (createHash('sha256').update(bytes).digest('hex') !== manifest.files[range.file].sha256)
          throw Error(`Corpus changed: ${range.path}`);
        const lines = bytes.toString('utf8').split(/\r?\n/).slice(range.startLine - 1, range.endLine);
        const file = { startLine: range.startLine, lines };
        const hash = sourceFileHash(file); sourceFiles[hash] = file;
        content.push({ type: 'sourceRange', sourceId, path: range.path, startLine: range.startLine,
          endLine: range.endLine, version: { kind: 'snapshot', contentHash: hash } });
      }
      const context = AgentContext.fromTrajectory({ agentType: 'saved-context', sourceSessionId: requestId,
        format: 'messages-v1', fromEntryId: 'context', throughEntryId: 'context',
        entries: [{ id: 'context', parentId: null, message: { role: 'user', content, timestamp: 0 } }] }).toSnapshot();
      const portable = AgentContext.fromSnapshot({ ...context, sourceFiles }).toSnapshot();
      request = { requestId, name: `Shopify corpus — ${tier}`, group: manifest.group,
        description: `Importance: ${tier}. ${manifest.tierRules[tier]} Primary corpus evidence only; immutable file slices. Source pane ${manifest.sourcePane}; session ${manifest.sourceSessionId}. Selection and limitations: artifacts/shopify-tiered-contexts-2026-11-06/manifest.json.`,
        context: portable };
      await writeFile(requestPath, JSON.stringify(request, null, 2) + '\n');
    }
    const saved = await call('create-agent-context', request);
    const verified = await call('read-agent-context', { agentContextId: saved.agentContextId });
    if (verified.contentHash !== request.context.contentHash || verified.group !== manifest.group)
      throw Error(`Saved context mismatch: ${tier}`);
    const blocks = verified.snapshot.messages.flatMap((m: any) => m.content);
    if (blocks.length !== ranges.length || blocks.some((b: any) => b.type !== 'sourceRange'))
      throw Error(`Unexpected model input: ${tier}`);
    let lines = 0;
    for (const block of blocks) {
      const expected = request.context.sourceFiles[block.version.contentHash];
      if (!expected || expected.lines.length !== block.endLine - block.startLine + 1) throw Error('Pinned range mismatch');
      for (let n = block.startLine; n <= block.endLine; n++) {
        const key = `${block.path}:${n}`;
        if (allLines.has(key)) throw Error(`Duplicated evidence: ${key}`);
        allLines.add(key); lines++;
      }
    }
    const expectedResolved = blocks.map((b: any) => `${b.path}:${b.startLine}-${b.endLine}\n${request.context.sourceFiles[b.version.contentHash].lines.join('\n')}`);
    const actualResolved = verified.resolvedSnapshot.messages.flatMap((m: any) => m.content.map((b: any) => b.text));
    if (JSON.stringify(expectedResolved) !== JSON.stringify(actualResolved)) throw Error(`Resolved evidence differs: ${tier}`);
    const summary = { tier, ...saved, rangeCount: blocks.length, lineCount: lines, fileCount: new Set(blocks.map((b: any) => b.path)).size,
      resolvedBytes: Buffer.byteLength(actualResolved.join('\n')) };
    summaries.push(summary);
    console.log(JSON.stringify(summary));
  }
  const listed = await call('list-agent-contexts', { query: 'Shopify corpus', limit: 100 });
  const members = listed.items.filter((i: any) => i.group === manifest.group);
  if (members.length !== 3 || summaries.some(s => !members.some((i: any) => i.agentContextId === s.agentContextId)))
    throw Error('Group does not contain exactly the expected three contexts');
  const result = { group: manifest.group, contexts: summaries, totalUniqueLines: allLines.size, totalFiles: Object.keys(manifest.files).length,
    manifest: 'manifest.json', verified: 'Three saved members; immutable hashes match; all ranges resolve byte-for-byte to captured slices; tiers are disjoint; source-only model inputs.' };
  await writeFile(path.join(directory, 'group.json'), JSON.stringify(result, null, 2) + '\n');
} finally { await client.close(); }
