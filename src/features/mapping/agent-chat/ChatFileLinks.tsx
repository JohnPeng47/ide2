import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { isRepositoryFilePath } from '../../../../domain/core/source/sourceNavigation';
import { useMappingServices } from '../services/MappingServices';

interface Target { path: string; line: number }
export function chatFileTarget(href: string, cwd: string): Target | undefined {
  let value: string;
  try { value = decodeURIComponent(href.replace(/^file:\/\//i, '')); } catch { return; }
  const match = /(?::(\d+)(?::\d+)?|#L(\d+)(?:C\d+)?(?:-L?\d+)?)$/.exec(value);
  const line = Number(match?.[1] || match?.[2] || 1);
  if (match) value = value.slice(0, match.index);
  const prefix = cwd.replace(/\/$/, '') + '/';
  if (value.startsWith(prefix)) value = value.slice(prefix.length);
  if (value.startsWith('./')) value = value.slice(2);
  if (!isRepositoryFilePath(value)) return;
  return { path: value, line: Math.max(1, line) };
}
const FileLinksContext = createContext<{ cwd: string; open?: (target: Target) => void }>({ cwd: '' });
export function ChatFileLink({ href, children }: { href: string; children: ReactNode }) {
  const { cwd, open } = useContext(FileLinksContext);
  const target = chatFileTarget(href, cwd);
  return target && open ? <button type="button" className="agent-file-reference" title={href} onClick={() => open(target)}>{children}</button>
    : <span className="agent-file-reference" title={href}>{children}</span>;
}
export function ChatFileLinks({ cwd, projectId, children }: { cwd: string; projectId?: string; children: ReactNode }) {
  const { codeRepo } = useMappingServices();
  const [target, setTarget] = useState<Target>(), [content, setContent] = useState(''), [error, setError] = useState('');
  useEffect(() => {
    if (!target || !projectId) return;
    const controller = new AbortController();
    setContent(''); setError('');
    void codeRepo.readFile({ projectId, sourceId: '' }, target.path, { signal: controller.signal, reload: true }).then(file => {
      if (controller.signal.aborted) return;
      const lines = file.text.split('\n'), start = Math.max(0, target.line - 6), end = Math.min(lines.length, start + 60);
      setContent(lines.slice(start, end).map((line, index) => `${start + index + 1}  ${line}`).join('\n') || '(empty file)');
    }, error => { if (!controller.signal.aborted) setError(String(error)); });
    return () => controller.abort();
  }, [codeRepo, projectId, target]);
  const context = useMemo(() => ({ cwd, open: projectId && codeRepo.available ? setTarget : undefined }), [cwd, projectId, codeRepo.available]);
  return <FileLinksContext.Provider value={context}>{children}
    {target && <section className="agent-source-preview" aria-label={`Source preview ${target.path}`}><header><strong>{target.path}:{target.line}</strong><button type="button" aria-label="Close source preview" onClick={() => setTarget(undefined)}>×</button></header>
      {error ? <p role="alert">{error}</p> : <pre>{content || 'Loading source…'}</pre>}</section>}
  </FileLinksContext.Provider>;
}
