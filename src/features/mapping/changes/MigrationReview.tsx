import { useEffect, useRef } from 'react';
import type { DiagramMigration, MigrationRole } from '../../../../domain/mapping/changes/diagramMigration';
import type { MigrationPreview } from './changeMigrationPreview';

export function MigrationReview({ preview, selectedId, selectedRole, onSelect }: {
  preview: MigrationPreview; selectedId?: string; selectedRole?: MigrationRole;
  onSelect: (migration: DiagramMigration, role: MigrationRole) => void;
}) {
  const selected = useRef<HTMLElement>(null);
  useEffect(() => { selected.current?.focus({ preventScroll: true }); selected.current?.scrollIntoView({ block: 'nearest' }); }, [selectedId, selectedRole]);
  if (!preview.endpoints.length) return null;
  return <aside className="migration-review" aria-label="Migration review">
    <div className="migration-legend"><span className="migration-source">Source ↗</span><span className="migration-destination">Destination ↙</span></div>
    {preview.endpoints.map(({ migration, role, endpoint, resolved, error }) => {
      const active = selectedId === migration.id && selectedRole === role;
      const other = role === 'source' ? 'destination' : 'source';
      return <section key={`${migration.id}:${role}`} ref={active ? selected : undefined} tabIndex={-1}
        className={`migration-endpoint migration-${role}${active ? ' is-current' : ''}`} data-migration-card={migration.id} data-migration-role={role}>
        <strong>{migration.id} · {role === 'source' ? 'Source ↗' : 'Destination ↙'} · {migration.title}</strong>
        <small>{migration.kind === 'feature-ownership' ? 'Feature ownership' : 'Code organization'}</small>
        <p>{migration.description}</p>
        {error ? <p role="alert">{error}</p> : resolved && <>
          <button onClick={() => onSelect(migration, role)}>Locate {resolved.node.label}</button>
          {endpoint.snapshot === 'baseline' && <>
            <small>Original source</small>
            <pre className="migration-baseline" aria-label={`${migration.id} original source`}>{resolved.content.ascii.split('\n')
              .slice(resolved.node.line - 1, Math.max(...resolved.nodes.map(n => n.line)))
              .map((line, index) => {
                const nodes = resolved.nodes.filter(n => n.line === resolved.node.line + index).sort((a, b) => a.startColumn - b.startColumn);
                let cursor = 0;
                return <span className="ascii-line" key={index}>{nodes.map(node => {
                  const prefix = line.slice(cursor, node.startColumn - 1); cursor = node.endColumn;
                  return <span key={node.id}>{prefix}<span className="migration-source" data-migration-id={migration.id}>{node.label}</span></span>;
                })}{line.slice(cursor)}{'\n'}</span>;
              })}</pre>
          </>}
        </>}
        <button onClick={() => onSelect(migration, other)}>Go to {other} {other === 'destination' ? '↗' : '↙'}</button>
      </section>;
    })}
  </aside>;
}
