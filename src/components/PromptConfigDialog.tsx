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
            <div><dt>OUTPUT</dt><dd>{props.config.outputKind}</dd></div>
            <div><dt>MODEL</dt><dd>{props.config.modelId}</dd></div>
            <div><dt>STYLE</dt><dd>{props.config.systemPrompt.profileId}</dd></div>
            <div><dt>CONFIG</dt><dd>{props.config.id}</dd></div>
          </dl>
          <section>
            <h3>Instruction</h3>
            <pre>{props.config.instruction || "(default instruction)"}</pre>
          </section>
          <section>
            <h3>References</h3>
            {props.config.references.length > 0 ? (
              <ul>{props.config.references.map((reference) => (
                <li key={`${reference.kind}:${reference.targetId}`}>
                  <code>{reference.token}</code>
                  <span>{reference.kind}</span>
                </li>
              ))}</ul>
            ) : <p>none</p>}
          </section>
          <details>
            <summary>Rendered context prompt</summary>
            <pre>{props.config.contextPrompt.rendered}</pre>
          </details>
          <details>
            <summary>Rendered system prompt</summary>
            <pre>{props.config.systemPrompt.rendered}</pre>
          </details>
        </div>
      </section>
    </div>
  );
}
