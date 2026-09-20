export const FONT_SIZE = 13;
export const LINE_HEIGHT = FONT_SIZE * 1.4;
export const PADDING = 24;
export const TEXT_TOP = 72;
export const COMPONENTS = [
  { id: 'S1', name: 'EditorService', color: '#88c0d0' },
  { id: 'S2', name: 'TextModelResolverService', color: '#a3be8c' },
  { id: 'S3', name: 'FileService', color: '#ebcb8b' },
  { id: 'S4', name: 'TextFileService', color: '#b48ead' },
  { id: 'S5', name: 'TextModel', color: '#bf616a' },
];

// Match the primary component nodes, not mentions in methods or prose.
const PRIMARY = {
  D2: [/^\|-- EditorService$/, /^`-- TextModelResolverService$/, /^\|   `-- FileService$/,
    /^\|-- TextFileService </, /textEditorModel: TextModel </],
  D5: [/comparison -> .* -> EditorService ->/, /^ +TextModelResolverService$/,
    /GitFileSystemProvider .* FileService$/, /^ +TextFileService$/,
    /original TextModel +modified TextModel$/],
};

export function makeDiagram(source, cellWidth) {
  const lines = source.ascii.split('\n');
  const anchors = [];
  COMPONENTS.forEach((component, index) => {
    const rows = lines.flatMap((line, row) => PRIMARY[source.id][index].test(line) ? [row] : []);
    if (rows.length !== 1) throw new Error(`${source.id}: expected one primary row for ${component.name}`);
    const row = rows[0];
    for (const match of lines[row].matchAll(new RegExp(`\\b${component.name}\\b`, 'g'))) {
      const column = match.index;
      const occurrence = anchors.filter(a => a.component === component.id).length;
      const label = component.id === 'S5' && source.id === 'D5'
        ? `${occurrence ? 'modified' : 'original'} TextModel` : component.name;
      anchors.push({ id: `${source.id}-${component.id}-${occurrence}`, component: component.id,
        diagram: source.id, row, column, length: component.name.length, label,
        x: PADDING + (column + component.name.length / 2) * cellWidth,
        y: TEXT_TOP + (row + .5) * LINE_HEIGHT });
    }
  });
  return { ...source, lines, anchors, cellWidth,
    width: Math.max(...lines.map(l => l.length)) * cellWidth + PADDING * 2,
    height: TEXT_TOP + lines.length * LINE_HEIGHT + PADDING };
}

export function correspondences(diagrams) {
  return COMPONENTS.flatMap(component => {
    const from = diagrams[0].anchors.find(a => a.component === component.id);
    return diagrams[1].anchors.filter(a => a.component === component.id)
      .map(to => ({ id: `${from.id}:${to.id}`, component: component.id, from, to }));
  });
}

export function cameraBasis(azimuth, tilt) {
  const a = azimuth * Math.PI / 180, t = tilt * Math.PI / 180;
  return { right: [Math.cos(a), 0, -Math.sin(a)],
    up: [Math.sin(a) * Math.sin(t), Math.cos(t), Math.cos(a) * Math.sin(t)],
    depth: [Math.sin(a) * Math.cos(t), -Math.sin(t), Math.cos(a) * Math.cos(t)] };
}
const dot = (a, b) => a.reduce((s, n, i) => s + n * b[i], 0);
export function project(point, basis) {
  return { x: dot(point, basis.right), y: -dot(point, basis.up), depth: dot(point, basis.depth) };
}
export function worldPoint(diagram, x, y, separation, orientation = 'upright') {
  if (orientation === 'flat') {
    return [x - diagram.width / 2, diagram.id === 'D2' ? separation : 0, y - diagram.height / 2];
  }
  return [x - diagram.width / 2, diagram.height / 2 - y, diagram.id === 'D2' ? 0 : separation];
}
export function planeProjection(diagram, separation, basis, orientation = 'upright') {
  const point = (x, y) => project(worldPoint(diagram, x, y, separation, orientation), basis);
  const o = point(0, 0), px = point(1, 0), py = point(0, 1);
  return { diagram, o, a: px.x-o.x, b: px.y-o.y, c: py.x-o.x, d: py.y-o.y,
    depthX: px.depth-o.depth, depthY: py.depth-o.depth,
    corners: [o, point(diagram.width, 0), point(diagram.width, diagram.height), point(0, diagram.height)] };
}
export function planePointAtScreen(plane, point) {
  const x = point.x-plane.o.x, y = point.y-plane.o.y;
  const det = plane.a*plane.d-plane.b*plane.c;
  return { x: (x*plane.d-y*plane.c)/det, y: (y*plane.a-x*plane.b)/det };
}

// Split a projected edge exactly where it enters/exits a plane's silhouette.
// The midpoint depth determines which sections are behind its surface.
export function edgePieces(from, to, planes) {
  const cuts = [0, 1];
  for (const p of planes) {
    const a = planePointAtScreen(p, from), b = planePointAtScreen(p, to);
    for (const [axis, bound] of [['x', 0], ['x', p.diagram.width], ['y', 0], ['y', p.diagram.height]]) {
      const delta = b[axis]-a[axis];
      if (Math.abs(delta)>1e-8) {
        const t = (bound-a[axis])/delta;
        if (t>0 && t<1) cuts.push(t);
      }
    }
  }
  cuts.sort((a,b)=>a-b);
  const lerp = t => ({ x: from.x+(to.x-from.x)*t, y: from.y+(to.y-from.y)*t,
    depth: from.depth+(to.depth-from.depth)*t });
  return cuts.slice(1).flatMap((end, i) => {
    const start = cuts[i];
    if (end-start<1e-8) return [];
    const mid = lerp((start+end)/2);
    const hidden = planes.some(p => {
      const xy = planePointAtScreen(p, mid);
      return xy.x>=0 && xy.x<=p.diagram.width && xy.y>=0 && xy.y<=p.diagram.height
        && p.o.depth+p.depthX*xy.x+p.depthY*xy.y > mid.depth+.01;
    });
    return [{ from: lerp(start), to: lerp(end), hidden }];
  });
}

export function fitBounds(points, width, height, padding=65) {
  const xs=points.map(p=>p.x), ys=points.map(p=>p.y);
  const left=Math.min(...xs), right=Math.max(...xs), top=Math.min(...ys), bottom=Math.max(...ys);
  return { center: { x:(left+right)/2, y:(top+bottom)/2 },
    scale: Math.max(.02, Math.min(Math.max(30,width-padding*2)/(right-left), Math.max(30,height-padding*2)/(bottom-top))) };
}
