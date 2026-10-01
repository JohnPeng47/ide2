export const SEARCH_QUERY_HISTORY_KEY = 'diagram-search-queries';
const limit = 50;
type HistoryStorage = Pick<Storage, 'getItem' | 'setItem'>;

/** Submitted queries only. Browsing preserves the unfinished query at the end. */
export class SearchQueryHistory {
  private entries: string[] = [];
  private cursor = -1;
  private draft = '';
  constructor(private readonly storage?: HistoryStorage) {
    try {
      const saved: unknown = JSON.parse(storage?.getItem(SEARCH_QUERY_HISTORY_KEY) ?? '[]');
      if (Array.isArray(saved)) this.entries = [...new Set(saved.filter((query): query is string =>
        typeof query === 'string' && !!query.trim()))].slice(0, limit);
    } catch { /* History remains available in memory if browser storage is unavailable. */ }
  }
  submit(query: string) {
    if (!query.trim()) return;
    this.entries = [query, ...this.entries.filter(entry => entry !== query)].slice(0, limit);
    this.cursor = -1;
    try { this.storage?.setItem(SEARCH_QUERY_HISTORY_KEY, JSON.stringify(this.entries)); } catch { /* Keep in-memory history. */ }
  }
  edited() { this.cursor = -1; }
  previous(current: string): string {
    if (!this.entries.length) return current;
    if (this.cursor === -1) this.draft = current;
    this.cursor = Math.min(this.cursor + 1, this.entries.length - 1);
    return this.entries[this.cursor];
  }
  next(current: string): string {
    if (this.cursor === -1) return current;
    this.cursor--;
    return this.cursor === -1 ? this.draft : this.entries[this.cursor];
  }
}
