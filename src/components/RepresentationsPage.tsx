import { useMemo } from "react";
import type { ProjectRepresentationCatalogRecord } from "../projectCatalog";

export function RepresentationsPanel(props: {
  catalog?: ProjectRepresentationCatalogRecord;
  onOpenProjectDiagram?: (id: string) => void;
  onOpen: (diagramSetId: string, diagramId: string) => void;
}) {
  const representations = useMemo(() => Object.values(props.catalog?.representations ?? {})
    .filter((representation) => representation.status === "settled")
    .sort((left, right) => left.viewKind.localeCompare(right.viewKind)
      || left.name.localeCompare(right.name)), [props.catalog]);

  return (
    <section className="representations-panel" aria-label="Starred representations">
      <header className="representations-panel__header">
        <strong>REPRESENTATIONS</strong>
        <span>{representations.length} STARRED</span>
      </header>
      <div className="representations-panel__list" role="list">
        {representations.map((representation) => {
          const revision = props.catalog?.revisions[representation.currentRevisionId];
          const primary = props.catalog?.activeByKind[representation.viewKind] === representation.id;
          return (
            <button
              type="button"
              role="listitem"
              className="representation-row"
              key={representation.id}
              disabled={!revision?.provenance && !props.onOpenProjectDiagram}
              onClick={() => {
                if (props.onOpenProjectDiagram && (revision?.content?.kind === "mapping-canvas" || !revision?.provenance)) props.onOpenProjectDiagram(representation.id);
                else if (revision?.provenance) props.onOpen(revision.provenance.diagramSetId, revision.provenance.artifactId);
              }}
            >
              <span className="representation-row__star" aria-label="Starred representation">★</span>
              <strong>{representation.name}</strong>
              <em>{representation.viewKind.toUpperCase()}{primary ? " · PRIMARY" : ""}</em>
            </button>
          );
        })}
        {representations.length === 0 ? (
          <p className="representations-panel__empty">Star a diagram to add the first Project representation.</p>
        ) : null}
      </div>
    </section>
  );
}
