import type { ReferenceIdentity } from "../../../domain/core/records/domain";

const MAX_VISIBLE_REFERENCES = 6;
const LEFT_LABEL_SPACE = 180;

export interface SelectionOverlayReference {
  key: string;
  identity: ReferenceIdentity;
  text: string;
}

export interface SelectionOverlayRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export function DiagramSelectionOverlay(props: {
  rect: SelectionOverlayRect;
  references: SelectionOverlayReference[];
}) {
  const visible = props.references.slice(0, MAX_VISIBLE_REFERENCES);
  const hiddenCount = props.references.length - visible.length;
  const placeLeft = props.rect.x >= LEFT_LABEL_SPACE;
  return (
    <div className="rect-selection-layer" aria-hidden="true">
      <div
        className="rect-selection-window"
        data-selection-rect="true"
        style={{
          left: props.rect.x,
          top: props.rect.y,
          width: props.rect.width,
          height: props.rect.height
        }}
      />
      {props.references.length > 0 ? (
        <div
          className={`rect-selection-overlay rect-selection-overlay--${placeLeft ? "left" : "right"}`}
          data-selection-overlay="true"
          style={placeLeft ? {
            left: 0,
            top: props.rect.y,
            width: Math.max(0, props.rect.x - 6)
          } : {
            left: props.rect.x + props.rect.width + 6,
            top: props.rect.y
          }}
        >
          {visible.map((reference) => (
            <div
              className="rect-selection-overlay__ref"
              data-reference-key={reference.key}
              title={reference.text}
              key={reference.key}
            >
              {reference.text}
            </div>
          ))}
          {hiddenCount > 0 ? (
            <div className="rect-selection-overlay__ref rect-selection-overlay__more">+{hiddenCount} more</div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
