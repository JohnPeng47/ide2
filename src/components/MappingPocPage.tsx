import { DraggableDiagramCanvas } from "./DraggableDiagramCanvas";
import { MappingPocSelectionCanvas } from "./MappingPocSelectionCanvas";
import {
  MAPPING_POC_GRAPH_A_LINE_COUNT,
  MAPPING_POC_GRAPH_B_LINE_COUNT
} from "../mappingPoc";

export function MappingPocPage(props: {
  onStudio: () => void;
  onExperiments: () => void;
}) {
  return (
    <main className="mapping-poc-shell">
      <header className="studio-header mapping-poc-header">
        <div className="brand">
          <span className="brand-mark">ND</span>
          <div><h1>NEW DIAGRAM</h1><p>representation mapping POC</p></div>
        </div>
        <nav className="screen-tabs" aria-label="Application pages">
          <button type="button" onClick={props.onStudio}>STUDIO</button>
          <button type="button" onClick={props.onExperiments}>EXPERIMENTS</button>
          <button type="button" className="is-active" aria-current="page">MAPPING</button>
        </nav>
      </header>

      <section className="mapping-poc-workspace">
        <header className="mapping-poc-toolbar">
          <div>
            <span className="eyebrow">GRAPH A · OVERVIEW</span>
            <h2>C7. Offline prompt-control experiments and curated datasets</h2>
          </div>
          <div className="mapping-poc-contract" aria-label="Proof of concept graph line counts">
            <span><strong>A</strong>{MAPPING_POC_GRAPH_A_LINE_COUNT} lines</span>
            <span><strong>B</strong>{MAPPING_POC_GRAPH_B_LINE_COUNT} lines</span>
          </div>
        </header>

        <DraggableDiagramCanvas
          className="mapping-poc-canvas"
          enabled
          resetKey="mapping-poc-graph-a-v1"
        >
          <MappingPocSelectionCanvas />
        </DraggableDiagramCanvas>

        <footer className="mapping-poc-status">
          <span>POC PAIR A → B</span>
          <span>drag over A to select · drag empty canvas to pan · Ctrl+B focuses actions</span>
        </footer>
      </section>
    </main>
  );
}
