import type { SourcePosition } from '../../../domain/core/source/sourceNavigation';

/** Only real source text participates; gutters and generated compaction text do not. */
export function sourcePositionAtNode(viewer: HTMLElement, node: Node | null, offset: number): SourcePosition | undefined {
  const element = node?.nodeType === Node.ELEMENT_NODE ? node as Element : node?.parentElement;
  const code = element?.closest('code[data-source-text]');
  const row = code?.closest<HTMLElement>('[data-line]');
  if (!node || !code || !row || !viewer.contains(code)) return;
  const prefix = document.createRange();
  prefix.selectNodeContents(code);
  prefix.setEnd(node, offset);
  return { line: Number(row.dataset.line) - 1, character: prefix.toString().length };
}

export function sourcePositionAtPoint(viewer: HTMLElement, x: number, y: number): SourcePosition | undefined {
  // Reject whitespace hit testing outside the source text even if the browser snaps its caret nearby.
  if (!document.elementFromPoint(x, y)?.closest('code[data-source-text]')) return;
  const caret = document.caretRangeFromPoint(x, y);
  return caret ? sourcePositionAtNode(viewer, caret.startContainer, caret.startOffset) : undefined;
}

export function selectSourceRange(viewer: HTMLElement, line: number, start: number, end: number) {
  const code = viewer.querySelector(`[data-line="${line}"] code[data-source-text]`);
  if (!code) return;
  const walker = document.createTreeWalker(code, NodeFilter.SHOW_TEXT);
  const nodes: Text[] = [];
  while (walker.nextNode()) nodes.push(walker.currentNode as Text);
  const at = (offset: number): [Node, number] => {
    for (const node of nodes) { if (offset <= node.length) return [node, offset]; offset -= node.length; }
    return [code, code.childNodes.length];
  };
  const range = document.createRange();
  range.setStart(...at(start)); range.setEnd(...at(Math.max(start, end)));
  const selection = window.getSelection(); selection?.removeAllRanges(); selection?.addRange(range);
  // Reveal horizontally without moving the surrounding canvas/page.
  const target = range.getBoundingClientRect(), bounds = viewer.getBoundingClientRect();
  if (target.right > bounds.right) viewer.scrollLeft += target.right - bounds.right + 24;
  else if (target.left < bounds.left) viewer.scrollLeft -= bounds.left - target.left + 24;
}
