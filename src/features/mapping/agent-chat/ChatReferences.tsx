import { useMemo, useSyncExternalStore } from 'react';
import type { ChatCanvasTarget, ChatReference } from '../../../../domain/mapping/agent-chat/agentChat';
import { findBox } from '../../../../domain/mapping/workspace/canvasDisplayNode';
import { selectionExcerpt } from '../../../../domain/mapping/workspace/selectionClipboard';
import type { ControllerSnapshot } from '../../../../domain/mapping/workspace/mappingDocumentController';
import type { CanvasSession } from '../workspace/canvasSession';
import { diagramReference, nodesReference } from '../prompt-composer/promptReferences';

export interface ChatReferenceCanvas { session: CanvasSession; target: ChatCanvasTarget; name: string }
const emptySubscribe = () => () => {};
const emptySnapshot = () => undefined;

export function captureChatReferences(snapshot: ControllerSnapshot, target: ChatCanvasTarget, name: string) {
  return snapshot.canvas.selection.items.flatMap(item => {
    const box = findBox(snapshot.document.scene.root, item.displayNodeId.slice(5));
    const diagram = box?.kind === 'diagram' ? snapshot.document.scene.contents[box.contentId] : undefined;
    // A stale region must never be silently resolved against different diagram text.
    if (!diagram || item.region && item.region.sourceAscii !== diagram.content.ascii) return [];
    const reference = item.region ? nodesReference(diagram, box!.id, item.region.rect, item.region.contentNodeIds) : diagramReference(diagram);
    const value: ChatReference = { canvas: target, canvasName: name, displayNodeId: item.displayNodeId, reference,
      ascii: item.region ? selectionExcerpt(diagram, item.region.rect, item.region.contentNodeIds) : diagram.content.ascii };
    return [{ key: JSON.stringify([target.workspaceInstanceId, target.documentId, item.id]), value }];
  });
}

export function useChatReferences(canvas: ChatReferenceCanvas | undefined) {
  const controller = canvas?.session.controller;
  const snapshot = useSyncExternalStore(controller?.subscribe ?? emptySubscribe, controller?.getSnapshot ?? emptySnapshot);
  const entries = useMemo(() => snapshot && canvas ? captureChatReferences(snapshot, canvas.target, canvas.name) : [],
    [snapshot?.document, snapshot?.canvas.selection, canvas?.target.workspaceInstanceId, canvas?.target.documentId, canvas?.name]);
  return entries;
}

export function ChatReferenceRow({ references, onRemove, disabled = false }: { references: readonly ChatReference[]; onRemove?: (index: number) => void; disabled?: boolean }) {
  if (!references.length) return null;
  return <div className="agent-chat-references" aria-label={onRemove ? 'Selected canvas references' : 'Attached canvas references'}>
    <span className="agent-chat-references-label">Refs</span>
    {references.map(({ reference, canvasName }, index) => <span className="agent-chat-reference" key={index}
      title={`${canvasName} · ${reference.kind === 'diagram' ? 'Whole diagram' : `Lines ${reference.range.startLine}–${reference.range.endLine}`} · ${reference.revisionId}`}>
      <small>[ref {index + 1}] {reference.kind === 'diagram' ? 'Diagram' : 'Nodes'}</small><span>{reference.label}</span>
      {onRemove && <button type="button" aria-label={`Remove reference ${index + 1}: ${reference.label}`} disabled={disabled} onClick={() => onRemove(index)}>×</button>}
    </span>)}
  </div>;
}

/** Kept independently of message text, including for older messages with no inline markers. */
export function ChatReferenceDetails({ references }: { references: readonly ChatReference[] }) {
  if (!references.length) return null;
  return <details className="agent-chat-reference-details"><summary>References ({references.length})</summary>
    <ChatReferenceRow references={references} />
    {references.map(({ reference, canvasName, ascii }, index) => <details className="agent-chat-reference-context" key={index}>
      <summary>[ref {index + 1}] {reference.label} · {canvasName}</summary>
      <small>Pinned revision: {reference.revisionId}</small><pre>{ascii}</pre>
    </details>)}
  </details>;
}
