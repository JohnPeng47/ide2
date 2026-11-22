// Creates one AgentContext per repository: the chosen core component diagram (text)
// plus the same pinned repository checkout used by Core component discovery.
// Idempotent: request IDs are stored in contexts-request.json and reused on rerun.
import { readFile, writeFile, access } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { AgentContextLibrary } from '../../application/mapping/agent/agentContextLibrary';
import { FileAgentContextRepository } from '../../infrastructure/core/persistence/fileAgentContextRepository';

const directory = path.dirname(fileURLToPath(import.meta.url)), root = path.resolve(directory, '../..');
const storeRoot = path.join(root, '.diagrams-local/canvas-domain-model');
const library = new AgentContextLibrary(new FileAgentContextRepository(storeRoot));
const exists = async (f: string) => { try { await access(f); return true; } catch { return false; } };

const seeds = [
  { key: 'mapping', name: 'Mapping', parent: 'saved-agent-context-2ba25014-3a84-42e9-b5f8-1e10c32fa2cd', runId: 'df362edd-3c37-49aa-932d-84181ef9d0c2' },
  { key: 'pi', name: 'Pi', parent: 'saved-agent-context-2b31f263-f81f-4df1-a146-8946dc709b5c', runId: '0fc465ae-961d-4c0a-a0c6-f60338bbe689' },
  { key: 'opencode', name: 'OpenCode', parent: 'saved-agent-context-3d034491-1ea2-4157-acc5-98ead2c12d98', runId: 'c896fde7-00ef-4b9f-a62f-7cfc94310a5b' },
  { key: 'ghostty', name: 'Ghostty', parent: 'saved-agent-context-29fbdd95-72d4-4dc1-ad7c-a1b0f8cd7da6', runId: 'd8ddfcb7-6be0-4a68-9277-c40a1254248f' },
];
const TASK = 'Use this checkout to double-check the supplied core component diagram while restructuring it into a canvas. '
  + 'Verify the containment, ownership and relationships you rely on, and correct anything the source contradicts.';

const requestFile = path.join(directory, 'contexts-request.json');
const ids: Record<string, string> = await exists(requestFile) ? JSON.parse(await readFile(requestFile, 'utf8')) : {};
for (const s of seeds) ids[s.key] ??= randomUUID();
await writeFile(requestFile, JSON.stringify(ids, null, 2) + '\n');

const receipts = [];
for (const s of seeds) {
  const parent = await library.read(s.parent, false);
  const repo = (parent.snapshot.messages[0].content as any[]).find(b => b.type === 'repository');
  if (!repo) throw Error(`${s.name}: parent has no repository block`);
  const ascii = await readFile(path.join(directory, 'seeds', `${s.key}.txt`), 'utf8');
  const text = `<core-component-diagram repository="${s.name}" commit="${repo.commit}">\n${ascii}\n</core-component-diagram>`;
  const receipt = await library.create({
    requestId: ids[s.key], group: 'Core component → canvas',
    name: `${s.name} · core → canvas seed`,
    description: `Core component diagram from Core component discovery run ${s.runId} (Astra/high), plus the same pinned checkout as ${s.parent} at ${repo.commit}, with a verification task.`,
    context: [{ type: 'text', text }, { ...repo, task: TASK }],
  });
  receipts.push({ ...s, commit: repo.commit, ...receipt });
}
await writeFile(path.join(directory, 'contexts-receipt.json'), JSON.stringify(receipts, null, 2) + '\n');
console.log(receipts.map(r => `${r.name}: ${r.agentContextId} ${r.contentHash}`).join('\n'));
