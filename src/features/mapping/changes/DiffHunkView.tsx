import { Fragment, useEffect, useMemo, useRef, useState } from 'react';
import type { TokensResult } from 'shiki';
import type { GitDiffHunk } from '../../../../domain/core/diffs/gitDiffHunk';
import { tokenizeSource } from '../../../shared/source/sourceHighlighting';
import { diffHunkRows } from './diffHunkRows';

export function DiffHunkView({ hunk, wrap, onOpen }: { hunk: GitDiffHunk; wrap: boolean; onOpen?: () => void }) {
  const ref = useRef<HTMLElement>(null);
  const [visible, setVisible] = useState(false), [tokens, setTokens] = useState<{ before: TokensResult; after: TokensResult }>();
  const [copy, setCopy] = useState('Copy patch');
  const content = useMemo(() => diffHunkRows(hunk), [hunk]);
  useEffect(() => {
    const observer = new IntersectionObserver(entries => { if (entries.some(entry => entry.isIntersecting)) { setVisible(true); observer.disconnect(); } }, { rootMargin: '400px' });
    if (ref.current) observer.observe(ref.current); return () => observer.disconnect();
  }, []);
  useEffect(() => {
    if (!visible || hunk.kind !== 'text') return;
    let cancelled = false;
    void Promise.all([tokenizeSource(hunk.path, content.before.join('\n')), tokenizeSource(hunk.path, content.after.join('\n'))])
      .then(([before, after]) => { if (!cancelled) setTokens({ before, after }); }).catch(() => { /* Plain text stays readable. */ });
    return () => { cancelled = true; };
  }, [visible, hunk.path, hunk.kind, content]);
  const added = content.rows.filter(row => row.kind === 'add').length, removed = content.rows.filter(row => row.kind === 'delete').length;
  return <article ref={ref} tabIndex={0} onClick={event => { if (!(event.target as HTMLElement).closest('button')) onOpen?.(); }} onKeyDown={event => { if (event.target === event.currentTarget && event.key === 'Enter') onOpen?.(); }} className="diff-hunk" data-hunk-id={hunk.id} aria-label={`${hunk.path} at ${hunk.commit.slice(0, 12)}`}>
    <header className="diff-hunk-header"><strong>{hunk.path}</strong><small title={hunk.commit}>{hunk.commit.slice(0, 8)}</small>
      <small className="diff-count-added">+{added}</small><small className="diff-count-removed">−{removed}</small>
      <button onClick={onOpen} title="Open mapped diagram change">Diagram ↗</button>
      <button aria-live="polite" onClick={async () => { try { await navigator.clipboard.writeText(hunk.patch); setCopy('Copied'); } catch { setCopy('Copy failed'); } }}>{copy}</button></header>
    {hunk.kind === 'text' ? <>
      <div className="diff-hunk-range">{hunk.patch.split('\n')[0]}</div>
      <div className={`diff-hunk-code${wrap ? ' is-wrapped' : ''}`} aria-label="Captured code diff">
        {content.rows.map((row, index) => {
          const highlighted = row.kind === 'delete' ? tokens?.before.tokens[row.oldIndex!] : tokens?.after.tokens[row.newIndex!];
          return <Fragment key={index}><div className="diff-hunk-row" data-kind={row.kind}>
            <span className="diff-hunk-number" aria-label={row.oldLine !== undefined ? `Old line ${row.oldLine}` : undefined}>{row.oldLine ?? ''}</span>
            <span className="diff-hunk-number" aria-label={row.newLine !== undefined ? `New line ${row.newLine}` : undefined}>{row.newLine ?? ''}</span>
            <span className="diff-hunk-sign" aria-hidden="true">{row.kind === 'add' ? '+' : row.kind === 'delete' ? '−' : ' '}</span>
            <span className="diff-hunk-text">{highlighted ? highlighted.map((token, i) => <span key={i} style={{ color: token.color }}>{token.content}</span>) : row.text || '\u00a0'}</span>
          </div>{row.noNewline && <div className="diff-no-newline">No newline at end of file</div>}</Fragment>;
        })}
      </div>
    </> : <div className="diff-hunk-metadata"><strong>{hunk.kind === 'binary' ? 'Binary file changed' : 'File metadata changed'}</strong><pre>{hunk.patch}</pre></div>}
  </article>;
}
