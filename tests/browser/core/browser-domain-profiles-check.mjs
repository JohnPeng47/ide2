import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir, homedir } from 'node:os';
import { createServer } from 'node:net';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';
const { evaluate, waitFor, waitForSelector, withHeadlessBrowser, captureScreenshot } = await import(pathToFileURL(path.join(homedir(), '.codex/skills/front-end/browser-test.mjs')).href);
const root = await mkdtemp(path.join(tmpdir(), 'mapping-domain-profiles-'));
let server;
try {
  const timestamp = new Date().toISOString();
  const projectId = 'project-profiles';
  const representations = {}, revisions = {};
  await mkdir(path.join(root, '.git'));
  for (const [profile, file, text] of [['source-code', 'main.ts', 'export const answer = 42;'], ['document', 'notes.md', '# Mapping document corpus']]) {
    await writeFile(path.join(root, file), text + '\n');
    const id = `representation-${profile}`, revisionId = `revision-${profile}`;
    representations[id] = { schemaVersion: 1, id, projectId, name: profile, handle: profile, viewKind: 'diagram', representationKind: 'tree', status: 'settled', currentRevisionId: revisionId, revisionIds: [revisionId], createdAt: timestamp, updatedAt: timestamp };
    revisions[revisionId] = { schemaVersion: 1, id: revisionId, projectId, representationId: id, revision: 1, ascii: 'Source', asciiSha256: createHash('sha256').update('Source').digest('hex'), representationKind: 'tree',
      source: { sourceId: `source-${profile}`, repositoryIdentity: root, domainProfileId: profile, corpus: { kind: profile === 'document' ? 'filesystem-documents' : 'git-worktree', root } },
      evidence: { entry: { id: 'entry', handle: 'entry', label: file, category: 'operation', summary: 'Source fixture', sourceRanges: [{ id: 'range-one', path: file, startLine: 1, endLine: 1, originalLines: [text] }] } },
      mappings: [{ id: 'map-one', evidenceId: 'entry', sourceRangeId: 'range-one', line: 1, startColumn: 1, endColumn: 6 }], createdAt: timestamp };
  }
  await mkdir(path.join(root, '.diagrams/representations'), { recursive: true });
  await writeFile(path.join(root, '.diagrams/project.json'), JSON.stringify({ schemaVersion: 1, id: projectId, name: 'Corpus profiles', sources: [], createdAt: timestamp, updatedAt: timestamp }));
  await writeFile(path.join(root, '.diagrams/representations/catalog.json'), JSON.stringify({ schemaVersion: 1, projectId, activeByKind: {}, representations, revisions, createdAt: timestamp, updatedAt: timestamp }));
  const port = await new Promise(resolve => { const s = createServer(); s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => resolve(p)); }); });
  const url = `http://127.0.0.1:${port}`;
  server = spawn(process.execPath, ['scripts/dev/start-server.mjs', '--http', 'preview', '--host', '127.0.0.1', '--port', String(port), '--strictPort'], { env: { ...process.env, NEW_DIAGRAM_PROJECT_ROOT: root, NEW_DIAGRAM_AGENT: 'fake' }, stdio: ['ignore', 'ignore', 'pipe'] });
  let log = ''; server.stderr.on('data', b => log += b);
  await waitFor(async () => (await fetch(url).catch(() => null))?.ok, { timeoutMs: 20000 }).catch(e => { throw new Error(`${e}\n${log}`); });
  for (const [profile, file, text] of [['source-code', 'main.ts', 'export const answer = 42;'], ['document', 'notes.md', '# Mapping document corpus']]) {
    await withHeadlessBrowser({ url: `${url}/mapping?diagram=representation-${profile}`, width: 1600, height: 1000 }, async ({ cdp }) => {
      await waitForSelector(cdp, '[data-selectable-node]');
      const rect = await evaluate(cdp, `(() => { const r=document.querySelector('[data-selectable-node]').getBoundingClientRect(); return {x:r.x,y:r.y,width:r.width,height:r.height}; })()`);
      const start = { x: rect.x + 1, y: rect.y + rect.height / 2 }, end = { x: rect.x + rect.width - 1, y: start.y };
      await cdp.send('Input.dispatchMouseEvent', { type:'mousePressed', ...start, button:'left', buttons:1, modifiers:2, clickCount:1 });
      await cdp.send('Input.dispatchMouseEvent', { type:'mouseMoved', ...end, button:'left', buttons:1, modifiers:2 });
      await cdp.send('Input.dispatchMouseEvent', { type:'mouseReleased', ...end, button:'left', modifiers:2, clickCount:1 });
      await waitForSelector(cdp, '.mapping-poc-selection-actions');
      assert.ok((await evaluate(cdp, 'document.querySelector(".mapping-poc-selection-menu").textContent')).includes('source 1/1'));
      const response = await fetch(`${url}/api/core/project/source?${new URLSearchParams({projectId, sourceId:`source-${profile}`, path:file})}`);
      assert.equal(response.status, 200); assert.equal((await response.json()).lines[0], text);
      await captureScreenshot(cdp, { output: path.join(root, `${profile}.png`) });
    });
  }
  console.log('PASS: Mapping source and document corpus bindings, selection coverage, and source HTTP access without DiagramSets');
} finally {
  if (server && server.exitCode === null) { const exited = new Promise(resolve => server.once('exit', resolve)); server.kill('SIGTERM'); await exited; }
  await rm(root, { recursive: true, force: true });
}
