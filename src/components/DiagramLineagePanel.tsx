import { Fragment, useState, type FormEvent, type ReactNode } from "react";
import type {
  DiagramRecord,
  DiagramSetRecord,
  GenerationBatchRecord
} from "../domain";

function connector(last: boolean): string {
  return last ? "`-- " : "+-- ";
}

function continuation(last: boolean): string {
  return last ? "    " : "|   ";
}

function TreePrefix(props: { prefix: string; last: boolean }) {
  return (
    <span className="diagram-tree-prefix" aria-hidden="true">
      {props.prefix}{connector(props.last)}
    </span>
  );
}

function TreeBridge(props: { prefix: string }) {
  return <div className="diagram-tree-bridge" aria-hidden="true">{props.prefix}|</div>;
}

function parentDiagramId(
  batch: GenerationBatchRecord,
  diagramsById: Map<string, DiagramRecord>
): string | undefined {
  const referenced = batch.promptReferences.find(
    (reference) => reference.kind === "diagram" && diagramsById.has(reference.targetId)
  );
  if (referenced) return referenced.targetId;
  const outputs = batch.outputDiagramIds
    .map((id) => diagramsById.get(id))
    .filter((diagram): diagram is DiagramRecord => Boolean(diagram));
  const first = outputs[0];
  return first?.derivedFromDiagramIds.find((parentId) => (
    diagramsById.has(parentId)
    && outputs.every((diagram) => diagram.derivedFromDiagramIds.includes(parentId))
  ));
}

function statusLabel(status: GenerationBatchRecord["status"]): string {
  return status.replaceAll("-", " ").toUpperCase();
}

