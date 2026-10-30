import type { ReactNode } from 'react';

/** Without a side, the frame is a standalone canvas preview. */
export function ComparePaneFrame({ side, title, subtitle, detail, actions, children }: {
  side?: 'A' | 'B'; title: string; subtitle: string; detail?: string; actions?: ReactNode; children: ReactNode;
}) {
  return <section className="compare-pane" aria-label={side ? `Comparison pane ${side}` : `Preview of ${title}`}>
    <header className="compare-pane-heading">{side && <span className="compare-side">{side}</span>}
      <div><strong title={title}>{title}</strong><small title={subtitle}>{subtitle}</small>
        {detail && <span className="compare-provenance" title={detail}>{detail}</span>}</div>
      {actions}
    </header>
    {children}
  </section>;
}
