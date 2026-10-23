import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, expect, it } from 'vitest';
import { compileDiagramAgentContext, loadDiagramAgentContext, storeDiagramAgentContext } from '../../../../domain/core/diagrams/diagramAgentContext';
import { singleDiagramScene } from '../../../../domain/core/diagrams/projectDiagramCanvas';
import { FileDiagramAgentContextStore } from '../fileDiagramAgentContextStore';

const roots: string[] = [];
afterEach(async () => { await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true }))); });

it('writes a standalone immutable context file and reloads it from a small diagram binding', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'diagram-agent-context-')); roots.push(root);
  const diagram = singleDiagramScene('Source').contents.overview;
  const compiled = compileDiagramAgentContext(diagram), store = new FileDiagramAgentContextStore(root);
  const bound = await storeDiagramAgentContext(compiled, store);
  expect(bound).toHaveProperty('backingRecordId');
  expect(bound).not.toHaveProperty('snapshot');
  expect(JSON.stringify(bound).length).toBeLessThan(JSON.stringify(compiled).length);
  expect(await loadDiagramAgentContext(bound, new FileDiagramAgentContextStore(root))).toEqual(compiled.snapshot);
  const file = path.join(root, 'diagram-agent-contexts', `${bound.backingRecordId}.json`);
  expect(JSON.parse(await readFile(file, 'utf8'))).toEqual(compiled.snapshot);
  await writeFile(file, '{}');
  await expect(loadDiagramAgentContext(bound, new FileDiagramAgentContextStore(root))).rejects.toThrow('integrity');
});
