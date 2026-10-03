import type { CanvasTransform } from '../../../../domain/core/diagrams/diagramCanvas';

// Saved workspaces predate the Editor: the old surface placed its stage at this
// margin. Keep that wire convention so existing viewports and exports still open
// on the same content. Runtime page coordinates never include the margin.
const legacyStage = { x: 190, y: 64 };
export function restoreMappingCamera(view: CanvasTransform) {
  return { x: view.offset.x / view.scale + legacyStage.x, y: view.offset.y / view.scale + legacyStage.y, z: view.scale };
}
export function saveMappingCamera(camera: { x: number; y: number; z: number }): CanvasTransform {
  return { offset: { x: (camera.x - legacyStage.x) * camera.z, y: (camera.y - legacyStage.y) * camera.z }, scale: camera.z };
}
