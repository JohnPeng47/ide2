import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';
import type { BudgetSample, UsageEvent, UsageRecords } from '../../../domain/core/usage/codexUsage';
export const usageDatabasePath = () => process.env.NEW_DIAGRAM_USAGE_DB || path.join(homedir(), '.local/share/new-diagram/codex-usage.sqlite');
export class UsageStore {
  readonly db: DatabaseSync;
  constructor(file = usageDatabasePath()) {
    if (file !== ':memory:') mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
    this.db = new DatabaseSync(file);
    this.db.exec(`PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000;
      CREATE TABLE IF NOT EXISTS usage_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS usage_events (id TEXT PRIMARY KEY, at INTEGER NOT NULL, body TEXT NOT NULL);
      CREATE INDEX IF NOT EXISTS usage_events_at ON usage_events(at);
      CREATE TABLE IF NOT EXISTS budget_samples (at INTEGER PRIMARY KEY, body TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS usage_cursors (file TEXT PRIMARY KEY, body TEXT NOT NULL);`);
    this.db.prepare('INSERT OR IGNORE INTO usage_meta VALUES (?, ?)').run('startedAt', JSON.stringify(Date.now()));
  }
  get<T>(key: string): T | null { const row = this.db.prepare('SELECT value FROM usage_meta WHERE key = ?').get(key); return row ? JSON.parse(String(row.value)) as T : null; }
  set(key: string, value: unknown) { this.db.prepare('INSERT OR REPLACE INTO usage_meta VALUES (?, ?)').run(key, JSON.stringify(value)); }
  cursor<T>(file: string): T | undefined { const row = this.db.prepare('SELECT body FROM usage_cursors WHERE file = ?').get(file); return row ? JSON.parse(String(row.body)) as T : undefined; }
  transaction(work: () => void) { this.db.exec('BEGIN IMMEDIATE'); try { work(); this.db.exec('COMMIT'); } catch (error) { this.db.exec('ROLLBACK'); throw error; } }
  event(event: UsageEvent) { this.db.prepare('INSERT OR IGNORE INTO usage_events VALUES (?, ?, ?)').run(event.id, event.at, JSON.stringify(event)); }
  ingest(file: string, cursor: unknown, events: UsageEvent[]) {
    this.transaction(() => { for (const event of events) this.event(event); this.db.prepare('INSERT OR REPLACE INTO usage_cursors VALUES (?, ?)').run(file, JSON.stringify(cursor)); });
  }
  sample(sample: BudgetSample) { this.db.prepare('INSERT OR IGNORE INTO budget_samples VALUES (?, ?)').run(sample.at, JSON.stringify(sample)); }
  readRecords(since: number): UsageRecords {
    return { startedAt: this.get<number>('startedAt')!,
      events: this.db.prepare('SELECT body FROM usage_events WHERE at >= ? ORDER BY at').all(since).map(row => JSON.parse(String(row.body))),
      samples: this.db.prepare('SELECT body FROM budget_samples WHERE at >= ? ORDER BY at').all(since).map(row => JSON.parse(String(row.body))),
      collectorAt: this.get<number>('collectorAt'), pollAttemptAt: this.get<number>('pollAttemptAt'), pollError: this.get<string>('pollError'), collectorError: this.get<string>('collectorError') };
  }
  close() { this.db.close(); }
}
