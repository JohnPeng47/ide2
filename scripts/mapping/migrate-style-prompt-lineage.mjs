/** Move the explicitly reviewed style ancestry into prompt versions; never infer lineage from text. */
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
const base = process.env.EVALS_URL || 'http://localhost:5191';
const apply = process.argv.includes('--apply');
const api = async (path, body) => {
  const response = await fetch(`${base}/api/mapping/evals${path}`, body ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : undefined);
  const value = await response.json(); assert(response.ok, JSON.stringify(value)); return value;
};
const hash = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const contentHash = stages => hash(Object.fromEntries(Object.entries(stages).sort(([a], [b]) => a.localeCompare(b))));
const id = '708ed1bd-ed6e-495f-a5be-c9852343b05c';
const experiment = await api(`/experiments/${id}`);
if (!experiment.promptTree?.length) {
  console.log('No manual tree remains to migrate.');
} else {
  const runs = await api('/runs'), beforeRuns = hash(runs);
  const refFor = conditionId => {
    const refs = experiment.samples.filter(s => s.conditionId === conditionId && !s.relaunchedFrom).flatMap(s => s.outputs.map(o => {
      const run = runs.find(r => r.id === o.runId), cell = run?.cells.find(c => c.key === o.cellKey);
      const prompt = run?.prompts.find(p => p.promptId === cell?.promptId);
      assert(prompt?.version, 'Migration requires an exact pinned prompt version.');
      return { promptId: prompt.promptId, version: prompt.version };
    }));
    assert(refs.length); assert(refs.every(r => JSON.stringify(r) === JSON.stringify(refs[0])), 'Review conditions with multiple prompt versions.');
    return refs[0];
  };
  for (const node of experiment.promptTree.filter(n => n.conditionId && n.parentId)) {
    const group = experiment.promptTree.find(n => n.id === node.parentId);
    const parent = group?.conditionId ? group : experiment.promptTree.find(n => n.id === group?.parentId);
    assert(parent?.conditionId);
    const ref = refFor(node.conditionId), parentRef = refFor(parent.conditionId);
    const prompt = await api(`/prompts/${ref.promptId}`), version = prompt.versions.find(v => v.version === ref.version);
    const derivation = { parent: parentRef, kind: 'variation', ...(!group.conditionId ? { dimension: { id: group.name.toLowerCase().replace(/[^a-z0-9]+/g, '-'), name: group.name, value: node.description || node.name } } : {}) };
    console.log(`${apply ? 'Record' : 'Preview'} ${node.name} v${ref.version} -> ${parent.name} v${parentRef.version}`);
    if (apply) {
      const saved = await api(`/prompts/${ref.promptId}/lineage`, { requestId: randomUUID(), version: ref.version, expectedContentHash: contentHash(version.stages), derivation });
      assert.deepEqual(saved.versions.map(v => v.stages), prompt.versions.map(v => v.stages));
    }
  }
  if (apply) {
    const { schemaVersion, id, projectId, revision, createdAt, updatedAt, promptTree, ...design } = experiment;
    const saved = await api('/experiments', { requestId: randomUUID(), experimentId: id, expectedRevision: revision, experiment: design });
    assert.deepEqual(saved.samples, experiment.samples); assert.deepEqual(saved.comparisons, experiment.comparisons);
    assert.equal(hash(await api('/runs')), beforeRuns, 'Existing runs must remain unchanged.');
    console.log('Removed the manual tree. Overview now derives it from prompt versions.');
  }
}
