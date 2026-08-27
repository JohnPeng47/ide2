import type { GenerationPromptConfigRecord } from "../domain";

export function PromptConfigDialog(props: {
  config: GenerationPromptConfigRecord;
  onClose: () => void;
}) {
  return (
    <div className="prompt-config-backdrop" role="presentation" onMouseDown={(event) => {
      if (event.target === event.currentTarget) props.onClose();
    }}>
      <section
        className="prompt-config-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="prompt-config-title"
      >
        <header>
          <div>
            <span className="eyebrow">GENERATION PROMPT</span>
            <h2 id="prompt-config-title">Immutable prompt config</h2>
          </div>
          <button type="button" aria-label="Close prompt details" onClick={props.onClose}>close</button>
        </header>
        <div className="prompt-config-body">
          <dl>
            <div><dt>OUTPUT</dt><dd>{props.config.viewKind ?? props.config.outputKind}</dd></div>
            <div><dt>MODEL</dt><dd>{props.config.modelId}</dd></div>
            <div><dt>STYLE</dt><dd>{props.config.systemPrompt.profileId}</dd></div>
            <div><dt>CONFIG</dt><dd>{props.config.id}</dd></div>
            {props.config.derivation ? (
              <div><dt>DERIVED FROM</dt><dd>{props.config.derivation.sourceArtifactId}</dd></div>
            ) : null}
          </dl>
          <section>
            <h3>Instruction</h3>
            <pre>{props.config.instruction || "(default instruction)"}</pre>
          </section>
          {props.config.referencePrompt ? (
            <section>
              <h3>Reference follow-up</h3>
              <pre>{props.config.referencePrompt.instruction}</pre>
              {props.config.referencePrompt.references.length > 0 ? (
                <ul>{props.config.referencePrompt.references.map((reference) => (
                  <li key={`follow-up:${reference.kind}:${reference.targetId}`}>
                    <code>{reference.token}</code>
                    <span>{reference.kind} · included in follow-up</span>
                  </li>
                ))}</ul>
              ) : <p>no resolved references</p>}
            </section>
          ) : null}
          <section>
            <h3>References</h3>
            {props.config.references.length > 0 ? (
              <ul>{props.config.references.map((reference) => (
                <li key={`${reference.kind}:${reference.targetId}`}>
                  <code>{reference.token}</code>
                  <span>{reference.kind} · included</span>
                </li>
              ))}</ul>
            ) : <p>none</p>}
            {(props.config.omittedReferences?.length ?? 0) > 0 ? (
              <ul>{props.config.omittedReferences!.map((reference) => (
                <li key={`omitted:${reference.kind}:${reference.targetId}`}>
                  <code>{reference.token}</code>
                  <span>{reference.kind} · omitted</span>
                </li>
              ))}</ul>
            ) : null}
          </section>
          {props.config.systemPrompt.references?.length ? (
            <section>
              <h3>System template references</h3>
              <ul>{props.config.systemPrompt.references.map((reference) => (
                <li key={`system:${reference.kind}:${reference.targetId}`}>
                  <code>{reference.token}</code>
                  <span>{reference.kind} · supplied by prompt template</span>
                </li>
              ))}</ul>
            </section>
          ) : null}
          <details>
            <summary>Rendered context prompt</summary>
            <pre>{props.config.contextPrompt.rendered}</pre>
          </details>
          <details>
            <summary>Rendered system prompt</summary>
            <pre>{props.config.systemPrompt.rendered}</pre>
          </details>
          {props.config.referencePrompt ? (
            <details>
              <summary>Rendered reference follow-up prompt</summary>
              <pre>{props.config.referencePrompt.rendered}</pre>
            </details>
          ) : null}
        </div>
      </section>
    </div>
  );
}
