import type { GridBox, LineGridScene } from './lineGrid';

/**
 * A scene holding one diagram box from another canvas, at the origin and expanded. The diagram value is reused
 * unchanged, so its content, source mappings, evidence and identity carry over. Canvas-level edges and jumps
 * belong to the source canvas and are not copied.
 */
export function singleBoxScene(scene: LineGridScene, boxId: string): LineGridScene {
  const box = findBox(scene.root, boxId);
  if (box?.kind !== 'diagram') throw new Error('Only a diagram box can be promoted');
  const contents: Record<string, LineGridScene['contents'][string]> = { [box.contentId]: scene.contents[box.contentId] };
  if (box.collapsedContentId && scene.contents[box.collapsedContentId]) contents[box.collapsedContentId] = scene.contents[box.collapsedContentId];
  if (!contents[box.contentId]) throw new Error('The diagram content is missing from this canvas');
  return { contents, root: { id: 'root', kind: 'container', position: { column: 0, row: 0 }, collapsed: false,
    layout: { collisionPolicy: 'push-right', gap: 3 }, children: [{ ...box, position: { column: 0, row: 0 }, collapsed: false }] } };
}

/** A readable canvas name: the diagram's first line of text, trimmed of rule characters. */
export function promotedCanvasName(scene: LineGridScene, boxId: string, fallback: string): string {
  const box = findBox(scene.root, boxId);
  const ascii = box?.kind === 'diagram' ? scene.contents[box.contentId]?.content.ascii ?? '' : '';
  return (diagramTitle(ascii) ?? fallback).slice(0, 120);
}

/** The first line of a diagram that says something: not blank and not a rule of `=`, `-` or similar. */
export function diagramTitle(ascii: string): string | undefined {
  return ascii.split('\n').map(line => line.trim()).find(line => /[A-Za-z0-9]/.test(line) && !/^[=\-+|_ ]+$/.test(line));
}

function findBox(box: GridBox, id: string): GridBox | undefined {
  if (box.id === id) return box;
  if (box.kind === 'container') for (const child of box.children) { const found = findBox(child, id); if (found) return found; }
  return undefined;
}
