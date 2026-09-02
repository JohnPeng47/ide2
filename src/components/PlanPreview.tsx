import { useEffect, useMemo, useState } from "react";
import { fetchSourceSnippet, type SourceSnippet } from "../api";
import type {
  PlanChange,
  PlanCodeEntityCompactionChange,
  PlanRecord,
  CodeEntityRecord,
  DiagramCodeEntityMapRecord,
  DiagramElementMapping,
  WorkspaceSnapshot
} from "../domain";
import type { ContentPresentation } from "../domainProfile";
import {
  projectPlanCompaction,
  projectPlanDiagram,
  projectPlanDiagramMappings
} from "../plans";
import { presentationForRepresentation } from "../representationPresentation";
import { AsciiSelectionGrid } from "./AsciiSelectionGrid";
import { SourceCodeView } from "./SourceCodeView";
import { TerminalMarkdownView } from "./TerminalMarkdownView";

function PreviewHeader(props: { title: string; detail: string; stale?: boolean }) {
  return (
    <header className="pane-header diagram-pane-header plan-preview__header">
      <div className="diagram-heading">
        <span className="eyebrow">PLAN PREVIEW</span>
        <div className="diagram-heading__title">
          <h2>{props.title}</h2>
          {props.stale ? <span className="plan-preview__stale">[stale]</span> : null}
        </div>
      </div>
      <span className="plan-preview__readonly">READ ONLY · {props.detail}</span>
    </header>
  );
}

export function PlanDiagramPreview(props: {
  workspace: WorkspaceSnapshot;
  plan: PlanRecord;
  change: Extract<PlanChange, { kind: "diagram-modified" | "diagram-added" }>;
  codeEntities: readonly CodeEntityRecord[];
  codeEntityMap?: DiagramCodeEntityMapRecord;
  onRevealCodeEntity?: (mapping: DiagramElementMapping) => void;
}) {
  const projection = useMemo(
    () => projectPlanDiagram(props.workspace, props.plan, props.change),
    [props.change, props.plan, props.workspace]
  );
  const diagram = projection.diagram;
  if (!diagram) {
    return <div className="plan-preview plan-preview--error">{projection.reason}</div>;
  }
  const sourceDiagram = props.change.kind === "diagram-modified"
    ? props.change.baseDiagram
    : undefined;
  const mappings = props.change.kind === "diagram-modified"
    && sourceDiagram
    && props.codeEntityMap?.asciiSha256 === props.change.baseAsciiSha256
    ? projection.stale
      ? props.codeEntityMap.mappings
      : projectPlanDiagramMappings(sourceDiagram.ascii, props.change.patch, props.codeEntityMap.mappings)
    : [];
  const representationKind = diagram.representationKind ?? "diagram";
  return (
    <div className="diagram-panel plan-preview">
      <PreviewHeader
        title={diagram.name}
        detail={props.change.kind === "diagram-added" ? "ADDED DIAGRAM" : "MODIFIED DIAGRAM"}
        stale={projection.stale}
      />
      {projection.reason ? <p className="plan-preview__warning">{projection.reason}</p> : null}
      <div className="ascii-stage">
        <AsciiSelectionGrid
          ascii={diagram.ascii}
          presentation={presentationForRepresentation(representationKind)}
          mode="read"
          mappings={mappings}
          entities={props.codeEntities}
          previewMappingIds={new Set()}
          bufferedReferenceKeys={new Set()}
          highlightedMappingIds={new Set()}
          highlightBusyMappingIds={new Set()}
          overlayReferences={[]}
          partialDiff={props.change.kind === "diagram-modified" ? props.change.semanticDiff : undefined}
          collapseSubtrees={false}
          onLiveSelection={() => undefined}
          onSelectionComplete={() => undefined}
          onReveal={props.onRevealCodeEntity}
        />
      </div>
    </div>
  );
}

function PlanCompactionPreview(props: {
  workspace: WorkspaceSnapshot;
  change: PlanCodeEntityCompactionChange;
  contentPresentation: ContentPresentation;
}) {
  const projection = useMemo(
    () => projectPlanCompaction(props.workspace, props.change),
    [props.change, props.workspace]
  );
  const [preview, setPreview] = useState<SourceSnippet | null>(null);
  const [error, setError] = useState<string | null>(null);
  const rangeIndex = projection.sourceRangeIndex;
  const entity = projection.entity;
  const range = entity && rangeIndex !== undefined ? entity.sourceRanges[rangeIndex] : undefined;

  useEffect(() => {
    let cancelled = false;
    setPreview(null);
    setError(null);
    if (!entity || rangeIndex === undefined) return undefined;
    void fetchSourceSnippet(props.change.diagramSetId, entity.id, rangeIndex)
      .then((next) => { if (!cancelled) setPreview(next); })
      .catch((caught) => {
        if (!cancelled) setError(caught instanceof Error ? caught.message : "source preview failed");
      });
    return () => { cancelled = true; };
  }, [entity, props.change.diagramSetId, rangeIndex]);

  return (
    <div className="diagram-panel plan-preview">
      <PreviewHeader
        title={entity?.label ?? props.change.label}
        detail="CODE ENTITY COMPACTION"
        stale={projection.stale}
      />
      {projection.reason ? <p className="plan-preview__warning">{projection.reason}</p> : null}
      {error ? <p className="source-state inline-error">{error}</p> : null}
      {!preview && !error ? <p className="source-state">Loading source...</p> : null}
      {preview && range ? (
        <div className="plan-preview__source">
          <SourceCodeView
            preview={preview}
            range={range}
            compacted={Boolean(range.compactedSource)}
            presentation={props.contentPresentation}
          />
        </div>
      ) : null}
    </div>
  );
}

export function PlanCorpusPreview(props: {
  workspace: WorkspaceSnapshot;
  plan: PlanRecord;
  change?: PlanCodeEntityCompactionChange;
  contentPresentation: ContentPresentation;
}) {
  if (!props.change) {
    return (
      <div className="diagram-panel plan-preview plan-preview--markdown">
        <PreviewHeader title={props.plan.title} detail="PLAN MARKDOWN" />
        <div className="plan-preview__markdown">
          <TerminalMarkdownView
            source={props.plan.markdown}
            path={`plans/${props.plan.id}/plan.md`}
          />
        </div>
      </div>
    );
  }
  return (
    <PlanCompactionPreview
      workspace={props.workspace}
      change={props.change}
      contentPresentation={props.contentPresentation}
    />
  );
}
