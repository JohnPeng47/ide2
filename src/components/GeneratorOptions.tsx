import { useMemo, useRef, useState } from "react";
import type {
  CodeEntitiesSetRecord,
  DiagramModelId,
  DiagramComponentRecord,
  DiagramRecord,
  GenerationOutputKind,
  GenerationPromptReference,
  GenerationPromptProfileId
} from "../domain";
import { ModelSelector } from "./ModelSelector";
import { PromptProfileSelector } from "./PromptProfileSelector";
import { promptOptions } from "../prompt";

export function GeneratorOptions(props: {
  codeEntities: CodeEntitiesSetRecord;
  diagrams: DiagramRecord[];
  components: DiagramComponentRecord[];
  outputKind: GenerationOutputKind;
  modelId: DiagramModelId;
  promptProfileId: GenerationPromptProfileId;
  historicalReferences: GenerationPromptReference[];
  prompt: string;
  count: number;
  generating: boolean;
  progress: string;
  error: string | null;
  onPrompt: (value: string) => void;
  onCount: (value: number) => void;
  onOutputKind: (value: GenerationOutputKind) => void;
  onModel: (value: DiagramModelId) => void;
  onPromptProfile: (value: GenerationPromptProfileId) => void;
  onGenerate: () => void;
}) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const [mentionQuery, setMentionQuery] = useState<string | null>(null);
  const options = useMemo(
    () => promptOptions(props.codeEntities, props.diagrams, props.components),
    [props.codeEntities, props.diagrams, props.components]
  );
  const suggestions = mentionQuery === null ? [] : options.filter((option) => (
    option.token.toLowerCase().includes(mentionQuery.toLowerCase())
    || option.label.toLowerCase().includes(mentionQuery.toLowerCase().replace(/^@/, ""))
  )).slice(0, 8);
  const optionTokens = new Set(options.map((option) => option.token.toLowerCase()));
  const optionKeys = new Set(options.map((option) => `${option.kind}:${option.id}`));
  const unresolvedMentions = [...new Set(
    [...props.prompt.matchAll(/@(entity|diagram|component)\/[a-z0-9][a-z0-9-]*/gi)]
      .map((match) => match[0])
      .filter((token) => !optionTokens.has(token.toLowerCase()))
  )];
  const unresolvedHistoricalReferences = props.historicalReferences
    .filter((reference) => props.prompt.includes(reference.token))
    .filter((reference) => !optionKeys.has(`${reference.kind}:${reference.targetId}`))
    .map((reference) => reference.token);
  const unresolvedReferences = [...new Set([
    ...unresolvedHistoricalReferences,
    ...unresolvedMentions
  ])];

  const updatePrompt = (value: string, cursor: number) => {
    props.onPrompt(value);
    const before = value.slice(0, cursor);
    const match = before.match(/@[a-z0-9\/-]*$/i);
    setMentionQuery(match?.[0] ?? null);
  };

  const insertMention = (token: string) => {
    const textarea = textareaRef.current;
    const cursor = textarea?.selectionStart ?? props.prompt.length;
    const before = props.prompt.slice(0, cursor);
    const match = before.match(/@[a-z0-9\/-]*$/i);
    const start = match ? cursor - match[0].length : cursor;
    const next = `${props.prompt.slice(0, start)}${token} ${props.prompt.slice(cursor)}`;
    props.onPrompt(next);
    setMentionQuery(null);
    requestAnimationFrame(() => {
      const nextCursor = start + token.length + 1;
      textarea?.focus();
      textarea?.setSelectionRange(nextCursor, nextCursor);
    });
  };

  return (
    <div className="generator-panel">
      <header className="pane-header">
        <div>
          <span className="eyebrow">GENERATION VIEW</span>
          <h2>{props.outputKind === "diagram" ? "Create diagram variants" : "Create component variants"}</h2>
        </div>
        <span className="agent-count">N AGENTS · {props.count} OUTPUTS</span>
      </header>

      <div className="output-kind" role="radiogroup" aria-label="Generated output type">
        <span className="eyebrow">OUTPUT</span>
        <button
          type="button"
          role="radio"
          aria-checked={props.outputKind === "diagram"}
          className={props.outputKind === "diagram" ? "is-active" : ""}
          disabled={props.generating}
          onClick={() => props.onOutputKind("diagram")}
        >Diagram</button>
        <button
          type="button"
          role="radio"
          aria-checked={props.outputKind === "diagram-component"}
          className={props.outputKind === "diagram-component" ? "is-active" : ""}
          disabled={props.generating}
          onClick={() => props.onOutputKind("diagram-component")}
        >DiagramComponent</button>
      </div>
      <div className="prompt-field">
        <div className="generation-prompt-heading">
          <label htmlFor="diagram-prompt">GENERATION INSTRUCTION</label>
          <span className="generation-prompt-selectors">
            <PromptProfileSelector
              id="generation-prompt-profile"
              value={props.promptProfileId}
              disabled={props.generating}
              onChange={props.onPromptProfile}
            />
            <ModelSelector
              id="generation-model"
              value={props.modelId}
              disabled={props.generating}
              onChange={props.onModel}
            />
          </span>
        </div>
        <textarea
          ref={textareaRef}
          id="diagram-prompt"
          value={props.prompt}
          disabled={props.generating}
          placeholder="Use @ to reference a CodeEntity, Diagram, or DiagramComponent…"
          spellCheck={false}
          onChange={(event) => updatePrompt(event.target.value, event.target.selectionStart)}
          onClick={(event) => updatePrompt(event.currentTarget.value, event.currentTarget.selectionStart)}
          onKeyUp={(event) => updatePrompt(event.currentTarget.value, event.currentTarget.selectionStart)}
        />
        {suggestions.length > 0 ? (
          <div className="mention-menu" role="listbox" aria-label="Prompt references">
            {suggestions.map((option) => (
              <button type="button" role="option" key={`${option.kind}:${option.id}`} onClick={() => insertMention(option.token)}>
                <code>{option.token}</code><span>{option.label}</span>
              </button>
            ))}
          </div>
        ) : null}
        <p className="field-help">Type @ for entity, diagram, and component references. Selected entities are included even without an explicit mention.</p>
        {unresolvedReferences.length > 0 ? (
          <p className="unresolved-references" role="status">
            Unresolved historical references: {unresolvedReferences.join(", ")}
          </p>
        ) : null}
      </div>

      <div className="generation-controls">
        <div className="counter">
          <span className="eyebrow">PARALLEL AGENTS</span>
          <div>
            <button
              type="button"
              aria-label="Use one fewer agent"
              disabled={props.generating || props.count <= 1}
              onClick={() => props.onCount(Math.max(1, props.count - 1))}
            >−</button>
            <output aria-live="polite">{props.count}</output>
            <button
              type="button"
              aria-label="Use one more agent"
              disabled={props.generating || props.count >= 12}
              onClick={() => props.onCount(Math.min(12, props.count + 1))}
            >+</button>
          </div>
        </div>
        <button
          type="button"
          className="button button--primary generate-action"
          disabled={props.generating}
          onClick={props.onGenerate}
        >
          {props.generating
            ? `running ${props.count} agents…`
            : `generate ${props.count} ${props.outputKind === "diagram" ? "diagrams" : "components"} →`}
        </button>
      </div>

      {props.progress ? <p className="run-progress" aria-live="polite"><span />{props.progress}</p> : null}
      {props.error ? <p className="inline-error" role="alert">{props.error}</p> : null}
    </div>
  );
}
