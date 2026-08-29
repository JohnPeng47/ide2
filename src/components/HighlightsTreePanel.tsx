import { useMemo, useState, type ReactNode } from "react";
import type { DiagramHighlightRecord } from "../domain";

interface HighlightTreeNode {
  key: string;
  text: string;
  children: HighlightTreeNode[];
  highlight?: DiagramHighlightRecord;
}

function truncate(text: string, limit = 48): string {
  return text.length <= limit ? text : `${text.slice(0, limit - 1).trimEnd()}…`;
}

function buildTree(highlights: readonly DiagramHighlightRecord[]): HighlightTreeNode[] {
  const artifacts = new Map<string, HighlightTreeNode>();
  for (const highlight of highlights) {
    const artifactKey = `${highlight.diagramSetId}:${highlight.artifactId}`;
    let artifact = artifacts.get(artifactKey);
    if (!artifact) {
      artifact = { key: artifactKey, text: highlight.artifactName, children: [] };
      artifacts.set(artifactKey, artifact);
    }
    let parent = artifact;
    for (const [index, lineage] of highlight.lineage.entries()) {
      const key = `${artifactKey}:${lineage.graphLine}:${lineage.text}`;
      let node = parent.children.find((candidate) => candidate.key === key);
      if (!node) {
        node = { key, text: lineage.text, children: [] };
        parent.children.push(node);
      }
      if (index === highlight.lineage.length - 1) node.highlight = highlight;
      parent = node;
    }
  }
  return [...artifacts.values()];
}

export function HighlightsTreePanel(props: {
  highlights: readonly DiagramHighlightRecord[];
  activeSetId: string;
  onReveal: (highlight: DiagramHighlightRecord) => void;
  onRemove: (highlight: DiagramHighlightRecord) => void;
}) {
  const highlights = props.highlights.filter((highlight) => highlight.diagramSetId === props.activeSetId);
  const roots = useMemo(() => buildTree(highlights), [highlights]);
  const [collapsedKeys, setCollapsedKeys] = useState<Set<string>>(new Set());

  const toggle = (key: string) => setCollapsedKeys((current) => {
    const next = new Set(current);
    if (next.has(key)) next.delete(key);
    else next.add(key);
    return next;
  });

  const renderNode = (node: HighlightTreeNode, depth: number, last: boolean): ReactNode => {
    const collapsed = collapsedKeys.has(node.key);
    const hasChildren = node.children.length > 0;
    const prefix = `${depth > 1 ? "|    ".repeat(depth - 1) : ""}${last ? "`--> " : "+--> "}`;
    return (
      <div className="highlight-tree-branch" key={node.key}>
        <div
          className={`highlight-tree-row${node.highlight ? " is-highlight" : ""}`}
          role="treeitem"
          aria-level={depth}
          aria-expanded={hasChildren ? !collapsed : undefined}
          data-highlight-id={node.highlight?.id}
          title={node.text}
        >
          <span className="highlight-tree-prefix" aria-hidden="true">{prefix}</span>
          {hasChildren ? (
            <button
              type="button"
              className="highlight-tree-toggle"
              aria-label={`${collapsed ? "Expand" : "Collapse"} ${node.text}`}
              onClick={() => toggle(node.key)}
            >[{collapsed ? "+" : "-"}]</button>
          ) : <span className="highlight-tree-toggle" aria-hidden="true">[★]</span>}
          {node.highlight ? (
            <button
              type="button"
              className="highlight-tree-label"
              onClick={() => props.onReveal(node.highlight!)}
            >{truncate(node.text)}</button>
          ) : <span className="highlight-tree-label">{truncate(node.text)}</span>}
          {node.highlight ? (
            <button
              type="button"
              className="highlight-tree-remove"
              aria-label={`Remove ${node.text} from highlights`}
              title="Remove highlight"
              onClick={() => props.onRemove(node.highlight!)}
            >[x]</button>
          ) : null}
        </div>
        {!collapsed && hasChildren ? node.children.map((child, index) => (
          renderNode(child, depth + 1, index === node.children.length - 1)
        )) : null}
      </div>
    );
  };

  return (
    <section className="highlights-panel" aria-label="Highlights">
      <div className="highlights-summary">
        <strong>HIGHLIGHTS</strong>
        <span>{highlights.length} SAVED</span>
      </div>
      <div className="highlight-tree" role="tree" aria-label="Saved tree highlights">
        {roots.map((root, index) => renderNode(root, 1, index === roots.length - 1))}
        {roots.length === 0 ? (
          <div className="highlight-tree-empty">
            <p>Use [☆] beside a mapped node to save its lineage and transcript.</p>
          </div>
        ) : null}
      </div>
    </section>
  );
}
