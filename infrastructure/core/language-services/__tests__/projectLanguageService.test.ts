import { afterEach, expect, it } from 'vitest';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { ProjectLanguageService } from '../projectLanguageService';
const resources: Array<{ root: string; service: ProjectLanguageService }> = [];
afterEach(async () => { for (const { root, service } of resources.splice(0)) { service.dispose(); await rm(root, { recursive: true, force: true }); } });
async function fixture() {
  const root = await mkdtemp(path.join(tmpdir(), 'definition-test-'));
  const service = new ProjectLanguageService(); resources.push({ root, service });
  await writeFile(path.join(root, 'tsconfig.json'), JSON.stringify({ compilerOptions: { strict: true }, include: ['*.ts'] }));
  await writeFile(path.join(root, 'math.ts'), 'export function double(value: number) { return value * 2; }\n');
  const source = 'import { double } from "./math";\nconst emoji = "😀"; double(21);\n';
  await writeFile(path.join(root, 'main.ts'), source);
  const binding = { kind: 'git-worktree' as const, root };
  const hash = createHash('sha256').update(source).digest('hex');
  return { root, service, source, binding, hash };
}
it('uses a real shared LSP session to resolve imports and UTF-16 positions, then sees changed definitions', async () => {
  const { root, service, source, binding, hash } = await fixture();
  const character = source.split('\n')[1].indexOf('double');
  const result = await service.definitions(binding, 'main.ts', { line: 1, character }, hash);
  expect(result).toMatchObject({ outsideRoot: 0, locations: [{ path: 'math.ts', range: { start: { line: 0, character: 16 }, end: { line: 0, character: 22 } } }] });
  // Closing read-only documents after each lookup prevents stale in-memory snapshots.
  const updated = 'function local() {}\nlocal();\n';
  await writeFile(path.join(root, 'main.ts'), updated);
  const local = await service.definitions(binding, 'main.ts', { line: 1, character: 2 }, createHash('sha256').update(updated).digest('hex'));
  expect(local.locations[0]).toMatchObject({ path: 'main.ts', range: { start: { line: 0, character: 9 } } });
}, 30000);
it('rejects stale contents, invalid positions and traversal before starting a language server', async () => {
  const { service, binding, hash } = await fixture();
  await expect(service.definitions(binding, 'main.ts', { line: 1, character: 0 }, 'old')).rejects.toThrow('Source changed');
  await expect(service.definitions(binding, '../main.ts', { line: 0, character: 0 }, hash)).rejects.toThrow();
  await expect(service.definitions(binding, 'main.ts', { line: 20, character: 0 }, hash)).rejects.toThrow('outside the file');
});

it('returns multiple definitions, no-result responses, and reports SDK targets outside the repository', async () => {
  const { root, service, binding } = await fixture();
  const source = 'interface Shared { a: number }\ninterface Shared { b: number }\nlet value: Shared;\nconst message = "hello"; message.toUpperCase();\n';
  await writeFile(path.join(root, 'main.ts'), source);
  const hash = createHash('sha256').update(source).digest('hex');
  const result = await service.definitions(binding, 'main.ts', { line: 2, character: 12 }, hash);
  expect(result.locations.map(location => location.range?.start.line)).toEqual([0, 1]);
  expect(await service.definitions(binding, 'main.ts', { line: 2, character: 0 }, hash)).toEqual({ locations: [], outsideRoot: 0 });
  const external = await service.definitions(binding, 'main.ts', { line: 3, character: source.split('\n')[3].indexOf('toUpperCase') + 2 }, hash);
  expect(external.locations).toEqual([]);
  expect(external.outsideRoot).toBeGreaterThan(0);
  const controller = new AbortController(); controller.abort();
  await expect(service.definitions(binding, 'main.ts', { line: 2, character: 12 }, hash, controller.signal)).rejects.toThrow();
}, 30000);

it('a disposed service cannot start or restart a server', async () => {
  const { service, binding, hash } = await fixture();
  service.dispose();
  await expect(service.definitions(binding, 'main.ts', { line: 1, character: 20 }, hash)).rejects.toThrow('stopped');
});
