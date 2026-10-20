import { normalizePromptBody, promptText } from '../prompt-composer/promptBody';
import { draftLength, type ChatDraft } from './chatDraft';

export interface DraftSelection { anchor: number; focus: number }
const chipId = (node: Node) => node instanceof HTMLElement ? node.dataset.referenceId : undefined;
const tail = (node: Node) => node instanceof HTMLElement && node.hasAttribute('data-editor-tail');
export function readDraftDom(root: Node, source: ChatDraft): ChatDraft {
  const references = new Map(source.filter(block => block.kind === 'reference').map(block => [block.id, block]));
  const walk = (node: Node): ChatDraft => {
    if (tail(node)) return [];
    const id = chipId(node);
    if (id) return references.has(id) ? [references.get(id)!] : [];
    if (node.nodeType === Node.TEXT_NODE) return [promptText(node.textContent ?? '')];
    if (node.nodeName === 'BR') return [promptText('\n')];
    return Array.from(node.childNodes).flatMap((child, index) => [
      ...(index && ['DIV', 'P'].includes(child.nodeName) ? [promptText('\n')] : []), ...walk(child)
    ]);
  };
  return normalizePromptBody(walk(root));
}

export function readDraftSelection(root: HTMLElement, source: ChatDraft): DraftSelection | undefined {
  const selection = window.getSelection();
  if (!selection?.anchorNode || !selection.focusNode || !root.contains(selection.anchorNode) || !root.contains(selection.focusNode)) return;
  const offset = (node: Node, position: number) => {
    const chip = (node instanceof Element ? node : node.parentElement)?.closest('[data-reference-id]');
    const range = document.createRange(); range.selectNodeContents(root);
    if (chip) range.setEndBefore(chip); else range.setEnd(node, position);
    return draftLength(readDraftDom(range.cloneContents(), source));
  };
  return { anchor: offset(selection.anchorNode, selection.anchorOffset), focus: offset(selection.focusNode, selection.focusOffset) };
}

export function placeDraftSelection(root: HTMLElement, selection: DraftSelection) {
  const point = (offset: number): [Node, number] => {
    for (const child of root.childNodes) {
      const length = tail(child) ? 0 : chipId(child) ? 1 : child.textContent?.length ?? 0;
      if (child.nodeType === Node.TEXT_NODE && offset <= length) return [child, offset];
      if (chipId(child) && offset === 0) return [root, Array.from(root.childNodes).indexOf(child as ChildNode)];
      offset -= length;
    }
    return [root, root.childNodes.length - (root.lastChild && tail(root.lastChild) ? 1 : 0)];
  };
  const [anchor, anchorOffset] = point(Math.max(0, selection.anchor));
  const [focus, focusOffset] = point(Math.max(0, selection.focus));
  root.focus({ preventScroll: true });
  window.getSelection()?.setBaseAndExtent(anchor, anchorOffset, focus, focusOffset);
}

/** Own the editable DOM explicitly: React must not reconcile nodes the browser is typing into. */
export function renderDraftDom(root: HTMLElement, draft: ChatDraft) {
  let number = 0;
  const nodes = draft.map(block => {
    if (block.kind === 'text') return document.createTextNode(block.text);
    const { reference, canvasName } = block.reference;
    const chip = document.createElement('span');
    chip.contentEditable = 'false'; chip.dataset.referenceId = block.id; chip.className = 'agent-chat-reference';
    chip.title = `${canvasName} · ${reference.kind === 'diagram' ? 'Whole diagram' : `Lines ${reference.range.startLine}–${reference.range.endLine}`} · ${reference.revisionId}`;
    const label = document.createElement('span'); label.textContent = reference.label;
    const marker = document.createElement('small'); marker.textContent = `[ref ${++number}]`;
    const remove = document.createElement('button'); remove.type = 'button'; remove.tabIndex = -1; remove.textContent = '×';
    remove.setAttribute('aria-label', `Remove reference ${number}: ${reference.label}`);
    chip.append(marker, label, remove);
    return chip;
  });
  // A trailing line break gives an empty final line a visible caret without adding prompt text.
  const br = document.createElement('br'); br.dataset.editorTail = '';
  root.replaceChildren(...nodes, br);
}
