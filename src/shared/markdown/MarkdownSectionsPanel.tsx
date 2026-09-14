import {
  useEffect,
  useMemo,
  useState,
  type ReactNode
} from "react";
import type { PaneJumpHistoryEntry } from "../panes/navigation";
import type { TerminalMarkdownSection } from "./toc";

export interface MarkdownSectionTreeNode {
  section: TerminalMarkdownSection;
  children: MarkdownSectionTreeNode[];
}

export interface MarkdownSectionJumpMarker {
  entry: PaneJumpHistoryEntry;
  rank: number;
  sectionId: string;
}

export function buildMarkdownSectionTree(
  sections: readonly TerminalMarkdownSection[]
): MarkdownSectionTreeNode[] {
  const roots: MarkdownSectionTreeNode[] = [];
  const stack: MarkdownSectionTreeNode[] = [];
  for (const section of sections) {
    const node = { section, children: [] } satisfies MarkdownSectionTreeNode;
    while (stack.length > 0 && stack.at(-1)!.section.level >= section.level) stack.pop();
    const parent = stack.at(-1);
    if (parent) parent.children.push(node);
    else roots.push(node);
    stack.push(node);
  }
  return roots;
}

function jumpSourceLocation(entry: PaneJumpHistoryEntry): { path: string; line: number } | null {
  if (!entry.payload || typeof entry.payload !== "object") return null;
  const payload = entry.payload as { path?: unknown; line?: unknown };
  return typeof payload.path === "string" && typeof payload.line === "number"
    ? { path: payload.path, line: payload.line }
    : null;
}

/** Assigns recent jumps to the most specific Markdown section containing them. */
export function mapJumpHistoryToSections(
  path: string | undefined,
  sections: readonly TerminalMarkdownSection[],
  jumpHistory: readonly PaneJumpHistoryEntry[]
): MarkdownSectionJumpMarker[] {
  if (!path) return [];
  return jumpHistory.flatMap((entry, index) => {
    const location = jumpSourceLocation(entry);
    if (!location || location.path !== path) return [];
    const section = sections
      .filter((candidate) => candidate.startLine <= location.line && location.line <= candidate.endLine)
      .sort((left, right) => right.level - left.level || right.startLine - left.startLine)[0];
    return section ? [{ entry, rank: index + 1, sectionId: section.id }] : [];
  });
}

function truncate(value: string, limit = 44): string {
  return value.length <= limit ? value : `${value.slice(0, limit - 1).trimEnd()}…`;
}

function branchPrefix(ancestorsLast: readonly boolean[], last: boolean): string {
  return `${ancestorsLast.map((ancestorLast) => ancestorLast ? "    " : "|   ").join("")}${last ? "`-- " : "+-- "}`;
}

function ancestorIds(nodes: readonly MarkdownSectionTreeNode[], activeId: string): string[] {
  for (const node of nodes) {
    if (node.section.id === activeId) return [];
    const childPath = ancestorIds(node.children, activeId);
    if (childPath.length > 0 || node.children.some((child) => child.section.id === activeId)) {
      return [node.section.id, ...childPath];
    }
  }
  return [];
}

