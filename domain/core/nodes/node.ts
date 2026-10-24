/** A content-bearing canvas object, independent of its renderer and internal content nodes. */
export interface Node<Kind extends string, ContentRef> {
  readonly id: string;
  readonly kind: Kind;
  readonly content: ContentRef;
}

export interface NodeRelationship {
  readonly id: string;
  readonly kind: string;
  readonly sourceNodeId: string;
  readonly targetNodeId: string;
}

export interface DisplayGeometry {
  readonly position: { x: number; y: number };
  readonly bounds: { width: number; height: number };
  readonly coordinateSpace: 'canvas' | 'viewport';
}

/** Expansion and content selection belong to the specialized ViewState. */
export interface NodePresentation<ViewState> {
  readonly id: string;
  readonly nodeId: string;
  readonly parentPresentationId?: string;
  readonly geometry: DisplayGeometry;
  readonly view: ViewState;
}
