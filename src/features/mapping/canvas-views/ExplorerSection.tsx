import { useState, type ButtonHTMLAttributes, type ReactNode } from 'react';
import './canvasViews.css';

const icons = {
  chevron: 'M6 4l4 4-4 4',
  add: 'M8 3v10M3 8h10',
  collapse: 'M3 3h10v10H3z M5.5 8h5',
  save: 'M3 2.5h8l2 2v9H3z M5.5 2.5v3h4.5v-3 M5.5 13.5v-4h5v4',
  fork: 'M5 2.5v11 M12.5 4.5a1.5 1.5 0 1 1-3 0a1.5 1.5 0 1 1 3 0 M11 6c0 3.5-6 2.5-6 6',
  alternatives: 'M2.5 2.5h4.5v4.5H2.5z M9 2.5h4.5v4.5H9z M2.5 9h4.5v4.5H2.5z M9 9h4.5v4.5H9z',
  keep: 'M3 8.5l3 3 7-7',
  discard: 'M2.5 4h11 M6 4V2.5h4V4 M4 4l.7 9.5h6.6L12 4',
  previous: 'M10 3.5L5.5 8l4.5 4.5',
  next: 'M6 3.5l4.5 4.5L6 12.5',
  record: 'M8 3a5 5 0 1 0 0 10A5 5 0 0 0 8 3z',
  stop: 'M4 4h8v8H4z',
  close: 'M4 4l8 8M12 4l-8 8',
  view: 'M3 2h8v10H3z M6 5h8v10H6',
} as const;

export function Icon({ name }: { name: keyof typeof icons }) {
  return <svg className={`explorer-icon is-${name}`} aria-hidden="true" viewBox="0 0 16 16"><path d={icons[name]} /></svg>;
}

/** Codicon-sized toolbar button; the label doubles as tooltip and accessible name. */
export function IconButton({ icon, label, className, ...props }: { icon: keyof typeof icons; label: string } & Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'children'>) {
  return <button type="button" className={`explorer-icon-button${className ? ` ${className}` : ''}`} aria-label={label} title={props.title ?? label} {...props}><Icon name={icon} /></button>;
}

/** A VS Code-style collapsible pane: uppercase title, toolbar actions shown while expanded. */
export function ExplorerSection({ title, actions, defaultOpen = true, open, onToggle, children }: {
  title: string; actions?: ReactNode; defaultOpen?: boolean; open?: boolean; onToggle?: (open: boolean) => void; children: ReactNode;
}) {
  const [local, setLocal] = useState(defaultOpen), expanded = open ?? local;
  return <section className={`explorer-section${expanded ? ' is-open' : ''}`} aria-label={title}>
    <div className="explorer-section-header">
      <button type="button" className="explorer-section-title" aria-expanded={expanded}
        onClick={() => { setLocal(!expanded); onToggle?.(!expanded); }}><Icon name="chevron" />{title}</button>
      {expanded && actions && <span className="explorer-section-actions">{actions}</span>}
    </div>
    {expanded && <div className="explorer-section-body">{children}</div>}
  </section>;
}
