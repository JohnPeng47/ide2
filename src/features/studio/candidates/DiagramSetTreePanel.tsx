import { useEffect, useMemo, useState } from "react";
import {
  isDiagramArchived,
  type DiagramRecord,
  type DiagramSetRecord,
  type PlanRecord
} from "../../../../domain/core/records/domain";
import { partialDiffForDiagram } from "../editing/artifactPartialDiffs";

export function DiagramSetTreePanel(props: {
  diagramSets: DiagramSetRecord[];
  diagrams: Record<string, DiagramRecord>;
  plans: readonly PlanRecord[];
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
      `Delete Generation Session “${set.name}”?\n\nIts files will be moved to .diagrams/trash and can be manually recovered.`
    );
    if (!confirmed) return;
    setDeletingId(set.id);
    setError(null);
    try {
      await props.onDeleteSet(set.id);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Generation Session deletion failed");
    } finally {
      setDeletingId(null);
    }
  };

  return (
    <section className="diagram-set-tree-panel" aria-label="Generation Sessions">
      <div className="diagram-set-tree-summary">
        <strong>GENERATION SESSIONS</strong>
        <span>{props.diagramSets.length} SESSION{props.diagramSets.length === 1 ? "" : "S"}</span>
      </div>
      {error ? <p className="diagram-set-tree-error" role="alert">{error}</p> : null}
      <div className="diagram-set-tree" role="tree" aria-label="Generation Sessions and candidates">
        {props.diagramSets.map((set) => {
          const diagrams = diagramsBySet.get(set.id) ?? [];
          const expanded = expandedSetIds.has(set.id);
          const active = set.id === props.activeSetId;
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
                  aria-label={`Delete Generation Session ${set.name}`}
                  title={`Delete ${set.name}`}
                  disabled={deletingId !== null || set.readiness === "collecting"}
                  onClick={() => void remove(set)}
                >{deletingId === set.id ? "[…]" : "[x]"}</button>
              </div>
              {expanded ? (
                <div role="group">
                  {diagrams.map((diagram, index) => {
                    const current = active && diagram.id === props.activeDiagramId;
                    const hasPartialDiff = Boolean(partialDiffForDiagram(diagram, props.plans));
                    return (
                      <button
                        type="button"
                        role="treeitem"
                        aria-level={2}
                        aria-current={current ? "page" : undefined}
                        className={`diagram-set-tree-row diagram-set-tree-diagram${current ? " is-current" : ""}`}
                        data-set-diagram-id={diagram.id}
                        key={diagram.id}
                        title={`${diagram.name}${hasPartialDiff ? " · partial diff" : ""}`}
                        onClick={() => props.onSelectDiagram(set.id, diagram.id)}
                      >
                        <span className="diagram-set-tree-prefix" aria-hidden="true">{
                          index === diagrams.length - 1 ? "`-- " : "+-- "
                        }</span>
                        <span className="diagram-set-tree-name">{diagram.name}</span>
                        {hasPartialDiff ? (
                          <span
                            className="diagram-set-tree-diff-status"
                            aria-label="Has partial diff"
                            title="Has partial diff"
                            data-partial-diff-status="true"
                          >[diff]</span>
                        ) : null}
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
