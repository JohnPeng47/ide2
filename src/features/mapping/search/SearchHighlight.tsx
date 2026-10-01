import type { DiagramContent } from '../../../../domain/core/diagrams/diagramContent';
import type { DiagramFocus } from '../../../../domain/core/diagrams/diagramCanvas';
export type { DiagramFocus } from '../../../../domain/core/diagrams/diagramCanvas';

export function SearchHighlight({ focus, result = focus?.search, content, row, columnFor, origin, cell }: {
  result?: DiagramFocus['search'];
  focus?: DiagramFocus; content?: DiagramContent; row?: number;
  columnFor?: (column: number) => number;
  origin?: { column: number; row: number }; cell: { width: number; height: number };
}) {
  if (!result || !origin || row === undefined || content?.revisionId !== result.revisionId || content.asciiSha256 !== result.asciiSha256) return null;
  return <>{result.matches.map((match, i) => {
    const left = columnFor?.(match.startColumn - 1) ?? match.startColumn - 1;
    const right = columnFor?.(match.endColumn - 1) ?? match.endColumn - 1;
    return <span key={i} className={`diagram-search-highlight${focus ? ' is-current' : ''}`} data-search-focus={focus?.serial} data-search-box={result.displayNodeId.slice(5)}
      data-search-line={result.line} aria-hidden="true" style={{ left: (origin.column + left) * cell.width,
        top: (origin.row + row) * cell.height, width: (right - left + 1) * cell.width, height: cell.height }} />;
  })}</>;
}
