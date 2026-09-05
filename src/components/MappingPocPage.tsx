import { useState } from "react";
import { UiTestFramework } from "@new-diagram/ui-test-framework";
import { DraggableDiagramCanvas } from "./DraggableDiagramCanvas";
import { MappingPocSelectionCanvas } from "./MappingPocSelectionCanvas";
import {
  MAPPING_POC_GRAPH_A_LINE_COUNT,
  MAPPING_POC_GRAPH_B_LINE_COUNT
} from "../mappingPoc";
import type { LocalChatVariant } from "../localChat";

const LOCAL_CHAT_UI_CONTROLS = {
  variant: {
    type: "select",
    label: "Local chat UI",
    description: "Compare the compact popover, floating window, and docked panel.",
    defaultValue: "compact",
    options: [
      { value: "compact", label: "Compact popover" },
      { value: "floating", label: "Floating window" },
      { value: "docked", label: "Docked panel" }
    ]
  },
  replyDelayMs: {
    type: "range",
    label: "Mock reply delay",
    description: "Simulates time spent waiting for the language model.",
    defaultValue: 350,
    min: 0,
    max: 1600,
    step: 100
  },
  placementGuide: {
    type: "toggle",
    label: "Placement hint",
    description: "Show the click-to-place instruction over the canvas.",
    defaultValue: true
  }
} as const;

export function MappingPocPage(props: {
  onStudio: () => void;
  onExperiments: () => void;
}) {
  const [graphALineCount, setGraphALineCount] = useState(MAPPING_POC_GRAPH_A_LINE_COUNT);
  return (
    <UiTestFramework
      id="mapping-local-chat"
      title="Local chat variants"
      controls={LOCAL_CHAT_UI_CONTROLS}
    >
      {(ui) => (
        <main className="mapping-poc-shell" data-local-chat-variant={ui.variant}>
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
                <h2>Current LLM prompt stack</h2>
              </div>
              <div className="mapping-poc-contract" aria-label="Proof of concept graph line counts">
                <span><strong>A</strong>{graphALineCount} lines</span>
                <span><strong>B</strong>{MAPPING_POC_GRAPH_B_LINE_COUNT} lines</span>
              </div>
            </header>

            <DraggableDiagramCanvas
              className="mapping-poc-canvas"
              enabled
              resetKey="mapping-poc-graph-a-v2"
            >
              <MappingPocSelectionCanvas
                onLineCountChange={setGraphALineCount}
                localChatVariant={ui.variant as LocalChatVariant}
                mockReplyDelayMs={ui.replyDelayMs}
                showPlacementGuide={ui.placementGuide}
              />
            </DraggableDiagramCanvas>

            <footer className="mapping-poc-status">
              <span>POC PAIR A → B</span>
              <span>drag over A to select · N opens mapped · P patches · A asks locally</span>
            </footer>
          </section>
        </main>
      )}
    </UiTestFramework>
  );
}
