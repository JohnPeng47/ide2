import { useContext, useLayoutEffect, useRef } from 'react';
import { BaseBoxShapeUtil, Rectangle2d, HTMLContainer, T, resizeBox, type TLBaseShape, type TLResizeInfo } from 'tldraw';
import { connectionBox } from '../../../../domain/core/diagrams/diagramConnection';
import { mappingShapeId } from './shapeProjection';
import { NativeConnection } from './NativeConnection';
import { CanvasRuntimeContext } from './CanvasRuntimeContext';
import { DiagramShapeContent } from './DiagramShapeContent';
import { FloatingShapeContent } from './FloatingShapeContent';

export type MappingShape = TLBaseShape<'mapping-box', {
  w: number; h: number; nodeId: string; kind: string; revisionId: string;
}>;
declare module 'tldraw' { interface TLGlobalShapePropsMap { 'mapping-box': MappingShape['props'] } }
function Body({ shape }: { shape: MappingShape }) {
  const runtime = useContext(CanvasRuntimeContext)!;
  const bodyRef = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const body = bodyRef.current;
    if (!body || !['projection', 'conversation', 'detail'].includes(shape.props.kind)) return;
    // These panes are interactive without entering the SDK's shape-editing mode.
    // Let the browser scroll their content before tldraw's canvas wheel handler.
    const wheel = (event: WheelEvent) => { if (!event.ctrlKey && !event.metaKey) event.stopPropagation(); };
    body.addEventListener('wheel', wheel, { passive: true });
    return () => body.removeEventListener('wheel', wheel);
  }, [shape.props.kind]);
  if (shape.id !== mappingShapeId(shape.props.nodeId)) {
    // Native Alt-drag previews must not register the source instance's DOM anchors
    // a second time. The semantic duplicate receives fresh anchors on completion.
    const scene = runtime.controller.getSnapshot().document.scene;
    const source = connectionBox(scene, shape.props.nodeId);
    return <HTMLContainer className="mapping-native-shape"><pre className="mapping-poc-ascii">{
      source?.kind === 'diagram' ? scene.contents[source.contentId].content.ascii : 'Copy'
    }</pre></HTMLContainer>;
  }
  return <HTMLContainer className={`mapping-native-shape mapping-native-${shape.props.kind}`}>
    {shape.props.kind === 'arrow' && <NativeConnection edgeId={shape.props.nodeId.slice('floating:edge:'.length)} />}
    <div ref={bodyRef} className="mapping-native-body" data-native-node={shape.props.nodeId}>{shape.props.kind !== 'arrow' && (shape.props.nodeId.startsWith('grid:')
      ? <DiagramShapeContent nodeId={shape.props.nodeId} /> : <FloatingShapeContent nodeId={shape.props.nodeId} />)}</div>
  </HTMLContainer>;
}
export class MappingShapeUtil extends BaseBoxShapeUtil<MappingShape> {
  static override type = 'mapping-box' as const;
  static override props = { w: T.positiveNumber, h: T.positiveNumber, nodeId: T.string, kind: T.string, revisionId: T.string };
  getDefaultProps(): MappingShape['props'] { return { w: 100, h: 100, nodeId: '', kind: 'diagram', revisionId: '' }; }
  override getGeometry(shape: MappingShape) { return new Rectangle2d({ width: shape.props.w, height: shape.props.h, isFilled: !['container', 'selection', 'arrow'].includes(shape.props.kind) }); }
  override canReceiveNewChildrenOfType(shape: MappingShape) { return shape.props.kind === 'container'; }
  override canRemoveChildrenOfType() { return false; }
  override canCull(shape: MappingShape) { return shape.props.kind !== 'arrow'; }
  override canEdit() { return false; }
  override canScroll(shape: MappingShape) { return ['projection', 'conversation', 'detail'].includes(shape.props.kind); }
  override canBind() { return false; }
  override canResize(shape: MappingShape) { return ['projection', 'detail'].includes(shape.props.kind); }
  override hideRotateHandle() { return true; }
  override onResize(shape: MappingShape, info: TLResizeInfo<MappingShape>) { return resizeBox(shape, info); }
  component(shape: MappingShape) { return <Body shape={shape} />; }
  getIndicatorPath(shape: MappingShape) { const path = new Path2D(); path.rect(0, 0, shape.props.w, shape.props.h); return path; }
}
