import { spawn } from 'node:child_process';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { z } from 'zod';
import { requireAiEnabled } from '../../../application/core/errors';
import type { ComparisonRuntime } from '../../../application/mapping/compare/comparisonGenerationService';
import { comparisonPrompt, generatedComparisonsSchema } from '../../../domain/mapping/compare/comparisonGeneration';

/** An isolated ASCII-only working directory prevents inherited repository/chat context. */
export class CodexComparisonRuntime implements ComparisonRuntime {
  constructor(private enabled: boolean) {}
  async generate(input: Parameters<ComparisonRuntime['generate']>[0]): ReturnType<ComparisonRuntime['generate']> {
    requireAiEnabled(this.enabled); input.signal.throwIfAborted();
    const directory = await mkdtemp(path.join(tmpdir(), 'diagram-comparison-'));
    try {
      await Promise.all(input.diagrams.map(diagram => writeFile(path.join(directory, `${diagram.id}.txt`), diagram.ascii, { mode: 0o600 })));
      const schema = path.join(directory, 'output-schema.json');
      await writeFile(schema, JSON.stringify(z.toJSONSchema(generatedComparisonsSchema)));
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
          else { try { resolve({ output: JSON.parse(reply), usage }); } catch { reject(Error('Comparison agent returned invalid JSON.')); } }
        };
        const abort = () => finish(Error('Comparison generation cancelled.'));
        const timeout = setTimeout(() => finish(Error('Comparison generation timed out.')), 15 * 60_000);
        input.signal.addEventListener('abort', abort, { once: true });
        const consume = (line: string) => {
          try {
            const event = JSON.parse(line);
            if (event.type === 'item.completed' && event.item?.type === 'agent_message') reply = event.item.text;
            if (event.type === 'turn.completed') usage = event.usage;
            if (event.type === 'turn.failed') failure = event.error?.message || 'Comparison generation failed.';
          } catch { /* Ignore non-JSON diagnostics. */ }
        };
        child.stdout.setEncoding('utf8'); child.stderr.resume();
        child.stdout.on('data', (chunk: string) => {
          bytes += Buffer.byteLength(chunk);
          if (bytes > 16 * 1024 * 1024) return finish(Error('Comparison output exceeded its limit.'));
          buffer += chunk; const lines = buffer.split('\n'); buffer = lines.pop() ?? ''; lines.forEach(consume);
        });
        child.stdin.on('error', error => finish(error)); child.on('error', error => finish(error));
        child.on('close', code => {
          clearTimeout(forceKill); consume(buffer);
          finish(failure || code !== 0 || !reply.trim() ? Error(failure || `Comparison agent exited ${code} without a result. Check model access and authentication.`) : undefined);
        });
        if (input.signal.aborted) abort(); else child.stdin.end(comparisonPrompt(input.diagrams));
      });
    } finally { await rm(directory, { recursive: true, force: true }); }
  }
}

export class FakeComparisonRuntime implements ComparisonRuntime {
  async generate({ diagrams, signal }: Parameters<ComparisonRuntime['generate']>[0]) {
    signal.throwIfAborted();
    const selected = [...new Map(diagrams.map(d => [d.canvasCopyId, d])).values()];
    const side = (d: typeof selected[number]) => ({ diagram: d.id, ranges: [{ startLine: 1, endLine: 1 },
      ...(d.ascii.split('\n').length >= 3 ? [{ startLine: 3, endLine: 3 }] : [])] });
    return { output: { comparisons: selected.slice(1).map(d => ({ title: 'Shared structure', explanation: 'Both diagrams show the same domain using different arrangements.', A: side(selected[0]), B: side(d) })) } };
  }
}
