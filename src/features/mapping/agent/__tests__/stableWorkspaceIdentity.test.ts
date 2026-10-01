import { afterEach, expect, it, vi } from 'vitest';
import { acquireStableWorkspaceId, browserStableWorkspaceId } from '../stableWorkspaceIdentity';

const first = '00000000-0000-4000-8000-000000000001';
const second = '00000000-0000-4000-8000-000000000002';

function environment(saved: string | null, held = new Set<string>()) {
  return {
    read: vi.fn(() => saved),
    write: vi.fn((id: string) => { saved = id; }),
    randomId: vi.fn(() => second),
    pause: vi.fn(async (_ms: number) => {}),
    claim: vi.fn(async (id: string) => {
      if (held.has(id)) return false;
      held.add(id); return true;
    })
  };
}

afterEach(() => vi.unstubAllGlobals());

it('retains the stored identity on reload without replacing command ownership IDs', async () => {
  const env = environment(first);
  expect(await acquireStableWorkspaceId(env)).toBe(first);
  expect(env.write).not.toHaveBeenCalled();
  expect(env.randomId).not.toHaveBeenCalled();
});

it('waits briefly for a refreshing predecessor to release its lock', async () => {
  const held = new Set([first]), env = environment(first, held);
  env.pause.mockImplementation(async () => { held.delete(first); });
  expect(await acquireStableWorkspaceId(env)).toBe(first);
  expect(env.claim).toHaveBeenCalledTimes(2);
});

it('rotates the copied sessionStorage identity in a duplicated tab', async () => {
  const held = new Set<string>(), original = environment(first, held), duplicate = environment(first, held);
  const [a, b] = await Promise.all([acquireStableWorkspaceId(original), acquireStableWorkspaceId(duplicate)]);
  expect(a).toBe(first); expect(b).toBe(second);
  expect(duplicate.write).toHaveBeenCalledWith(second);
  expect(held).toEqual(new Set([first, second]));
});

it('ignores invalid saved IDs and persists a newly owned UUID', async () => {
  const env = environment('invalid');
  expect(await acquireStableWorkspaceId(env)).toBe(second);
  expect(env.claim).toHaveBeenCalledExactlyOnceWith(second);
  expect(env.write).toHaveBeenCalledWith(second);
});

it('does not claim reload stability if reading, writing, or locking fails', async () => {
  for (const method of ['read', 'write', 'claim'] as const) {
    const env = environment(null);
    env[method].mockImplementation(() => { throw new Error('blocked'); });
    expect(await acquireStableWorkspaceId(env)).toBeUndefined();
  }
});

it('keeps a single window-owned lock across hook remounts and repeated callers', async () => {
  vi.stubGlobal('window', {});
  const request = vi.fn((_name: string, _options: unknown, callback: (lock: object) => Promise<void>) => callback({}));
  vi.stubGlobal('navigator', { locks: { request } });
  vi.stubGlobal('sessionStorage', { getItem: () => first, setItem: vi.fn() });
  const a = browserStableWorkspaceId('/'), b = browserStableWorkspaceId('/');
  expect(a).toBe(b); expect(await a).toBe(first);
  expect(request).toHaveBeenCalledTimes(1);
  expect(await browserStableWorkspaceId('/other-app/')).toBe(first);
  expect(request).toHaveBeenCalledTimes(2);
  expect(request.mock.calls[0][0]).not.toEqual(request.mock.calls[1][0]);
});

it('omits a stable ID when the browser cannot enforce exclusive ownership', async () => {
  vi.stubGlobal('window', {}); vi.stubGlobal('navigator', {});
  vi.stubGlobal('sessionStorage', { getItem: () => first });
  expect(await browserStableWorkspaceId('/')).toBeUndefined();
});
