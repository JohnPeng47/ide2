import type { SVGProps } from 'react';

/** Existing panel connector appearance, shared with anchored diagram edges. */
export function PanelConnector(props: {
  path: string; target: { x: number; y: number; side: 'left' | 'right' | 'top' | 'bottom' };
  selected?: boolean; dashed?: boolean;
} & Pick<SVGProps<SVGGElement>, 'className'>) {
  const { x, y, side } = props.target;
  const dx = side === 'left' ? -1 : side === 'right' ? 1 : 0;
  const dy = side === 'top' ? -1 : side === 'bottom' ? 1 : 0;
  const head = `M${x + dx * 5 - dy * 3} ${y + dy * 5 + dx * 3} L${x} ${y} L${x + dx * 5 + dy * 3} ${y + dy * 5 - dx * 3}`;
  return <g className={props.className} fill="none" stroke="currentColor" strokeWidth={props.selected ? 2 : 1}>
    <path d={props.path} strokeDasharray={props.dashed ? '6 4' : undefined} />
    <path d={head} />
  </g>;
}