export function MarkdownSectionsPanel(props: {
  path?: string;
  title?: string;
  sections: readonly TerminalMarkdownSection[];
  activeSectionId?: string;
  jumpHistory: readonly PaneJumpHistoryEntry[];
  onJumpSection: (section: TerminalMarkdownSection) => void;
  onReplayJump: (entry: PaneJumpHistoryEntry) => void;
  onClearHistory?: () => void;
}) {
  const roots = useMemo(() => buildMarkdownSectionTree(props.sections), [props.sections]);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [documentCollapsed, setDocumentCollapsed] = useState(false);
  const jumpMarkers = useMemo(
    () => mapJumpHistoryToSections(props.path, props.sections, props.jumpHistory),
    [props.jumpHistory, props.path, props.sections]
  );
  const markersBySection = useMemo(() => {
    const mapped = new Map<string, MarkdownSectionJumpMarker[]>();
    jumpMarkers.forEach((marker) => {
      mapped.set(marker.sectionId, [...(mapped.get(marker.sectionId) ?? []), marker]);
    });
    return mapped;
  }, [jumpMarkers]);

  useEffect(() => {
    if (!props.activeSectionId) return;
    const ancestors = ancestorIds(roots, props.activeSectionId);
    if (ancestors.length === 0) return;
    setCollapsed((current) => {
      if (!ancestors.some((id) => current.has(id))) return current;
      const next = new Set(current);
      ancestors.forEach((id) => next.delete(id));
      return next;
    });
  }, [props.activeSectionId, roots]);

  const toggle = (id: string) => setCollapsed((current) => {
    const next = new Set(current);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    return next;
  });

  const renderSection = (
    node: MarkdownSectionTreeNode,
    last: boolean,
    ancestorsLast: boolean[]
  ): ReactNode => {
    const hasChildren = node.children.length > 0;
    const isCollapsed = collapsed.has(node.section.id);
    const active = node.section.id === props.activeSectionId;
    const markers = markersBySection.get(node.section.id) ?? [];
    return (
      <div className="markdown-section-branch" key={node.section.id}>
        <div
          className={`markdown-section-row${active ? " is-current" : ""}${markers.length > 0 ? " has-jump" : ""}`}
          role="treeitem"
          aria-level={ancestorsLast.length + 2}
          aria-expanded={hasChildren ? !isCollapsed : undefined}
          aria-current={active ? "location" : undefined}
          data-markdown-section-id={node.section.id}
        >
          <span className="markdown-section-prefix" aria-hidden="true">{
            branchPrefix(ancestorsLast, last)
          }</span>
          {hasChildren ? (
            <button
              type="button"
              className="markdown-section-toggle"
              aria-label={`${isCollapsed ? "Expand" : "Collapse"} ${node.section.label}`}
              onClick={() => toggle(node.section.id)}
            >[{isCollapsed ? "+" : "-"}]</button>
          ) : <span className="markdown-section-toggle" aria-hidden="true">[·]</span>}
          {markers.length > 0 ? (
            <span className="markdown-section-jumps" aria-label="Recent jumps">
              {markers.map((marker) => (
                <button
                  type="button"
                  className="markdown-section-jump"
                  data-jump-rank={marker.rank}
                  key={marker.entry.jumpId}
                  title={`Replay jump ${marker.rank}: ${marker.entry.label}${marker.entry.detail ? ` · ${marker.entry.detail}` : ""}`}
                  onClick={() => props.onReplayJump(marker.entry)}
                >[J{marker.rank}]</button>
              ))}
            </span>
          ) : null}
          <button
            type="button"
            className="markdown-section-label"
            title={`${node.section.label} · lines ${node.section.startLine}-${node.section.endLine}`}
            onClick={() => props.onJumpSection(node.section)}
          >{truncate(node.section.label)}</button>
          <span className="markdown-section-line">L{node.section.startLine}</span>
        </div>
        {!isCollapsed ? node.children.map((child, index) => renderSection(
          child,
          index === node.children.length - 1,
          [...ancestorsLast, last]
        )) : null}
      </div>
    );
  };

  return (
    <section className="markdown-sections-panel" aria-label="Markdown sections">
      <div className="markdown-sections-summary">
        <strong>SECTIONS</strong>
        <div className="markdown-sections-summary-meta">
          <span>{props.sections.length} NODE{props.sections.length === 1 ? "" : "S"} · {jumpMarkers.length} MARKED</span>
          {props.jumpHistory.length > 0 && props.onClearHistory ? (
            <button type="button" className="markdown-sections-clear" onClick={props.onClearHistory}>clear</button>
          ) : null}
        </div>
      </div>
      <div className="markdown-sections-tree" role="tree" aria-label="Markdown section navigation">
        <div className="markdown-section-group" role="treeitem" aria-level={1} aria-expanded={!documentCollapsed}>
          <div className="markdown-section-root-row">
            <button
              type="button"
              className="markdown-section-toggle"
              aria-label={`${documentCollapsed ? "Expand" : "Collapse"} ${props.path ?? "document"}`}
              onClick={() => setDocumentCollapsed((current) => !current)}
            >[{documentCollapsed ? "+" : "-"}]</button>
            <strong title={props.title}>{props.path ?? "NO MARKDOWN DOCUMENT"}</strong>
          </div>
          {!documentCollapsed ? (
            <div role="group">
              {roots.map((root, index) => renderSection(root, index === roots.length - 1, []))}
              {roots.length === 0 ? (
                <p className="markdown-sections-empty">Open a Markdown source view to load its section tree.</p>
              ) : null}
            </div>
          ) : null}
        </div>
      </div>
    </section>
  );
}
