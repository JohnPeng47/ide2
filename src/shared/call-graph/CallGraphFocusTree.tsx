import {
  useMemo,
  useRef,
  useState,
  type KeyboardEvent
} from "react";
import type { CallGraphFocusNode, CallGraphFocusResult } from "../../../domain/core/source/callGraphFocus";

export interface VisibleCallGraphNode {
  node: CallGraphFocusNode;
  path: string;
  parentPath?: string;
  depth: number;
  position: number;
  siblingCount: number;
}

export function flattenVisibleCallGraph(
  roots: readonly CallGraphFocusNode[],
  expanded: ReadonlySet<string>
): VisibleCallGraphNode[] {
  const visible: VisibleCallGraphNode[] = [];
  const visit = (
    nodes: readonly CallGraphFocusNode[],
    depth: number,
    parentPath?: string
  ) => {
    nodes.forEach((node, index) => {
      const path = parentPath === undefined ? `${index}` : `${parentPath}.${index}`;
      visible.push({
        node,
        path,
        parentPath,
        depth,
        position: index + 1,
        siblingCount: nodes.length
      });
      if (node.children.length > 0 && expanded.has(path)) {
        visit(node.children, depth + 1, path);
      }
    });
  };
  visit(roots, 1);
  return visible;
}

function initiallyExpandedPaths(roots: readonly CallGraphFocusNode[]): Set<string> {
  const expanded = new Set<string>();
  const visit = (nodes: readonly CallGraphFocusNode[], parentPath?: string) => {
    nodes.forEach((node, index) => {
      const path = parentPath === undefined ? `${index}` : `${parentPath}.${index}`;
      if (node.children.length > 0) {
        expanded.add(path);
        visit(node.children, path);
      }
    });
  };
  visit(roots);
  return expanded;
}

export function CallGraphFocusTree(props: { result: CallGraphFocusResult }) {
  const [expanded, setExpanded] = useState(() => initiallyExpandedPaths(props.result.roots));
  const [activePath, setActivePath] = useState(() => props.result.roots.length > 0 ? "0" : "");
  const treeRef = useRef<HTMLDivElement>(null);
  const visible = useMemo(
    () => flattenVisibleCallGraph(props.result.roots, expanded),
    [expanded, props.result.roots]
  );

  const focusPath = (path: string) => {
    setActivePath(path);
    const item = [...(treeRef.current?.querySelectorAll<HTMLElement>("[data-call-graph-tree-item]") ?? [])]
      .find((candidate) => candidate.dataset.treePath === path);
    item?.focus();
  };
  const toggle = (path: string) => setExpanded((current) => {
    const next = new Set(current);
    if (next.has(path)) next.delete(path);
    else next.add(path);
    return next;
  });
  const handleKeyDown = (
    event: KeyboardEvent<HTMLDivElement>,
    item: VisibleCallGraphNode,
    index: number
  ) => {
    if (event.target !== event.currentTarget) return;
    const hasChildren = item.node.children.length > 0;
    if (event.key === "ArrowDown" && visible[index + 1]) {
      event.preventDefault();
      focusPath(visible[index + 1].path);
    } else if (event.key === "ArrowUp" && visible[index - 1]) {
      event.preventDefault();
      focusPath(visible[index - 1].path);
    } else if (event.key === "ArrowRight" && hasChildren) {
      event.preventDefault();
      if (expanded.has(item.path)) focusPath(`${item.path}.0`);
      else toggle(item.path);
    } else if (event.key === "ArrowLeft") {
      if (hasChildren && expanded.has(item.path)) {
        event.preventDefault();
        toggle(item.path);
      } else if (item.parentPath !== undefined) {
        event.preventDefault();
        focusPath(item.parentPath);
      }
    } else if (event.key === "Home" && visible[0]) {
      event.preventDefault();
      focusPath(visible[0].path);
    } else if (event.key === "End" && visible.at(-1)) {
      event.preventDefault();
      focusPath(visible.at(-1)!.path);
    } else if ((event.key === "Enter" || event.key === " ") && hasChildren) {
      event.preventDefault();
      toggle(item.path);
    }
  };

  return (
    <section className="call-graph-focus-panel" aria-label={`Focused ${props.result.callGraphName}`}>
      <header className="pane-header call-graph-focus-header">
        <div>
          <span className="eyebrow">FOCUSED CALL GRAPH</span>
          <h2>{props.result.callGraphName}</h2>
        </div>
        <span className="call-graph-focus-count">
          {visible.length} visible node{visible.length === 1 ? "" : "s"}
        </span>
      </header>
      {props.result.roots.length === 0 ? (
        <p className="call-graph-focus-empty">No call-graph nodes match this selection.</p>
      ) : (
        <div
          ref={treeRef}
          className="call-graph-focus-tree"
          role="tree"
          aria-label={`${props.result.callGraphName} nodes`}
        >
          {visible.map((item, index) => {
            const hasChildren = item.node.children.length > 0;
            const isExpanded = expanded.has(item.path);
            return (
              <div
                key={item.path}
                className="call-graph-focus-treeitem"
                role="treeitem"
                aria-expanded={hasChildren ? isExpanded : undefined}
                aria-level={item.depth}
                aria-posinset={item.position}
                aria-setsize={item.siblingCount}
                tabIndex={activePath === item.path ? 0 : -1}
                data-call-graph-tree-item=""
                data-tree-path={item.path}
                style={{ paddingInlineStart: `${0.75 + (item.depth - 1) * 1.15}rem` }}
                onFocus={() => setActivePath(item.path)}
                onKeyDown={(event) => handleKeyDown(event, item, index)}
              >
                {hasChildren ? (
                  <button
                    type="button"
                    className="call-graph-focus-toggle"
                    aria-label={`${isExpanded ? "Collapse" : "Expand"} ${item.node.label}`}
                    aria-expanded={isExpanded}
                    onClick={() => toggle(item.path)}
                  >{isExpanded ? "−" : "+"}</button>
                ) : <span className="call-graph-focus-leaf" aria-hidden="true">·</span>}
                <span className="call-graph-focus-label">{item.node.label}</span>
                {item.node.codeEntity ? (
                  <span className="call-graph-focus-entity">code entity</span>
                ) : null}
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}
