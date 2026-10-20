import { randomBytes } from 'node:crypto';

/** Immutable tables. Expiry removes a whole read; an alias is never reassigned. */
export class CanvasReadAliases {
  private readonly generation = randomBytes(6).toString('hex');
  private serial = 0;
  private reads = new Map<string, { binding: string; ids: Map<string, string>; expires: number }>();
  constructor(private readonly maxReads = 128, private readonly ttl = 30 * 60_000, private readonly maxIds = 50_000) {}
  project<T>(value: T, binding: string) {
    const readId = `r${this.generation}_${++this.serial}`;
    const ids = new Map<string, string>(), reverse = new Map<string, string>(), counts = new Map<string, number>();
    const add = (id: string, kind: string) => {
      if (reverse.has(id)) return;
      if (ids.size >= this.maxIds) throw Error('READ_TOO_LARGE: select fewer nodes');
      const n = (counts.get(kind) ?? 0) + 1; counts.set(kind, n);
      const alias = `@${readId}.${kind}:${n}`; ids.set(alias, id); reverse.set(id, alias);
    };
    const collect = (item: unknown) => {
      if (!item || typeof item !== 'object') return;
      if (Array.isArray(item)) { item.forEach(collect); return; }
      for (const [key, entry] of Object.entries(item)) {
        if (typeof entry === 'string' && (key === 'id' || key.endsWith('Id')) && key !== 'sourceId' && key !== 'repositoryId') {
          const kind = key === 'id' ? ('layout' in item ? 'display' : 'ascii' in item ? 'content' : 'node')
            : key.replace(/Id$/, '').replace(/[^a-zA-Z]/g, '').toLowerCase();
          add(entry, kind);
        }
        collect(entry);
      }
    };
    collect(value);
    const map = (item: unknown, field = ''): unknown => {
      if (typeof item === 'string') return /^(id|.*Id|.*Ids)$/.test(field) ? reverse.get(item) ?? item : item;
      if (Array.isArray(item)) return item.map(entry => map(entry, field));
      if (item && typeof item === 'object') return Object.fromEntries(Object.entries(item).map(([key, entry]) => [reverse.get(key) ?? key, map(entry, key)]));
      return item;
    };
    this.prune();
    while (this.reads.size >= this.maxReads) this.reads.delete(this.reads.keys().next().value!);
    this.reads.set(readId, { binding, ids, expires: Date.now() + this.ttl });
    return { readId, ...(map(value) as T) };
  }
  resolve<T>(value: T, binding: string): T {
    this.prune();
    const map = (item: unknown): unknown => {
      if (typeof item === 'string' && /^@r[^.]+\.[a-z]+:\d+$/.test(item)) {
        const read = this.reads.get(item.slice(1, item.indexOf('.')));
        if (!read || !read.ids.has(item)) throw Error('STALE_READ: alias expired or backend restarted; read the canvas again');
        if (read.binding !== binding) throw Error('READ_BINDING_MISMATCH: alias belongs to a different canvas/document');
        return read.ids.get(item)!;
      }
      if (Array.isArray(item)) return item.map(map);
      if (item && typeof item === 'object') return Object.fromEntries(Object.entries(item).map(([key, entry]) => [map(key) as string, map(entry)]));
      return item;
    };
    return map(value) as T;
  }
  private prune() { for (const [id, read] of this.reads) if (read.expires <= Date.now()) this.reads.delete(id); }
}
