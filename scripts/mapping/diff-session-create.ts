import { parseArgs } from 'node:util';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { createBackend } from '../../src/server/app/bootstrap';

const { values } = parseArgs({ options: {
  pi: { type: 'boolean', default: false }, 'project-root': { type: 'string', default: process.cwd() },
  'diagrams-dir': { type: 'string', default: '.diagrams-local/canvas-domain-model' },
  baseline: { type: 'string' }, repository: { type: 'string' }, commit: { type: 'string', multiple: true }, head: { type: 'string' },
  title: { type: 'string', default: 'Generated ChangeSession' }, 'request-id': { type: 'string' }
} });
if (!values.pi) throw Error('Pass --pi to enable AI generation (astra-high).');
const root = path.resolve(values['project-root']);
const backend = createBackend(root, path.resolve(values['diagrams-dir']), undefined, root, { piEnabled: true });
let runId: string | undefined;
const cancel = () => { if (runId) void backend.diffSessionWorkflows.cancel(runId); };
process.on('SIGINT', cancel); process.on('SIGTERM', cancel);
try {
  let run = await backend.diffSessionWorkflows.start({ requestId: values['request-id'] ?? randomUUID(), title: values.title,
    ...(values.baseline ? { baselineChangeSessionId: values.baseline } : { repositoryId: values.repository, commits: values.commit, head: values.head }) });
  runId = run.id;
  console.log(JSON.stringify(run));
  let previous = JSON.stringify(run);
  while (run.status === 'running') {
    await new Promise(resolve => setTimeout(resolve, 1500));
    run = (await backend.diffSessionWorkflows.get(runId))!;
    if (JSON.stringify(run) !== previous) { console.log(JSON.stringify(run)); previous = JSON.stringify(run); }
  }
  if (run.status !== 'completed') process.exitCode = 1;
} finally { process.off('SIGINT', cancel); process.off('SIGTERM', cancel); backend.dispose(); }
