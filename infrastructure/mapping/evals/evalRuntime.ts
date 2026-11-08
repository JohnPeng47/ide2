import { spawn } from 'node:child_process';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { z } from 'zod';
import { requireAiEnabled } from '../../../application/core/errors';
import type { EvalRuntime } from '../../../application/mapping/evals/evalRunService';

/** An isolated ASCII-only working directory prevents inherited repository/chat context. */
export class CodexEvalRuntime implements EvalRuntime {
  constructor(private enabled: boolean) {}
  async generate(input: Parameters<EvalRuntime['generate']>[0]): ReturnType<EvalRuntime['generate']> {
    requireAiEnabled(this.enabled); input.signal.throwIfAborted();
    const directory = await mkdtemp(path.join(tmpdir(), 'canvas-eval-'));
    try {
      await Promise.all(Object.entries(input.files).map(([name, value]) => writeFile(path.join(directory, name), JSON.stringify(value), { mode: 0o600 })));
      const schema = path.join(directory, 'output-schema.json');
      await writeFile(schema, JSON.stringify(z.toJSONSchema(input.schema)));
      input.signal.throwIfAborted();
      return await new Promise((resolve, reject) => {
        const child = spawn(process.env.NEW_DIAGRAM_CODEX_BIN || 'codex', ['exec', '--model', input.model,
          '--sandbox', 'read-only', '-c', 'approval_policy="never"', '-c', `model_reasoning_effort=${JSON.stringify(input.effort)}`,
          '--ephemeral', '--skip-git-repo-check', '--json', '--color', 'never', '--output-schema', schema, '--cd', directory, '-'],
        { cwd: directory, stdio: ['pipe', 'pipe', 'pipe'] });
        let buffer = '', reply = '', failure = '', bytes = 0, settled = false, usage: Record<string, number> | undefined;
        let forceKill: ReturnType<typeof setTimeout> | undefined;
        const stop = () => { child.kill('SIGTERM'); forceKill ??= setTimeout(() => child.kill('SIGKILL'), 2000); forceKill.unref(); };
        const finish = (error?: Error) => {
          if (settled) return; settled = true; clearTimeout(timeout); input.signal.removeEventListener('abort', abort);
          if (error) { stop(); reject(error); }
          else { try { resolve({ output: JSON.parse(reply), usage }); } catch { reject(Error('Eval agent returned invalid JSON.')); } }
        };
        const abort = () => finish(Error('Generation cancelled.'));
        const timeout = setTimeout(() => finish(Error('Generation timed out.')), 15 * 60_000);
        input.signal.addEventListener('abort', abort, { once: true });
        const consume = (line: string) => {
          try {
            const event = JSON.parse(line);
            if (event.type === 'item.completed' && event.item?.type === 'agent_message') reply = event.item.text;
            if (event.type === 'turn.completed') usage = event.usage;
            if (event.type === 'turn.failed') failure = event.error?.message || 'Generation failed.';
          } catch { /* Ignore non-JSON diagnostics. */ }
        };
        child.stdout.setEncoding('utf8'); child.stderr.resume();
        child.stdout.on('data', (chunk: string) => {
          bytes += Buffer.byteLength(chunk);
          if (bytes > 16 * 1024 * 1024) return finish(Error('Generation output exceeded its limit.'));
          buffer += chunk; const lines = buffer.split('\n'); buffer = lines.pop() ?? ''; lines.forEach(consume);
        });
        child.stdin.on('error', error => finish(error)); child.on('error', error => finish(error));
        child.on('close', code => {
          clearTimeout(forceKill); consume(buffer);
          finish(failure || code !== 0 || !reply.trim() ? Error(failure || `Eval agent exited ${code} without a result. Check model access and authentication.`) : undefined);
        });
        if (input.signal.aborted) abort(); else child.stdin.end(input.prompt);
      });
    } finally { await rm(directory, { recursive: true, force: true }); }
  }
}

