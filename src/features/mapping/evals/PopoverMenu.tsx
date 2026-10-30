import { useEffect, useRef } from 'react';

export interface MenuItem { label: string; detail?: string; onSelect: () => void; danger?: boolean; muted?: boolean }
export interface MenuSection { label?: string; items: MenuItem[] }

/** A small menu at a point (context menu) or under a button. Escape, outside clicks and Tab close it. */
export function PopoverMenu({ label, at, sections, onClose }: { label: string; at: { x: number; y: number }; sections: MenuSection[]; onClose: () => void }) {
  const menu = useRef<HTMLDivElement>(null), close = useRef(onClose); close.current = onClose;
  useEffect(() => {
    const items = () => [...menu.current?.querySelectorAll<HTMLButtonElement>('[role=menuitem]') ?? []];
    items()[0]?.focus();
    const previous = document.activeElement;
    const down = (event: MouseEvent) => { if (!menu.current?.contains(event.target as Node)) close.current(); };
    const key = (event: KeyboardEvent) => {
      const list = items(), index = list.indexOf(document.activeElement as HTMLButtonElement);
      if (event.key === 'Escape' || event.key === 'Tab') { event.preventDefault(); event.stopPropagation(); close.current(); (previous as HTMLElement | null)?.focus?.(); }
      if (event.key === 'ArrowDown' || event.key === 'ArrowUp') { event.preventDefault(); list[(index + (event.key === 'ArrowDown' ? 1 : list.length - 1)) % list.length]?.focus(); }
      if (event.key === 'Home') { event.preventDefault(); list[0]?.focus(); }
      if (event.key === 'End') { event.preventDefault(); list.at(-1)?.focus(); }
    };
    window.addEventListener('mousedown', down, true); window.addEventListener('keydown', key, true);
    return () => { window.removeEventListener('mousedown', down, true); window.removeEventListener('keydown', key, true); };
  }, []);
  // Keep the menu on screen near the right and bottom edges.
  const left = Math.min(at.x, window.innerWidth - 280), top = Math.min(at.y, window.innerHeight - 40 - sections.reduce((n, s) => n + s.items.length * 32 + (s.label ? 26 : 0), 0));
  return <div ref={menu} role="menu" aria-label={label} className="evals-menu" style={{ left: Math.max(8, left), top: Math.max(8, top) }}>
    {sections.map((section, i) => <div key={i} role="group" aria-label={section.label} className="evals-menu-section">
      {section.label && <div className="evals-menu-heading" aria-hidden>{section.label}</div>}
      {section.items.map(item => <button key={item.label + (item.detail ?? '')} type="button" role="menuitem"
        className={`${item.danger ? 'is-danger' : ''}${item.muted ? ' is-muted' : ''}`} onClick={() => { close.current(); item.onSelect(); }}>
        <span>{item.label}</span>{item.detail && <small>{item.detail}</small>}
      </button>)}
    </div>)}
  </div>;
}
