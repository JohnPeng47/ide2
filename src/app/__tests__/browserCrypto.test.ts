import { describe, expect, it, vi } from 'vitest';
import { installRandomUUID } from '../browserCrypto';

describe('LAN HTTP UUID compatibility', () => {
  it('preserves a native implementation', () => {
    const native = vi.fn(() => '00000000-0000-4000-8000-000000000000' as const);
    const crypto = { randomUUID: native, getRandomValues: vi.fn() };
    installRandomUUID(crypto);
    expect(crypto.randomUUID).toBe(native);
    expect(crypto.getRandomValues).not.toHaveBeenCalled();
  });

  it('uses random bytes and sets UUID version and variant bits', () => {
    const crypto: Pick<Crypto, 'getRandomValues'> & Partial<Pick<Crypto, 'randomUUID'>> = {
      getRandomValues<T extends ArrayBufferView>(array: T): T {
        new Uint8Array(array.buffer, array.byteOffset, array.byteLength).fill(255);
        return array;
      },
    };
    const randomBytes = vi.spyOn(crypto, 'getRandomValues');
    installRandomUUID(crypto);
    expect(crypto.randomUUID!()).toBe('ffffffff-ffff-4fff-bfff-ffffffffffff');
    expect(crypto.randomUUID!()).toBe('ffffffff-ffff-4fff-bfff-ffffffffffff');
    expect(randomBytes).toHaveBeenCalledTimes(2);
  });
});
