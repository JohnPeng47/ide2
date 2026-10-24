import { spawn, type ChildProcess } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { createServer } from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { seedMappingFixture } from '../../browser/support/browser-mapping-fixture.mjs';
import { canvasSaveFixture } from '../../support/mappingDiagram';
import { singleDiagramScene } from '../../../domain/core/diagrams/projectDiagramCanvas';
import { revisionFixture } from '../../support/diagramRevisions';
import { diagramContentNodes } from '../../../domain/core/diagrams/diagramContentNodes';
import { defaultArrowAppearance, type DiagramConnection } from '../../../domain/core/diagrams/diagramConnection';

const repo = fileURLToPath(new URL('../../../', import.meta.url));
export type Seeded = Awaited<ReturnType<typeof resetFixture>>;

async function stop(server?: ChildProcess) {
  if (!server || server.exitCode !== null || server.signalCode !== null) return;
  await new Promise<void>(resolve => {
    const timer = setTimeout(() => server.kill('SIGKILL'), 5000);
    server.once('exit', () => { clearTimeout(timer); resolve(); });
    server.kill('SIGTERM');
  });
}

export async function resetFixture(size: 'normal') {
  const root = await mkdtemp(path.join(tmpdir(), `mapping-f02-${size}-`));
  let server: ChildProcess | undefined;
  const remove = async () => { try { await stop(server); } finally { await rm(root, { recursive: true, force: true }); } };
  try {
    await seedMappingFixture(root, { ascii: 'F02 fixture', nodes: [] });
    const catalogPath = path.join(root, '.diagrams/representations/catalog.json');
    const catalog = JSON.parse(await readFile(catalogPath, 'utf8'));
    const scene = singleDiagramScene('F02 fixture');
    const ids = ['d1', 'd2', 'd3', 'd4', 'd5', 'd6'];
    const service = revisionFixture();
    scene.contents = Object.fromEntries(ids.map(id => [id, service.create({ id, revision: 0, structureKind: 'tree',
      ascii: `${id.toUpperCase()}\n\n|-- ${id} branch\n|   \x60-- ${id} leaf\n\x60-- ${id} tail\n`,
    }).diagram]));
    if (scene.root.kind !== 'container') throw Error('Fixture requires a container root');
    scene.root.children = ids.map((id, i) => ({ id, kind: 'diagram', contentId: id, collapsed: false,
      position: { column: (i % 3) * 30, row: 5 + Math.floor(i / 3) * 22 } }));
    const edges: DiagramConnection[] = ids.slice(0, -1).map((id, i) => ({ id: `${id}-${ids[i + 1]}`,
      // Route the measured edge from the label's right side: automatic left-side
      // proxy routing crosses the subtree toggle and intercepts an unfold click.
      source: { kind: 'content-node', displayNodeId: `grid:${id}`, side: id === 'd3' ? 'right' : 'auto',
        contentNodeId: diagramContentNodes(scene.contents[id].content).find(node => node.line === 4)!.id,
        revisionId: scene.contents[id].content.revisionId },
      target: { kind: 'box', displayNodeId: `grid:${ids[i + 1]}`, side: 'auto' },
      appearance: { ...defaultArrowAppearance, label: `${id} to ${ids[i + 1]}` },
    }));
    catalog.revisions['revision-overview'].content = { kind: 'canvas-history',
      history: canvasSaveFixture({ name: 'F02 fixture', scene, edges }).history };
    await writeFile(catalogPath, JSON.stringify(catalog));
    const port = await new Promise<number>((resolve, reject) => {
      const socket = createServer();
      socket.once('error', reject);
      socket.listen(0, '127.0.0.1', () => {
        const address = socket.address();
        if (!address || typeof address === 'string') throw Error('Expected TCP address');
        socket.close(error => error ? reject(error) : resolve(address.port));
      });
    });
    const url = `http://127.0.0.1:${port}`;
    let errors = '';
    server = spawn(process.execPath, ['scripts/dev/start-server.mjs', '--http', 'preview', '--host', '127.0.0.1', '--port', String(port), '--strictPort'], {
      cwd: repo, env: { ...process.env, NEW_DIAGRAM_PROJECT_ROOT: root,
        NEW_DIAGRAMS_DIR: path.join(root, '.diagrams'), NEW_DIAGRAM_AGENT: 'fake' },
      stdio: ['ignore', 'ignore', 'pipe'],
    });
    server.stderr!.on('data', chunk => { errors += chunk; });
    server.on('error', error => { errors += String(error); });
    const deadline = Date.now() + 30_000;
    while (true) {
      if ((await fetch(url, { signal: AbortSignal.timeout(1000) }).catch(() => null))?.ok) break;
      if (Date.now() >= deadline || server.exitCode !== null) throw Error(`Fixture server unavailable: ${errors}`);
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    return { canvasUrl: `${url}/mapping?diagram=representation-overview`, remove,
      description: { diagrams: ids.length, edges: edges.length, size } };
  } catch (error) { await remove(); throw error; }
}
