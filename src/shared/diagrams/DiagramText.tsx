import { Fragment, useMemo, useEffect, useRef, useState, type ComponentPropsWithRef, type ReactNode, type HTMLAttributes } from 'react';
import type { DiagramTextRow, DiagramTextRun, DiagramTextOwner } from '../../../domain/core/diagrams/diagramText';
import type { DiagramJumpTarget } from '../../../domain/core/diagrams/diagramJump';
import './diagramText.css';

type Props = Omit<ComponentPropsWithRef<'pre'>, 'children'> & {
  rows: readonly DiagramTextRow[];
  registerEndpoint?: (identity: Pick<DiagramTextOwner, 'displayNodeId' | 'contentNodeId' | 'revisionId'>, element: Element | null) => void;
  onJump?: (target: DiagramJumpTarget) => void;
  renderRun?: (run: DiagramTextRun) => ReactNode;
  rowProps?: (row: DiagramTextRow) => HTMLAttributes<HTMLSpanElement>;
  /** Optional display-only decoration; never changes source text or endpoint identity. */
  nodeSuffix?: (owner: DiagramTextOwner) => ReactNode;
  nodeProps?: (owner: DiagramTextOwner) => HTMLAttributes<HTMLSpanElement> | undefined;
};

/** Shared JSX for both viewers. Controllers retain gestures, folding, and source actions. */
export function DiagramText({ rows, onJump, renderRun, rowProps, nodeProps, nodeSuffix, registerEndpoint, ...pre }: Props) {
  const endpointRefs = useMemo(() => new Map<string, (element: Element | null) => void>(), [registerEndpoint]);
  const refFor = (owner: DiagramTextOwner) => {
    const key = JSON.stringify([owner.displayNodeId, owner.contentNodeId, owner.revisionId]);
    let ref = endpointRefs.get(key);
    if (!ref) { ref = element => registerEndpoint?.({ displayNodeId: owner.displayNodeId, contentNodeId: owner.contentNodeId, revisionId: owner.revisionId }, element); endpointRefs.set(key, ref); }
    return ref;
  };
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
      const decoration = owner ? nodeProps?.(owner) : undefined;
      const pieces: DiagramTextRun[][] = [];
      for (const run of group) {
        if (run.jump && pieces.at(-1)?.[0].jump?.id === run.jump.id && pieces.at(-1)?.[0].jumps?.map(j => j.id).join(',') === run.jumps?.map(j => j.id).join(',')) pieces.at(-1)!.push(run);
        else pieces.push([run]);
      }
      const contents = pieces.map(piece => {
        const run = piece[0];
        return <Fragment key={run.start}>{run.jump && onJump
          ? <JumpChoices run={run} onJump={onJump} text={piece.map(item => item.text).join('')} />
          : piece.map(item => <Fragment key={item.start}>{renderRun ? renderRun(item) : item.text}</Fragment>)}</Fragment>;
      });
      return <Fragment key={first.start}><span
        {...decoration}
        ref={owner?.contentNodeId && registerEndpoint ? refFor(owner) : undefined}
        className={[owner?.contentNodeId ? 'diagram-content-node' : '', decoration?.className].filter(Boolean).join(' ') || undefined}
        data-display-node-id={owner?.displayNodeId} data-content-node-id={owner?.contentNodeId}
        data-content-revision={owner?.revisionId} data-source-line={owner?.sourceLine}
        data-source-start-column={owner ? first.start - owner.columnOffset + 1 : undefined}
        data-source-end-column={owner ? group.at(-1)!.end - owner.columnOffset : undefined}
        data-node-mapping-ids={owner?.contentNodeId ? [...new Set(group.flatMap(run => run.mappings)
          .filter(mapping => mapping.line === owner.sourceLine && mapping.startColumn >= first.start - owner.columnOffset + 1
            && mapping.endColumn <= group.at(-1)!.end - owner.columnOffset).map(mapping => mapping.id))].join(' ') || undefined : undefined}
        data-mapping-ids={group.flatMap(run => run.mappings.map(mapping => mapping.id)).filter((id, i, ids) => ids.indexOf(id) === i).join(' ') || undefined}
      >{contents}</span>{owner?.contentNodeId && nodeSuffix?.(owner)}</Fragment>;
    })}{index < rows.length - 1 ? '\n' : null}</span>;
  })}</pre>;
}

export function JumpChoices({ run, onJump, text }: { run: DiagramTextRun; text: string; onJump: (target: DiagramJumpTarget) => void }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    if (!open) return;
    const outside = (event: PointerEvent) => { if (!ref.current?.contains(event.target as Node)) setOpen(false); };
    window.addEventListener('pointerdown', outside, true);
    return () => window.removeEventListener('pointerdown', outside, true);
  }, [open]);
  const jumps = run.jumps ?? [run.jump!];
  return <span ref={ref} className="diagram-jump-container" onKeyDown={event => { if (event.key === 'Escape') { event.stopPropagation(); setOpen(false); } }}>
    <button type="button" className="diagram-jump" data-diagram-jump-id={run.jump!.id} data-mapping-static-ui data-diagram-canvas-static-ui
      onPointerDown={event => { if (!event.ctrlKey) event.stopPropagation(); }}
      onClick={event => { if (event.ctrlKey || event.metaKey) return; event.stopPropagation();
        if (jumps.length === 1) onJump(jumps[0].target); else setOpen(value => !value); }}
      title={jumps.length === 1 ? 'Open linked diagram' : `Choose from ${jumps.length} linked diagrams`}>{text}</button>
    {open && <span className="diagram-jump-choices" role="menu" aria-label="Linked diagrams" data-mapping-static-ui data-diagram-canvas-static-ui>
      {jumps.map((jump, i) => <button key={jump.id} type="button" role="menuitem" onClick={event => { event.stopPropagation(); setOpen(false); onJump(jump.target); }}>
        {(jump as { label?: string }).label || `Destination ${i + 1}: ${jump.target.displayNodeId ?? jump.target.representationId}`}
      </button>)}
    </span>}
  </span>;
}
