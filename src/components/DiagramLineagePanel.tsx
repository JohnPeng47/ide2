import { Fragment, useState, type FormEvent, type ReactNode } from "react";
import type {
  DiagramComponentRecord,
  DiagramCandidateBatchRecord,
  DiagramRecord,
  DiagramSetRecord,
  DiagramViewKind,
  GenerationBatchRecord,
  GenerationPromptConfigRecord
} from "../domain";
import { GLOBAL_IMPORTS_DIAGRAM_SET_ID } from "../domain";
import { PromptConfigDialog } from "./PromptConfigDialog";
import { DiagramCandidateFeedbackDialog } from "./DiagramCandidateFeedbackDialog";

function connector(last: boolean): string {
  return last ? "`-- " : "+-- ";
}

function ComponentLineageSection(props: {
  diagramSet: DiagramSetRecord;
  components: DiagramComponentRecord[];
  generationBatches: Record<string, GenerationBatchRecord>;
  generationPromptConfigs: Record<string, GenerationPromptConfigRecord>;
  activeComponentId?: string;
  onSelect: (componentId: string) => void;
  onArchive: (componentId: string) => Promise<void>;
  onInspectPrompt: (configId: string) => void;
}) {
  const [archivingId, setArchivingId] = useState<string | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const byId = new Map(props.components.map((component) => [component.id, component]));
  const number = new Map(
    [
      ...props.diagramSet.diagramComponentIds,
      ...props.components
        .filter((component) => component.diagramSetId === GLOBAL_IMPORTS_DIAGRAM_SET_ID)
        .map((component) => component.id)
    ].map((componentId, index) => [componentId, index + 1])
  );
  const batches = props.diagramSet.generationBatchIds
    .map((id) => props.generationBatches[id])
    .filter((batch): batch is GenerationBatchRecord => Boolean(batch))
    .filter((batch) => (
      props.generationPromptConfigs[batch.promptConfigId]?.outputKind === "diagram-component"
    ))
    .filter((batch) => (
      batch.status !== "complete"
      || batch.outputDiagramComponentIds.some((componentId) => byId.has(componentId))
    ));
  const parentByBatch = new Map<string, string>();
  const batchesByParent = new Map<string, GenerationBatchRecord[]>();
  for (const batch of batches) {
    const parent = props.generationPromptConfigs[batch.promptConfigId]?.references.find(
      (reference) => reference.kind === "diagram-component" && byId.has(reference.targetId)
    )?.targetId;
    if (!parent) continue;
    parentByBatch.set(batch.id, parent);
    batchesByParent.set(parent, [...(batchesByParent.get(parent) ?? []), batch]);
  }
  const batchedIds = new Set(batches.flatMap((batch) => batch.outputDiagramComponentIds));
  const directChildrenByParent = new Map<string, DiagramComponentRecord[]>();
  const directParentByComponent = new Map<string, string>();
  for (const component of props.components) {
    if (batchedIds.has(component.id)) continue;
    const parentId = component.sourceDiagramComponentId
      ?? component.derivedFromDiagramComponentIds.find((id) => byId.has(id));
    if (!parentId || !byId.has(parentId)) continue;
    directParentByComponent.set(component.id, parentId);
    directChildrenByParent.set(parentId, [
      ...(directChildrenByParent.get(parentId) ?? []),
      component
    ]);
  }
  const rootComponents = props.components.filter((component) => (
    !batchedIds.has(component.id) && !directParentByComponent.has(component.id)
  ));
  const rootBatches = batches.filter((batch) => !parentByBatch.has(batch.id));

  const archive = async (component: DiagramComponentRecord) => {
    setArchivingId(component.id);
    setActionError(null);
    try {
      await props.onArchive(component.id);
    } catch (error) {
      setActionError(error instanceof Error ? error.message : "DiagramComponent archive failed");
    } finally {
      setArchivingId(null);
    }
  };

  const copyReference = async (component: DiagramComponentRecord) => {
    setActionError(null);
    try {
      await navigator.clipboard.writeText(`@component/${component.handle}`);
      setCopiedId(component.id);
    } catch (error) {
      setActionError(error instanceof Error ? error.message : "DiagramComponent reference copy failed");
    }
  };

  const renderComponent = (
    component: DiagramComponentRecord,
    prefix: string,
    last: boolean,
    ancestors: Set<string>
  ): ReactNode => {
    if (ancestors.has(component.id)) return null;
    const childBatches = batchesByParent.get(component.id) ?? [];
    const directChildren = directChildrenByParent.get(component.id) ?? [];
    const nextAncestors = new Set(ancestors).add(component.id);
    const current = component.id === props.activeComponentId;
    return (
      <div className="diagram-tree-branch" key={component.id}>
        <div
          className={`diagram-tree-line diagram-tree-component${current ? " is-current" : ""}`}
          data-component-id={component.id}
        >
          <TreePrefix prefix={prefix} last={last} />
          <span className="diagram-tree-toggle-spacer" />
          <button
            type="button"
            className="diagram-tree-component__open"
            aria-current={current ? "page" : undefined}
            title={component.ascii}
            onClick={() => props.onSelect(component.id)}
          >
            <strong>C{String(number.get(component.id) ?? 0).padStart(2, "0")}</strong>
            <span className="diagram-tree-description">{component.name}</span>
            <em>{component.diagramSetId === GLOBAL_IMPORTS_DIAGRAM_SET_ID
              ? "GLOBAL"
              : component.origin === "selection" ? "CAPTURED" : component.origin.toUpperCase()}</em>
          </button>
          <span className="diagram-tree-component-actions">
            {component.generationPromptConfigId ? (
              <button
                type="button"
                className="diagram-tree-prompt"
                aria-label={`Inspect generation prompt for ${component.name}`}
                onClick={() => props.onInspectPrompt(component.generationPromptConfigId!)}
              >
                prompt
              </button>
            ) : null}
            <button
              type="button"
              className={`diagram-tree-copy${copiedId === component.id ? " is-copied" : ""}`}
              aria-label={`Copy @component/${component.handle}`}
              data-reference={`@component/${component.handle}`}
              title={`Copy @component/${component.handle}`}
              onClick={() => void copyReference(component)}
            >
              {copiedId === component.id ? "copied" : "copy"}
            </button>
            <button
              type="button"
              className="diagram-tree-archive"
              aria-label={`Archive ${component.name}`}
              title="Archive DiagramComponent; keep its artifact on disk"
              disabled={archivingId === component.id}
              onClick={() => void archive(component)}
            >
              [x]
            </button>
          </span>
        </div>
        {childBatches.map((batch, batchIndex) => {
          const childPrefix = `${prefix}${continuation(last)}`;
          return (
            <Fragment key={batch.id}>
              <TreeBridge prefix={childPrefix} />
              {renderBatch(
                batch,
                childPrefix,
                batchIndex === childBatches.length - 1 && directChildren.length === 0,
                nextAncestors
              )}
            </Fragment>
          );
        })}
        {directChildren.map((child, index) => {
          const childPrefix = `${prefix}${continuation(last)}`;
          return (
            <Fragment key={child.id}>
              <TreeBridge prefix={childPrefix} />
              {renderComponent(
                child,
                childPrefix,
                index === directChildren.length - 1,
                nextAncestors
              )}
            </Fragment>
          );
        })}
      </div>
    );
  };

  const renderBatch = (
    batch: GenerationBatchRecord,
    prefix: string,
    last: boolean,
    ancestors: Set<string>
  ): ReactNode => {
    const outputs = batch.outputDiagramComponentIds
      .map((id) => byId.get(id))
      .filter((component): component is DiagramComponentRecord => Boolean(component));
    const batchNumber = props.diagramSet.generationBatchIds.indexOf(batch.id) + 1;
    const outputPrefix = `${prefix}${continuation(last)}`;
    return (
      <div className="diagram-tree-branch" key={batch.id}>
        <div className={`diagram-tree-line diagram-tree-generation status-${batch.status}`}>
          <TreePrefix prefix={prefix} last={last} />
          <span className="diagram-tree-toggle-spacer" />
          <strong>G{batchNumber}</strong>
          <span className="diagram-tree-status">[{statusLabel(batch.status)}]</span>
          <span className="diagram-tree-description">{
            props.generationPromptConfigs[batch.promptConfigId]?.instruction || "Component variants"
          }</span>
        </div>
        {outputs.map((component, index) => (
          <Fragment key={component.id}>
            <TreeBridge prefix={outputPrefix} />
            {renderComponent(component, outputPrefix, index === outputs.length - 1, ancestors)}
          </Fragment>
        ))}
      </div>
    );
  };

  return (
    <section className="component-lineage" aria-label="Diagram components">
      <div className="diagram-tree-section-title">
        <strong>COMPONENTS · {props.components.length}</strong>
        <span>captured and generated fragments</span>
      </div>
      {actionError ? <p className="diagram-tree-error" role="alert">{actionError}</p> : null}
      {rootComponents.map((component, index) => (
        <Fragment key={component.id}>
          <TreeBridge prefix="" />
          {renderComponent(
            component,
            "",
            index === rootComponents.length - 1 && rootBatches.length === 0,
            new Set()
          )}
        </Fragment>
      ))}
      {rootBatches.map((batch, index) => (
        <Fragment key={batch.id}>
          <TreeBridge prefix="" />
          {renderBatch(batch, "", index === rootBatches.length - 1, new Set())}
        </Fragment>
      ))}
      {props.components.length === 0 && batches.length === 0
        ? <p className="empty-copy">Capture a rectangle from a Diagram to create the first component.</p>
        : null}
    </section>
  );
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
  diagramsById: Map<string, DiagramRecord>,
  promptConfigs: Record<string, GenerationPromptConfigRecord>
): string | undefined {
  const outputs = batch.outputDiagramIds
    .map((id) => diagramsById.get(id))
    .filter((diagram): diagram is DiagramRecord => Boolean(diagram));
  const outputViewKind = outputs[0]?.viewKind;
  const referenced = promptConfigs[batch.promptConfigId]?.references.find(
    (reference) => reference.kind === "diagram"
      && diagramsById.get(reference.targetId)?.viewKind === outputViewKind
  );
  if (referenced) return referenced.targetId;
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
  allDiagrams: Record<string, DiagramRecord>;
  components: DiagramComponentRecord[];
  generationBatches: Record<string, GenerationBatchRecord>;
  diagramCandidateBatches: Record<string, DiagramCandidateBatchRecord>;
  generationPromptConfigs: Record<string, GenerationPromptConfigRecord>;
  activeDiagramId?: string;
  activeComponentId?: string;
  onSelect: (diagramId: string) => void;
  onSelectComponent: (componentId: string) => void;
  onRename: (diagramId: string, name: string) => Promise<void>;
  onArchive: (diagramId: string) => Promise<void>;
  onArchiveComponent: (componentId: string) => Promise<void>;
  onSaveCandidateRankings: (
    candidateBatchId: string,
    rankings: Array<{ diagramId: string; rank: number }>
  ) => Promise<void>;
}) {
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draftName, setDraftName] = useState("");
  const [saving, setSaving] = useState(false);
  const [archivingId, setArchivingId] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [collapsedIds, setCollapsedIds] = useState<Set<string>>(new Set());
  const [inspectedConfigId, setInspectedConfigId] = useState<string | null>(null);
  const [feedbackBatchId, setFeedbackBatchId] = useState<string | null>(null);
  const diagramsById = new Map(props.diagrams.map((diagram) => [diagram.id, diagram]));
  const diagramNumber = new Map(
    [
      ...props.diagramSet.diagramIds,
      ...props.diagrams
        .filter((diagram) => diagram.diagramSetId === GLOBAL_IMPORTS_DIAGRAM_SET_ID)
        .map((diagram) => diagram.id)
    ].map((diagramId, index) => [diagramId, index + 1])
  );
  const batches = props.diagramSet.generationBatchIds
    .map((id) => props.generationBatches[id])
    .filter((batch): batch is GenerationBatchRecord => Boolean(batch))
    .filter((batch) => props.generationPromptConfigs[batch.promptConfigId]?.outputKind === "diagram");
  const batchesById = new Map(batches.map((batch) => [batch.id, batch]));
  const candidateBatchIds = batches.flatMap((batch) => (
    batch.diagramCandidateBatchId ? [batch.diagramCandidateBatchId] : []
  ));
  const candidateNumber = new Map(candidateBatchIds.map((id, index) => [id, index + 1]));
  const rankByDiagramId = new Map(candidateBatchIds.flatMap((id) => {
    const candidateBatch = props.diagramCandidateBatches[id];
    return candidateBatch
      ? Object.entries(candidateBatch.rankings).map(([diagramId, rank]) => [diagramId, rank] as const)
      : [];
  }));
  const childrenByDiagram = new Map<string, string[]>();
  const parentByBatch = new Map<string, string>();
  for (const batch of batches) {
    const parentId = parentDiagramId(batch, diagramsById, props.generationPromptConfigs);
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
  const rootDiagrams = props.diagrams.filter((diagram) => !batchedDiagramIds.has(diagram.id));
  const importedDiagrams = rootDiagrams.filter((diagram) => diagram.origin === "imported");
  const orphanDiagrams = rootDiagrams.filter((diagram) => diagram.origin !== "imported");

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

  let renderGenerationBatch: (batchId: string, prefix: string, last: boolean) => ReactNode;

  const renderDiagram = (
    diagram: DiagramRecord,
    prefix: string,
    last: boolean
  ): ReactNode => {
    const current = diagram.id === props.activeDiagramId;
    const childBatchIds = childrenByDiagram.get(diagram.id) ?? [];
    const children = childBatchIds.flatMap(outputDiagrams);
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
              {rankByDiagramId.has(diagram.id) ? (
                <span className="diagram-tree-rank">[R{rankByDiagramId.get(diagram.id)}]</span>
              ) : null}
              <strong>{String(number).padStart(2, "0")}</strong>
              <span className="diagram-tree-description">{diagram.name}</span>
              {diagram.basedOnDiagramId ? (
                <em>BASED ON {String(diagramNumber.get(diagram.basedOnDiagramId) ?? "?").padStart(2, "0")}</em>
              ) : null}
              {diagram.diagramSetId === GLOBAL_IMPORTS_DIAGRAM_SET_ID ? <em>GLOBAL</em> : null}
              {current ? <em>CURRENT</em> : null}
            </button>
            <span className="diagram-tree-actions">
              {diagram.generationPromptConfigId ? (
                <button
                  type="button"
                  className="diagram-tree-prompt"
                  aria-label={`Inspect generation prompt for ${diagram.name}`}
                  onClick={() => setInspectedConfigId(diagram.generationPromptConfigId!)}
                >
                  prompt
                </button>
              ) : null}
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
        {!collapsed && childBatchIds.map((batchId, index) => {
          const childPrefix = `${prefix}${continuation(last)}`;
          return (
            <Fragment key={batchId}>
              <TreeBridge prefix={childPrefix} />
              {renderGenerationBatch(
                batchId,
                childPrefix,
                index === childBatchIds.length - 1
              )}
            </Fragment>
          );
        })}
      </div>
    );
  };

  const renderCandidateBatch = (
    candidateBatch: DiagramCandidateBatchRecord,
    prefix: string,
    last: boolean
  ): ReactNode => {
    const outputs = candidateBatch.diagramIds
      .map((diagramId) => diagramsById.get(diagramId))
      .filter((diagram): diagram is DiagramRecord => Boolean(diagram));
    const archivedCount = candidateBatch.diagramIds.filter(
      (diagramId) => Boolean(props.allDiagrams[diagramId]?.archivedAt)
    ).length;
    const batchNumber = candidateNumber.get(candidateBatch.id) ?? 0;
    const ranked = candidateBatch.diagramIds.length > 0
      && candidateBatch.diagramIds.every((diagramId) => (
        Number.isInteger(candidateBatch.rankings[diagramId])
      ));
    const collapseId = `candidate-batch:${candidateBatch.id}`;
    const collapsed = collapsedIds.has(collapseId);
    const outputPrefix = `${prefix}${continuation(last)}`;
    const hiddenCount = outputs.reduce(
      (total, diagram) => total + subtreeSize(diagram, new Set()),
      0
    );
    return (
      <div className="diagram-tree-branch" key={candidateBatch.id}>
        <div
          className={`diagram-tree-line diagram-tree-candidate-batch${ranked ? " is-ranked" : ""}`}
          data-candidate-batch-id={candidateBatch.id}
        >
          <TreePrefix prefix={prefix} last={last} />
          {outputs.length > 0 ? (
            <button
              type="button"
              className="diagram-tree-toggle"
              aria-label={`${collapsed ? "Expand" : "Collapse"} candidate batch B${batchNumber}`}
              aria-expanded={!collapsed}
              onClick={() => toggleCollapsed(collapseId)}
            >
              {collapsed ? `[+${hiddenCount}]` : "[-]"}
            </button>
          ) : <span className="diagram-tree-toggle-spacer" />}
          <strong>B{batchNumber}</strong>
          <span className="diagram-tree-feedback-status">[{ranked ? "RANKED" : "UNRANKED"}]</span>
          <span className="diagram-tree-description">
            {candidateBatch.diagramIds.length} candidates
            {archivedCount ? ` · ${archivedCount} archived` : ""}
          </span>
          <span className="diagram-tree-actions">
            <button
              type="button"
              className="diagram-tree-feedback"
              aria-label={`Provide feedback for candidate batch B${batchNumber}`}
              onClick={() => setFeedbackBatchId(candidateBatch.id)}
            >
              feedback
            </button>
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

  renderGenerationBatch = (
    batchId: string,
    prefix: string,
    last: boolean
  ): ReactNode => {
    const batch = batchesById.get(batchId);
    if (!batch) return null;
    const batchNumber = props.diagramSet.generationBatchIds.indexOf(batch.id) + 1;
    const outputs = outputDiagrams(batch.id);
    const candidateBatch = batch.diagramCandidateBatchId
      ? props.diagramCandidateBatches[batch.diagramCandidateBatchId]
      : undefined;
    const outputPrefix = `${prefix}${continuation(last)}`;
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
          title={props.generationPromptConfigs[batch.promptConfigId]?.instruction
            || `${batch.requestedCount} generated diagrams`}
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
            {props.generationPromptConfigs[batch.promptConfigId]?.instruction
              || `${batch.requestedCount} generated diagrams`}
          </span>
        </div>
        {!collapsed && candidateBatch ? (
          <>
            <TreeBridge prefix={outputPrefix} />
            {renderCandidateBatch(candidateBatch, outputPrefix, true)}
          </>
        ) : null}
      </div>
    );
  };

  const renderImports = (last: boolean): ReactNode => {
    const collapseId = "imports";
    const collapsed = collapsedIds.has(collapseId);
    const hiddenCount = importedDiagrams.reduce(
      (total, diagram) => total + subtreeSize(diagram, new Set()),
      0
    );
    const childPrefix = continuation(last);
    return (
      <div className="diagram-tree-branch" data-imports-branch>
        <div className="diagram-tree-line diagram-tree-imports">
          <TreePrefix prefix="" last={last} />
          <button
            type="button"
            className="diagram-tree-toggle"
            aria-label={`${collapsed ? "Expand" : "Collapse"} imports`}
            aria-expanded={!collapsed}
            onClick={() => toggleCollapsed(collapseId)}
          >
            {collapsed ? `[+${hiddenCount}]` : "[-]"}
          </button>
          <strong>GLOBAL IMPORTS</strong>
          <span className="diagram-tree-description">
            {importedDiagrams.length} imported {importedDiagrams.length === 1 ? "diagram" : "diagrams"}
          </span>
        </div>
        {!collapsed && importedDiagrams.map((diagram, index) => (
          <Fragment key={diagram.id}>
            <TreeBridge prefix={childPrefix} />
            {renderDiagram(diagram, childPrefix, index === importedDiagrams.length - 1)}
          </Fragment>
        ))}
      </div>
    );
  };

  const viewKinds: Array<{ kind: DiagramViewKind; label: string; description: string }> = [
    { kind: "diagram", label: "[DIAGRAM]", description: "architecture candidates" },
    { kind: "call-graph", label: "[CALL-GRAPH]", description: "invocation candidates" },
    { kind: "dir-view", label: "[DIR-VIEW]", description: "repository layout candidates" }
  ];

  const renderViewSection = (
    kind: DiagramViewKind,
    label: string,
    description: string
  ): ReactNode => {
    const categoryBatchIds = rootBatchIds.filter((batchId) => {
      const config = props.generationPromptConfigs[batchesById.get(batchId)?.promptConfigId ?? ""];
      return (config?.viewKind ?? "diagram") === kind;
    });
    const categoryOrphans = orphanDiagrams.filter((diagram) => diagram.viewKind === kind);
    const categoryImports = kind === "diagram" ? importedDiagrams : [];
    const categoryCount = props.diagrams.filter((diagram) => diagram.viewKind === kind).length;
    const branchCount = categoryBatchIds.length + categoryOrphans.length + Number(categoryImports.length > 0);
    let branchIndex = 0;
    const isLastBranch = () => ++branchIndex === branchCount;
    return (
      <section className="diagram-view-lineage" aria-label={`${label} candidates`} key={kind}>
        <div className="diagram-tree-section-title">
          <strong>{label} · {categoryCount}</strong>
          <span>{description}</span>
        </div>
        {categoryBatchIds.map((batchId) => (
          <Fragment key={batchId}>
            <TreeBridge prefix="" />
            {renderGenerationBatch(batchId, "", isLastBranch())}
          </Fragment>
        ))}
        {categoryOrphans.map((diagram) => (
          <Fragment key={diagram.id}>
            <TreeBridge prefix="" />
            {renderDiagram(diagram, "", isLastBranch())}
          </Fragment>
        ))}
        {categoryImports.length > 0 ? (
          <Fragment>
            <TreeBridge prefix="" />
            {renderImports(isLastBranch())}
          </Fragment>
        ) : null}
        {branchCount === 0 ? <p className="empty-copy">No candidates generated.</p> : null}
      </section>
    );
  };

  return (
    <div className="diagram-lineage-panel">
      <header className="pane-header">
        <div>
          <span className="eyebrow">ARTIFACTS · {props.diagrams.length + props.components.length}</span>
          <h2>Diagram lineage</h2>
        </div>
        <span className="status-pill">{rootBatchIds.length} ROOT {rootBatchIds.length === 1 ? "BATCH" : "BATCHES"}</span>
      </header>
      <div className="diagram-lineage-tree" aria-label="Generated diagram lineage">
        <div className="diagram-tree-set-title">
          <strong>{props.diagramSet.name}</strong>
          <span>{props.diagramSet.generationBatchIds.length} generations</span>
        </div>
        {actionError ? <p className="diagram-tree-error" role="alert">{actionError}</p> : null}
        {viewKinds.map(({ kind, label, description }) => (
          renderViewSection(kind, label, description)
        ))}
        <ComponentLineageSection
          diagramSet={props.diagramSet}
          components={props.components}
          generationBatches={props.generationBatches}
          generationPromptConfigs={props.generationPromptConfigs}
          activeComponentId={props.activeComponentId}
          onSelect={props.onSelectComponent}
          onArchive={props.onArchiveComponent}
          onInspectPrompt={setInspectedConfigId}
        />
      </div>
      {inspectedConfigId && props.generationPromptConfigs[inspectedConfigId] ? (
        <PromptConfigDialog
          config={props.generationPromptConfigs[inspectedConfigId]}
          onClose={() => setInspectedConfigId(null)}
        />
      ) : null}
      {feedbackBatchId && props.diagramCandidateBatches[feedbackBatchId] ? (
        <DiagramCandidateFeedbackDialog
          key={feedbackBatchId}
          batch={props.diagramCandidateBatches[feedbackBatchId]}
          diagrams={props.allDiagrams}
          batchLabel={`B${candidateNumber.get(feedbackBatchId) ?? 0}`}
          onClose={() => setFeedbackBatchId(null)}
          onSave={(rankings) => props.onSaveCandidateRankings(feedbackBatchId, rankings)}
        />
      ) : null}
    </div>
  );
}
