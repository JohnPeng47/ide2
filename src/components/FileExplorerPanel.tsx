import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { fetchRepositoryDirectory } from "../api";
import type {
  CodeEntityRecord,
  DiagramComponentRecord,
  DiagramRecord,
  RepositoryDirectoryListing
} from "../domain";
import {
  buildFileTree,
  diagramFileFilter,
  directoryPaths,
  flattenFileTree,
  parentRepositoryPath,
  type DiagramFileEntityReference,
  type FileTreeRow
} from "../fileTree";

type ExplorerDisplayRow = {
  key: string;
  kind: "repository";
  row: FileTreeRow;
} | {
  key: string;
  kind: "entity";
  filePath: string;
  level: number;
  prefix: string;
  entity: DiagramFileEntityReference;
};

export function FileExplorerPanel(props: {
  activeSetId: string;
  activeProjectId: string;
  codeEntities: readonly CodeEntityRecord[];
  artifact?: DiagramRecord | DiagramComponentRecord;
  onRevealCodeEntity?: (target: {
    entityId: string;
    sourceRangeIndex: number;
    targetLine?: number;
  }) => void;
}) {
  const [listings, setListings] = useState<Record<string, RepositoryDirectoryListing>>({});
  const listingsRef = useRef(listings);
  const [filterCollapsedPaths, setFilterCollapsedPaths] = useState<Set<string>>(new Set());
  const [matchedFilterPaths, setMatchedFilterPaths] = useState<Set<string>>(new Set());
  const [unavailableFilterCount, setUnavailableFilterCount] = useState(0);
  const [filterLoading, setFilterLoading] = useState(false);
  const [filterError, setFilterError] = useState<string | null>(null);
  const [expandedEntityPaths, setExpandedEntityPaths] = useState<Set<string>>(new Set());
  const [focusedRowKey, setFocusedRowKey] = useState("");
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
    setFilterCollapsedPaths(new Set());
    setMatchedFilterPaths(new Set());
    setUnavailableFilterCount(0);
    setFilterError(null);
    setExpandedEntityPaths(new Set());
    setFocusedRowKey("");
    return () => {
      requestGeneration.current += 1;
      filterGeneration.current += 1;
      for (const controller of controllers.current.values()) controller.abort();
    };
  }, [loadDirectory, props.activeSetId, updateListings]);

  const filter = useMemo(() => props.artifact ? diagramFileFilter(
    props.artifact,
    props.codeEntities,
    props.activeProjectId,
    props.codeEntities
      .filter((entity) => entity.origin?.diagramSetId === "project-catalog")
      .map((entity) => entity.id)
  ) : {
    paths: [],
    entitiesByPath: {},
    unresolvedEntityIds: [],
    foreignEntityIds: [],
    invalidPaths: []
  }, [props.activeProjectId, props.artifact, props.codeEntities]);

  useEffect(() => {
    const generation = ++filterGeneration.current;
    setFilterLoading(true);
    setFilterError(null);
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
        } catch (error) {
          if (!(error instanceof DOMException && error.name === "AbortError")) {
            unavailable += paths.length;
            failures.push(error instanceof Error ? error.message : "directory listing failed");
          }
        }
      }));
      if (filterGeneration.current !== generation) return;
      setMatchedFilterPaths(matches);
      setUnavailableFilterCount(unavailable);
      setFilterError(failures[0] ?? null);
      setFilterLoading(false);
    })();
  }, [filter, loadDirectory]);

  const filterTree = useMemo(
    () => buildFileTree([...matchedFilterPaths]),
    [matchedFilterPaths]
  );
  const filterExpandedPaths = useMemo(() => new Set(
    directoryPaths(filterTree).filter((directory) => !filterCollapsedPaths.has(directory))
  ), [filterCollapsedPaths, filterTree]);
  const rows = useMemo(
    () => flattenFileTree(filterTree, filterExpandedPaths),
    [filterExpandedPaths, filterTree]
  );

  const displayRows = useMemo<ExplorerDisplayRow[]>(() => rows.flatMap((row) => {
    const repositoryRow: ExplorerDisplayRow = { key: row.path, kind: "repository", row };
    const references = row.kind === "file" ? filter.entitiesByPath[row.path] ?? [] : [];
    if (!references.length || !expandedEntityPaths.has(row.path)) return [repositoryRow];
    const basePrefix = row.level === 1 ? "" : row.prefix.slice(0, -4);
    return [repositoryRow, ...references.map((entity, index): ExplorerDisplayRow => ({
      key: `${row.path}::${entity.entityId}`,
      kind: "entity",
      filePath: row.path,
      level: row.level + 1,
      prefix: `${basePrefix}    ${index === references.length - 1 ? "`-- " : "+-- "}`,
      entity
    }))];
  }), [expandedEntityPaths, filter.entitiesByPath, rows]);

  useEffect(() => {
    if (displayRows.some((row) => row.key === focusedRowKey)) return;
    setFocusedRowKey(displayRows[0]?.key ?? "");
  }, [displayRows, focusedRowKey]);

  const isExpanded = (row: FileTreeRow): boolean => (
    row.kind === "directory" && filterExpandedPaths.has(row.path)
  );

  const toggleDirectory = (row: FileTreeRow) => {
    if (row.kind !== "directory") return;
    setFilterCollapsedPaths((current) => {
      const next = new Set(current);
      if (next.has(row.path)) next.delete(row.path);
      else next.add(row.path);
      return next;
    });
  };

  const focusRow = (key: string) => {
    setFocusedRowKey(key);
    requestAnimationFrame(() => rowRefs.current.get(key)?.focus());
  };

  const revealEntity = (entity: DiagramFileEntityReference) => {
    const record = props.codeEntities.find((candidate) => candidate.id === entity.entityId);
    const range = record?.sourceRanges[entity.sourceRangeIndex];
    const firstCompactedLine = range?.compactedSource?.sections.find(
      (section) => section.kind === "collapsed-comment"
    )?.startLine;
    props.onRevealCodeEntity?.({
      entityId: entity.entityId,
      sourceRangeIndex: entity.sourceRangeIndex,
      ...(firstCompactedLine ? { targetLine: firstCompactedLine } : {})
    });
  };

  const toggleFileEntities = (filePath: string) => {
    setExpandedEntityPaths((current) => {
      const next = new Set(current);
      if (next.has(filePath)) next.delete(filePath);
      else next.add(filePath);
      return next;
    });
  };

  const onRowKeyDown = (event: KeyboardEvent<HTMLElement>, displayRow: ExplorerDisplayRow, index: number) => {
    if (event.key === "ArrowDown" && displayRows[index + 1]) {
      event.preventDefault();
      focusRow(displayRows[index + 1].key);
    } else if (event.key === "ArrowUp" && displayRows[index - 1]) {
      event.preventDefault();
      focusRow(displayRows[index - 1].key);
    } else if (event.key === "Home" && displayRows[0]) {
      event.preventDefault();
      focusRow(displayRows[0].key);
    } else if (event.key === "End" && displayRows.at(-1)) {
      event.preventDefault();
      focusRow(displayRows.at(-1)!.key);
    } else if (displayRow.kind === "entity") {
      if (event.key === "ArrowLeft") {
        event.preventDefault();
        focusRow(displayRow.filePath);
      } else if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        revealEntity(displayRow.entity);
      }
    } else if (event.key === "ArrowRight" && displayRow.row.kind === "directory") {
      event.preventDefault();
      if (!isExpanded(displayRow.row)) toggleDirectory(displayRow.row);
      else {
        const nextRow = displayRows[index + 1];
        if (nextRow?.kind === "repository" && nextRow.row.parentPath === displayRow.row.path) {
          focusRow(nextRow.key);
        }
      }
    } else if (event.key === "ArrowRight" && displayRow.row.kind === "file") {
      const references = filter.entitiesByPath[displayRow.row.path] ?? [];
      if (!references.length) return;
      event.preventDefault();
      if (!expandedEntityPaths.has(displayRow.row.path)) toggleFileEntities(displayRow.row.path);
      else if (displayRows[index + 1]?.kind === "entity") focusRow(displayRows[index + 1].key);
    } else if (event.key === "ArrowLeft") {
      if (displayRow.row.kind === "directory" && isExpanded(displayRow.row)) {
        event.preventDefault();
        toggleDirectory(displayRow.row);
      } else if (displayRow.row.kind === "file" && expandedEntityPaths.has(displayRow.row.path)) {
        event.preventDefault();
        toggleFileEntities(displayRow.row.path);
      } else if (displayRow.row.parentPath) {
        event.preventDefault();
        focusRow(displayRow.row.parentPath);
      }
    } else if ((event.key === "Enter" || event.key === " ") && displayRow.row.kind === "directory") {
      event.preventDefault();
      toggleDirectory(displayRow.row);
    } else if (event.key === "Enter" && displayRow.row.kind === "file") {
      const firstEntity = filter.entitiesByPath[displayRow.row.path]?.[0];
      if (firstEntity) {
        event.preventDefault();
        revealEntity(firstEntity);
      }
    } else if (event.key === " " && displayRow.row.kind === "file"
      && filter.entitiesByPath[displayRow.row.path]?.length) {
      event.preventDefault();
      toggleFileEntities(displayRow.row.path);
    }
  };

  const omittedCount = filter.foreignEntityIds.length
    + filter.unresolvedEntityIds.length
    + filter.invalidPaths.length
    + unavailableFilterCount;
  const emptyMessage = filterLoading
    ? "Matching CodeEntity paths against the live checkout..."
    : props.artifact
      ? "No files in this checkout match the active artifact's CodeEntities."
      : "Open a diagram to see its referenced files.";

  return (
    <section className="file-explorer" aria-label="Diagram files">
      <div className="file-explorer__mode-bar">
        <strong>DIAGRAM FILES</strong>
        <span aria-live="polite">{filterLoading
          ? "MATCHING"
          : `${matchedFilterPaths.size} MATCH${omittedCount ? ` · ${omittedCount} UNAVAILABLE` : ""}`}</span>
      </div>
      <div
        className="file-tree-scroller"
        role="tree"
        aria-label="Diagram files"
        aria-busy={filterLoading}
      >
        {displayRows.map((displayRow, index) => {
          if (displayRow.kind === "entity") {
            return (
              <button
                ref={(node) => {
                  if (node) rowRefs.current.set(displayRow.key, node);
                  else rowRefs.current.delete(displayRow.key);
                }}
                type="button"
                key={displayRow.key}
                className="file-tree-entity-row"
                role="treeitem"
                aria-level={displayRow.level}
                tabIndex={focusedRowKey === displayRow.key ? 0 : -1}
                title={`${displayRow.entity.label} · @entity/${displayRow.entity.handle}`}
                data-entity-id={displayRow.entity.entityId}
                data-file-path={displayRow.filePath}
                onFocus={() => setFocusedRowKey(displayRow.key)}
                onClick={() => {
                  focusRow(displayRow.key);
                  revealEntity(displayRow.entity);
                }}
                onKeyDown={(event) => onRowKeyDown(event, displayRow, index)}
              >
                <span className="file-tree-row__prefix" aria-hidden="true">{displayRow.prefix}</span>
                <span className="file-tree-entity-row__handle">@entity/{displayRow.entity.handle}</span>
                <span className="file-tree-entity-row__label">{displayRow.entity.label}</span>
              </button>
            );
          }
          const row = displayRow.row;
          const expanded = isExpanded(row);
          const entityReferences = row.kind === "file" ? filter.entitiesByPath[row.path] ?? [] : [];
          const entitiesExpanded = entityReferences.length > 0 && expandedEntityPaths.has(row.path);
          return (
            <div
              ref={(node) => {
                if (node) rowRefs.current.set(displayRow.key, node);
                else rowRefs.current.delete(displayRow.key);
              }}
              key={displayRow.key}
              className={`file-tree-row file-tree-row--${row.kind}`}
              role="treeitem"
              aria-level={row.level}
              aria-expanded={row.kind === "directory" ? expanded : entityReferences.length ? entitiesExpanded : undefined}
              tabIndex={focusedRowKey === displayRow.key ? 0 : -1}
              title={row.path}
              data-path={row.path}
              onFocus={() => setFocusedRowKey(displayRow.key)}
              onClick={() => {
                focusRow(displayRow.key);
                if (row.kind === "directory") toggleDirectory(row);
              }}
              onKeyDown={(event) => onRowKeyDown(event, displayRow, index)}
            >
              <span className="file-tree-row__prefix" aria-hidden="true">{row.prefix}</span>
              {row.kind === "directory" ? (
                <span className="file-tree-row__toggle" aria-hidden="true">{expanded ? "[-]" : "[+]"}</span>
              ) : entityReferences.length ? (
                <button
                  type="button"
                  className="file-tree-entity-toggle"
                  aria-label={`${entitiesExpanded ? "Hide" : "Show"} ${entityReferences.length} CodeEntities for ${row.name}`}
                  aria-expanded={entitiesExpanded}
                  tabIndex={-1}
                  onClick={(event) => {
                    event.stopPropagation();
                    focusRow(displayRow.key);
                    toggleFileEntities(row.path);
                  }}
                >[{entityReferences.length}]</button>
              ) : <span className="file-tree-row__toggle" aria-hidden="true">   </span>}
              {row.kind === "file" && entityReferences.length ? (
                <button
                  type="button"
                  className="file-tree-row__name file-tree-row__name-button"
                  aria-label={`Open first CodeEntity for ${row.name}`}
                  tabIndex={-1}
                  onClick={(event) => {
                    event.stopPropagation();
                    focusRow(displayRow.key);
                    revealEntity(entityReferences[0]);
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
        {filterError ? (
          <p className="file-tree-warning" role="alert">Some repository paths could not be checked: {filterError}</p>
        ) : null}
      </div>
    </section>
  );
}