export function DiagramLineagePanel(props: {
  diagramSet: DiagramSetRecord;
  diagrams: DiagramRecord[];
  generationBatches: Record<string, GenerationBatchRecord>;
  activeDiagramId: string;
  onSelect: (diagramId: string) => void;
  onRename: (diagramId: string, name: string) => Promise<void>;
  onArchive: (diagramId: string) => Promise<void>;
}) {
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draftName, setDraftName] = useState("");
  const [saving, setSaving] = useState(false);
  const [archivingId, setArchivingId] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [collapsedIds, setCollapsedIds] = useState<Set<string>>(new Set());
  const diagramsById = new Map(props.diagrams.map((diagram) => [diagram.id, diagram]));
  const diagramNumber = new Map(
    props.diagramSet.diagramIds.map((diagramId, index) => [diagramId, index + 1])
  );
  const batches = props.diagramSet.generationBatchIds
    .map((id) => props.generationBatches[id])
    .filter((batch): batch is GenerationBatchRecord => Boolean(batch))
    .filter((batch) => (
      batch.status !== "complete"
      || batch.outputDiagramIds.some((diagramId) => diagramsById.has(diagramId))
    ));
  const batchesById = new Map(batches.map((batch) => [batch.id, batch]));
  const childrenByDiagram = new Map<string, string[]>();
  const parentByBatch = new Map<string, string>();
  for (const batch of batches) {
    const parentId = parentDiagramId(batch, diagramsById);
    if (!parentId) continue;
    parentByBatch.set(batch.id, parentId);
    const children = childrenByDiagram.get(parentId) ?? [];
    children.push(batch.id);
    childrenByDiagram.set(parentId, children);
  }
  const rootBatchIds = batches
    .filter((batch) => !parentByBatch.has(batch.id))
    .map((batch) => batch.id);
  const batchedDiagramIds = new Set(batches.flatMap((batch) => batch.outputDiagramIds));
  const orphanDiagrams = props.diagrams.filter((diagram) => !batchedDiagramIds.has(diagram.id));

  const outputDiagrams = (batchId: string): DiagramRecord[] => {
    const batch = batchesById.get(batchId);
    if (!batch) return [];
    return batch.outputDiagramIds
      .map((diagramId) => diagramsById.get(diagramId))
      .filter((diagram): diagram is DiagramRecord => Boolean(diagram));
  };

  const childDiagrams = (diagramId: string): DiagramRecord[] => (
    (childrenByDiagram.get(diagramId) ?? []).flatMap(outputDiagrams)
  );

  const subtreeSize = (diagram: DiagramRecord, ancestors: Set<string>): number => {
    if (ancestors.has(diagram.id)) return 0;
    const nextAncestors = new Set(ancestors).add(diagram.id);
    return 1 + childDiagrams(diagram.id)
      .reduce((total, child) => total + subtreeSize(child, nextAncestors), 0);
  };

  const toggleCollapsed = (id: string) => {
    setCollapsedIds((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const beginRename = (diagram: DiagramRecord) => {
    setEditingId(diagram.id);
    setDraftName(diagram.name);
    setActionError(null);
  };

  const saveRename = async (event: FormEvent, diagram: DiagramRecord) => {
    event.preventDefault();
    const name = draftName.trim();
    if (!name) {
      setActionError("Diagram name is required");
      return;
    }
    if (name === diagram.name) {
      setEditingId(null);
      return;
    }
    setSaving(true);
    setActionError(null);
    try {
      await props.onRename(diagram.id, name);
      setEditingId(null);
    } catch (error) {
      setActionError(error instanceof Error ? error.message : "Diagram rename failed");
    } finally {
      setSaving(false);
    }
  };

  const archive = async (diagram: DiagramRecord) => {
    setArchivingId(diagram.id);
    setActionError(null);
    try {
      await props.onArchive(diagram.id);
      if (editingId === diagram.id) setEditingId(null);
    } catch (error) {
      setActionError(error instanceof Error ? error.message : "Diagram archive failed");
    } finally {
      setArchivingId(null);
    }
  };

  const renderDiagram = (
    diagram: DiagramRecord,
    prefix: string,
    last: boolean
  ): ReactNode => {
    const current = diagram.id === props.activeDiagramId;
    const children = childDiagrams(diagram.id);
    const collapseId = `diagram:${diagram.id}`;
    const collapsed = collapsedIds.has(collapseId);
    const hiddenCount = children.reduce(
      (total, child) => total + subtreeSize(child, new Set([diagram.id])),
      0
    );
    const number = diagramNumber.get(diagram.id) ?? 0;
    return (
      <div className="diagram-tree-branch" key={diagram.id}>
        {editingId === diagram.id ? (
          <form
            className={`diagram-tree-line diagram-tree-edit${current ? " is-current" : ""}`}
            data-diagram-id={diagram.id}
            onSubmit={(event) => void saveRename(event, diagram)}
          >
            <TreePrefix prefix={prefix} last={last} />
            <span className="diagram-tree-toggle-spacer" />
            <strong>{String(number).padStart(2, "0")}</strong>
            <input
              aria-label={`Name for ${diagram.name}`}
              value={draftName}
              maxLength={120}
              disabled={saving}
              autoFocus
              onChange={(event) => setDraftName(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Escape") setEditingId(null);
              }}
            />
            <button type="submit" className="diagram-tree-save" disabled={saving}>save</button>
            <button type="button" disabled={saving} onClick={() => setEditingId(null)}>cancel</button>
          </form>
        ) : (
          <div
            className={`diagram-tree-line diagram-tree-diagram${current ? " is-current" : ""}`}
            data-diagram-id={diagram.id}
          >
            <TreePrefix prefix={prefix} last={last} />
            {children.length > 0 ? (
              <button
                type="button"
                className="diagram-tree-toggle"
                aria-label={`${collapsed ? "Expand" : "Collapse"} ${diagram.name}`}
                aria-expanded={!collapsed}
                onClick={() => toggleCollapsed(collapseId)}
              >
                {collapsed ? `[+${hiddenCount}]` : "[-]"}
              </button>
            ) : <span className="diagram-tree-toggle-spacer" />}
            <button
              type="button"
              className="diagram-tree-diagram__open"
              aria-current={current ? "page" : undefined}
              onClick={() => props.onSelect(diagram.id)}
            >
              <strong>{String(number).padStart(2, "0")}</strong>
              <span className="diagram-tree-description">{diagram.name}</span>
              {current ? <em>CURRENT</em> : null}
            </button>
            <span className="diagram-tree-actions">
              <button
                type="button"
                className="diagram-tree-rename"
                aria-label={`Rename ${diagram.name}`}
                disabled={archivingId === diagram.id}
                onClick={() => beginRename(diagram)}
              >
                rename
              </button>
              <button
                type="button"
                className="diagram-tree-archive"
                aria-label={`Archive ${diagram.name}`}
                title="Archive diagram; keep its artifact on disk"
                disabled={archivingId === diagram.id}
                onClick={() => void archive(diagram)}
              >
                [x]
              </button>
            </span>
          </div>
        )}
        {!collapsed && children.map((child, index) => {
          const childPrefix = `${prefix}${continuation(last)}`;
          return (
            <Fragment key={child.id}>
              <TreeBridge prefix={childPrefix} />
              {renderDiagram(child, childPrefix, index === children.length - 1)}
            </Fragment>
          );
        })}
      </div>
    );
  };

  const renderRootBatch = (
    batchId: string,
    prefix: string,
    last: boolean
  ): ReactNode => {
    const batch = batchesById.get(batchId);
    if (!batch) return null;
    const batchNumber = props.diagramSet.generationBatchIds.indexOf(batch.id) + 1;
    const outputPrefix = `${prefix}${continuation(last)}`;
    const outputs = outputDiagrams(batch.id);
    const collapseId = `batch:${batch.id}`;
    const collapsed = collapsedIds.has(collapseId);
    const hiddenCount = outputs.reduce(
      (total, diagram) => total + subtreeSize(diagram, new Set()),
      0
    );
    return (
      <div className="diagram-tree-branch" key={batch.id}>
        <div
          className={`diagram-tree-line diagram-tree-generation status-${batch.status}`}
          data-generation-batch-id={batch.id}
          data-parent-diagram-id={parentByBatch.get(batch.id)}
          title={batch.userPrompt || `${batch.requestedCount} generated diagrams`}
        >
          <TreePrefix prefix={prefix} last={last} />
          {outputs.length > 0 ? (
            <button
              type="button"
              className="diagram-tree-toggle"
              aria-label={`${collapsed ? "Expand" : "Collapse"} generation G${batchNumber}`}
              aria-expanded={!collapsed}
              onClick={() => toggleCollapsed(collapseId)}
            >
              {collapsed ? `[+${hiddenCount}]` : "[-]"}
            </button>
          ) : <span className="diagram-tree-toggle-spacer" />}
          <strong>G{batchNumber}</strong>
          <span className="diagram-tree-status">[{statusLabel(batch.status)}]</span>
          <span className="diagram-tree-description">
            {batch.userPrompt || `${batch.requestedCount} generated diagrams`}
          </span>
        </div>
        {!collapsed && outputs.map((diagram, index) => (
          <Fragment key={diagram.id}>
            <TreeBridge prefix={outputPrefix} />
            {renderDiagram(diagram, outputPrefix, index === outputs.length - 1)}
          </Fragment>
        ))}
      </div>
    );
  };

  return (
    <div className="diagram-lineage-panel">
      <header className="pane-header">
        <div>
          <span className="eyebrow">DIAGRAMS · {props.diagrams.length}</span>
          <h2>Generated lineage</h2>
        </div>
        <span className="status-pill">{rootBatchIds.length} ROOT {rootBatchIds.length === 1 ? "BATCH" : "BATCHES"}</span>
      </header>
      <div className="diagram-lineage-tree" aria-label="Generated diagram lineage">
        <div className="diagram-tree-set-title">
          <strong>{props.diagramSet.name}</strong>
          <span>{props.diagramSet.generationBatchIds.length} generations</span>
        </div>
        {actionError ? <p className="diagram-tree-error" role="alert">{actionError}</p> : null}
        {rootBatchIds.map((batchId, index) => (
          <Fragment key={batchId}>
            <TreeBridge prefix="" />
            {renderRootBatch(
              batchId,
              "",
              index === rootBatchIds.length - 1 && orphanDiagrams.length === 0
            )}
          </Fragment>
        ))}
        {orphanDiagrams.map((diagram, index) => (
          <Fragment key={diagram.id}>
            <TreeBridge prefix="" />
            {renderDiagram(diagram, "", index === orphanDiagrams.length - 1)}
          </Fragment>
        ))}
      </div>
    </div>
  );
}
