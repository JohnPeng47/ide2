import { useEffect, useId, useRef, useState } from 'react';
import { setColorOpacity, useColorOpacity } from './colorOpacity';
import { setTheme, themeDefinitions, useTheme } from './theme';
import './themeToggle.css';

export function ThemeToggle() {
  const theme = useTheme(), next = theme === 'dark' ? 'light' : 'dark';
  const opacity = useColorOpacity(), [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null), opener = useRef<HTMLButtonElement>(null), panelId = useId();
  useEffect(() => {
    if (!open) return;
    const outside = (event: PointerEvent) => { if (!ref.current?.contains(event.target as Node)) setOpen(false); };
    window.addEventListener('pointerdown', outside, true);
    return () => window.removeEventListener('pointerdown', outside, true);
  }, [open]);
  return <div className="theme-picker" ref={ref} onKeyDown={event => {
    if (event.key === 'Escape' && open) { event.stopPropagation(); setOpen(false); opener.current?.focus(); }
  }}>
    {open && <section className="theme-picker-panel" id={panelId} aria-label="Appearance settings">
      <strong>Color opacity</strong>
      {(['treemap', 'canvas'] as const).map(key => <label key={key}>
        <span>{key === 'treemap' ? 'Diagram treemap' : 'Diagram backgrounds'}<output>{opacity[key]}%</output></span>
        <input type="range" min="0" max="100" step="1" value={opacity[key]}
          aria-label={key === 'treemap' ? 'Treemap color opacity' : 'Diagram background opacity'}
          aria-valuetext={`${opacity[key]}% opaque`} onChange={event => setColorOpacity(key, Number(event.target.value))} />
      </label>)}
      <small>0% transparent · 100% solid</small>
    </section>}
    <div className="theme-picker-buttons"><button className="theme-toggle" type="button" onClick={() => setTheme(next)}
    aria-label={`Switch to ${themeDefinitions[next].label}`} title={`Current theme: ${themeDefinitions[theme].label}`}>
    <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.5">
      {theme === 'dark' ? <><circle cx="12" cy="12" r="4" /><path d="M12 1v3m0 16v3M1 12h3m16 0h3M4.2 4.2l2.1 2.1m11.4 11.4 2.1 2.1M4.2 19.8l2.1-2.1M17.7 6.3l2.1-2.1" /></>
        : <path d="M20.5 14.1A9 9 0 0 1 9.9 3.5 9 9 0 1 0 20.5 14.1Z" />}
    </svg>
    <span>{theme === 'dark' ? 'Light theme' : 'Dark theme'}</span>
    </button><button ref={opener} type="button" className="theme-settings-toggle" aria-label="Color opacity settings"
      aria-expanded={open} aria-controls={panelId} onClick={() => setOpen(value => !value)} title="Color opacity settings">
      <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.5">
        <path d="M4 7h7m4 0h5M4 17h3m4 0h9" /><circle cx="13" cy="7" r="2" /><circle cx="9" cy="17" r="2" />
      </svg>
    </button></div>
  </div>;
}
