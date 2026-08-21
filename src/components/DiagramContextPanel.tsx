import type {
  CodeEntitiesSetRecord,
  DiagramComponentRecord,
  DiagramRecord,
  DiagramSetRecord,
  DiagramModelId,
  EditSessionRecord,
  GenerationBatchRecord,
  GenerationPromptConfigRecord
} from "../domain";
import { DEFAULT_DIAGRAM_MODEL_ID } from "../domain";
import { CodeEntitiesPanel, type CodeEntityReveal } from "./CodeEntitiesPanel";
import { DiagramLineagePanel } from "./DiagramLineagePanel";
import { EditOperationsPanel } from "./EditOperationsPanel";

export type ContextTab = "code-entities" | "diagrams" | "operations";

export function DiagramContextPanel(props: {
  setId: string;
  codeEntities: CodeEntitiesSetRecord;
  diagramSet: DiagramSetRecord;
  diagrams: DiagramRecord[];
  components: DiagramComponentRecord[];
  generationBatches: Record<string, GenerationBatchRecord>;
  generationPromptConfigs: Record<string, GenerationPromptConfigRecord>;
  activeDiagram?: DiagramRecord;
  activeComponent?: DiagramComponentRecord;
  editSession?: EditSessionRecord;
  editPrompt?: string;
  editModelId?: DiagramModelId;
  markerMode?: boolean;
  editBusy?: boolean;
  editProgress?: string;
  editError?: string | null;
  codeEntityReveal?: CodeEntityReveal;
  selectedIds?: Set<string>;
  onToggleEntity?: (id: string) => void;
  activeTab: ContextTab;
  onTab: (tab: ContextTab) => void;
  onSelectDiagram: (diagramId: string) => void;
  onSelectComponent: (componentId: string) => void;
  onRenameDiagram: (diagramId: string, name: string) => Promise<void>;
  onArchiveDiagram: (diagramId: string) => Promise<void>;
  onArchiveComponent: (componentId: string) => Promise<void>;
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
      <div className="context-tabs" role="tablist" aria-label="Diagram context">
        <button
          type="button"
          id="code-entities-tab"
          role="tab"
          aria-selected={props.activeTab === "code-entities"}
          aria-controls="code-entities-panel"
          className={props.activeTab === "code-entities" ? "is-active" : ""}
          onClick={() => props.onTab("code-entities")}
        >
          Code Entities
        </button>
        <button
          type="button"
          id="diagrams-tab"
          role="tab"
          aria-selected={props.activeTab === "diagrams"}
          aria-controls="diagrams-panel"
          className={props.activeTab === "diagrams" ? "is-active" : ""}
          onClick={() => props.onTab("diagrams")}
        >
          Diagrams
        </button>
        {props.editSession ? (
          <button
            type="button"
            id="operations-tab"
            role="tab"
            aria-selected={props.activeTab === "operations"}
            aria-controls="operations-panel"
            className={props.activeTab === "operations" ? "is-active" : ""}
            onClick={() => props.onTab("operations")}
          >
            Operations · {props.editSession.operationCursor}
          </button>
        ) : null}
      </div>
      {props.activeTab === "operations" && props.editSession ? (
        <div
          className="context-tabpanel"
          id="operations-panel"
          role="tabpanel"
          aria-labelledby="operations-tab"
        >
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
      ) : props.activeTab === "code-entities" ? (
        <div
          className="context-tabpanel"
          id="code-entities-panel"
          role="tabpanel"
          aria-labelledby="code-entities-tab"
        >
          <CodeEntitiesPanel
            setId={props.setId}
            codeEntities={props.codeEntities}
            diagram={props.activeDiagram ?? props.activeComponent}
            selectedIds={props.selectedIds}
            onToggle={props.onToggleEntity}
            reveal={props.codeEntityReveal}
          />
        </div>
      ) : (
        <div
          className="context-tabpanel"
          id="diagrams-panel"
          role="tabpanel"
          aria-labelledby="diagrams-tab"
        >
          <DiagramLineagePanel
            diagramSet={props.diagramSet}
            diagrams={props.diagrams}
            components={props.components}
            generationBatches={props.generationBatches}
            generationPromptConfigs={props.generationPromptConfigs}
            activeDiagramId={props.activeDiagram?.id}
            activeComponentId={props.activeComponent?.id}
            onSelect={props.onSelectDiagram}
            onSelectComponent={props.onSelectComponent}
            onRename={props.onRenameDiagram}
            onArchive={props.onArchiveDiagram}
            onArchiveComponent={props.onArchiveComponent}
          />
        </div>
      )}
    </div>
  );
}