/** Deterministic outputs for tests and offline UI work. */
export class FakeEvalRuntime implements EvalRuntime {
  async generate(input: Parameters<EvalRuntime['generate']>[0]): ReturnType<EvalRuntime['generate']> {
    input.signal.throwIfAborted();
    if (input.stage === 'linked') {
      const sources = input.files['canvases.json'] as { id: string; diagrams: { id: string; ascii: string }[] }[];
      const fresh = (id: string, name: string) => ({ kind: 'new' as const, id, name, diagrams: [{ id: 'overview', ascii: name + '\n`-- Supporting evidence', position: { column: 0, row: 0 } }], edges: [] });
      const canvases = [...(sources.length ? sources.map(c => ({ kind: 'existing' as const, id: c.id, sourceCanvas: c.id, edits: [] })) : [fresh('root', 'Overview')]), fresh('detail', 'Detail')];
      const source = (index: number) => sources[index]?.diagrams[0] ?? { id: 'overview', ascii: 'Overview' };
      return { output: { explanation: 'A navigable set with pinned inputs and supporting detail.', rootCanvas: canvases[0].id, canvases,
        jumps: canvases.slice(0, -1).map((c, i) => ({ source: { canvas: c.id, diagram: source(i).id,
          line: source(i).ascii.split('\n').findIndex(line => line.trim()) + 1, startColumn: 1, endColumn: 1 },
          target: { canvas: canvases[i + 1].id, diagram: null, line: null } })) } };
    }
    if (input.stage === 'proposal') return { output: { tree: 'Proposed diagram changes\n  |-- Workspace                              existing canvas\n  |   `-- [1b] Extend overview\n  |       `-- Show the new component' } };
    if (input.stage === 'seed' || input.stage === 'judge') {
      const references = Array.from({ length: 5 }, (_, i) => ({ slot: i + 1, title: `Parcel pattern ${i + 1}`,
        ascii: `ParcelRoute${i + 1}\n|-- Route\n\`-- Stop`, rationale: 'Preserve a clear ownership subtree.' }));
      if (input.stage === 'seed') return { output: { references } };
      const outputs = input.files['outputs.json'] as { key: string }[];
      return { output: { assessments: outputs.map(item => ({ key: item.key, topology: 3, coverage: 3, accuracy: 4, readability: 4,
        evidence: 'Line 1 identifies the generated root.', strengths: 'Clear root and child.', weaknesses: 'Limited nested detail.' })),
        progress: 'The outputs preserve a clear hierarchy; deeper structure still needs improvement.', nextReferences: references,
        recommendations: 'Retain the ownership examples and test deeper return-model expansion.' } };
    }
    if (input.stage === 'alternative') {
      if (input.files['layout-template.json']) {
        const geometry = input.files['layout-template.json'] as import('../../../domain/core/diagrams/layoutTemplate').LayoutGeometry;
        return { output: { format: 'template-slots-v1', explanation: 'Fresh diagrams fitted to the selected layout.',
          // A wide first slot exercises deterministic fitting in browser fixtures.
          diagrams: geometry.slots.map((slot, index) => ({ slotId: slot.id, ascii: `Fresh diagram ${index + 1}\n${index === 0 ? '|-- A wider generated branch demonstrates deterministic layout fitting\n' : ''}\`-- Generated from context` })), edges: [] } };
      }
      const context = input.files['context.json'] as { name: string };
      const pass = input.prompt.match(/pass \d+/)?.[0] ?? 'pass';
      return { output: { explanation: `Alternative of ${context.name} for ${pass}`, edges: [{ source: { diagram: 'overview', line: 2 }, target: { diagram: 'detail', line: 1 }, label: 'expands' }],
        diagrams: [{ id: 'overview', ascii: `Overview\n\`-- ${pass}`, position: { column: 0, row: 0 } }, { id: 'detail', ascii: 'Detail\n`-- From context', position: { column: 40, row: 0 } }] } };
    }
    if (input.stage === 'r2') return { output: { explanation: 'Compressed child', diagrams: [{ id: 'summary', ascii: 'Summary\n`-- Shared feature', position: { column: 0, row: 0 } }], edges: [] } };
    const parent = input.files['parent-full.json'] as { diagrams: { id: string }[] };
    return { output: { attachment: 'a', explanation: 'Attach summary to existing parent', edits: [], placements: [{ diagram: 'summary', position: { column: 140, row: 0 } }],
      edges: [{ source: { diagram: 'summary', line: 1 }, target: { diagram: parent.diagrams[0].id, line: 1 }, label: 'summarizes' }] } };
  }
}
