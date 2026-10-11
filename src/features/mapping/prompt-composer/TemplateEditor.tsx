import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { findPromptTemplate, normalizePromptOptions, renderPromptTemplate, validateTemplateMarkdown, type PromptTemplateSelection } from '../../../../domain/mapping/agent/promptTemplates';
import { TerminalMarkdownContent } from '../../../shared/markdown/TerminalMarkdownContent';

/** Centered modal over the composer. Edits stay in the draft; the server re-validates on submit. */
export function TemplateEditor(props: { template: PromptTemplateSelection; instruction: string; referenceCount: number;
  onSave: (markdown: string) => void; onClose: () => void }) {
  const definition = findPromptTemplate(props.template.id, props.template.version)!;
  const [markdown, setMarkdown] = useState(props.template.markdown ?? definition.markdown);
  const [withValues, setWithValues] = useState(true);
  const dialog = useRef<HTMLDivElement>(null), opener = useRef<Element | null>(null);
  const titleId = useId(), editorId = useId();
  const issues = useMemo(() => validateTemplateMarkdown(definition, markdown), [definition, markdown]);
  useEffect(() => {
    opener.current = document.activeElement;
    dialog.current?.querySelector<HTMLTextAreaElement>('textarea')?.focus();
    return () => { if (opener.current instanceof HTMLElement && opener.current.isConnected) opener.current.focus(); };
  }, []);
  // Rendering with draft values shows exactly what the model will read, minus captured canvas data.
  const preview = useMemo(() => {
    if (!withValues || issues.length) return markdown;
    try {
      return renderPromptTemplate({ markdown, options: normalizePromptOptions(definition, props.template.options), parameters: definition.parameters }, {
        context: '`[captured diagram, connections and evidence]`',
        references: props.referenceCount ? `\`[${props.referenceCount} pinned reference${props.referenceCount === 1 ? '' : 's'}]\`` : '`[no references]`',
        instruction: props.instruction ? `> ${props.instruction.replace(/\n/g, '\n> ')}` : '`[your prompt text]`' });
    } catch { return markdown; }
  }, [withValues, issues, markdown, definition, props.template.options, props.referenceCount, props.instruction]);
  const edited = markdown !== definition.markdown;
  return createPortal(<div className="prompt-template-backdrop" data-mapping-static-ui data-diagram-canvas-static-ui>
    <div ref={dialog} className="prompt-template-editor" role="dialog" aria-modal="true" aria-labelledby={titleId}
      onKeyDown={event => {
        event.stopPropagation();
        if (event.key === 'Escape') { event.preventDefault(); props.onClose(); return; }
        if (event.key !== 'Tab') return;
        const controls = Array.from(dialog.current!.querySelectorAll<HTMLElement>('textarea, button:not(:disabled)'));
        if (document.activeElement === (event.shiftKey ? controls[0] : controls.at(-1))) { event.preventDefault(); (event.shiftKey ? controls.at(-1) : controls[0])?.focus(); }
      }}>
      <header className="window-panel-header">
        <div><strong id={titleId}>Edit template · {definition.title}</strong>
          <small>Based on {definition.id}@v{definition.version} · changes are saved into this draft only</small></div>
        <button type="button" onClick={props.onClose}>Close</button>
      </header>
      <div className="prompt-template-columns">
        <section aria-label="Markdown">
          <div className="diff-pane-toolbar"><span>MARKDOWN · fields: {'{{context}} {{references}} {{instruction}}'}{definition.parameters.length ? ` · options: ${definition.parameters.map(parameter => `{{options.${parameter.key}}}`).join(' ')}` : ''}</span></div>
          <label className="prompt-visually-hidden" htmlFor={editorId}>Template Markdown</label>
          <textarea id={editorId} className="prompt-template-markdown" spellCheck={false} value={markdown} maxLength={40000}
            aria-invalid={issues.length > 0} onChange={event => setMarkdown(event.target.value)} />
        </section>
        <section aria-label="Preview">
          <div className="diff-pane-toolbar"><span>PREVIEW</span>
            <div role="radiogroup" aria-label="Preview content" className="prompt-segmented">
              <button type="button" role="radio" aria-checked={withValues} onClick={() => setWithValues(true)}>With draft values</button>
              <button type="button" role="radio" aria-checked={!withValues} onClick={() => setWithValues(false)}>Raw placeholders</button>
            </div></div>
          <TerminalMarkdownContent className="prompt-template-preview" source={preview} />
        </section>
      </div>
      <div className="prompt-template-checks" role="region" aria-label="Template checks" aria-live="polite">
        {issues.length ? issues.map((issue, index) => <span key={index} className="is-error">✕ {issue.line ? `Line ${issue.line}: ` : ''}{issue.message}</span>)
          : <span className="is-ok">✓ All required fields and options are valid</span>}
      </div>
      <footer className="prompt-template-footer">
        <button type="button" disabled={!edited} onClick={() => setMarkdown(definition.markdown)}>Reset to v{definition.version}</button>
        <button type="button" onClick={props.onClose}>Cancel</button>
        <button type="button" className="prompt-primary" disabled={issues.length > 0} onClick={() => { props.onSave(markdown); props.onClose(); }}>Save to draft</button>
      </footer>
    </div>
  </div>, document.body);
}
