import { CodeEntitiesPanel, type CodeEntityReveal } from "../../../shared/source/CodeEntitiesPanel";
import type {
  CodeEntitiesSetRecord,
  DiagramCandidateBatchRecord,
  DiagramComponentRecord,
  DiagramModelId,
  DiagramRecord,
  DiagramSetRecord,
  EditSessionRecord,
  GenerationBatchRecord,
  GenerationPromptConfigRecord
} from "../../../../domain/core/records/domain";
import { DEFAULT_DIAGRAM_MODEL_ID } from "../../../../domain/core/records/domain";
import type { ContentPresentation } from "../../../../domain/core/profiles/domainProfile";
import type { RepresentationFeedbackTarget, RepresentationGraphRecord } from "../../../../domain/core/representations/representationGraph";
import type { TerminalMarkdownOutline } from "../../../shared/markdown/toc";
import { DiagramLineagePanel } from "./DiagramLineagePanel";
import { EditOperationsPanel } from "../editing/EditOperationsPanel";
import { RepresentationLayersPanel } from "./RepresentationLayersPanel";

export type ContextTab = "code-entities" | "diagrams" | "layers" | "operations";

export function DiagramContextPanel(props: {
  setId: string;
  codeEntities: CodeEntitiesSetRecord;
  contentPresentation: ContentPresentation;
  diagramSet: DiagramSetRecord;
  diagrams: DiagramRecord[];
  allDiagrams: Record<string, DiagramRecord>;
  components: DiagramComponentRecord[];
  generationBatches: Record<string, GenerationBatchRecord>;
  diagramCandidateBatches: Record<string, DiagramCandidateBatchRecord>;
  generationPromptConfigs: Record<string, GenerationPromptConfigRecord>;
  activeDiagram?: DiagramRecord;
  activeComponent?: DiagramComponentRecord;
  editSession?: EditSessionRecord;
  representationGraph?: RepresentationGraphRecord;
  representationFeedbackBusy?: boolean;
  onRepresentationFeedback?: (
    target: RepresentationFeedbackTarget,
    comment: string
  ) => Promise<void>;
  editPrompt?: string;
  editModelId?: DiagramModelId;
  markerMode?: boolean;
  editBusy?: boolean;
  editProgress?: string;
  editError?: string | null;
  codeEntityReveal?: CodeEntityReveal;
  onMarkdownOutlineChange?: (outline: (TerminalMarkdownOutline & { path: string }) | null) => void;
  onMarkdownActiveSectionChange?: (section: {
    path: string;
    id: string;
    line: number;
    scrollTop: number;
  }) => void;
  selectedIds?: Set<string>;
  onToggleEntity?: (id: string) => void;
  activeTab: ContextTab;
  onSelectDiagram: (diagramId: string) => void;
  onSelectComponent: (componentId: string) => void;
  onRenameDiagram: (diagramId: string, name: string) => Promise<void>;
  onArchiveDiagram: (diagramId: string) => Promise<void>;
  onArchiveComponent: (componentId: string) => Promise<void>;
  onSaveCandidateRankings: (
    candidateBatchId: string,
    rankings: Array<{ diagramId: string; rank: number }>
  ) => Promise<void>;
  onEditPrompt?: (value: string) => void;
  onEditModel?: (value: DiagramModelId) => void;
  onMarkerMode?: (value: boolean) => void;
  onUndoEdit?: () => void;
  onRedoEdit?: () => void;
  onLlmEdit?: () => void;
  onFinishEdit?: () => void;
  onDiscardEdit?: () => void;
}) {
  return (
    <div className="diagram-context-panel">
      {props.activeTab === "operations" && props.editSession ? (
        <div className="context-tabpanel">
          <EditOperationsPanel
            session={props.editSession}
            prompt={props.editPrompt ?? ""}
            modelId={props.editModelId ?? DEFAULT_DIAGRAM_MODEL_ID}
            markerMode={Boolean(props.markerMode)}
            busy={Boolean(props.editBusy)}
            progress={props.editProgress ?? ""}
            error={props.editError ?? null}
            onPrompt={(value) => props.onEditPrompt?.(value)}
            onModel={(value) => props.onEditModel?.(value)}
            onMarkerMode={(value) => props.onMarkerMode?.(value)}
            onUndo={() => props.onUndoEdit?.()}
            onRedo={() => props.onRedoEdit?.()}
            onLlmEdit={() => props.onLlmEdit?.()}
            onFinish={() => props.onFinishEdit?.()}
            onDiscard={() => props.onDiscardEdit?.()}
          />
        </div>
      ) : props.activeTab === "layers" && props.representationGraph ? (
        <div className="context-tabpanel">
          <RepresentationLayersPanel
            graph={props.representationGraph}
            busy={props.representationFeedbackBusy}
            onFeedback={(target, comment) => props.onRepresentationFeedback?.(target, comment)
              ?? Promise.reject(new Error("representation feedback is unavailable"))}
          />
        </div>
      ) : props.activeTab === "code-entities" ? (
        <div className="context-tabpanel">
          <CodeEntitiesPanel
            setId={props.setId}
            codeEntities={props.codeEntities}
            contentPresentation={props.contentPresentation}
            diagram={props.activeDiagram ?? props.activeComponent}
            selectedIds={props.selectedIds}
            onToggle={props.onToggleEntity}
            reveal={props.codeEntityReveal}
            onMarkdownOutlineChange={props.onMarkdownOutlineChange}
            onMarkdownActiveSectionChange={props.onMarkdownActiveSectionChange}
          />
        </div>
      ) : (
        <div className="context-tabpanel">
          <DiagramLineagePanel
            diagramSet={props.diagramSet}
            diagrams={props.diagrams}
            allDiagrams={props.allDiagrams}
            components={props.components}
            generationBatches={props.generationBatches}
            diagramCandidateBatches={props.diagramCandidateBatches}
            generationPromptConfigs={props.generationPromptConfigs}
            activeDiagramId={props.activeDiagram?.id}
            activeComponentId={props.activeComponent?.id}
            onSelect={props.onSelectDiagram}
            onSelectComponent={props.onSelectComponent}
            onRename={props.onRenameDiagram}
            onArchive={props.onArchiveDiagram}
            onArchiveComponent={props.onArchiveComponent}
            onSaveCandidateRankings={props.onSaveCandidateRankings}
          />
        </div>
      )}
    </div>
  );
}
