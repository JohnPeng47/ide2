import { useEffect, useMemo, useState } from "react";
import {
  isDiagramArchived,
  type DiagramRecord,
  type DiagramSetRecord
} from "../domain";

export function DiagramSetTreePanel(props: {
  diagramSets: DiagramSetRecord[];
  diagrams: Record<string, DiagramRecord>;
  activeSetId: string;
  activeDiagramId?: string;
  onSelectSet: (setId: string) => void;
  onSelectDiagram: (setId: string, diagramId: string) => void;
  onDeleteSet: (setId: string) => Promise<void>;
}) {
  const [expandedSetIds, setExpandedSetIds] = useState<Set<string>>(
    () => new Set([props.activeSetId])
  );
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setExpandedSetIds((current) => new Set(current).add(props.activeSetId));
  }, [props.activeSetId]);

  const diagramsBySet = useMemo(() => new Map(props.diagramSets.map((set) => [
    set.id,
    set.diagramIds
      .map((id) => props.diagrams[id])
      .filter((diagram): diagram is DiagramRecord => Boolean(diagram) && !isDiagramArchived(diagram))
  ])), [props.diagramSets, props.diagrams]);

  const toggleSet = (setId: string) => {
    setExpandedSetIds((current) => {
      const next = new Set(current);
      if (next.has(setId)) next.delete(setId);
      else next.add(setId);
      return next;
    });
  };

  const remove = async (set: DiagramSetRecord) => {
    const confirmed = window.confirm(
      `Delete Diagram Set “${set.name}”?\n\nIts files will be moved to .diagrams/trash and can be manually recovered.`
    );
    if (!confirmed) return;
    setDeletingId(set.id);
    setError(null);
    try {
      await props.onDeleteSet(set.id);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Diagram Set deletion failed");
    } finally {
      setDeletingId(null);
    }
  };

  return (
    <section className="diagram-set-tree-panel" aria-label="Diagram Sets">
      <div className="diagram-set-tree-summary">
        <strong>DIAGRAM SETS</strong>
        <span>{props.diagramSets.length} SET{props.diagramSets.length === 1 ? "" : "S"}</span>
      </div>
      {error ? <p className="diagram-set-tree-error" role="alert">{error}</p> : null}
      <div className="diagram-set-tree" role="tree" aria-label="Diagram Sets and diagrams">
        {props.diagramSets.map((set) => {
          const diagrams = diagramsBySet.get(set.id) ?? [];
          const expanded = expandedSetIds.has(set.id);
          const active = set.id === props.activeSetId;
          const starredIds = new Set(Object.values(set.featuredViewIds));
          return (
            <div className="diagram-set-tree-branch" role="treeitem" aria-expanded={expanded} aria-level={1} key={set.id}>
              <div
                className={`diagram-set-tree-row diagram-set-tree-set${active ? " is-current" : ""}`}
                data-diagram-set-id={set.id}
              >
                <button
                  type="button"
                  className="diagram-set-tree-toggle"
                  aria-label={`${expanded ? "Collapse" : "Expand"} ${set.name}`}
                  onClick={() => toggleSet(set.id)}
                >[{expanded ? "-" : "+"}]</button>
                <button
                  type="button"
                  className="diagram-set-tree-select"
                  aria-current={active ? "true" : undefined}
                  onClick={() => props.onSelectSet(set.id)}
                >
                  <strong>{set.name}</strong>
                  {set.readiness === "failed" ? <em>FAILED</em> : null}
                </button>
                <button
                  type="button"
                  className="diagram-set-tree-delete"
                  aria-label={`Delete Diagram Set ${set.name}`}
                  title={`Delete ${set.name}`}
                  disabled={deletingId !== null || set.readiness === "collecting"}
                  onClick={() => void remove(set)}
                >{deletingId === set.id ? "[…]" : "[x]"}</button>
              </div>
              {expanded ? (
                <div role="group">
                  {diagrams.map((diagram, index) => {
                    const starred = starredIds.has(diagram.id);
                    const current = active && diagram.id === props.activeDiagramId;
                    return (
                      <button
                        type="button"
                        role="treeitem"
                        aria-level={2}
                        aria-current={current ? "page" : undefined}
                        className={`diagram-set-tree-row diagram-set-tree-diagram${current ? " is-current" : ""}`}
                        data-set-diagram-id={diagram.id}
                        key={diagram.id}
                        title={`${diagram.name}${starred ? " · starred" : ""}`}
                        onClick={() => props.onSelectDiagram(set.id, diagram.id)}
                      >
                        <span className="diagram-set-tree-prefix" aria-hidden="true">{
                          index === diagrams.length - 1 ? "`-- " : "+-- "
                        }</span>
                        <span
                          className={`diagram-set-tree-star${starred ? " is-starred" : ""}`}
                          aria-label={starred ? "Starred diagram" : undefined}
                          aria-hidden={starred ? undefined : "true"}
                        >{starred ? "★" : "·"}</span>
                        <span className="diagram-set-tree-name">{diagram.name}</span>
                        <em>{diagram.viewKind.toUpperCase()}</em>
                      </button>
                    );
                  })}
                  {diagrams.length === 0 ? (
                    <div className="diagram-set-tree-empty">
                      <span aria-hidden="true">`-- </span>
                      <span>no diagrams</span>
                    </div>
                  ) : null}
                </div>
              ) : null}
            </div>
          );
        })}
      </div>
    </section>
  );
}
