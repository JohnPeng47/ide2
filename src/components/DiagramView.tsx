import type { DiagramRecord } from "../domain";

export function DiagramView(props: {
  active: DiagramRecord;
  onDerive: (diagram: DiagramRecord) => void;
}) {
  return (
    <div className="diagram-panel">
      <header className="pane-header">
        <div>
          <span className="eyebrow">DIAGRAM VIEW</span>
          <h2>{props.active.name}</h2>
        </div>
        <button type="button" className="button" onClick={() => props.onDerive(props.active)}>
          create derivative →
        </button>
      </header>
      <div className="ascii-stage">
        <pre>{props.active.ascii}</pre>
      </div>
      <footer className="diagram-meta">
        <code>@diagram/{props.active.handle}</code>
        <span>{props.active.codeEntityIds.length} code entities</span>
        <span>{props.active.derivedFromDiagramIds.length ? "DERIVATIVE" : "ROOT"}</span>
      </footer>
    </div>
  );
}
