import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { fetchRepositoryDirectory } from "../api";
import type {
  CodeEntitiesSetRecord,
  DiagramCodeEntityMapRecord,
  DiagramRecord,
  DiagramSetRecord,
  RepositoryDirectoryListing
} from "../domain";
import {
  buildFileTree,
  diagramSetFileIndex,
  directoryPaths,
  flattenFileTree,
  parentRepositoryPath,
  rollUpFileTreeLabels,
  type DiagramSetFileEntityReference,
  type FileTreeRow
} from "../fileTree";

export function FileExplorerPanel(props: {
  activeSetId: string;
  activeProjectId: string;
  diagramSets: readonly DiagramSetRecord[];
  diagrams: Readonly<Record<string, DiagramRecord>>;
  codeEntitySets: Readonly<Record<string, CodeEntitiesSetRecord>>;
  codeEntityMaps: Readonly<Record<string, DiagramCodeEntityMapRecord>>;
  onRevealCodeEntity?: (target: { entityId: string; sourceRangeIndex: number }) => void;
}) {
  const [listings, setListings] = useState<Record<string, RepositoryDirectoryListing>>({});
  const listingsRef = useRef(listings);
  const [collapsedPaths, setCollapsedPaths] = useState<Set<string>>(new Set());
  const [matchedPaths, setMatchedPaths] = useState<Set<string>>(new Set());
  const [unavailableCount, setUnavailableCount] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [focusedPath, setFocusedPath] = useState("");
  const controllers = useRef(new Map<string, AbortController>());
  const requests = useRef(new Map<string, Promise<RepositoryDirectoryListing>>());
  const requestGeneration = useRef(0);
  const filterGeneration = useRef(0);
  const rowRefs = useRef(new Map<string, HTMLElement>());

  const updateListings = useCallback((next: Record<string, RepositoryDirectoryListing>) => {
    listingsRef.current = next;
    setListings(next);
  }, []);

  const loadDirectory = useCallback((directory: string): Promise<RepositoryDirectoryListing> => {
    const cached = listingsRef.current[directory];
    if (cached) return Promise.resolve(cached);
    const pending = requests.current.get(directory);
    if (pending) return pending;
    const generation = requestGeneration.current;
    const controller = new AbortController();
    controllers.current.set(directory, controller);
    const request = fetchRepositoryDirectory(props.activeSetId, directory, controller.signal)
      .then((listing) => {
        if (requestGeneration.current === generation) {
          updateListings({ ...listingsRef.current, [directory]: listing });
        }
        return listing;
      })
      .finally(() => {
        if (controllers.current.get(directory) === controller) controllers.current.delete(directory);
        if (requests.current.get(directory) === request) requests.current.delete(directory);
      });
    requests.current.set(directory, request);
    return request;
  }, [props.activeSetId, updateListings]);

  useEffect(() => {
    requestGeneration.current += 1;
    filterGeneration.current += 1;
    for (const controller of controllers.current.values()) controller.abort();
    controllers.current.clear();
    requests.current.clear();
    updateListings({});
    setCollapsedPaths(new Set());
    setMatchedPaths(new Set());
    setUnavailableCount(0);
    setError(null);
    setFocusedPath("");
    return () => {
      requestGeneration.current += 1;
      filterGeneration.current += 1;
      for (const controller of controllers.current.values()) controller.abort();
    };
  }, [loadDirectory, props.activeSetId, updateListings]);

  const filter = useMemo(() => diagramSetFileIndex({
    projectId: props.activeProjectId,
    diagramSets: props.diagramSets,
    diagrams: props.diagrams,
    codeEntitySets: props.codeEntitySets,
    codeEntityMaps: props.codeEntityMaps
  }), [
    props.activeProjectId,
    props.codeEntityMaps,
    props.codeEntitySets,
    props.diagramSets,
    props.diagrams
  ]);

  useEffect(() => {
    const generation = ++filterGeneration.current;
    setLoading(true);
    setError(null);
    void (async () => {
      const byParent = new Map<string, string[]>();
      for (const filePath of filter.paths) {
        const parent = parentRepositoryPath(filePath);
        byParent.set(parent, [...(byParent.get(parent) ?? []), filePath]);
      }
      const matches = new Set<string>();
      let unavailable = 0;
      const failures: string[] = [];
      await Promise.all([...byParent.entries()].map(async ([parent, paths]) => {
        try {
          const listing = await loadDirectory(parent);
          const liveFiles = new Set(
            listing.entries.filter((entry) => entry.kind === "file").map((entry) => entry.path)
          );
          for (const filePath of paths) {
            if (liveFiles.has(filePath)) matches.add(filePath);
            else unavailable += 1;
          }
        } catch (caught) {
          if (!(caught instanceof DOMException && caught.name === "AbortError")) {
            unavailable += paths.length;
            failures.push(caught instanceof Error ? caught.message : "directory listing failed");
          }
        }
      }));
      if (filterGeneration.current !== generation) return;
      setMatchedPaths(matches);
      setUnavailableCount(unavailable);
      setError(failures[0] ?? null);
      setLoading(false);
    })();
  }, [filter, loadDirectory]);

  const tree = useMemo(() => buildFileTree([...matchedPaths]), [matchedPaths]);
  const expandedPaths = useMemo(() => new Set(
    directoryPaths(tree).filter((directory) => !collapsedPaths.has(directory))
  ), [collapsedPaths, tree]);
  const rows = useMemo(() => flattenFileTree(tree, expandedPaths), [expandedPaths, tree]);
  const orderedLabels = useMemo(() => filter.labels.map(({ label }) => label), [filter.labels]);
  const labelsByNodePath = useMemo(() => rollUpFileTreeLabels(
    [...matchedPaths],
    filter.labelsByPath,
    orderedLabels
  ), [filter.labelsByPath, matchedPaths, orderedLabels]);
  const labelNames = useMemo(() => new Map(
    filter.labels.map(({ label, name }) => [label, name])
  ), [filter.labels]);
  const labelColumnWidth = Math.max(1, orderedLabels.join("|").length);

  useEffect(() => {
    if (rows.some((row) => row.path === focusedPath)) return;
    setFocusedPath(rows[0]?.path ?? "");
  }, [focusedPath, rows]);

  const isExpanded = (row: FileTreeRow): boolean => (
    row.kind === "directory" && expandedPaths.has(row.path)
  );

  const toggleDirectory = (row: FileTreeRow) => {
    if (row.kind !== "directory") return;
    setCollapsedPaths((current) => {
      const next = new Set(current);
      if (next.has(row.path)) next.delete(row.path);
      else next.add(row.path);
      return next;
    });
  };

  const focusRow = (path: string) => {
    setFocusedPath(path);
    requestAnimationFrame(() => rowRefs.current.get(path)?.focus());
  };

  const activeReference = (filePath: string): DiagramSetFileEntityReference | undefined => (
    filter.entitiesByPath[filePath]?.find((reference) => reference.diagramSetId === props.activeSetId)
  );

  const revealEntity = (entity: DiagramSetFileEntityReference) => {
    props.onRevealCodeEntity?.({
      entityId: entity.entityId,
      sourceRangeIndex: entity.sourceRangeIndex
    });
  };

  const onRowKeyDown = (event: KeyboardEvent<HTMLElement>, row: FileTreeRow, index: number) => {
    if (event.key === "ArrowDown" && rows[index + 1]) {
      event.preventDefault();
      focusRow(rows[index + 1].path);
    } else if (event.key === "ArrowUp" && rows[index - 1]) {
      event.preventDefault();
      focusRow(rows[index - 1].path);
    } else if (event.key === "Home" && rows[0]) {
      event.preventDefault();
      focusRow(rows[0].path);
    } else if (event.key === "End" && rows.at(-1)) {
      event.preventDefault();
      focusRow(rows.at(-1)!.path);
    } else if (event.key === "ArrowRight" && row.kind === "directory") {
      event.preventDefault();
      if (!isExpanded(row)) toggleDirectory(row);
      else if (rows[index + 1]?.parentPath === row.path) focusRow(rows[index + 1].path);
    } else if (event.key === "ArrowLeft") {
      if (row.kind === "directory" && isExpanded(row)) {
        event.preventDefault();
        toggleDirectory(row);
      } else if (row.parentPath) {
        event.preventDefault();
        focusRow(row.parentPath);
      }
    } else if ((event.key === "Enter" || event.key === " ") && row.kind === "directory") {
      event.preventDefault();
      toggleDirectory(row);
    } else if (event.key === "Enter" && row.kind === "file") {
      const reference = activeReference(row.path);
      if (reference) {
        event.preventDefault();
        revealEntity(reference);
      }
    }
  };

  const omittedCount = filter.foreignEntityIds.length
    + filter.unresolvedEntityIds.length
    + filter.invalidPaths.length
    + unavailableCount;
  const emptyMessage = loading
    ? "Matching mapped source paths against the live checkout..."
    : "No mapped files are available across the project DiagramSets.";

  return (
    <section className="file-explorer" aria-label="Mapped files across DiagramSets">
      <div className="file-explorer__mode-bar">
        <strong>MAPPED FILES</strong>
        <span aria-live="polite">{loading
          ? "MATCHING"
          : `${matchedPaths.size} FILES · ${orderedLabels.join("|") || "NO SETS"}${
            omittedCount ? ` · ${omittedCount} UNAVAILABLE` : ""
          }`}</span>
      </div>
      <div
        className="file-tree-scroller"
        role="tree"
        aria-label="Mapped files by DiagramSet"
        aria-busy={loading}
      >
        {rows.map((row, index) => {
          const expanded = isExpanded(row);
          const labels = labelsByNodePath[row.path] ?? [];
          const labelText = labels.join("|");
          const labelTitle = labels.map((label) => labelNames.get(label) ?? label).join(" | ");
          const reference = row.kind === "file" ? activeReference(row.path) : undefined;
          return (
            <div
              ref={(node) => {
                if (node) rowRefs.current.set(row.path, node);
                else rowRefs.current.delete(row.path);
              }}
              key={row.path}
              className={`file-tree-row file-tree-row--${row.kind}`}
              role="treeitem"
              aria-level={row.level}
              aria-expanded={row.kind === "directory" ? expanded : undefined}
              tabIndex={focusedPath === row.path ? 0 : -1}
              title={row.path}
              data-path={row.path}
              data-diagram-set-labels={labelText}
              onFocus={() => setFocusedPath(row.path)}
              onClick={() => {
                focusRow(row.path);
                if (row.kind === "directory") toggleDirectory(row);
              }}
              onKeyDown={(event) => onRowKeyDown(event, row, index)}
            >
              <span
                className="file-tree-row__set-labels"
                style={{ width: `${labelColumnWidth}ch` }}
                title={labelTitle}
              >{labelText}</span>
              <span className="file-tree-row__prefix" aria-hidden="true">{row.prefix}</span>
              {row.kind === "directory" ? (
                <span className="file-tree-row__toggle" aria-hidden="true">{expanded ? "[-]" : "[+]"}</span>
              ) : <span className="file-tree-row__toggle" aria-hidden="true">   </span>}
              {row.kind === "file" && reference ? (
                <button
                  type="button"
                  className="file-tree-row__name file-tree-row__name-button"
                  aria-label={`Open mapped source for ${row.name} in the active DiagramSet`}
                  tabIndex={-1}
                  onClick={(event) => {
                    event.stopPropagation();
                    focusRow(row.path);
                    revealEntity(reference);
                  }}
                >{row.name}</button>
              ) : <span className="file-tree-row__name">{row.name}</span>}
            </div>
          );
        })}
        {rows.length === 0 ? (
          <div className="file-tree-empty">
            <p>{emptyMessage}</p>
          </div>
        ) : null}
        {error ? (
          <p className="file-tree-warning" role="alert">Some repository paths could not be checked: {error}</p>
        ) : null}
      </div>
    </section>
  );
}
