/** Transient canvas pixels. These measurements are never document/persistence data. */
export interface EndpointIdentity { displayNodeId: string; contentNodeId?: string; revisionId?: string }
export interface EndpointRect { x: number; y: number; width: number; height: number }
export type EndpointBounds = Readonly<Record<string, EndpointRect>>;
export const endpointKey = (identity: EndpointIdentity): string => JSON.stringify([
  identity.displayNodeId, identity.contentNodeId ?? null, identity.revisionId ?? null
]);

export function equalEndpointBounds(a: EndpointBounds | undefined, b: EndpointBounds): boolean {
  if (!a || Object.keys(a).length !== Object.keys(b).length) return false;
  return Object.keys(b).every(key => a[key] && (['x', 'y', 'width', 'height'] as const)
    .every(field => Math.abs(a[key][field] - b[key][field]) < 0.0001));
}
