import { createContext, useContext, useEffect, memo, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type { ChatItem, ChatSession } from '../../../../domain/mapping/agent-chat/agentChat';
import { actionLabel, failedItem, hiddenItem, outputPreview, TranscriptProjector, type TranscriptBlock } from '../../../../domain/mapping/agent-chat/chatTranscript';
import { CodexMarkdown } from './markdown/CodexMarkdown';
import { chatRequest } from './agentChatClient';
import { CopyButton } from './markdown/CopyButton';
import { ChatReferenceDetails } from './ChatReferences';
import { useTranscriptZoom } from './useTranscriptZoom';

function Disclosure({ label = 'Show details', expanded, children }: { label?: string; expanded: boolean; children: () => ReactNode }) {
  const [local, setLocal] = useState<boolean>();
  const open = local ?? expanded;
  return <div className="agent-disclosure"><button type="button" aria-expanded={open} onClick={() => setLocal(!open)}>{open ? '▾ Hide details' : `▸ ${label}`}</button>
    {open && <div className="agent-detail-body">{children()}</div>}</div>;
}
const ActivitySession = createContext('');
function useActivityDetails(item: ChatItem) {
  const sessionId = useContext(ActivitySession);
  const [loaded, setLoaded] = useState<ChatItem>(), [error, setError] = useState('');
  useEffect(() => {
    if (!item.detailAvailable) return;
    let cancelled = false;
    void chatRequest<ChatItem>(`/sessions/${sessionId}/items/${encodeURIComponent(item.id)}`).then(value => { if (!cancelled) setLoaded(value); }, error => { if (!cancelled) setError(String(error)); });
    return () => { cancelled = true; };
  }, [sessionId, item.id, item.detailAvailable]);
  return { item: item.detailAvailable && loaded ? loaded : item, loading: !!item.detailAvailable && !loaded && !error, error };
}
function Output({ item: source }: { item: ChatItem }) {
  const { item, loading, error } = useActivityDetails(source);
  return <>{loading && <small>Loading retained output…</small>}{error && <p role="alert">{error}</p>}{!!item.omittedChars && <small>{item.omittedChars.toLocaleString()} earlier characters omitted; retained output follows.</small>}
    <pre>{item.text || '(no output)'}</pre>{item.text && <CopyButton text={item.text} label="Copy retained output" />}</>;
}
function Diff({ text, limit }: { text: string; limit?: number }) {
  const lines = text.split('\n');
  return <pre className="agent-diff">{lines.slice(0, limit).map((line, index) => <span key={index} className={line.startsWith('+') ? 'agent-diff-add' : line.startsWith('-') ? 'agent-diff-remove' : undefined}>{line}{'\n'}</span>)}</pre>;
}
function FileDetails({ item: source }: { item: ChatItem }) {
  const { item, loading, error } = useActivityDetails(source);
  return <>{loading && <small>Loading changes…</small>}{error && <p role="alert">{error}</p>}{item.changes?.map(file => <section key={file.path}><strong>{file.path}</strong>{!!file.omittedChars && <small>Earlier diff content omitted.</small>}<Diff text={file.diff} /><CopyButton text={file.diff} label="Copy diff" /></section>)}</>;
}
function ItemDetails({ item }: { item: ChatItem }) {
  if (item.kind === 'reasoning') return <section><strong>Reasoning summary</strong><CodexMarkdown text={item.text} /></section>;
  return <section>{item.command && <code>{item.command.command}</code>}<Output item={item} /></section>;
}
function ExplorationDetails({ items }: { items: ChatItem[] }) {
  const [count, setCount] = useState(20);
  return <>{items.slice(0, count).filter(entry => !hiddenItem(entry) || entry.kind === 'reasoning').map(entry => <ItemDetails key={entry.id} item={entry} />)}
    {count < items.length && <button type="button" onClick={() => setCount(value => value + 20)}>Show more activity ({items.length - count} remaining)</button>}</>;
}
const TranscriptRow = memo(function TranscriptRow({ block, active, expanded }: { block: TranscriptBlock; active: boolean; expanded: boolean }) {
  const item = block.items[0];
  if (block.kind === 'exploration') {
    const failed = block.failureCount;
    const labels: string[] = [];
    for (let i = block.items.length - 1; i >= 0 && labels.length < 3; i--) {
      const entry = block.items[i];
      if (!entry.command || hiddenItem(entry)) continue;
      labels.unshift(...entry.command.actions.slice(-3).map(action => `${actionLabel(action)}${entry.command?.exitCode ? ` (exit ${entry.command.exitCode})` : ''}`));
    }
    return <section className="agent-activity" data-activity="exploration" data-active={active} data-failed={!!failed}>
      <div className="agent-activity-heading"><span className="agent-marker">{active ? '◌' : '•'}</span><strong>{active ? 'Exploring' : 'Explored'}</strong><small>{block.commandCount} {block.commandCount === 1 ? 'command' : 'commands'}{failed ? ` · ${failed} failed` : ''}</small></div>
      <div className="agent-activity-preview">{labels.slice(-3).map((label, i) => <div key={i} title={label}>{label}</div>)}</div>
      <Disclosure expanded={expanded} label="Show details">{() => <ExplorationDetails items={block.items} />}</Disclosure>
    </section>;
  }
  if (hiddenItem(item)) return expanded && item.kind === 'reasoning' && item.text ? <section className="agent-reasoning"><ItemDetails item={item} /></section> : null;
  if (item.kind === 'assistant' || item.kind === 'user' || (item.kind === 'plan' && !item.plan)) return <article className={`agent-message agent-message-${item.kind}`} data-phase={item.phase}>
    {item.kind === 'plan' && <strong className="agent-message-label">Proposed Plan</strong>}
    {item.kind === 'user' && <span className="agent-user-label">You</span>}
    <CodexMarkdown text={item.text} streaming={active} />
    {item.references && <ChatReferenceDetails references={item.references} />}
    <div className="agent-message-actions"><CopyButton text={item.text} label="Copy message" /></div>
  </article>;
  if (item.sourceType === 'fileChange' && item.changes) {
    const applied = item.status === 'completed', failed = failedItem(item);
    const added = item.changes.reduce((sum, file) => sum + file.added, 0), removed = item.changes.reduce((sum, file) => sum + file.removed, 0);
    return <section className="agent-activity" data-activity="files" data-failed={failed}>
      <div className="agent-activity-heading"><span className="agent-marker">{failed ? '×' : '•'}</span><strong>{applied ? 'Edited' : active ? 'Editing' : item.status === 'declined' ? 'Declined changes to' : 'Changes stopped for'} {item.changes.length} {item.changes.length === 1 ? 'file' : 'files'}</strong><span className="agent-diff-add">+{added}</span><span className="agent-diff-remove">−{removed}</span>{failed && <strong>Failed</strong>}</div>
      {item.changes.slice(0, 3).map(file => <div className="agent-file-preview" key={file.path}><code title={file.path}>{file.path}</code><Diff text={file.diff} limit={3} /></div>)}
      <Disclosure expanded={expanded} label="Show changes">{() => <FileDetails item={item} />}</Disclosure>
    </section>;
  }
  if (item.plan) return <section className="agent-activity" data-activity="plan"><div className="agent-activity-heading"><span className="agent-marker">•</span><strong>Updated plan</strong><small>{item.plan.filter(step => step.status === 'completed').length}/{item.plan.length}</small></div>
    <ol className="agent-plan-steps">{item.plan.slice(0, 3).map((step, i) => <li key={i} data-state={step.status}><span>{step.status === 'completed' ? '✓' : step.status === 'inProgress' ? '◌' : '○'}</span>{step.step}</li>)}</ol>
    <Disclosure expanded={expanded}>{() => <>{item.text && <CodexMarkdown text={item.text} />}<ol className="agent-plan-steps">{item.plan!.map((step, i) => <li key={i} data-state={step.status}>{step.status === 'completed' ? '✓' : step.status === 'inProgress' ? '◌' : '○'} {step.step}</li>)}</ol></>}</Disclosure></section>;
  const failed = failedItem(item);
  const commandLabel = active ? 'Running' : failed ? `Failed${item.command?.exitCode !== undefined ? ` (exit ${item.command.exitCode})` : ''}` : item.status === 'inProgress' ? 'Stopped' : item.status === 'declined' ? 'Declined' : 'Ran';
  return <section className={`agent-activity agent-${item.kind}`} data-activity={item.command ? 'command' : item.kind} data-active={active} data-failed={failed}>
    <div className="agent-activity-heading"><span className="agent-marker">{failed ? '×' : active ? '◌' : '•'}</span>
      {item.command ? <><strong>{commandLabel}</strong><code title={item.command.command}>{item.command.command.split('\n')[0]}</code></> : <strong>{item.title || 'Activity'}</strong>}
      {!item.command && (active || failed) && <small>{active ? 'Running' : 'Failed'}</small>}
      {item.command?.durationMs !== undefined && <small>{(item.command.durationMs / 1000).toFixed(1)}s</small>}
    </div>
    {(item.command || item.kind === 'interaction') && <div className="agent-activity-preview">{(outputPreview(item.text) || (active ? 'Waiting for output…' : '(no output)')).split('\n').map((line, i) => <div key={i} title={line}>{line || '\u00a0'}</div>)}</div>}
    {(item.text || item.command) && <Disclosure expanded={expanded}>{() => <Output item={item} />}</Disclosure>}
  </section>;
});

/** The transcript is isolated from composer edits and retains completed row identities. */
export const ChatTranscript = memo(function ChatTranscript({ session, open, zoom, onZoomChange }: { session: ChatSession; open: boolean; zoom: number; onZoomChange: (value: number) => void }) {
  const projector = useMemo(() => new TranscriptProjector(), [session.id]);
  const blocks = useMemo(() => projector.project(session.items), [projector, session.items]);
  const [expanded, setExpanded] = useState(false), [count, setCount] = useState(80), [following, setFollowing] = useState(true);
  const viewport = useRef<HTMLDivElement>(null), body = useRef<HTMLDivElement>(null);
  const userScrollUntil = useRef(0);
  const follow = useRef(true), anchor = useRef<{ id: string; offset: number } | undefined>(undefined);
  const first = Math.max(0, blocks.length - count);
  // Bound mounted history while following; preserve the visible slice when reading backward.
  const start = useRef(first);
  start.current = follow.current ? first : Math.min(start.current, first);
  const rememberAnchor = () => {
    const el = viewport.current;
    if (!el || follow.current) { anchor.current = undefined; return; }
    const top = el.getBoundingClientRect().top;
    const row = Array.from(el.querySelectorAll<HTMLElement>('[data-transcript-row]')).find(row => row.getBoundingClientRect().bottom > top);
    if (row) anchor.current = { id: row.dataset.transcriptRow!, offset: row.getBoundingClientRect().top - top };
  };
  const { changeZoom } = useTranscriptZoom(viewport, () => { userScrollUntil.current = 0; rememberAnchor(); }, zoom, onZoomChange);
  const lastUser = useRef<string | undefined>(undefined);
  useLayoutEffect(() => {
    let user: string | undefined;
    for (let i = session.items.length - 1; i >= 0; i--) if (session.items[i].kind === 'user') { user = session.items[i].id; break; }
    if (user !== lastUser.current) { lastUser.current = user; userScrollUntil.current = 0; follow.current = true; setFollowing(true); }
  }, [session.items]);
  useLayoutEffect(() => {
    if (!open) return;
    let frame = 0;
    const place = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const el = viewport.current;
        if (!el) return;
        if (follow.current) el.scrollTop = el.scrollHeight;
        else if (anchor.current) {
          const row = Array.from(el.querySelectorAll<HTMLElement>('[data-transcript-row]')).find(row => row.dataset.transcriptRow === anchor.current!.id);
          if (row) el.scrollTop += row.getBoundingClientRect().top - el.getBoundingClientRect().top - anchor.current.offset;
        }
      });
    };
    place();
    const observer = new ResizeObserver(place);
    if (body.current) observer.observe(body.current);
    if (viewport.current) observer.observe(viewport.current);
    return () => { cancelAnimationFrame(frame); observer.disconnect(); };
  }, [open, blocks, expanded, count]);
  return <ActivitySession.Provider value={session.id}><div className="agent-transcript-controls"><button type="button" aria-pressed={expanded} onClick={() => { if (follow.current) userScrollUntil.current = 0; rememberAnchor(); setExpanded(value => !value); }}>{expanded ? 'Compact transcript' : 'Expand transcript'}</button>
      <div className="agent-transcript-zoom" role="group" aria-label="Markdown zoom" title="Ctrl/Cmd + scroll to zoom markdown">
        <button type="button" aria-label="Zoom out markdown" disabled={zoom <= 75} onClick={() => changeZoom(zoom - 10)}>−</button>
        <button type="button" aria-label="Reset markdown zoom" onClick={() => changeZoom(100)}>{zoom}%</button>
        <button type="button" aria-label="Zoom in markdown" disabled={zoom >= 200} onClick={() => changeZoom(zoom + 10)}>+</button>
      </div></div>
    <div className="agent-chat-timeline" ref={viewport} onClickCapture={() => { if (follow.current) userScrollUntil.current = 0; }} tabIndex={0} aria-label="Conversation transcript"
      onWheel={event => { if (!event.ctrlKey && !event.metaKey) userScrollUntil.current = performance.now() + 500; }}
      onTouchMove={() => { userScrollUntil.current = performance.now() + 500; }}
      onPointerDown={event => { if (event.target === viewport.current) userScrollUntil.current = performance.now() + 1500; }}
      onKeyDown={event => { if (['ArrowUp', 'ArrowDown', 'PageUp', 'PageDown', 'Home', 'End', ' '].includes(event.key)) userScrollUntil.current = performance.now() + 500; }}
      onScroll={event => {
      if (event.target !== viewport.current || performance.now() > userScrollUntil.current) return;
      const el = viewport.current!;
      follow.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
      setFollowing(follow.current); rememberAnchor();
    }}><div ref={body}>
      {start.current > 0 && <button type="button" className="agent-history-more" onClick={() => { rememberAnchor(); start.current = Math.max(0, start.current - 80); setCount(value => value + 80); }}>Load earlier activity</button>}
      {blocks.slice(start.current).map(block => <div key={block.id} data-transcript-row={block.id}><TranscriptRow block={block}
        active={session.status === 'running' && block.activeCount > 0 && (!block.items[0].turnId || block.items[0].turnId === session.turnId)} expanded={expanded} /></div>)}
      {session.error && <p className="agent-chat-error" role="alert">{session.error}</p>}
      {session.completedAt && <div className="agent-completion">{session.status === 'interrupted' ? 'Stopped' : session.status === 'failed' ? 'Turn failed' : 'Completed'}{session.turnStartedAt && ` · ${Math.max(0, Math.round((Date.parse(session.completedAt) - Date.parse(session.turnStartedAt)) / 1000))}s`}</div>}
    </div></div>
    {!following && <button className="agent-chat-latest" onClick={() => { userScrollUntil.current = 0; follow.current = true; setFollowing(true); viewport.current?.scrollTo({ top: viewport.current.scrollHeight }); }}>Jump to latest ↓</button>}
  </ActivitySession.Provider>;
});
