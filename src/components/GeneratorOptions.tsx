import { useMemo, useRef, useState } from "react";
import type {
  CodeEntitiesSetRecord,
  CodeEntityRecord,
  DiagramModelId,
  DiagramComponentRecord,
  DiagramRecord,
  GenerationTargetKind,
  GenerationPromptProfileId,
  PromptReference,
  SystemPromptTemplateRecord
} from "../domain";
import type { DiagramReferenceMention } from "../derivativePrompt";
import { ModelSelector } from "./ModelSelector";
import { PromptProfileSelector } from "./PromptProfileSelector";
import { promptOptions } from "../prompt";

export function GeneratorOptions(props: {
  codeEntities: CodeEntitiesSetRecord;
  diagrams: DiagramRecord[];
  components: DiagramComponentRecord[];
  targetKind: GenerationTargetKind;
  foundationDiagram?: DiagramRecord;
  companionCallGraph?: DiagramRecord;
  immutableCodeEntities: CodeEntityRecord[];
  foundationRepositoryPaths: string[];
  modelId: DiagramModelId;
  promptProfileId: GenerationPromptProfileId;
  promptProfiles: SystemPromptTemplateRecord[];
  historicalReferences: PromptReference[];
  diagramReferences: DiagramReferenceMention[];
  excludedReferenceKeys: Set<string>;
  derivativeSourceReferenceKey?: string;
  prompt: string;
  count: number;
  generating: boolean;
  progress: string;
  error: string | null;
  backLabel?: string;
  onBack?: () => void;
  onPrompt: (value: string) => void;
  onToggleDiagramReference: (key: string) => void;
  onCount: (value: number) => void;
  onTargetKind: (value: GenerationTargetKind) => void;
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
  const auxiliary = props.targetKind === "call-graph" || props.targetKind === "dir-view";
  const auxiliaryReady = Boolean(props.foundationDiagram)
    && (props.targetKind !== "dir-view" || Boolean(props.companionCallGraph));
  const targetLabel = props.targetKind === "diagram-component"
    ? "component"
    : props.targetKind === "call-graph"
      ? "call graph"
      : props.targetKind === "dir-view"
        ? "directory view"
        : "diagram";

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
          <h2>Create {targetLabel} variants</h2>
        </div>
        <div className="generation-pane-actions">
          {props.onBack ? (
            <button
              type="button"
              className="button generation-back"
              disabled={props.generating}
              onClick={props.onBack}
            >← {props.backLabel ?? "back"}</button>
          ) : null}
          <span className="agent-count">N AGENTS · {props.count} OUTPUTS</span>
        </div>
      </header>

      <div className="output-kind" role="radiogroup" aria-label="Generated output type">
        <span className="eyebrow">OUTPUT</span>
        <button
          type="button"
          role="radio"
          aria-checked={props.targetKind === "diagram"}
          className={props.targetKind === "diagram" ? "is-active" : ""}
          disabled={props.generating}
          onClick={() => props.onTargetKind("diagram")}
        >Diagram</button>
        <button
          type="button"
          role="radio"
          aria-checked={props.targetKind === "call-graph"}
          className={props.targetKind === "call-graph" ? "is-active" : ""}
          disabled={props.generating || !props.foundationDiagram}
          title={props.foundationDiagram ? undefined : "Star a main Diagram first"}
          onClick={() => props.onTargetKind("call-graph")}
        >Call Graph</button>
        <button
          type="button"
          role="radio"
          aria-checked={props.targetKind === "dir-view"}
          className={props.targetKind === "dir-view" ? "is-active" : ""}
          disabled={props.generating || !props.foundationDiagram || !props.companionCallGraph}
          title={!props.foundationDiagram
            ? "Star a main Diagram first"
            : !props.companionCallGraph
              ? "Generate and star a Call Graph first"
              : undefined}
          onClick={() => props.onTargetKind("dir-view")}
        >Dir View</button>
        <button
          type="button"
          role="radio"
          aria-checked={props.targetKind === "diagram-component"}
          className={props.targetKind === "diagram-component" ? "is-active" : ""}
          disabled={props.generating}
          onClick={() => props.onTargetKind("diagram-component")}
        >DiagramComponent</button>
      </div>
      {auxiliary ? (
        <section className={`generation-immutable-context${auxiliaryReady ? "" : " is-missing"}`} aria-label="Immutable generation context">
          <header>
            <span className="eyebrow">IMMUTABLE CONTEXT</span>
            <span>Always included</span>
          </header>
          <div className="generation-foundation" role="status">
            <span className="eyebrow">FOUNDATION DIAGRAM</span>
            {props.foundationDiagram ? (
              <><strong>★ {props.foundationDiagram.name}</strong><code>@diagram/{props.foundationDiagram.handle}</code></>
            ) : (
              <strong>Star a main Diagram before generating this view.</strong>
            )}
          </div>
          {props.targetKind === "dir-view" ? (
            <div className="generation-companion" role="status">
              <span className="eyebrow">COMPANION CALL GRAPH</span>
              {props.companionCallGraph ? (
                <><strong>★ {props.companionCallGraph.name}</strong><code>@diagram/{props.companionCallGraph.handle}</code></>
              ) : (
                <strong>Generate and star a Call Graph before generating this view.</strong>
              )}
            </div>
          ) : null}
          <div className="generation-code-entities">
            <span className="eyebrow">CODE ENTITIES · {props.immutableCodeEntities.length}</span>
            {props.immutableCodeEntities.length ? (
              <ul>{props.immutableCodeEntities.map((entity) => (
                <li key={entity.id}>
                  <strong>{entity.label}</strong>
                  <code>@entity/{entity.handle}</code>
                </li>
              ))}</ul>
            ) : (
              <strong className="generation-context-empty">No attached CodeEntities.</strong>
            )}
          </div>
          {props.targetKind === "dir-view" ? (
            <div className="generation-repository-paths">
              <span className="eyebrow">REPOSITORY PATHS · {props.foundationRepositoryPaths.length}</span>
              <ul>{props.foundationRepositoryPaths.map((path) => <li key={path}><code>{path}</code></li>)}</ul>
            </div>
          ) : null}
        </section>
      ) : null}
      <div className="prompt-field">
        <div className="generation-prompt-heading">
          <label htmlFor="diagram-prompt">GENERATION INSTRUCTION</label>
          <span className="generation-prompt-selectors">
            <PromptProfileSelector
              id="generation-prompt-profile"
              templates={props.promptProfiles}
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
          disabled={props.generating || (auxiliary && !auxiliaryReady)}
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
        <p className="field-help">{auxiliary
          ? props.targetKind === "dir-view"
            ? "The starred foundation Diagram, starred Call Graph, and their attached CodeEntities are always included. Type @ to add another explicit reference."
            : "The foundation Diagram and its attached CodeEntities are always included. Type @ to add another explicit reference."
          : "Type @ for entity, diagram, and component references. Selected entities are included even without an explicit mention."}</p>
        {props.diagramReferences.length > 0 ? (
          <section className="prompt-reference-controls" aria-label="Referenced diagrams">
            <header>
              <span className="eyebrow">REFERENCED DIAGRAMS</span>
              <span>Toggle model context without changing the prompt text.</span>
            </header>
            <div>
              {props.diagramReferences.map((reference) => {
                const included = reference.available
                  && !props.excludedReferenceKeys.has(reference.key);
                return (
                  <label key={reference.key} className={!reference.available ? "is-unavailable" : ""}>
                    <input
                      type="checkbox"
                      checked={included}
                      disabled={props.generating || !reference.available}
                      onChange={() => props.onToggleDiagramReference(reference.key)}
                    />
                    <code>{reference.tokens[0]}</code>
                    <span>{reference.label}</span>
                    <em>{reference.available ? (included ? "included" : "omitted") : "unavailable"}</em>
                  </label>
                );
              })}
            </div>
            {props.derivativeSourceReferenceKey
              && props.excludedReferenceKeys.has(props.derivativeSourceReferenceKey) ? (
                <p className="prompt-reference-warning" role="status">
                  The current derivative source is omitted, so generated diagrams will not be linked to it.
                </p>
              ) : null}
          </section>
        ) : null}
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
          disabled={props.generating || (auxiliary && !auxiliaryReady)}
          onClick={props.onGenerate}
        >
          {props.generating
            ? `running ${props.count} agents…`
            : `generate ${props.count} ${targetLabel}${props.count === 1 ? "" : "s"} →`}
        </button>
      </div>

      {props.progress ? <p className="run-progress" aria-live="polite"><span />{props.progress}</p> : null}
      {props.error ? <p className="inline-error" role="alert">{props.error}</p> : null}
    </div>
  );
}
