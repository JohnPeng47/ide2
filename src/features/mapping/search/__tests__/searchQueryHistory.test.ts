import { expect, it } from 'vitest';
import { SearchQueryHistory, SEARCH_QUERY_HISTORY_KEY } from '../searchQueryHistory';

function storage() {
  const values = new Map<string, string>();
  return { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => { values.set(key, value); } };
}

it('persists submitted queries only, deduplicates them, and recalls them after reload', () => {
  const disk = storage(), history = new SearchQueryHistory(disk);
  history.edited(); history.previous('unfinished'); history.next('unfinished');
  expect(disk.getItem(SEARCH_QUERY_HISTORY_KEY)).toBeNull();
  history.submit('first'); history.submit('second'); history.submit('first'); history.submit('  ');
  expect(JSON.parse(disk.getItem(SEARCH_QUERY_HISTORY_KEY)!)).toEqual(['first', 'second']);
  const restored = new SearchQueryHistory(disk);
  expect(restored.previous('')).toBe('first'); expect(restored.previous('first')).toBe('second');
});

it('browses older/newer queries, stops at the oldest, and restores the unfinished draft', () => {
  const history = new SearchQueryHistory(); history.submit('older'); history.submit('newer');
  expect(history.previous('unfinished')).toBe('newer');
  expect(history.previous('newer')).toBe('older'); expect(history.previous('older')).toBe('older');
  expect(history.next('older')).toBe('newer'); expect(history.next('newer')).toBe('unfinished');
  expect(history.next('unfinished')).toBe('unfinished');
  history.previous('unfinished'); history.edited();
  expect(history.next('edited query')).toBe('edited query');
  expect(history.previous('edited query')).toBe('newer'); expect(history.next('newer')).toBe('edited query');
});

it('bounds stored history and tolerates corrupted or unavailable browser storage', () => {
  const disk = storage(), history = new SearchQueryHistory(disk);
  for (let i = 0; i < 60; i++) history.submit(`query ${i}`);
  const saved = JSON.parse(disk.getItem(SEARCH_QUERY_HISTORY_KEY)!);
  expect(saved).toHaveLength(50); expect(saved.at(-1)).toBe('query 10');
  disk.setItem(SEARCH_QUERY_HISTORY_KEY, 'broken JSON');
  expect(new SearchQueryHistory(disk).previous('draft')).toBe('draft');
  const blocked = new SearchQueryHistory({ getItem() { throw Error('blocked'); }, setItem() { throw Error('blocked'); } });
  blocked.submit('remember'); expect(blocked.previous('')).toBe('remember');
});
