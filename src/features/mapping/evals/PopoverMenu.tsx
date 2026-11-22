import { useEffect, useRef, useState } from 'react';

export interface MenuItem { label: string; detail?: string; onSelect: () => void; danger?: boolean; muted?: boolean; copyId?: string }
export interface MenuSection { label?: string; items: MenuItem[] }

function CopyIdMenuItem({ label, copyId }: { label: string; copyId: string }) {
  const [status, setStatus] = useState('');
  async function copy() {
    try {
      if (navigator.clipboard?.writeText) await navigator.clipboard.writeText(copyId);
      else {
        // The app can also run on a plain HTTP LAN address.
        const input = document.createElement('textarea');
        const opener = document.activeElement;
        input.value = copyId;
        input.style.position = 'fixed';
        input.style.opacity = '0';
        document.body.append(input);
        try {
          input.select();
          if (!document.execCommand('copy')) throw Error('Clipboard unavailable');
        } finally {
          input.remove();
          if (opener instanceof HTMLElement) opener.focus();
        }
      }
      setStatus('Copied');
    } catch { setStatus('Copy failed'); }
  }
  return <button type="button" role="menuitem" title={`Copy global ID: ${copyId}`} aria-label={`Copy global ID for ${label}`}
    onClick={() => void copy()} onBlur={() => setStatus('')}>
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true">
      <rect x="8" y="8" width="12" height="12" rx="2" /><path d="M16 8V5a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h3" />
    </svg><small role="status">{status}</small>
  </button>;
}

/** A small menu at a point (context menu) or under a button. Escape, outside clicks and Tab close it. */
export function PopoverMenu({ label, at, sections, onClose }: { label: string; at: { x: number; y: number }; sections: MenuSection[]; onClose: () => void }) {
  const menu = useRef<HTMLDivElement>(null), close = useRef(onClose); close.current = onClose;
  const opener = useRef<Element | null>(null);
  useEffect(() => {
    const items = () => [...menu.current?.querySelectorAll<HTMLButtonElement>('[role=menuitem]') ?? []];
    opener.current ??= document.activeElement;
    items()[0]?.focus();
    const down = (event: MouseEvent) => { if (!menu.current?.contains(event.target as Node)) close.current(); };
    const key = (event: KeyboardEvent) => {
      const list = items(), index = list.indexOf(document.activeElement as HTMLButtonElement);
      if (event.key === 'Escape' || event.key === 'Tab') { event.preventDefault(); event.stopPropagation(); close.current(); if (opener.current instanceof HTMLElement) opener.current.focus(); }
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
      {section.items.map(item => <div className="evals-menu-row" role="none" key={item.copyId ?? item.label + (item.detail ?? '')}>
        <button type="button" role="menuitem" className={`${item.danger ? 'is-danger' : ''}${item.muted ? ' is-muted' : ''}`}
          onClick={() => {
            if (opener.current instanceof HTMLElement) opener.current.focus();
            close.current();
            item.onSelect();
          }}>
          <span>{item.label}</span>{item.detail && <small>{item.detail}</small>}
        </button>
        {item.copyId && <CopyIdMenuItem label={item.label} copyId={item.copyId} />}
      </div>)}
    </div>)}
  </div>;
}
