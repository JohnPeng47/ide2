import { useState } from "react";
import type { GridBox, LineGridScene } from "../../../../domain/core/diagrams/lineGrid";
import type { ProjectRepresentationRecord } from "../../../../domain/core/representations/projectCatalog";
export function MappingDiagramExplorer(props: {
  projectName: string; diagrams: ProjectRepresentationRecord[]; activeId?: string;
  scene?: LineGridScene; dirtyIds: string[]; onOpen: (id: string) => void; onFocus: (boxId: string) => void;
  onDelete: (id: string) => void; deletingId?: string; deleteDisabled: boolean; busyIds: string[];
}) {
  const [query, setQuery] = useState("");
  const boxTree = (box: GridBox) => <li key={box.id}>
    <button type="button" onClick={() => props.onFocus(box.id)} data-explorer-box={box.id}>
      {box.kind === "container" ? "▸ " : "· "}{box.kind === "diagram"
        ? props.scene?.contents[box.contentId]?.content.ascii.split("\n")[0].slice(0, 60) || box.id : "Group"}
    </button>
    {box.kind === "container" && <ul>{box.children.map(boxTree)}</ul>}
  </li>;
  return <>
    <header><strong>{props.projectName}</strong><span>PROJECT DIAGRAMS</span></header>
    <input type="search" aria-label="Filter diagrams" placeholder="Find a diagram…" value={query} onChange={(event) => setQuery(event.target.value)} />
    <nav aria-label="Project diagrams"><ul>{props.diagrams.filter((diagram) => diagram.name.toLowerCase().includes(query.toLowerCase())).map((diagram) =>
      <li key={diagram.id}>
        <div className="mapping-explorer-row">
          <button type="button" className={diagram.id === props.activeId ? "is-active" : ""}
            disabled={Boolean(props.deletingId)}
            aria-current={diagram.id === props.activeId ? "page" : undefined} data-project-diagram={diagram.id} onClick={() => props.onOpen(diagram.id)}>
            {diagram.name}{props.dirtyIds.includes(diagram.id) ? " *" : ""}
          </button>
          <button type="button" className="mapping-explorer-delete" aria-label={`Delete diagram ${diagram.name}`}
            title={`Delete ${diagram.name}`} disabled={props.deleteDisabled || props.busyIds.includes(diagram.id)}
            onClick={() => props.onDelete(diagram.id)}>{props.deletingId === diagram.id ? "…" : "×"}</button>
        </div>
        {diagram.id === props.activeId && props.scene && <ul>{props.scene.root.kind === "container"
          ? props.scene.root.children.map(boxTree) : boxTree(props.scene.root)}</ul>}
      </li>
    )}</ul></nav>
    {!props.diagrams.length && <p>No project diagrams yet. Create one with New.</p>}
  </>;
}
