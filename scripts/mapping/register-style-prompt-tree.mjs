/** Add the agreed presentation lineage to the style experiment, preserving all execution records. */
import assert from 'node:assert/strict';
const base = process.env.EVALS_URL || 'http://localhost:5191';
const api = async (path, body) => {
  const response = await fetch(`${base}/api/mapping/evals${path}`, body ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : undefined);
  const result = await response.json(); assert(response.ok, JSON.stringify(result)); return result;
};
const current = await api('/experiments/708ed1bd-ed6e-495f-a5be-c9852343b05c');
const promptTree = [
  { id: 'baseline', name: 'Shared baseline', conditionId: 'baseline', description: '50% code / 50% natural language · balanced modular/runtime focus · moderate hierarchy' },
  { id: 'expression', name: 'Expression', parentId: 'baseline' },
  { id: 'code', name: 'Code', parentId: 'expression', conditionId: 'code', description: '100% code / 0% natural language' },
  { id: 'language', name: 'Natural language', parentId: 'expression', conditionId: 'language', description: '0% code / 100% natural language' },
  { id: 'focus', name: 'Organizing focus', parentId: 'baseline' },
  { id: 'modular', name: 'Modular', parentId: 'focus', conditionId: 'modular', description: 'Components, interfaces, and source dependencies' },
  { id: 'runtime', name: 'Runtime state', parentId: 'focus', conditionId: 'runtime', description: 'Instances, state, resources, and ownership' },
  { id: 'topology', name: 'Tree topology', parentId: 'baseline' },
  { id: 'shallow', name: 'Shallow', parentId: 'topology', conditionId: 'shallow', description: 'Shallow, wide tree' },
  { id: 'varied', name: 'Varied', parentId: 'topology', conditionId: 'varied', description: 'Varied depth and branching' }
];
if (JSON.stringify(current.promptTree) === JSON.stringify(promptTree)) {
  console.log('Prompt tree already registered.');
} else if (!process.argv.includes('--apply')) {
  console.log(JSON.stringify(promptTree, null, 2));
} else {
  const { id, revision, schemaVersion, projectId, createdAt, updatedAt, ...experiment } = current;
  const saved = await api('/experiments', { requestId: crypto.randomUUID(), experimentId: id, expectedRevision: revision, experiment: { ...experiment, promptTree } });
  assert.deepEqual(saved.samples, current.samples); assert.deepEqual(saved.comparisons, current.comparisons);
  console.log(`Registered prompt tree at revision ${saved.revision}.`);
}
