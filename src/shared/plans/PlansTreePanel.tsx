import { useEffect, useState } from "react";
import type { PlanChange, PlanRecord } from "../../../domain/core/records/domain";
import { planChangeCounts } from "../../../domain/core/plans/plans";

interface PlanChangeGroup {
  kind: PlanChange["kind"];
  label: string;
  emptyLabel: string;
}

const CHANGE_GROUPS: readonly PlanChangeGroup[] = [
  { kind: "diagram-modified", label: "Modified diagrams", emptyLabel: "No modified diagrams" },
  { kind: "diagram-added", label: "Added diagrams", emptyLabel: "No added diagrams" },
  {
    kind: "code-entity-compaction",
    label: "Code entity compactions",
    emptyLabel: "No compaction changes"
  }
];

function changeStatus(change: PlanChange): string {
  if (change.kind === "diagram-modified") return "modified";
  if (change.kind === "diagram-added") return "new";
  return "compaction";
}

export function PlansTreePanel(props: {
  plans: readonly PlanRecord[];
  selectedPlanId?: string;
  selectedChangeId?: string;
  staleChangeIds?: ReadonlySet<string>;
  onSelect: (planId: string, changeId?: string) => void;
}) {
  const [expandedPlanIds, setExpandedPlanIds] = useState<Set<string>>(
    () => new Set(props.plans.map((plan) => plan.id))
  );

  useEffect(() => {
    setExpandedPlanIds((current) => {
      const next = new Set([...current].filter((id) => props.plans.some((plan) => plan.id === id)));
      for (const plan of props.plans) if (!current.has(plan.id)) next.add(plan.id);
      return next;
    });
  }, [props.plans]);

  const togglePlan = (planId: string) => setExpandedPlanIds((current) => {
    const next = new Set(current);
    if (next.has(planId)) next.delete(planId);
    else next.add(planId);
    return next;
  });

  return (
    <section className="plans-tree-panel" aria-label="Plans">
      <div className="file-explorer__mode-bar">
        <strong>PLANS</strong>
        <span>{props.plans.length} PLAN{props.plans.length === 1 ? "" : "S"}</span>
      </div>
      <div className="plans-tree" role="tree" aria-label="Project plans">
        {props.plans.map((plan) => {
          const expanded = expandedPlanIds.has(plan.id);
          const counts = planChangeCounts(plan);
          const total = counts.modifiedDiagrams + counts.addedDiagrams + counts.codeEntityCompactions;
          return (
            <div className="plans-tree__plan" key={plan.id}>
              <div
                className={`plans-tree__row plans-tree__row--plan${
                  props.selectedPlanId === plan.id && !props.selectedChangeId ? " is-selected" : ""
                }`}
                role="treeitem"
                aria-level={1}
                aria-expanded={expanded}
              >
                <button
                  type="button"
                  className="plans-tree__toggle"
                  aria-label={`${expanded ? "Collapse" : "Expand"} ${plan.title}`}
                  onClick={() => togglePlan(plan.id)}
                >[{expanded ? "-" : "+"}]</button>
                <button
                  type="button"
                  className="plans-tree__label"
                  aria-current={props.selectedPlanId === plan.id && !props.selectedChangeId ? "page" : undefined}
                  onClick={() => props.onSelect(plan.id)}
                >{plan.title}</button>
                <span className={`plans-tree__status plans-tree__status--${plan.status}`}>{plan.status}</span>
                <span className="plans-tree__count">{total}</span>
              </div>
              {expanded ? (
                <div role="group">
                  {CHANGE_GROUPS.map((group) => {
                    const changes = plan.changes.filter((change) => change.kind === group.kind);
                    return (
                      <div className="plans-tree__group" key={group.kind} role="treeitem" aria-level={2}>
                        <div className="plans-tree__row plans-tree__row--group">
                          <span className="plans-tree__branch" aria-hidden="true">+--</span>
                          <span>{group.label}</span>
                          <span className="plans-tree__count">{changes.length}</span>
                        </div>
                        <div role="group">
                          {changes.map((change, index) => {
                            const stale = props.staleChangeIds?.has(`${plan.id}:${change.id}`);
                            const selected = props.selectedPlanId === plan.id
                              && props.selectedChangeId === change.id;
                            return (
                              <button
                                type="button"
                                role="treeitem"
                                aria-level={3}
                                aria-current={selected ? "page" : undefined}
                                className={`plans-tree__row plans-tree__row--change${selected ? " is-selected" : ""}`}
                                key={change.id}
                                onClick={() => props.onSelect(plan.id, change.id)}
                              >
                                <span className="plans-tree__branch" aria-hidden="true">
                                  {index === changes.length - 1 ? "`--" : "+--"}
                                </span>
                                <span className="plans-tree__change-label">{change.label}</span>
                                <span className={`plans-tree__change-status${stale ? " is-stale" : ""}`}>
                                  [{stale ? "stale" : changeStatus(change)}]
                                </span>
                              </button>
                            );
                          })}
                          {changes.length === 0 ? (
                            <div className="plans-tree__empty" aria-label={group.emptyLabel}>`-- empty</div>
                          ) : null}
                        </div>
                      </div>
                    );
                  })}
                </div>
              ) : null}
            </div>
          );
        })}
        {props.plans.length === 0 ? (
          <div className="file-tree-empty"><p>No Plans are registered for this project.</p></div>
        ) : null}
      </div>
    </section>
  );
}
