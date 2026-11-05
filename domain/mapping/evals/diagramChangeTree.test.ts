import { expect, it } from 'vitest';
import { judgeDiagramChangeTrees, parseDiagramChangeTree } from './diagramChangeTree';

const tree = 'Proposed diagram changes\n  |-- PersistentLayer                              existing canvas\n  |   |-- [1b] Modify overview\n  |   |   `-- Expand the SearchArtifact branch (related to [3])\n  |   |-- [2] Add: SearchArtifact model and storage\n  |   `-- [4] Replace obsolete execution diagram\n  |\n  `-- [3] Search orchestration                      new canvas\n      |-- Search lifecycle\n      `-- Result navigation';
it('counts structural operation tags, including new canvas branches, without counting prose mentions', () => {
  const parsed = parseDiagramChangeTree(tree);
  expect(parsed.issues).toEqual([]);
  expect(parsed.counts).toEqual({ '1a': 0, '1b': 1, '2': 1, '3': 1, '4': 1 });
  expect(parsed.operations.find(o => o.code === '3')).toMatchObject({ line: 8 });
});
it('reports malformed outputs without silently reclassifying or repairing them', () => {
  for (const text of ['', 'Here is the proposal:\n' + tree, '```text\n' + tree + '\n```', tree.replace('[4]', '[9]'), tree.replace('[3] Search', 'Search'), tree.replace('[1b] Modify', 'Modify')]) {
    expect(parseDiagramChangeTree(text).valid).toBe(false);
  }
  expect(parseDiagramChangeTree(tree.replace('[1b]', '[3]')).issues).toContainEqual(expect.objectContaining({ message: 'Put [3] on the new canvas branch, not a diagram operation' }));
});
it('accepts CRLF and Unicode branches and reports operation counts separately from output incidence', () => {
  expect(parseDiagramChangeTree(tree.replaceAll('|--', '├──').replaceAll('`--', '└──').replaceAll('\n', '\r\n')).valid).toBe(true);
  const judged = judgeDiagramChangeTrees([{ runId: 'a', outputKey: '1', text: tree }, { runId: 'b', outputKey: '2', text: tree.replace('[4]', '[1a]') }]);
  expect(judged).toMatchObject({ validOutputs: 2, outputsUsing3: 2, outputsUsing4: 1, totals: { '1a': 1, '1b': 2, '2': 2, '3': 2, '4': 1 } });
});
