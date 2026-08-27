import { useEffect, useMemo, useRef, useState } from "react";
import type {
  CodeEntityPromptKind,
  CodeEntityPromptTemplateRecord,
  GenerationTargetKind,
  PromptTemplateVariable,
  PromptTemplateVariableOverrides,
  SystemPromptTemplateRecord
} from "../domain";
import {
  DEFAULT_REFERENCE_FOLLOW_UP_PROMPT,
  PROMPT_TEMPLATE_VARIABLE_DEFINITIONS,
  REFERENCE_PROMPT_TEMPLATE_VARIABLES,
  SYSTEM_PROMPT_TEMPLATE_VARIABLES,
  renderReferencePromptTemplate,
  renderSystemPromptTemplate,
  resolvePromptTemplateVariableValues,
  type PromptOption
} from "../prompt";

export type PromptTemplateFamily = "generation" | "code-entities";
type PromptKind = GenerationTargetKind | CodeEntityPromptKind;
type AnyTemplate = SystemPromptTemplateRecord | CodeEntityPromptTemplateRecord;

export interface PromptTemplateDraft {
  id?: string;
  label: string;
  description: string;
  prompts: Partial<Record<PromptKind, string>>;
  referencePrompts?: Partial<Record<GenerationTargetKind, string>>;
  variableOverrides?: PromptTemplateVariableOverrides;
}

const familyKinds: Record<PromptTemplateFamily, PromptKind[]> = {
  generation: ["diagram", "call-graph", "dir-view", "diagram-component"],
  "code-entities": ["code-entity-identification", "code-entity-compaction"]
};

const kindLabels: Record<PromptKind, string> = {
  diagram: "DIAGRAM",
  "call-graph": "CALL GRAPH",
  "dir-view": "DIR VIEW",
  "diagram-component": "COMPONENT",
  "code-entity-identification": "IDENTIFICATION",
  "code-entity-compaction": "COMPACTION"
};

function draftFrom(template: AnyTemplate): PromptTemplateDraft {
  return {
    id: template.id,
    label: template.label,
    description: template.description,
    prompts: { ...template.prompts },
    ...( "referencePrompts" in template
      ? { referencePrompts: { ...template.referencePrompts } }
      : {}),
    ...( "variableOverrides" in template && template.variableOverrides
      ? {
          variableOverrides: Object.fromEntries(Object.entries(template.variableOverrides).map(
            ([kind, values]) => [kind, { ...values }]
          ))
        }
      : {})
  };
}

function emptyDraft(family: PromptTemplateFamily): PromptTemplateDraft {
  return {
    label: "New template",
    description: "",
    prompts: Object.fromEntries(familyKinds[family].map((kind) => [kind, ""])),
    ...(family === "generation" ? {
      referencePrompts: Object.fromEntries(
        familyKinds.generation.map((kind) => [kind, DEFAULT_REFERENCE_FOLLOW_UP_PROMPT])
      )
    } : {})
  };
}

