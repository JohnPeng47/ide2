import { useState } from "react";
import type {
  CodeEntitiesSetRecord,
  DiagramRecord,
  DiagramSetRecord,
  GenerationBatchRecord
} from "../domain";
import { CodeEntitiesPanel } from "./CodeEntitiesPanel";
import { DiagramLineagePanel } from "./DiagramLineagePanel";

type ContextTab = "code-entities" | "diagrams";

export function DiagramContextPanel(props: {
  setId: string;
  codeEntities: CodeEntitiesSetRecord;
  diagramSet: DiagramSetRecord;
  diagrams: DiagramRecord[];
  generationBatches: Record<string, GenerationBatchRecord>;
  activeDiagram: DiagramRecord;
  onSelectDiagram: (diagramId: string) => void;
  onRenameDiagram: (diagramId: string, name: string) => Promise<void>;
  onArchiveDiagram: (diagramId: string) => Promise<void>;
}) {
  const [activeTab, setActiveTab] = useState<ContextTab>("code-entities");
  return (
    <div className="diagram-context-panel">
      <div className="context-tabs" role="tablist" aria-label="Diagram context">
        <button
          type="button"
          id="code-entities-tab"
          role="tab"
          aria-selected={activeTab === "code-entities"}
          aria-controls="code-entities-panel"
          className={activeTab === "code-entities" ? "is-active" : ""}
          onClick={() => setActiveTab("code-entities")}
        >
          Code Entities
        </button>
        <button
          type="button"
          id="diagrams-tab"
          role="tab"
          aria-selected={activeTab === "diagrams"}
          aria-controls="diagrams-panel"
          className={activeTab === "diagrams" ? "is-active" : ""}
          onClick={() => setActiveTab("diagrams")}
        >
          Diagrams
        </button>
      </div>
      {activeTab === "code-entities" ? (
        <div
          className="context-tabpanel"
          id="code-entities-panel"
          role="tabpanel"
          aria-labelledby="code-entities-tab"
        >
          <CodeEntitiesPanel
            setId={props.setId}
            codeEntities={props.codeEntities}
            diagram={props.activeDiagram}
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
            generationBatches={props.generationBatches}
            activeDiagramId={props.activeDiagram.id}
            onSelect={props.onSelectDiagram}
            onRename={props.onRenameDiagram}
            onArchive={props.onArchiveDiagram}
          />
        </div>
      )}
    </div>
  );
}
