import { useCallback, useContext, useSyncExternalStore } from 'react';
import { BaseBoxShapeUtil, Rectangle2d, HTMLContainer, T, resizeBox, type TLBaseShape, type TLResizeInfo } from 'tldraw';
import { connectionBox } from '../../../../domain/core/diagrams/diagramConnection';
import { mappingShapeId } from './shapeProjection';
import { NativeConnection } from './NativeConnection';
import { ShapeSlotsContext } from './shapeSlots';

export type MappingShape = TLBaseShape<'mapping-box', {
  w: number; h: number; nodeId: string; kind: string; revisionId: string;
}>;
declare module 'tldraw' { interface TLGlobalShapePropsMap { 'mapping-box': MappingShape['props'] } }
function Body({ shape }: { shape: MappingShape }) {
  const slots = useContext(ShapeSlotsContext);
  const subscribe = useCallback((listener: () => void) => slots!.subscribe(shape.props.nodeId, listener), [slots, shape.props.nodeId]);
  const body = useSyncExternalStore(subscribe, () => slots!.get(shape.props.nodeId));
  if (shape.id !== mappingShapeId(shape.props.nodeId)) {
    // Native Alt-drag previews must not register the source instance's DOM anchors
    // a second time. The semantic duplicate receives fresh anchors on completion.
    const scene = slots!.controller!.getSnapshot().document.scene;
    const source = connectionBox(scene, shape.props.nodeId);
    return <HTMLContainer className="mapping-native-shape"><pre className="mapping-poc-ascii">{
      source?.kind === 'diagram' ? scene.contents[source.contentId].content.ascii : 'Copy'
    }</pre></HTMLContainer>;
  }
  return <HTMLContainer className={`mapping-native-shape mapping-native-${shape.props.kind}`}>
    {shape.props.kind === 'arrow' && <NativeConnection edgeId={shape.props.nodeId.slice('floating:edge:'.length)} />}
    <div className="mapping-native-body" data-native-node={shape.props.nodeId}>{body}</div>
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
