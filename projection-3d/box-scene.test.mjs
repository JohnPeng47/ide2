import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { validateBoxScene, projectBox, boxBasis, wrapLabel } from './box-scene.mjs';
import { project } from './geometry.mjs';
import { validateVisualization } from './visualization.mjs';
const scene=JSON.parse(readFileSync(new URL('./visualizations/d5-boxes.json',import.meta.url)));
const original=JSON.parse(readFileSync(new URL('./diagrams.json',import.meta.url)))[1];

test('D5 is transcribed 1:1, including every leaf and every source text occurrence',()=>{
  assert.deepEqual(scene.source,original);assert.equal(scene.nodes.length,56);assert.equal(scene.edges.length,60);
  const lines=scene.source.ascii.split('\n');
  const covered=lines.map(line=>new Set());
  for(const node of scene.nodes) {
    const {line,startColumn,endColumn}=node.source;
    assert.equal(lines[line-1].slice(startColumn-1,endColumn),node.label);
    for(let c=startColumn-1;c<endColumn;c++){assert.ok(!covered[line-1].has(c),'duplicate source character');covered[line-1].add(c);}
  }
  for(const a of scene.annotations) {
    const start=lines[a.line-1].indexOf(a.text);assert.ok(start>=0);
    for(let c=start;c<start+a.text.length;c++)covered[a.line-1].add(c);
  }
  for(const [row,line] of lines.entries())for(const [col,char] of [...line].entries()) {
    if(!/[A-Za-z0-9]/.test(char)||covered[row].has(col))continue;
    assert.ok(char==='v'&&/^[\s|+`v-]*$/.test(line),`Unmapped source text at ${row+1}:${col+1}: ${line}`);
  }
});

test('box footprints never overlap, and all connection endpoints exist',()=>{
  const ids=new Set(scene.nodes.map(n=>n.id));
  assert.equal(ids.size,scene.nodes.length);
  for(const e of scene.edges){assert.ok(ids.has(e.from));assert.ok(ids.has(e.to));}
  for(let i=0;i<scene.nodes.length;i++)for(let j=i+1;j<scene.nodes.length;j++) {
    const a=scene.nodes[i].box,b=scene.nodes[j].box;
    assert.ok(a.x+a.width<=b.x||b.x+b.width<=a.x||a.z+a.depth<=b.z||b.z+b.depth<=a.z,
      `overlapping boxes: ${scene.nodes[i].id}, ${scene.nodes[j].id}`);
  }
});

test('top labels share the projected plane at every supported camera angle',()=>{
  for(const azimuth of [15,45,75])for(const elevation of [15,35.264,65])for(const n of scene.nodes) {
    const view={azimuth,elevation},p=projectBox(n.box,view),basis=boxBasis(view);
    const corner=project([n.box.x,n.box.height,n.box.z],basis);
    assert.deepEqual(p.top[0],corner);
    assert.equal(wrapLabel(n.label,25).join('').replace(/\s/g,''),n.label.replace(/\s/g,''));
    assert.ok(wrapLabel(n.label,25).every(line=>line.length<=25));
  }
});

test('portable box format round trips with strict source and reference validation',()=>{
  assert.deepEqual(validateVisualization(JSON.parse(JSON.stringify(scene))),scene);
  for(const change of [s=>s.nodes[0].label='invented',s=>s.nodes[1].source={...s.nodes[0].source},
    s=>s.edges[0].to='missing',s=>s.view.selected='missing',s=>s.view.zoom=NaN,s=>s.nodes[0].box.width=1]) {
    const bad=structuredClone(scene);change(bad);assert.throws(()=>validateBoxScene(bad));
  }
});
