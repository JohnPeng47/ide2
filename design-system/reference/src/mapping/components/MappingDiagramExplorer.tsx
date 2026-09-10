import { useState } from "react";
import type { GridBox, LineGridScene } from "../../core/lineGrid";
import type { ProjectRepresentationRecord } from "../../core/projectCatalog";
export function MappingDiagramExplorer(props: {
  projectName: string; diagrams: ProjectRepresentationRecord[]; activeId?: string;
  scene?: LineGridScene; dirtyIds: string[]; onOpen: (id: string) => void; onFocus: (boxId: string) => void;
}) {
  const [query, setQuery] = useState("");
  const boxTree = (box: GridBox) => <li key={box.id}>
    <button type="button" onClick={() => props.onFocus(box.id)} data-explorer-box={box.id}>
      {box.kind === "container" ? "▸ " : "· "}{box.kind === "diagram"
        ? props.scene?.contents[box.contentId]?.ascii.split("\n")[0].slice(0, 60) || box.id : "Group"}
    </button>
    {box.kind === "container" && <ul>{box.children.map(boxTree)}</ul>}
  </li>;
  return <>
    <header><strong>{props.projectName}</strong><span>PROJECT DIAGRAMS</span></header>
    <input type="search" aria-label="Filter diagrams" placeholder="Find a diagram…" value={query} onChange={(event) => setQuery(event.target.value)} />
    <nav aria-label="Project diagrams"><ul>{props.diagrams.filter((diagram) => diagram.name.toLowerCase().includes(query.toLowerCase())).map((diagram) =>
      <li key={diagram.id}>
        <button type="button" className={diagram.id === props.activeId ? "is-active" : ""}
          aria-current={diagram.id === props.activeId ? "page" : undefined} data-project-diagram={diagram.id} onClick={() => props.onOpen(diagram.id)}>
          {diagram.name}{props.dirtyIds.includes(diagram.id) ? " *" : ""}
        </button>
        {diagram.id === props.activeId && props.scene && <ul>{props.scene.root.kind === "container"
          ? props.scene.root.children.map(boxTree) : boxTree(props.scene.root)}</ul>}
      </li>
    )}</ul></nav>
    {!props.diagrams.length && <p>No project diagrams yet. Create one with New.</p>}
  </>;
}
