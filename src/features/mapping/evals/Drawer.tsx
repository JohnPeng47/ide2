import { useEffect, useRef, type ReactNode } from 'react';

/** Modal side sheet. Escape and the backdrop close it; focus moves in on open and back on close. */
export function Drawer({ title, onClose, children, wide }: { title: string; onClose: () => void; children: ReactNode; wide?: boolean }) {
  const panel = useRef<HTMLDivElement>(null), close = useRef(onClose); close.current = onClose;
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    const initial = panel.current?.querySelector<HTMLElement>('input, select, textarea, button:not(.evals-drawer-close)')
      ?? panel.current?.querySelector<HTMLButtonElement>('.evals-drawer-close');
    initial?.focus();
    const key = (event: KeyboardEvent) => { if (event.key === 'Escape') { event.stopPropagation(); close.current(); } };
    window.addEventListener('keydown', key, true);
    return () => { window.removeEventListener('keydown', key, true); previous?.focus?.(); };
  }, []);
  return <div className="evals-drawer-backdrop" onMouseDown={event => { if (event.target === event.currentTarget) onClose(); }}>
    <div ref={panel} role="dialog" aria-modal="true" aria-label={title} className={`evals-drawer${wide ? ' is-wide' : ''}`}>
      <header><h2>{title}</h2><button type="button" className="evals-drawer-close" aria-label="Close" onClick={onClose}>×</button></header>
      <div className="evals-drawer-body">{children}</div>
    </div>
  </div>;
}
