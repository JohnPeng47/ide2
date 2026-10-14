import { composeScene, flattenGrid, resolveScene, type LineGridScene } from '../../core/diagrams/lineGrid';
import { diagramTextRanges, textRow, type DiagramTextRange } from '../../core/diagrams/diagramText';
import { projectDiagramContent, type DiagramViews } from './diagramViewState';
import type { CanvasJump } from '../../core/diagrams/canvasJump';

/** composeScene remains the authority for character placement and collision validation. */
export function diagramSceneText(scene: LineGridScene, views?: DiagramViews, jumps: readonly CanvasJump[] = []) {
  const boxes = new Map(flattenGrid(resolveScene(scene)).map(box => [box.box.id, box]));
  const ranges = new Map<number, DiagramTextRange[]>();
  const ascii = composeScene(scene, (diagram, box) => {
    const projection = projectDiagramContent(diagram.content, box.collapsed ? undefined : views?.[`grid:${box.id}`]);
    const local = diagramTextRanges({ ascii: diagram.content.ascii, content: diagram.content,
      displayNodeId: `grid:${box.id}`, mappings: diagram.sourceContext.mappings, sourceContext: diagram.sourceContext,
      jumps: [...(diagram.jumps ?? []), ...jumps.filter(jump => jump.sourceDisplayNodeId === `grid:${box.id}`)] });
    const { column, row } = boxes.get(box.id)!.bounds;
    projection.sourceLines.forEach((line, visibleRow) => {
      const target = row + visibleRow;
      ranges.set(target, [...(ranges.get(target) ?? []), ...(local.get(line) ?? []).map(range => ({ ...range,
        start: column + range.start, end: column + range.end,
        owner: range.owner ? { ...range.owner, columnOffset: column } : undefined }))]);
    });
    return projection.ascii;
  });
  return { ascii, rows: ascii.split('\n').map((line, row) => textRow(line, ranges.get(row) ?? [])) };
}