export function SystemPromptSettingsDialog(props: {
  generationTemplates: SystemPromptTemplateRecord[];
  codeEntityTemplates: CodeEntityPromptTemplateRecord[];
  referenceOptions: PromptOption[];
  initialGenerationTemplateId: string;
  onClose: () => void;
  onSave: (family: PromptTemplateFamily, draft: PromptTemplateDraft) => Promise<AnyTemplate>;
  onReset: (family: PromptTemplateFamily, id: string) => Promise<AnyTemplate>;
  onDelete: (family: PromptTemplateFamily, id: string) => Promise<void>;
}) {
  const initial = props.generationTemplates.find(
    (template) => template.id === props.initialGenerationTemplateId
  ) ?? props.generationTemplates[0];
  const [family, setFamily] = useState<PromptTemplateFamily>("generation");
  const [selectedId, setSelectedId] = useState(initial?.id ?? "");
  const [draft, setDraft] = useState<PromptTemplateDraft>(() => initial
    ? draftFrom(initial)
    : emptyDraft("generation"));
  const [promptKind, setPromptKind] = useState<PromptKind>("diagram");
  const [generationPhase, setGenerationPhase] = useState<"system" | "reference">("system");
  const [view, setView] = useState<"editor" | "preview" | "variables">("editor");
  const [referenceMentionQuery, setReferenceMentionQuery] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const editorRef = useRef<HTMLTextAreaElement>(null);
  const referenceSuggestions = referenceMentionQuery === null ? [] : props.referenceOptions.filter(
    (option) => option.token.toLowerCase().includes(referenceMentionQuery.toLowerCase())
      || option.label.toLowerCase().includes(referenceMentionQuery.toLowerCase().replace(/^@/, ""))
  ).slice(0, 8);
  const templates: AnyTemplate[] = family === "generation"
    ? props.generationTemplates
    : props.codeEntityTemplates;
  const selected = templates.find((template) => template.id === selectedId);
  const changed = selected
    ? JSON.stringify(draftFrom(selected)) !== JSON.stringify(draft)
    : Boolean(draft.label || draft.description || Object.values(draft.prompts).some(Boolean)
      || Object.values(draft.referencePrompts ?? {}).some(Boolean));

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !busy) props.onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [busy, props.onClose]);

  useEffect(() => {
    if (!selectedId || templates.some((template) => template.id === selectedId)) return;
    const next = templates[0];
    if (next) {
      setSelectedId(next.id);
      setDraft(draftFrom(next));
    }
  }, [selectedId, templates]);

  const validationError = useMemo(() => {
    if (!draft.label.trim()) return "Template name is required.";
    const kinds = familyKinds[family];
    if (kinds.some((kind) => !draft.prompts[kind]?.trim())) {
      return family === "generation"
        ? "Diagram, Call Graph, Dir View, and DiagramComponent prompts are required."
        : "Both identification and compaction criteria are required.";
    }
    if (family === "generation") {
      try {
        renderSystemPromptTemplate(draft.prompts.diagram!, "diagram", draft.variableOverrides?.diagram);
        renderSystemPromptTemplate(
          draft.prompts["call-graph"]!,
          "call-graph",
          draft.variableOverrides?.["call-graph"]
        );
        renderSystemPromptTemplate(
          draft.prompts["dir-view"]!,
          "dir-view",
          draft.variableOverrides?.["dir-view"]
        );
        renderSystemPromptTemplate(
          draft.prompts["diagram-component"]!,
          "diagram-component",
          draft.variableOverrides?.["diagram-component"]
        );
        for (const kind of familyKinds.generation as GenerationTargetKind[]) {
          const template = draft.referencePrompts?.[kind];
          if (!template?.trim()) throw new Error("All generation reference prompts are required.");
          renderReferencePromptTemplate({
            template,
            targetKind: kind,
            instruction: "Use @diagram/reference as the style reference.",
            referenceContext: "Diagram reference",
            variableOverrides: draft.variableOverrides?.[kind]
          });
        }
      } catch (caught) {
        return caught instanceof Error ? caught.message : "The prompt template is invalid.";
      }
    }
    return null;
  }, [draft, family]);

  const preview = useMemo(() => {
    const value = family === "generation" && generationPhase === "reference"
      ? draft.referencePrompts?.[promptKind as GenerationTargetKind] ?? ""
      : draft.prompts[promptKind] ?? "";
    if (family === "code-entities") return value;
    try {
      return generationPhase === "reference"
        ? renderReferencePromptTemplate({
            template: value,
            targetKind: promptKind as GenerationTargetKind,
            instruction: "Use @diagram/reference as the style reference.",
            referenceContext: "Diagram @diagram/reference\nASCII:\n+-- reference --+",
            variableOverrides: draft.variableOverrides?.[promptKind as GenerationTargetKind]
          })
        : renderSystemPromptTemplate(
            value,
            promptKind as GenerationTargetKind,
            draft.variableOverrides?.[promptKind as GenerationTargetKind]
          );
    } catch {
      return "Fix template errors to see the resolved prompt.";
    }
  }, [draft.prompts, draft.referencePrompts, family, generationPhase, promptKind]);

  const switchFamily = (nextFamily: PromptTemplateFamily) => {
    if (nextFamily === family) return;
    if (changed && !window.confirm("Discard unsaved template changes?")) return;
    const nextTemplates = nextFamily === "generation"
      ? props.generationTemplates
      : props.codeEntityTemplates;
    const next = nextTemplates[0];
    setFamily(nextFamily);
    setGenerationPhase("system");
    setPromptKind(familyKinds[nextFamily][0]);
    setSelectedId(next?.id ?? "");
    setDraft(next ? draftFrom(next) : emptyDraft(nextFamily));
    setView("editor");
    setError(null);
  };

  const choose = (template: AnyTemplate) => {
    if (changed && !window.confirm("Discard unsaved template changes?")) return;
    setSelectedId(template.id);
    setDraft(draftFrom(template));
    setError(null);
  };

  const create = (source?: AnyTemplate) => {
    if (changed && !window.confirm("Discard unsaved template changes?")) return;
    setSelectedId("");
    setDraft(source ? {
      label: `${source.label} copy`,
      description: source.description,
      prompts: { ...source.prompts },
      ...( "referencePrompts" in source
        ? { referencePrompts: { ...source.referencePrompts } }
        : {}),
      ...( "variableOverrides" in source && source.variableOverrides
        ? {
            variableOverrides: Object.fromEntries(Object.entries(source.variableOverrides).map(
              ([kind, values]) => [kind, { ...values }]
            ))
          }
        : {})
    } : emptyDraft(family));
    setView("editor");
    setError(null);
  };

  const run = async (action: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    try {
      await action();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Template update failed");
    } finally {
      setBusy(false);
    }
  };

  const insertVariable = (name: string) => {
    const editor = editorRef.current;
    const referencePhase = family === "generation" && generationPhase === "reference";
    const value = referencePhase
      ? draft.referencePrompts?.[promptKind as GenerationTargetKind] ?? ""
      : draft.prompts[promptKind] ?? "";
    const start = editor?.selectionStart ?? value.length;
    const end = editor?.selectionEnd ?? start;
    const token = `{{${name}}}`;
    setDraft((current) => ({
      ...current,
      ...(referencePhase ? {
        referencePrompts: {
          ...current.referencePrompts,
          [promptKind]: `${value.slice(0, start)}${token}${value.slice(end)}`
        }
      } : {
        prompts: {
          ...current.prompts,
          [promptKind]: `${value.slice(0, start)}${token}${value.slice(end)}`
        }
      })
    }));
    requestAnimationFrame(() => {
      editor?.focus();
      editor?.setSelectionRange(start + token.length, start + token.length);
    });
  };

  const updateReferenceMentionQuery = (value: string, cursor: number) => {
    const before = value.slice(0, cursor);
    const match = before.match(/@[a-z0-9\/-]*$/i);
    setReferenceMentionQuery(match?.[0] ?? null);
  };

  const insertReference = (token: string) => {
    const editor = editorRef.current;
    const referencePhase = family === "generation" && generationPhase === "reference";
    const value = referencePhase
      ? draft.referencePrompts?.[promptKind as GenerationTargetKind] ?? ""
      : draft.prompts[promptKind] ?? "";
    const cursor = editor?.selectionStart ?? value.length;
    const before = value.slice(0, cursor);
    const match = before.match(/@[a-z0-9\/-]*$/i);
    const start = match ? cursor - match[0].length : cursor;
    const next = `${value.slice(0, start)}${token} ${value.slice(cursor)}`;
    setDraft((current) => ({
      ...current,
      ...(referencePhase ? {
        referencePrompts: { ...current.referencePrompts, [promptKind]: next }
      } : {
        prompts: { ...current.prompts, [promptKind]: next }
      })
    }));
    setReferenceMentionQuery(null);
    requestAnimationFrame(() => {
      const nextCursor = start + token.length + 1;
      editor?.focus();
      editor?.setSelectionRange(nextCursor, nextCursor);
    });
  };

  const activeGenerationKind = promptKind as GenerationTargetKind;
  const activeVariableNames = generationPhase === "reference"
    ? REFERENCE_PROMPT_TEMPLATE_VARIABLES
    : SYSTEM_PROMPT_TEMPLATE_VARIABLES;
  const activeVariableValues = resolvePromptTemplateVariableValues({
    targetKind: activeGenerationKind,
    phase: generationPhase,
    variableOverrides: draft.variableOverrides?.[activeGenerationKind]
  });
  const setVariableOverride = (name: PromptTemplateVariable, value: string) => {
    setDraft((current) => {
      const kindOverrides = { ...current.variableOverrides?.[activeGenerationKind] };
      if (value) kindOverrides[name] = value;
      else delete kindOverrides[name];
      const variableOverrides = { ...current.variableOverrides };
      if (Object.keys(kindOverrides).length) variableOverrides[activeGenerationKind] = kindOverrides;
      else delete variableOverrides[activeGenerationKind];
      return {
        ...current,
        variableOverrides: Object.keys(variableOverrides).length ? variableOverrides : undefined
      };
    });
  };

  return (
    <div className="prompt-settings-backdrop" role="presentation" onMouseDown={(event) => {
      if (event.target === event.currentTarget && !busy) props.onClose();
    }}>
      <section className="prompt-settings-dialog" role="dialog" aria-modal="true" aria-labelledby="prompts-title">
        <header>
          <div>
            <span className="eyebrow">SETTINGS</span>
            <h2 id="prompts-title">Configure prompts</h2>
          </div>
          <button type="button" aria-label="Close prompt settings" disabled={busy} onClick={props.onClose}>close</button>
        </header>

        <div className="prompt-settings-layout">
          <aside>
            <div className="prompt-family-tabs" role="tablist" aria-label="Prompt family">
              <button type="button" role="tab" aria-selected={family === "generation"} className={family === "generation" ? "is-active" : ""} onClick={() => switchFamily("generation")}>DIAGRAMS</button>
              <button type="button" role="tab" aria-selected={family === "code-entities"} className={family === "code-entities" ? "is-active" : ""} onClick={() => switchFamily("code-entities")}>CODE ENTITIES</button>
            </div>
            <div className="prompt-template-list-heading">
              <span>TEMPLATES · {templates.length}</span>
              <button type="button" onClick={() => create()}>+ NEW</button>
            </div>
            <div className="prompt-template-list">
              {templates.map((template) => (
                <button
                  type="button"
                  key={template.id}
                  className={selectedId === template.id ? "is-active" : ""}
                  onClick={() => choose(template)}
                >
                  <strong>{template.label}</strong>
                  <span>v{template.version}{template.builtIn ? " · BUILT-IN" : " · CUSTOM"}</span>
                </button>
              ))}
            </div>
            {selected ? (
              <div className="prompt-template-side-actions">
                <button type="button" onClick={() => create(selected)}>duplicate</button>
                {selected.builtIn ? (
                  <button type="button" disabled={busy} onClick={() => void run(async () => {
                    const reset = await props.onReset(family, selected.id);
                    setDraft(draftFrom(reset));
                  })}>reset built-in</button>
                ) : null}
                <button
                  className="is-danger"
                  type="button"
                  disabled={busy || templates.length === 1}
                  title={templates.length === 1 ? "At least one prompt template is required" : undefined}
                  onClick={() => {
                    if (!window.confirm(`Delete prompt template “${selected.label}”? This cannot be undone.`)) return;
                    void run(async () => props.onDelete(family, selected.id));
                  }}
                >delete</button>
              </div>
            ) : null}
          </aside>

          <form onSubmit={(event) => {
            event.preventDefault();
            if (validationError) return;
            void run(async () => {
              const saved = await props.onSave(family, draft);
              setSelectedId(saved.id);
              setDraft(draftFrom(saved));
            });
          }}>
            <div className="prompt-template-fields">
              <label><span>NAME</span><input value={draft.label} maxLength={80} onChange={(event) => setDraft({ ...draft, label: event.target.value })} /></label>
              <label><span>DESCRIPTION</span><input value={draft.description} maxLength={240} placeholder="When should this template be used?" onChange={(event) => setDraft({ ...draft, description: event.target.value })} /></label>
            </div>

            <div className="prompt-template-toolbar">
              <div role="tablist" aria-label={family === "generation" ? "Artifact prompt" : "CodeEntity prompt"}>
                {familyKinds[family].map((kind) => (
                  <button type="button" role="tab" key={kind} aria-selected={promptKind === kind} className={promptKind === kind ? "is-active" : ""} onClick={() => setPromptKind(kind)}>{kindLabels[kind]}</button>
                ))}
              </div>
              {family === "generation" ? (
                <div role="tablist" aria-label="Generation prompt phase">
                  <button type="button" role="tab" aria-selected={generationPhase === "system"} className={generationPhase === "system" ? "is-active" : ""} onClick={() => setGenerationPhase("system")}>SYSTEM</button>
                  <button type="button" role="tab" aria-selected={generationPhase === "reference"} className={generationPhase === "reference" ? "is-active" : ""} onClick={() => setGenerationPhase("reference")}>REFERENCE FOLLOW-UP</button>
                </div>
              ) : null}
              <div role="tablist" aria-label="Prompt view">
                <button type="button" role="tab" aria-selected={view === "editor"} className={view === "editor" ? "is-active" : ""} onClick={() => setView("editor")}>EDITOR</button>
                <button type="button" role="tab" aria-selected={view === "preview"} className={view === "preview" ? "is-active" : ""} onClick={() => setView("preview")}>{family === "generation" ? "RESOLVED PREVIEW" : "PREVIEW"}</button>
                {family === "generation" ? (
                  <button type="button" role="tab" aria-selected={view === "variables"} className={view === "variables" ? "is-active" : ""} onClick={() => setView("variables")}>VARIABLES</button>
                ) : null}
              </div>
            </div>

            {view === "editor" ? (
              <div className="prompt-template-editor">
                {family === "generation" ? (
                  <div className="prompt-variable-row">
                    <span>INSERT VARIABLE</span>
                    <button type="button" onClick={() => insertVariable("outputKind")}>{"{{outputKind}}"}</button>
                    <button type="button" onClick={() => insertVariable("submissionTool")}>{"{{submissionTool}}"}</button>
                    {generationPhase === "reference" ? (
                      <>
                        <button type="button" onClick={() => insertVariable("referenceInstruction")}>{"{{referenceInstruction}}"}</button>
                        <button type="button" onClick={() => insertVariable("referenceContext")}>{"{{referenceContext}}"}</button>
                      </>
                    ) : null}
                    <span className="prompt-template-reference-hint">TYPE @ FOR IMPORTED ARTIFACTS</span>
                  </div>
                ) : null}
                <textarea
                  ref={editorRef}
                  aria-label={`${kindLabels[promptKind]} ${generationPhase === "reference" ? "reference follow-up" : "system"} prompt`}
                  value={family === "generation" && generationPhase === "reference"
                    ? draft.referencePrompts?.[promptKind as GenerationTargetKind] ?? ""
                    : draft.prompts[promptKind] ?? ""}
                  spellCheck={false}
                  onChange={(event) => {
                    const value = event.target.value;
                    updateReferenceMentionQuery(value, event.target.selectionStart);
                    setDraft(family === "generation" && generationPhase === "reference"
                      ? {
                          ...draft,
                          referencePrompts: { ...draft.referencePrompts, [promptKind]: value }
                        }
                      : {
                          ...draft,
                          prompts: { ...draft.prompts, [promptKind]: value }
                        });
                  }}
                  onClick={(event) => updateReferenceMentionQuery(
                    event.currentTarget.value,
                    event.currentTarget.selectionStart
                  )}
                  onKeyUp={(event) => updateReferenceMentionQuery(
                    event.currentTarget.value,
                    event.currentTarget.selectionStart
                  )}
                />
                {family === "generation" && referenceSuggestions.length > 0 ? (
                  <div className="mention-menu prompt-template-reference-menu" role="listbox" aria-label="System prompt artifact references">
                    {referenceSuggestions.map((option) => (
                      <button
                        type="button"
                        role="option"
                        key={`${option.kind}:${option.id}`}
                        onMouseDown={(event) => {
                          event.preventDefault();
                          insertReference(option.token);
                        }}
                        onClick={() => insertReference(option.token)}
                      >
                        <code>{option.token}</code><span>{option.label}</span>
                      </button>
                    ))}
                  </div>
                ) : null}
              </div>
            ) : view === "preview" ? (
              <pre className="prompt-template-preview">{preview}</pre>
            ) : (
              <div className="prompt-template-variables" aria-label="Template variable definitions">
                <header>
                  <div>
                    <span className="eyebrow">VARIABLE DEFINITIONS</span>
                    <p>Overrides are stored for {kindLabels[activeGenerationKind]} and used wherever that variable appears. Clear a value to restore its computed or runtime definition.</p>
                  </div>
                </header>
                <div>
                  {activeVariableNames.map((name) => {
                    const override = draft.variableOverrides?.[activeGenerationKind]?.[name];
                    const definition = PROMPT_TEMPLATE_VARIABLE_DEFINITIONS[name];
                    return (
                      <label key={name}>
                        <span>
                          <code>{`{{${name}}}`}</code>
                          <em>{definition.source}</em>
                        </span>
                        <small>{definition.description}</small>
                        <textarea
                          aria-label={`${name} variable override`}
                          value={override ?? ""}
                          placeholder={activeVariableValues[name]}
                          spellCheck={false}
                          onChange={(event) => setVariableOverride(name, event.target.value)}
                        />
                        <footer>
                          <span>{override === undefined ? `Current: ${activeVariableValues[name]}` : "Custom definition active"}</span>
                          {override !== undefined ? (
                            <button type="button" onClick={() => setVariableOverride(name, "")}>restore default</button>
                          ) : null}
                        </footer>
                      </label>
                    );
                  })}
                </div>
              </div>
            )}

            <footer>
              <span>{error ?? validationError ?? (selected ? `Saved revision v${selected.version}` : "Unsaved custom template")}</span>
              <button className="button" type="button" disabled={busy} onClick={props.onClose}>cancel</button>
              <button className="button button--primary" type="submit" disabled={busy || Boolean(validationError) || !changed}>{busy ? "saving..." : "save template"}</button>
            </footer>
          </form>
        </div>
      </section>
    </div>
  );
}
