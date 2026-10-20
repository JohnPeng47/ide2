export interface HighlightReference { documentId: string; nodeId: string; highlightId: string }
/** A Markdown destination: [label](highlight:documentId/nodeId/highlightId). */
export function highlightReferenceUrl(target: HighlightReference): string {
  return `highlight:${[target.documentId, target.nodeId, target.highlightId].map(encodeURIComponent).join('/')}`;
}
export function parseHighlightReference(url: string): HighlightReference | undefined {
  if (!url.startsWith('highlight:')) return;
  try {
    const parts = url.slice(10).split('/').map(decodeURIComponent);
    if (parts.length !== 3 || parts.some(part => !part || part.length > 200 || /[\u0000-\u001f\u007f]/.test(part)) || !parts[1].startsWith('grid:')) return;
    return { documentId: parts[0], nodeId: parts[1], highlightId: parts[2] };
  } catch { return; }
}
