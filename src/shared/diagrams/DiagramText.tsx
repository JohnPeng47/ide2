import { Fragment, type ComponentPropsWithRef, type ReactNode, type HTMLAttributes } from 'react';
import type { DiagramTextRow, DiagramTextRun, DiagramTextOwner } from '../../../domain/core/diagrams/diagramText';
import type { DiagramJumpTarget } from '../../../domain/core/diagrams/diagramJump';
import './diagramText.css';

type Props = Omit<ComponentPropsWithRef<'pre'>, 'children'> & {
  rows: readonly DiagramTextRow[];
  registerEndpoint?: (identity: Pick<DiagramTextOwner, 'displayNodeId' | 'contentNodeId' | 'revisionId'>, element: Element | null) => void;
  onJump?: (target: DiagramJumpTarget) => void;
  renderRun?: (run: DiagramTextRun) => ReactNode;
  rowProps?: (row: DiagramTextRow) => HTMLAttributes<HTMLSpanElement>;
};

/** Shared JSX for both viewers. Controllers retain gestures, folding, and source actions. */
export function DiagramText({ rows, onJump, renderRun, rowProps, registerEndpoint, ...pre }: Props) {
  return <pre {...pre}>{rows.map((row, index) => {
    // Keep one outline around a label even when source mappings split its text.
    const groups: DiagramTextRun[][] = [];
    for (const run of row.runs) {
      const previous = groups.at(-1)?.[0];
      if (previous?.owner?.contentNodeId && previous.owner.contentNodeId === run.owner?.contentNodeId
        && previous.owner.displayNodeId === run.owner.displayNodeId) groups.at(-1)!.push(run);
      else groups.push([run]);
    }
    return <span key={index} className="ascii-line" {...rowProps?.(row)}>{groups.map(group => {
      const first = group[0], owner = first.owner;
      const pieces: DiagramTextRun[][] = [];
      for (const run of group) {
        if (run.jump && pieces.at(-1)?.[0].jump?.id === run.jump.id) pieces.at(-1)!.push(run);
        else pieces.push([run]);
      }
      const contents = pieces.map(piece => {
        const run = piece[0];
        return <Fragment key={run.start}>{run.jump && onJump
          ? <button type="button" className="diagram-jump" data-diagram-jump-id={run.jump.id}
              data-mapping-static-ui data-diagram-canvas-static-ui
              onPointerDown={event => { if (!event.ctrlKey) event.stopPropagation(); }}
              onClick={event => { if (event.ctrlKey) return; event.stopPropagation(); onJump(run.jump!.target); }}
              title="Open linked diagram">{piece.map(item => item.text).join('')}</button>
          : piece.map(item => <Fragment key={item.start}>{renderRun ? renderRun(item) : item.text}</Fragment>)}</Fragment>;
      });
      return <span key={first.start}
        ref={owner?.contentNodeId && registerEndpoint ? element => registerEndpoint({ displayNodeId: owner.displayNodeId,
          contentNodeId: owner.contentNodeId, revisionId: owner.revisionId }, element) : undefined}
        className={owner?.contentNodeId ? 'diagram-content-node' : undefined}
        data-display-node-id={owner?.displayNodeId} data-content-node-id={owner?.contentNodeId}
        data-content-revision={owner?.revisionId} data-source-line={owner?.sourceLine}
        data-source-start-column={owner ? first.start - owner.columnOffset + 1 : undefined}
        data-source-end-column={owner ? group.at(-1)!.end - owner.columnOffset : undefined}
        data-node-mapping-ids={owner?.contentNodeId ? [...new Set(group.flatMap(run => run.mappings)
          .filter(mapping => mapping.line === owner.sourceLine && mapping.startColumn >= first.start - owner.columnOffset + 1
            && mapping.endColumn <= group.at(-1)!.end - owner.columnOffset).map(mapping => mapping.id))].join(' ') || undefined : undefined}
        data-mapping-ids={group.flatMap(run => run.mappings.map(mapping => mapping.id)).filter((id, i, ids) => ids.indexOf(id) === i).join(' ') || undefined}
      >{contents}</span>;
    })}{index < rows.length - 1 ? '\n' : null}</span>;
  })}</pre>;
}
