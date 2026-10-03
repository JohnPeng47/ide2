import { atom, type Atom } from 'tldraw';
import { endpointKey, type EndpointIdentity, type EndpointRect } from '../../../../domain/mapping/workspace/endpointGeometry';

interface Measurement { layoutKey: string; rect: EndpointRect }
/** Transient, shape-local geometry. Reads subscribe only to that anchor. Neither
 * camera movement nor DOM culling deletes a measurement or writes domain state. */
export class LocalAnchorStore {
  private records = new Map<string, Atom<Measurement | undefined>>();
  private record(identity: EndpointIdentity) {
    const key = endpointKey(identity);
    let record = this.records.get(key);
    if (!record) { record = atom<Measurement | undefined>(`anchor:${key}`, undefined); this.records.set(key, record); }
    return record;
  }
  get(identity: EndpointIdentity, layoutKey: string) {
    const value = this.record(identity).get();
    return value?.layoutKey === layoutKey ? value.rect : undefined;
  }
  set(identity: EndpointIdentity, layoutKey: string, rect: EndpointRect) {
    const record = this.record(identity), previous = record.get();
    const rounded = Object.fromEntries(Object.entries(rect).map(([key, value]) => [key, Math.round(value * 100) / 100])) as unknown as EndpointRect;
    if (previous?.layoutKey === layoutKey && JSON.stringify(previous.rect) === JSON.stringify(rounded)) return;
    record.set({ layoutKey, rect: rounded });
  }
  invalidate() { for (const record of this.records.values()) record.set(undefined); }
  retain(layouts: Map<string, string>) {
    for (const [key, record] of this.records) {
      const owner = (JSON.parse(key) as string[])[0], value = record.get();
      if (value && value.layoutKey !== layouts.get(owner)) record.set(undefined);
      // Readers keep their atoms until the corresponding component unmounts.
      if (!layouts.has(owner)) this.records.delete(key);
    }
  }
}
