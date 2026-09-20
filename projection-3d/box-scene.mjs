import { cameraBasis, project } from './geometry.mjs';
export const BOX_CURRENT_KEY='projection-3d.boxes.current.v2';
export const BOX_PENDING_KEY='projection-3d.boxes.pending.v2';
export const BOX_LIBRARY_KEY='projection-3d.boxes.library.v2';
export function validateBoxScene(value) {
  const fail=message=>{throw new Error(`Invalid box visualization: ${message}`);};
  if(!value||value.format!=='projection-3d'||value.version!==2||value.kind!=='node-boxes')fail('unsupported format');
  for(const key of ['name','id'])if(typeof value[key]!=='string'||!value[key].trim()||value[key].length>150)fail(`invalid ${key}`);
  if(!value.source||typeof value.source.ascii!=='string'||value.source.ascii.length>500000)fail('missing source diagram');
  if(!Array.isArray(value.nodes)||!value.nodes.length||value.nodes.length>500)fail('expected 1–500 nodes');
  const lines=value.source.ascii.split('\n'),ids=new Set(),spans=new Set();
  for(const n of value.nodes) {
    if(!n||typeof n.id!=='string'||!n.id||ids.has(n.id))fail('duplicate or missing node ID');ids.add(n.id);
    if(typeof n.label!=='string'||!n.label||n.label.length>300)fail('invalid label');
    const s=n.source;
    if(!s||!Number.isInteger(s.line)||!Number.isInteger(s.startColumn)||!Number.isInteger(s.endColumn)
      ||s.line<1||s.startColumn<1||s.endColumn<s.startColumn
      ||lines[s.line-1]?.slice(s.startColumn-1,s.endColumn)!==n.label)fail(`source label mismatch: ${n.id}`);
    const span=`${s.line}:${s.startColumn}:${s.endColumn}`;if(spans.has(span))fail('duplicate source occurrence');spans.add(span);
    if(!['service','detail','document'].includes(n.kind))fail('invalid node kind');
    if(!n.box)fail('missing box');
    if(n.box.width<80||n.box.depth<50)fail('box is too small for its label');
    for(const key of ['x','z','width','depth','height']) {
      const v=n.box[key];if(!Number.isFinite(v)||Math.abs(v)>100000||(['width','depth','height'].includes(key)&&v<=0))fail('invalid box geometry');
    }
  }
  if(!Array.isArray(value.edges)||value.edges.length>2000)fail('invalid connections');
  const edgeIds=new Set();
  for(const e of value.edges) {
    if(!e||!ids.has(e.from)||!ids.has(e.to)||!['flow','contains'].includes(e.kind)
      ||typeof e.id!=='string'||edgeIds.has(e.id)||(e.label!==null&&typeof e.label!=='string'))fail('invalid connection');
    edgeIds.add(e.id);
  }
  if(!Array.isArray(value.chapters)||value.chapters.length>30||value.chapters.some(c=>typeof c.name!=='string'
    ||!Number.isFinite(c.x)||!Number.isFinite(c.z)))fail('invalid floor headings');
  if(!Array.isArray(value.annotations)||value.annotations.some(a=>!a||typeof a.text!=='string'
    ||!['heading','route','legend'].includes(a.role)||!Number.isInteger(a.line)||!lines[a.line-1]?.includes(a.text)))fail('invalid source annotations');
  const v=value.view;
  if(!v)fail('missing camera');
  for(const [key,min,max] of [['azimuth',15,75],['elevation',15,65],['zoom',.2,12],['panX',-1e7,1e7],['panY',-1e7,1e7]])
    if(!Number.isFinite(v[key])||v[key]<min||v[key]>max)fail(`invalid ${key}`);
  if(v.selected!==null&&!ids.has(v.selected))fail('unknown selection');
  if(typeof v.showConnections!=='boolean')fail('invalid connection visibility');
  if(!value.viewport||['width','height'].some(k=>!Number.isFinite(value.viewport[k])||value.viewport[k]<=0||value.viewport[k]>100000))fail('invalid viewport');
  return structuredClone(value);
}
export function boxBasis(view) {return cameraBasis(view.azimuth,-view.elevation);}
export function boxCorners(box) {
  const {x,z,width:w,depth:d,height:h}=box;
  return {top:[[x,h,z],[x+w,h,z],[x+w,h,z+d],[x,h,z+d]],
    front:[[x,h,z+d],[x+w,h,z+d],[x+w,0,z+d],[x,0,z+d]],
    right:[[x+w,h,z],[x+w,0,z],[x+w,0,z+d],[x+w,h,z+d]]};
}
export function projectBox(box,view) {
  const basis=boxBasis(view);
  return Object.fromEntries(Object.entries(boxCorners(box)).map(([key,points])=>[key,points.map(p=>project(p,basis))]));
}
export function wrapLabel(label,max=23) {
  if(!Number.isInteger(max)||max<1)throw new Error('Label width must be a positive integer');
  const words=label.split(' '),lines=[''];
  for(const word of words) {
    if(lines.at(-1)&&lines.at(-1).length+word.length+1>max)lines.push('');
    // Long identifiers wrap without truncation; their full spelling is retained.
    for(let offset=0;offset<word.length;offset+=max) {
      const piece=word.slice(offset,offset+max);
      if(offset)lines.push('');
      lines[lines.length-1]+=(lines.at(-1)?' ':'')+piece;
    }
  }
  return lines;
}
// Routes use the clear corridors between box rows and columns. For distant
// rows, use an outside lane to avoid drawing through unrelated boxes.
export function connectionRoute(from,to,index=0) {
  const a=from.box,b=to.box;
  if(a.z===b.z) {
    const lane=Math.max(a.z+a.depth,b.z+b.depth)+35+(index%4)*7;
    return [[a.x+a.width/2,0,a.z+a.depth],[a.x+a.width/2,0,lane],[b.x+b.width/2,0,lane],[b.x+b.width/2,0,b.z+b.depth]];
  }
  const down=b.z>a.z;
  const start=[a.x+a.width/2,0,down?a.z+a.depth:a.z],end=[b.x+b.width/2,0,down?b.z:b.z+b.depth];
  const laneA=start[2]+(down?1:-1)*(22+(index%3)*6),laneB=end[2]+(down?-1:1)*22;
  if(Math.abs(a.z-b.z)<=260)return [start,[start[0],0,(laneA+laneB)/2],[end[0],0,(laneA+laneB)/2],end];
  const side=-80-(index%8)*16;
  return [start,[start[0],0,laneA],[side,0,laneA],[side,0,laneB],[end[0],0,laneB],end];
}
