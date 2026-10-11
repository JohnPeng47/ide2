import type { Diagram } from '../../../../domain/core/diagrams/diagram';
import { promptReferenceSchema, type PromptReference } from '../../../../domain/mapping/agent/diagramEdit';
import type { MappingPocGridRect } from '../../../../domain/mapping/selection/mappingPoc';
import { regionSelectionItem } from '../../../../domain/mapping/selection/selectionState';

/** The first line with words, without box-drawing punctuation: borders make poor labels. */
export function diagramTitle(diagram: Pick<Diagram, 'content' | 'id'>) {
  for (const line of diagram.content.ascii.split('\n')) {
    const words = line.replace(/[^\w.:/ ]+/g, ' ').replace(/\s+/g, ' ').trim();
    if (/[A-Za-z0-9]{2}/.test(words)) return words.slice(0, 80);
  }
  return diagram.id;
}

/** Captured once at insertion: later selection or canvas changes never alter a reference. */
export function diagramReference(diagram: Diagram): PromptReference {
  return { kind: 'diagram', label: diagramTitle(diagram), diagramId: diagram.diagramId, revisionId: diagram.revisionId };
}
export function nodesReference(diagram: Diagram, boxId: string, rect: MappingPocGridRect): PromptReference {
  const item = regionSelectionItem(diagram, boxId, rect, 'capture');
  const lines = diagram.content.ascii.split('\n');
  const endLine = Math.min(rect.endLine, lines.length), startLine = Math.min(rect.startLine, endLine);
  const excerpt = lines.slice(startLine - 1, endLine).map(line => line.slice(rect.startColumn - 1, rect.endColumn).trim()).find(Boolean);
  return { kind: 'nodes', label: (excerpt || diagramTitle(diagram)).slice(0, 80), diagramId: diagram.diagramId, revisionId: diagram.revisionId,
    nodeIds: [...item.region!.selectedIds], range: { startLine, endLine, startColumn: rect.startColumn, endColumn: Math.max(rect.startColumn, rect.endColumn) } };
}

/** Plain text for other apps; HTML carries the structured references so a paste in any composer restores them. */
const attribute = 'data-ide2-prompt-references';
export function promptReferenceClipboard(references: readonly PromptReference[]) {
  const text = references.map(reference => reference.kind === 'diagram' ? `[diagram: ${reference.label}]`
    : `[nodes: ${reference.label} in ${reference.diagramId}]`).join(' ');
  const encoded = btoa(String.fromCharCode(...new TextEncoder().encode(JSON.stringify(references))));
  const escape = (value: string) => value.replace(/[&<>"]/g, char => `&#${char.charCodeAt(0)};`);
  return { text, html: `<span ${attribute}="${encoded}">${escape(text)}</span>` };
}
export async function copyPromptReferences(references: readonly PromptReference[]) {
  const { text, html } = promptReferenceClipboard(references);
  if (typeof ClipboardItem !== 'undefined' && navigator.clipboard?.write) {
    await navigator.clipboard.write([new ClipboardItem({ 'text/plain': new Blob([text], { type: 'text/plain' }), 'text/html': new Blob([html], { type: 'text/html' }) })]);
  } else if (navigator.clipboard?.writeText) await navigator.clipboard.writeText(text);
  else throw Error('Clipboard is unavailable in this browser');
}
/** Returns validated references from pasted HTML, or undefined for ordinary pastes. */
export function pastedPromptReferences(html: string): PromptReference[] | undefined {
  const encoded = html && new DOMParser().parseFromString(html, 'text/html').querySelector(`[${attribute}]`)?.getAttribute(attribute);
  if (!encoded) return undefined;
  try {
    const parsed = JSON.parse(new TextDecoder().decode(Uint8Array.from(atob(encoded), char => char.charCodeAt(0))));
    const references = promptReferenceSchema.array().max(20).safeParse(parsed);
    return references.success ? references.data : undefined;
  } catch { return undefined; }
}
