import { comparisonManifest, generatedReportSchema, sourceKey } from '../../../domain/mapping/compare/comparisonReport';
import { spawn } from 'node:child_process';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { z } from 'zod';
import { requireAiEnabled } from '../../../application/core/errors';
import type { ComparisonRuntime } from '../../../application/mapping/compare/comparisonGenerationService';
import { comparisonPrompt, generatedComparisonsSchema } from '../../../domain/mapping/compare/comparisonGeneration';

/** Strict structured outputs accept anyOf, while Zod emits oneOf for tagged unions. */
export function comparisonOutputJsonSchema(experiment: boolean) {
  const schema = z.toJSONSchema(experiment ? generatedReportSchema : generatedComparisonsSchema);
  const normalize = (value: unknown): unknown => {
    if (Array.isArray(value)) return value.map(normalize);
    if (!value || typeof value !== 'object') return value;
    return Object.fromEntries(Object.entries(value).filter(([key]) => key !== 'discriminator').map(([key, child]) => [key === 'oneOf' ? 'anyOf' : key, normalize(child)]));
  };
  return normalize(schema);
}

/** An isolated ASCII-only working directory prevents inherited repository/chat context. */
export class CodexComparisonRuntime implements ComparisonRuntime {
  constructor(private enabled: boolean) {}
  async generate(input: Parameters<ComparisonRuntime['generate']>[0]): ReturnType<ComparisonRuntime['generate']> {
    requireAiEnabled(this.enabled); input.signal.throwIfAborted();
    const directory = await mkdtemp(path.join(tmpdir(), 'diagram-comparison-'));
    try {
      await Promise.all(input.diagrams.map(diagram => writeFile(path.join(directory, `${diagram.id}.txt`), diagram.ascii, { mode: 0o600 })));
      if (input.experiment) await writeFile(path.join(directory, 'canvases.json'), JSON.stringify(comparisonManifest(input.canvases!, input.experiment), null, 2));
      const schema = path.join(directory, 'output-schema.json');
      await writeFile(schema, JSON.stringify(comparisonOutputJsonSchema(!!input.experiment)));
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
        if (input.signal.aborted) abort(); else child.stdin.end(input.evaluationPrompt ?? comparisonPrompt(input.diagrams));
      });
    } finally { await rm(directory, { recursive: true, force: true }); }
  }
}

export class FakeComparisonRuntime implements ComparisonRuntime {
  async generate({ diagrams, signal, experiment, canvases }: Parameters<ComparisonRuntime['generate']>[0]) {
    signal.throwIfAborted();
    const groupId = (group: 'baseline' | 'prompted') => `C${(canvases ?? []).findIndex(copy => experiment![group].some(source => sourceKey(source) === sourceKey(copy.source))) + 1}`;
    if (experiment) {
      const opinion = { level: 'moderate', attributionConfidence: 'low', rationale: 'The difference is material, but one sample cannot establish attribution.' };
      const A = diagrams.find(d => d.canvasCopyId === canvases![Number(groupId('baseline').slice(1)) - 1].id)!;
      const B = diagrams.find(d => d.canvasCopyId === canvases![Number(groupId('prompted').slice(1)) - 1].id)!;
      return { output: { scale: { kind: 'default' }, summary: 'Tentative prompt differences in the supplied outputs.',
        limitations: 'n=m=1: recurrence and within-group variability cannot be assessed.',
        comparisonSummary: experiment.maxComparisons ? 'Tentative illustrations; no causal attribution.' : 'No comparisons selected: the requested maximum is zero.',
        comparisons: [
          { kind: 'canvas', opinion, title: 'State responsibility', explanation: 'The prompted tree makes responsibility explicit.',
            A: { canvas: groupId('baseline'), camera: { transform: { offset: { x: -70, y: 20 }, scale: .6 } } },
            B: { canvas: groupId('prompted'), camera: { transform: { offset: { x: -30, y: 10 }, scale: .8 } } } },
          { kind: 'diagram', opinion: { ...opinion, level: 'small' }, title: 'Corresponding tree details', explanation: 'Paired excerpts expose the content difference.',
            A: { diagram: A.id, ranges: [{ startLine: 1, endLine: 1 }] },
            B: { diagram: B.id, ranges: [{ startLine: Math.min(2, B.ascii.split('\n').length), endLine: Math.min(3, B.ascii.split('\n').length) }] } }
        ].slice(0, experiment.maxComparisons) } };
    }
    const selected = [...new Map(diagrams.map(d => [d.canvasCopyId, d])).values()];
    const side = (d: typeof selected[number]) => ({ diagram: d.id, ranges: [{ startLine: 1, endLine: 1 },
      ...(d.ascii.split('\n').length >= 3 ? [{ startLine: 3, endLine: 3 }] : [])] });
    return { output: { comparisons: selected.slice(1).map(d => ({ title: 'Shared structure', explanation: 'Both diagrams show the same domain using different arrangements.', A: side(selected[0]), B: side(d) })) } };
  }
}
