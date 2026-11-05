import { forwardRef, useEffect, useRef, useState, type ComponentProps } from 'react';
import { TemplateEditor, type TemplateEditorHandle } from './TemplateEditor';
import { parsePromptSections, type PromptTemplateBase } from '../../../../domain/mapping/evals/promptTemplateBase';

export const PromptSectionsEditor = forwardRef<TemplateEditorHandle, ComponentProps<typeof TemplateEditor> & { base: PromptTemplateBase }>(function PromptSectionsEditor({ base, ...props }, ref) {
  return <div className="prompt-sections-editor"><div className="evals-muted">{base.name} · v{base.version}</div><TemplateEditor {...props} ref={ref} /></div>;
});


export function PromptTextBox({ value, onChange, base, label, readOnly }: { value: string; onChange: (text: string) => void; base: PromptTemplateBase; label: string; readOnly?: boolean }) {
  const history = useRef([value]), index = useRef(0);
  const [issues, setIssues] = useState<string[]>([]);
  useEffect(() => { const timer = setTimeout(() => setIssues(parsePromptSections(value, base).issues.map(i => i.message)), 2000); return () => clearTimeout(timer); }, [value, base]);
  const move = (direction: number) => { const next = index.current + direction; if (next < 0 || next >= history.current.length) return; index.current = next; onChange(history.current[next]); };
  return <><PromptSectionsEditor value={value} base={base} label={label} readOnly={readOnly} known={new Set()} onUndo={() => move(-1)} onRedo={() => move(1)} onChange={change => { history.current = [...history.current.slice(0, index.current + 1), change.value]; index.current++; onChange(change.value); }} />{issues.map((issue, i) => <p role="alert" className="evals-error" key={i}>{issue}</p>)}</>;
}
