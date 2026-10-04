import { useEffect, useState, type ReactNode } from 'react';

export function RepositoryTreeGroup({ id, name, reveal, children }: { id: string; name: string; reveal: boolean; children: ReactNode }) {
  const [open, setOpen] = useState(true);
  useEffect(() => { if (reveal) setOpen(true); }, [reveal]);
  return <li data-repository-group={id}><details open={open} onToggle={event => setOpen(event.currentTarget.open)}>
    <summary className="repository-heading">{name}</summary><ul>{children}</ul>
  </details></li>;
}
