/** A stable tab ID is discovery metadata, never a command/publisher ownership key. */
interface IdentityEnvironment {
  read(): string | null;
  write(id: string): void;
  claim(id: string): Promise<boolean>;
  randomId(): string;
  pause(ms: number): Promise<void>;
}

const validId = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Exported separately so refresh/duplicate races can be tested without React. */
export async function acquireStableWorkspaceId(environment: IdentityEnvironment): Promise<string | undefined> {
  try {
    const saved = environment.read();
    if (saved && validId.test(saved)) {
      // A reload's old document may need a moment to release its browser lock.
      // A duplicated tab copied sessionStorage, but cannot acquire that lock.
      for (let attempt = 0; attempt < 6; attempt++) {
        if (await environment.claim(saved)) return saved;
        if (attempt < 5) await environment.pause(50);
      }
    }
    for (let attempt = 0; attempt < 3; attempt++) {
      const id = environment.randomId();
      if (!await environment.claim(id)) continue;
      environment.write(id);
      return id;
    }
  } catch {
    // Storage/locks can be disabled by the browser. Do not advertise an identity
    // whose reload stability and exclusive ownership we cannot establish.
  }
  return undefined;
}

type IdentityWindow = Window & {
  __mappingWorkspaceIdentities?: Map<string, Promise<string | undefined>>;
};

/** Window ownership outlives React remounts/HMR; browser teardown releases locks. */
export function browserStableWorkspaceId(baseUrl: string): Promise<string | undefined> {
  const owner = window as IdentityWindow;
  const key = `mapping.stable-workspace.v1:${baseUrl}`;
  const identities = owner.__mappingWorkspaceIdentities ??= new Map();
  const existing = identities.get(key);
  if (existing) return existing;
  const identity = acquireStableWorkspaceId({
    read: () => {
      if (!navigator.locks) throw new Error('Exclusive browser locks unavailable');
      return sessionStorage.getItem(key);
    },
    write: id => sessionStorage.setItem(key, id),
    randomId: () => crypto.randomUUID(),
    pause: ms => new Promise(resolve => setTimeout(resolve, ms)),
    claim: id => new Promise<boolean>((resolve, reject) => {
      void navigator.locks.request(`${key}:${id}`, { ifAvailable: true }, lock => {
        resolve(Boolean(lock));
        // No timeout/heartbeat: exclusivity lasts until this document is gone.
        return lock ? new Promise<void>(() => {}) : undefined;
      }).catch(reject);
    })
  });
  identities.set(key, identity);
  return identity;
}
