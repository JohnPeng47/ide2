import { closeSync, existsSync, openSync, readSync, readdirSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';
import { usageLogLine, type LogCursor } from './usageLogParser';
import { UsageStore } from './usageStore';
import type { UsageEvent } from '../../../domain/core/usage/codexUsage';
export const sessionRoots = () => [path.join(process.env.CODEX_HOME || path.join(homedir(), '.codex'), 'sessions'),
  path.join(process.env.CODEX_HOME || path.join(homedir(), '.codex'), 'archived_sessions'),
  path.join(process.env.PI_CODING_AGENT_DIR || path.join(homedir(), '.pi/agent'), 'sessions')];
export class UsageCollector {
  private files: string[] = []; private discoveredAt = 0;
  constructor(private store: UsageStore, private roots = sessionRoots()) {}
  scan(now = Date.now()) {
    const errors: string[] = [];
    if (now - this.discoveredAt >= 30_000 || !this.discoveredAt) {
      this.files = this.roots.filter(existsSync).flatMap(root => readdirSync(root, { recursive: true, encoding: 'utf8' })
        .filter(name => name.endsWith('.jsonl')).map(name => path.join(root, name)));
      this.discoveredAt = now;
    }
    for (const file of this.files) {
      try { this.readFile(file); } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') errors.push(`${path.basename(file)}: ${error instanceof Error ? error.message : 'Read failed'}`);
      }
    }
    this.store.set('collectorAt', now); this.store.set('collectorError', errors.length ? errors.slice(0, 3).join('; ') : null);
  }
  private readFile(file: string) {
    const stat = statSync(file), since = this.store.get<number>('startedAt')!;
    if (stat.mtimeMs < since) return;
    let cursor = this.store.cursor<LogCursor>(file) ?? { offset: 0, inode: stat.ino };
    if (cursor.inode !== stat.ino || stat.size < cursor.offset) cursor = { offset: 0, inode: stat.ino };
    if (stat.size === cursor.offset) return;
    const buffer = Buffer.alloc(Math.min(16 * 1024 * 1024, stat.size - cursor.offset));
    const fd = openSync(file, 'r'); let read: number;
    try { read = readSync(fd, buffer, 0, buffer.length, cursor.offset); } finally { closeSync(fd); }
    const end = buffer.subarray(0, read).lastIndexOf(10);
    if (end < 0) { if (read === 16 * 1024 * 1024) throw Error('Log line exceeds collection limit'); return; }
    const events: UsageEvent[] = [];
    for (const line of buffer.subarray(0, end).toString('utf8').split('\n')) {
      if (!line.trim()) continue;
      const event = usageLogLine(line, cursor, since); if (event) events.push(event);
    }
    cursor.offset += end + 1;
    this.store.ingest(file, cursor, events);
  }
}
