import { useMemo, useState } from "react";
import {
  orderRepresentationLayers,
  type RepresentationFeedbackTarget,
  type RepresentationGraphRecord
} from "../representationGraph";

export function RepresentationLayersPanel(props: {
  graph: RepresentationGraphRecord;
  busy?: boolean;
  onFeedback: (target: RepresentationFeedbackTarget, comment: string) => Promise<void>;
}) {
  const layers = useMemo(() => orderRepresentationLayers(props.graph), [props.graph]);
  const [comments, setComments] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const submit = async (target: RepresentationFeedbackTarget, key: string) => {
    const comment = comments[key]?.trim() ?? "";
    if (!comment) return;
    setError(null);
    try {
      await props.onFeedback(target, comment);
      setComments((current) => ({ ...current, [key]: "" }));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "feedback could not be saved");
    }
  };
  return (
    <section className="representation-layers-panel" aria-label="Representation layers">
      <header>
        <strong>REPRESENTATION LAYERS</strong>
        <span>{layers.length} LEVELS</span>
      </header>
      <ol>
        {layers.map((layer) => {
          const incoming = props.graph.transitions.filter((transition) => transition.toLayerId === layer.id);
          return (
            <li key={layer.id} data-layer-id={layer.id}>
              <div className="representation-layer-card">
                <span className="eyebrow">L{layer.informationRank + 1} · {layer.representationKind}</span>
                <strong>{layer.label}</strong>
                <code>{layer.artifactRevision.artifactId}</code>
              </div>
              {incoming.map((transition) => {
                const key = `transition:${transition.id}`;
                return (
                  <div className="representation-transition-feedback" key={transition.id}>
                    <label htmlFor={`feedback-${transition.id}`}>Feedback for the transition into this layer</label>
                    <textarea
                      id={`feedback-${transition.id}`}
                      value={comments[key] ?? ""}
                      disabled={props.busy}
                      onChange={(event) => setComments((current) => ({
                        ...current,
                        [key]: event.target.value
                      }))}
                    />
                    <button
                      type="button"
                      disabled={props.busy || !(comments[key]?.trim())}
                      onClick={() => void submit({ kind: "transition", transitionId: transition.id }, key)}
                    >Save feedback</button>
                  </div>
                );
              })}
            </li>
          );
        })}
      </ol>
      {error ? <p className="inline-error" role="alert">{error}</p> : null}
    </section>
  );
}
