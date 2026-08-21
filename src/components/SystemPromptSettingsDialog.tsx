import { useEffect, useMemo, useRef, useState } from "react";
import type {
  GenerationOutputKind,
  SystemPromptTemplateRecord
} from "../domain";
import { renderSystemPromptTemplate } from "../prompt";

type Draft = Pick<SystemPromptTemplateRecord, "label" | "description" | "prompts"> & { id?: string };

function draftFrom(template: SystemPromptTemplateRecord): Draft {
  return {
    id: template.id,
    label: template.label,
    description: template.description,
    prompts: { ...template.prompts }
  };
}

export function SystemPromptSettingsDialog(props: {
  templates: SystemPromptTemplateRecord[];
  initialTemplateId: string;
  onClose: () => void;
  onSave: (draft: Draft) => Promise<SystemPromptTemplateRecord>;
  onReset: (id: string) => Promise<SystemPromptTemplateRecord>;
  onDelete: (id: string) => Promise<void>;
}) {
  const initial = props.templates.find((template) => template.id === props.initialTemplateId)
    ?? props.templates[0];
  const [selectedId, setSelectedId] = useState(initial?.id ?? "");
  const [draft, setDraft] = useState<Draft>(() => initial
    ? draftFrom(initial)
    : { label: "", description: "", prompts: { diagram: "", "diagram-component": "" } });
  const [outputKind, setOutputKind] = useState<GenerationOutputKind>("diagram");
  const [view, setView] = useState<"editor" | "preview">("editor");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const editorRef = useRef<HTMLTextAreaElement>(null);
  const selected = props.templates.find((template) => template.id === selectedId);
  const changed = selected
    ? JSON.stringify(draftFrom(selected)) !== JSON.stringify(draft)
    : Boolean(draft.label || draft.description || draft.prompts.diagram || draft.prompts["diagram-component"]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !busy) props.onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [busy, props.onClose]);

  useEffect(() => {
    if (!selectedId || props.templates.some((template) => template.id === selectedId)) return;
    const next = props.templates[0];
    if (next) {
      setSelectedId(next.id);
      setDraft(draftFrom(next));
    }
  }, [props.templates, selectedId]);

  const validationError = useMemo(() => {
    if (!draft.label.trim()) return "Template name is required.";
    if (!draft.prompts.diagram.trim() || !draft.prompts["diagram-component"].trim()) {
      return "Both Diagram and DiagramComponent prompts are required.";
    }
    try {
      renderSystemPromptTemplate(draft.prompts.diagram, "diagram");
      renderSystemPromptTemplate(draft.prompts["diagram-component"], "diagram-component");
      return null;
    } catch (caught) {
      return caught instanceof Error ? caught.message : "The prompt template is invalid.";
    }
  }, [draft]);

  const preview = useMemo(() => {
    try {
      return renderSystemPromptTemplate(draft.prompts[outputKind], outputKind);
    } catch {
      return "Fix template errors to see the resolved prompt.";
    }
  }, [draft.prompts, outputKind]);

  const choose = (template: SystemPromptTemplateRecord) => {
    if (changed && !window.confirm("Discard unsaved template changes?")) return;
    setSelectedId(template.id);
    setDraft(draftFrom(template));
    setError(null);
  };

  const create = (source?: SystemPromptTemplateRecord) => {
    if (changed && !window.confirm("Discard unsaved template changes?")) return;
    setSelectedId("");
    setDraft(source ? {
      label: `${source.label} copy`,
      description: source.description,
      prompts: { ...source.prompts }
    } : {
      label: "New template",
      description: "",
      prompts: { diagram: "", "diagram-component": "" }
    });
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
    const value = draft.prompts[outputKind];
    const start = editor?.selectionStart ?? value.length;
    const end = editor?.selectionEnd ?? start;
    const token = `{{${name}}}`;
    setDraft((current) => ({
      ...current,
      prompts: {
        ...current.prompts,
        [outputKind]: `${value.slice(0, start)}${token}${value.slice(end)}`
      }
    }));
    requestAnimationFrame(() => {
      editor?.focus();
      editor?.setSelectionRange(start + token.length, start + token.length);
    });
  };

  return (
    <div className="prompt-settings-backdrop" role="presentation" onMouseDown={(event) => {
      if (event.target === event.currentTarget && !busy) props.onClose();
    }}>
      <section className="prompt-settings-dialog" role="dialog" aria-modal="true" aria-labelledby="system-prompts-title">
        <header>
          <div>
            <span className="eyebrow">SETTINGS</span>
            <h2 id="system-prompts-title">Configure system prompts</h2>
          </div>
          <button type="button" aria-label="Close system prompt settings" disabled={busy} onClick={props.onClose}>close</button>
        </header>

        <div className="prompt-settings-layout">
          <aside>
            <div className="prompt-template-list-heading">
              <span>TEMPLATES · {props.templates.length}</span>
              <button type="button" onClick={() => create()}>+ NEW</button>
            </div>
            <div className="prompt-template-list">
              {props.templates.map((template) => (
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
                    const reset = await props.onReset(selected.id);
                    setDraft(draftFrom(reset));
                  })}>reset built-in</button>
                ) : null}
                <button
                  className="is-danger"
                  type="button"
                  disabled={busy || props.templates.length === 1}
                  title={props.templates.length === 1 ? "At least one prompt template is required" : undefined}
                  onClick={() => {
                    if (!window.confirm(`Delete prompt template “${selected.label}”? This cannot be undone.`)) return;
                    void run(async () => props.onDelete(selected.id));
                  }}
                >delete</button>
              </div>
            ) : null}
          </aside>

          <form onSubmit={(event) => {
            event.preventDefault();
            if (validationError) return;
            void run(async () => {
              const saved = await props.onSave(draft);
              setSelectedId(saved.id);
              setDraft(draftFrom(saved));
            });
          }}>
            <div className="prompt-template-fields">
              <label><span>NAME</span><input value={draft.label} maxLength={80} onChange={(event) => setDraft({ ...draft, label: event.target.value })} /></label>
              <label><span>DESCRIPTION</span><input value={draft.description} maxLength={240} placeholder="When should this template be used?" onChange={(event) => setDraft({ ...draft, description: event.target.value })} /></label>
            </div>

            <div className="prompt-template-toolbar">
              <div role="tablist" aria-label="Artifact prompt">
                <button type="button" role="tab" aria-selected={outputKind === "diagram"} className={outputKind === "diagram" ? "is-active" : ""} onClick={() => setOutputKind("diagram")}>DIAGRAM</button>
                <button type="button" role="tab" aria-selected={outputKind === "diagram-component"} className={outputKind === "diagram-component" ? "is-active" : ""} onClick={() => setOutputKind("diagram-component")}>COMPONENT</button>
              </div>
              <div role="tablist" aria-label="Prompt view">
                <button type="button" role="tab" aria-selected={view === "editor"} className={view === "editor" ? "is-active" : ""} onClick={() => setView("editor")}>EDITOR</button>
                <button type="button" role="tab" aria-selected={view === "preview"} className={view === "preview" ? "is-active" : ""} onClick={() => setView("preview")}>RESOLVED PREVIEW</button>
              </div>
            </div>

            {view === "editor" ? (
              <div className="prompt-template-editor">
                <div className="prompt-variable-row">
                  <span>INSERT VARIABLE</span>
                  <button type="button" onClick={() => insertVariable("outputKind")}>{"{{outputKind}}"}</button>
                  <button type="button" onClick={() => insertVariable("submissionTool")}>{"{{submissionTool}}"}</button>
                </div>
                <textarea
                  ref={editorRef}
                  aria-label={`${outputKind} system prompt`}
                  value={draft.prompts[outputKind]}
                  spellCheck={false}
                  onChange={(event) => setDraft({
                    ...draft,
                    prompts: { ...draft.prompts, [outputKind]: event.target.value }
                  })}
                />
              </div>
            ) : <pre className="prompt-template-preview">{preview}</pre>}

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
