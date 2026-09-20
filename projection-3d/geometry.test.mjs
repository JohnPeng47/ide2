import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { makeDiagram, correspondences, cameraBasis, project, worldPoint, planeProjection,
  planePointAtScreen, edgePieces, fitBounds } from './geometry.mjs';

const sources=JSON.parse(readFileSync(new URL('./diagrams.json',import.meta.url)));
const diagrams=sources.map(d=>makeDiagram(d,7.8));
const near=(a,b)=>assert.ok(Math.abs(a-b)<1e-7,`${a} != ${b}`);

test('snapshot contains exactly the two original ASCII strings',()=>{
  const original=readFileSync(new URL('../docs/architecture/vscode-d2-d5-parallel.ascii',import.meta.url),'utf8');
  assert.equal(sources[0].ascii+'\n\n'+sources[1].ascii,original);
});
test('primary anchors identify original character spans and six one-to-many edges',()=>{
  assert.equal(diagrams[0].anchors.length,5);assert.equal(diagrams[1].anchors.length,6);
  for(const d of diagrams)for(const a of d.anchors) {
    assert.equal(d.lines[a.row].slice(a.column,a.column+a.length),a.label.replace(/^(original|modified) /,''));
  }
  assert.deepEqual(diagrams[0].anchors.map(a=>a.row),[2,90,79,71,35]);
  assert.deepEqual(diagrams[1].anchors.map(a=>a.row),[41,48,53,61,67,67]);
  const edges=correspondences(diagrams);assert.equal(edges.length,6);
  const modelEdges=edges.filter(e=>e.component==='S5');
  assert.equal(modelEdges[0].from,modelEdges[1].from);
  assert.notEqual(modelEdges[0].to.column,modelEdges[1].to.column);
});
test('camera is orthographic and plane transforms match endpoint transforms across the orbit range',()=>{
  for(const azimuth of [-75,0,35,75])for(const tilt of [-70,0,35,70])for(const gap of [100,1000,2000]) {
    const basis=cameraBasis(azimuth,tilt);
    for(const axis of Object.values(basis))near(axis.reduce((s,x)=>s+x*x,0),1);
    near(basis.right.reduce((s,x,i)=>s+x*basis.up[i],0),0);
    const p=project([0,0,0],basis),q=project(basis.depth.map(x=>x*10000),basis);
    near(p.x,q.x);near(p.y,q.y);
    for(const d of diagrams) {
      const plane=planeProjection(d,gap,basis);
      for(const a of d.anchors) {
        const point=project(worldPoint(d,a.x,a.y,gap),basis);
        near(point.x,plane.o.x+plane.a*a.x+plane.c*a.y);
        near(point.y,plane.o.y+plane.b*a.x+plane.d*a.y);
        const local=planePointAtScreen(plane,point);near(local.x,a.x);near(local.y,a.y);
      }
    }
  }
});
test('edge occlusion splits at the projected plane boundary with continuous endpoints',()=>{
  const plane={diagram:{width:10,height:10},o:{x:0,y:0,depth:5},a:1,b:0,c:0,d:1,depthX:0,depthY:0};
  const parts=edgePieces({x:-5,y:5,depth:0},{x:15,y:5,depth:0},[plane]);
  assert.deepEqual(parts.map(p=>p.hidden),[false,true,false]);
  near(parts[0].to.x,0);near(parts[1].to.x,10);
  for(let i=1;i<parts.length;i++)assert.deepEqual(parts[i-1].to,parts[i].from);
  assert.ok(edgePieces({x:-5,y:5,depth:10},{x:15,y:5,depth:10},[plane]).every(p=>!p.hidden));
});
test('fit contains the projected planes inside the viewport padding',()=>{
  const points=diagrams.flatMap(d=>planeProjection(d,1000,cameraBasis(35,35)).corners);
  const fit=fitBounds(points,1100,760);
  for(const p of points){const x=(p.x-fit.center.x)*fit.scale+550,y=(p.y-fit.center.y)*fit.scale+380;
    assert.ok(x>=64.99&&x<=1035.01&&y>=64.99&&y<=695.01);
  }
});
