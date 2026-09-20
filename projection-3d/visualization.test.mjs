import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createVisualization, restoreView, validateVisualization } from './visualization.mjs';
import { makeDiagram, worldPoint, cameraBasis, planeProjection, planePointAtScreen, project } from './geometry.mjs';
const saved=JSON.parse(readFileSync(new URL('./visualizations/flat.json',import.meta.url)));

test('JSON round trip preserves the drawings, camera, selection and hidden components',()=>{
  const state={...saved.view,selected:'S5',enabled:new Set(['S1','S5']),panX:43,panY:-19,scale:.7};
  const value=createVisualization('Round trip',saved.diagrams,state,saved.viewport,'test');
  const restored=restoreView(JSON.parse(JSON.stringify(value)),saved.viewport);
  assert.deepEqual(restored,{...state,hovered:null});
  assert.deepEqual(value.diagrams,saved.diagrams);
  value.diagrams[0].ascii='changed';
  assert.notEqual(saved.diagrams[0].ascii,'changed');
});

test('viewport adaptation scales pan and zoom together',()=>{
  const value=structuredClone(saved);value.view.panX=20;value.view.panY=-30;
  const restored=restoreView(value,{width:saved.viewport.width/2,height:saved.viewport.height/2});
  assert.equal(restored.scale,value.view.scale/2);assert.equal(restored.panX,10);assert.equal(restored.panY,-15);
});

test('malformed or incompatible files are rejected before scene replacement',()=>{
  for(const mutate of [v=>v.version=2,v=>v.view.scale=NaN,v=>v.view.orientation='unknown',
    v=>v.view.tilt=0,v=>v.view.enabled=['missing'],v=>v.view.selected='missing',
    v=>v.viewport.width=0,v=>v.diagrams[0].ascii='no anchors']) {
    const value=structuredClone(saved);mutate(value);assert.throws(()=>validateVisualization(value));
  }
});

test('flat planes are horizontal with D2 above D5 and exact projected anchors',()=>{
  const diagrams=saved.diagrams.map(d=>makeDiagram(d,7.8));
  for(const azimuth of [-75,0,25,75])for(const tilt of [-80,-55,-10]) {
    const basis=cameraBasis(azimuth,tilt);
    for(const d of diagrams) {
      const plane=planeProjection(d,1000,basis,'flat');
      for(const a of d.anchors) {
        const world=worldPoint(d,a.x,a.y,1000,'flat');
        assert.equal(world[1],d.id==='D2'?1000:0);
        const p=project(world,basis),local=planePointAtScreen(plane,p);
        assert.ok(Math.abs(local.x-a.x)<1e-6 && Math.abs(local.y-a.y)<1e-6);
      }
    }
    const upper=project(worldPoint(diagrams[0],diagrams[0].width/2,diagrams[0].height/2,1000,'flat'),basis);
    const lower=project(worldPoint(diagrams[1],diagrams[1].width/2,diagrams[1].height/2,1000,'flat'),basis);
    assert.ok(upper.y<lower.y);assert.ok(upper.depth>lower.depth);
  }
});
