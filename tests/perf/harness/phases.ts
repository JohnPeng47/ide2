import { appendFile, mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';

export class PhaseRecorder {
  lastCompleted: string | null = null;
  constructor(private file: string, private metadata: { flow: string; test: string }) {}

  async run<T>(phase: string, action: () => Promise<T>): Promise<T> {
    await mkdir(dirname(this.file), { recursive: true });
    const started = performance.now();
    const startedAt = new Date().toISOString();
    let error: unknown;
    let succeeded = false;
    try {
      const result = await action();
      this.lastCompleted = phase;
      succeeded = true;
      return result;
    } catch (caught) {
      error = caught;
      throw caught;
    } finally {
      await appendFile(this.file, JSON.stringify({ ...this.metadata, phase, startedAt,
        endedAt: new Date().toISOString(), durationMs: performance.now() - started,
        status: succeeded ? 'passed' : 'failed',
        ...(!succeeded ? { error: String(error) } : {}), lastCompletedPhase: this.lastCompleted,
      }) + '\n');
    }
  }
}
