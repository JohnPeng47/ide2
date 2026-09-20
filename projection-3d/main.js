import boxScene from './visualizations/d5-boxes.json';
import { BOX_PENDING_KEY } from './box-scene.mjs';
import './style.css';
import initialSources from './diagrams.json';
import upright from './visualizations/upright.json';
import flat from './visualizations/flat.json';
import { DEFAULT_VIEW, STORAGE_KEY, CURRENT_KEY, createVisualization, validateVisualization, restoreView } from './visualization.mjs';
let sources = initialSources;
import { COMPONENTS, FONT_SIZE, LINE_HEIGHT, PADDING, TEXT_TOP, makeDiagram, correspondences,
  cameraBasis, project, worldPoint, planeProjection, edgePieces, fitBounds } from './geometry.mjs';

const $ = selector => document.querySelector(selector);
const NS = 'http://www.w3.org/2000/svg';
function svg(tag, attributes={}, text) {
  const node = document.createElementNS(NS, tag);
  for (const [key, value] of Object.entries(attributes)) node.setAttribute(key, value);
  if (text !== undefined) node.textContent = text;
  return node;
}
const defaults = DEFAULT_VIEW;
const state = { ...defaults, selected:null, hovered:null, enabled:new Set(COMPONENTS.map(c=>c.id)) };
const viewport = $('#viewport'), scene = $('#scene');
const planeNodes = new Map(), edgeNodes = new Map(), endpointNodes = new Map();
let diagrams, edges, frame=0, drag=null, fitting=true;
const component = id => COMPONENTS.find(c=>c.id===id);
const active = () => state.hovered ?? state.selected;
const visibleDiagrams = () => diagrams.filter(d=>state.mode==='all'||state.mode===d.id);

function schedule(fit=false) {
  fitting ||= fit;
  if (!frame) frame=requestAnimationFrame(render);
}
function screenPoint(p, center) {
  return { x:(p.x-center.x)*state.scale+viewport.clientWidth/2+state.panX,
    y:(p.y-center.y)*state.scale+viewport.clientHeight/2+state.panY };
}
function select(id) { state.selected=state.selected===id?null:id; state.hovered=null; schedule(); }
function wireHover(node, id) {
  node.addEventListener('pointerenter', ()=>{ if(!drag) { state.hovered=id; schedule(); } });
  node.addEventListener('pointerleave', ()=>{ state.hovered=null; schedule(); });
}
function createPlane(d) {
  const g=svg('g', { 'data-plane':d.id });
  const paper=svg('rect', {class:'plane-paper',width:d.width,height:d.height,rx:3});
  g.append(paper);
  const grid=svg('path',{class:'plane-grid',d:[
    ...Array.from({length:Math.floor(d.width/24)},(_,i)=>`M ${(i+1)*24} 50 V ${d.height}`),
    ...Array.from({length:Math.floor((d.height-50)/24)},(_,i)=>`M 0 ${50+(i+1)*24} H ${d.width}`),
  ].join(' ')});
  g.append(grid);
  g.append(svg('text',{x:PADDING,y:27,class:'plane-title',style:`fill:${d.id==='D2'?'#88c0d0':'#b48ead'}`},`${d.id}  /  ${d.name}`));
  const depthLabel=svg('text',{x:PADDING,y:44,class:'plane-subtitle'});
  g.append(depthLabel,svg('path',{d:`M 0 54 H ${d.width}`,stroke:'#4c566a','stroke-width':.7}));
  const highlights=new Map();
  for(const a of d.anchors) {
    const color=component(a.component).color;
    const rect=svg('rect',{class:'anchor-highlight','data-anchor-highlight':a.id,
      x:PADDING+a.column*d.cellWidth,y:TEXT_TOP+a.row*LINE_HEIGHT,
      width:a.length*d.cellWidth,height:LINE_HEIGHT,rx:2,fill:color,stroke:color});
    g.append(rect); highlights.set(a.id,rect);
  }
  d.lines.forEach((line,row)=>{
    const text=svg('text',{x:PADDING,y:TEXT_TOP+row*LINE_HEIGHT+(LINE_HEIGHT-FONT_SIZE)/2+FONT_SIZE*.8,
      class:'diagram-row','data-row':row,'xml:space':'preserve'},line);
    if(line.length) { text.setAttribute('textLength',line.length*d.cellWidth); text.setAttribute('lengthAdjust','spacingAndGlyphs'); }
    g.append(text);
  });
  $('#planes').append(g);
  planeNodes.set(d.id,{g,paper,highlights,depthLabel});
}
function createControls() {
  for(const c of COMPONENTS) {
    const row=document.createElement('div'); row.className='correspondence'; row.dataset.component=c.id;
    row.style.setProperty('--edge-color',c.color);
    row.innerHTML=`<input type="checkbox" checked aria-label="Show ${c.name} edges" />
      <button aria-pressed="false" aria-label="Pin ${c.name}"><span class="swatch"></span><span>${c.name}</span><span class="edge-multiplicity">${c.id==='S5'?'1:2':'1:1'}</span></button>`;
    row.querySelector('input').addEventListener('change',e=>{
      if(e.target.checked)state.enabled.add(c.id); else {state.enabled.delete(c.id); if(state.selected===c.id)state.selected=null;}
      state.hovered=null;schedule();
    });
    const button=row.querySelector('button');
    button.addEventListener('click',()=>{state.enabled.add(c.id);row.querySelector('input').checked=true;select(c.id);});
    wireHover(button,c.id);
    $('#correspondences').append(row);
  }
}
function createEdges() {
  for(const e of edges) {
    const group=svg('g',{'data-edge':e.id,'data-component':e.component});
    const hit=svg('path',{class:'edge-hit'});
    hit.addEventListener('click',()=>{ if(!suppressClick)select(e.component); });
    wireHover(hit,e.component);
    group.append(hit);$('#edges').append(group);edgeNodes.set(e.id,{group,hit});
  }
  for(const d of diagrams) for(const a of d.anchors) {
    const g=svg('g',{class:'endpoint','data-anchor':a.id,'data-component':a.component,role:'button',tabindex:0,
      'aria-label':`${d.id}: ${a.label}, row ${a.row+1}, column ${a.column+1}`});
    g.append(svg('circle',{r:10,fill:'transparent'}),svg('circle',{r:3.3,fill:'#0d1014',stroke:component(a.component).color,'stroke-width':1.5}));
    g.append(svg('title',{},`${d.id} · ${a.label} · row ${a.row+1}, column ${a.column+1}`));
    g.addEventListener('click',()=>{ if(!suppressClick)select(a.component); });
    g.addEventListener('keydown',e=>{if(e.key==='Enter'||e.key===' ') {e.preventDefault();select(a.component);}});
    wireHover(g,a.component);
    $('#endpoints').append(g);endpointNodes.set(a.id,g);
  }
}

function render() {
  frame=0;
  const basis=state.mode === 'all' ? cameraBasis(state.azimuth,state.tilt)
    : cameraBasis(0,state.orientation === 'flat' ? -90 : 0);
  const planes=visibleDiagrams().map(d=>planeProjection(d,state.separation,basis,state.orientation));
  const bounds=fitBounds(planes.flatMap(p=>p.corners),viewport.clientWidth,viewport.clientHeight);
  if(fitting) {state.scale=bounds.scale;state.panX=state.panY=0;fitting=false;}
  const screen=p=>screenPoint(p,bounds.center);
  // Parallel planes share a center in their local surface coordinates.
  const depth=p=>p.corners.reduce((sum,c)=>sum+c.depth,0)/4;
  planes.sort((a,b)=>depth(a)-depth(b));
  for(const d of diagrams)planeNodes.get(d.id).g.style.display=visibleDiagrams().includes(d)?'':'none';
  for(const p of planes) {
    const {g,paper,highlights,depthLabel}=planeNodes.get(p.diagram.id),o=screen(p.o);
    g.setAttribute('transform',`matrix(${p.a*state.scale} ${p.b*state.scale} ${p.c*state.scale} ${p.d*state.scale} ${o.x} ${o.y})`);
    paper.setAttribute('fill-opacity',state.opacity/100);
    depthLabel.textContent=state.orientation === 'flat'
      ? `XZ plane  /  Y = ${p.diagram.id==='D2'?state.separation:0}  /  ${p.diagram.id==='D2'?'upper':'lower'} layer`
      : `XY plane  /  Z = ${p.diagram.id==='D2'?0:state.separation}  /  ${p.diagram.lines.length} rows`;
    for(const a of p.diagram.anchors) {
      const rect=highlights.get(a.id);
      rect.style.display=state.enabled.has(a.component)?'':'none';
      rect.setAttribute('fill-opacity',active()===a.component ? .38 : .12);
      rect.setAttribute('opacity',active()&&active()!==a.component ? .25 : 1);
    }
    // Paint parallel planes in depth order. Text remains full opacity.
    $('#planes').append(g);
  }
  const anchorProjection=a=>project(worldPoint(diagrams.find(d=>d.id===a.diagram),a.x,a.y,state.separation,state.orientation),basis);
  for(const e of edges) {
    const {group,hit}=edgeNodes.get(e.id);
    const show=state.mode==='all'&&state.enabled.has(e.component);
    group.style.display=show?'':'none'; if(!show)continue;
    const from=anchorProjection(e.from),to=anchorProjection(e.to),a=screen(from),b=screen(to);
    hit.setAttribute('d',`M ${a.x} ${a.y} L ${b.x} ${b.y}`);
    for(const path of [...group.querySelectorAll('.edge')])path.remove();
    const emphasized=active()===e.component, dimmed=active()&&!emphasized;
    group.setAttribute('opacity',dimmed ? .12 : 1);
    const pieces=edgePieces(from,to,planes);
    for(const [index,piece] of pieces.entries()) {
      const start=screen(piece.from),end=screen(piece.to);
      const path=svg('path',{class:'edge',d:`M ${start.x} ${start.y} L ${end.x} ${end.y}`,
        stroke:component(e.component).color,'stroke-width':emphasized?2.5:1.5,
        'stroke-dasharray':piece.hidden?'4 5':'none','stroke-opacity':piece.hidden ? .48 : .9,
        'data-hidden':piece.hidden,
        ...(state.orientation==='flat' && index===pieces.length-1 ? {'marker-end':`url(#arrow-${e.component})`} : {})});
      group.insertBefore(path,hit);
    }
  }
  for(const d of diagrams)for(const a of d.anchors) {
    const node=endpointNodes.get(a.id),show=state.enabled.has(a.component)&&(state.mode==='all'||state.mode===d.id);
    node.style.display=show?'':'none';if(!show)continue;
    const p=screen(anchorProjection(a));node.setAttribute('transform',`translate(${p.x} ${p.y})`);
    node.setAttribute('opacity',active()&&active()!==a.component ? .2 : 1);
  }
  renderAxes(basis);updateControls();queueCurrentSave();
}
function renderAxes(basis) {
  const axes=$('#axes');axes.replaceChildren();
  for(const [label,point,color] of [['X',[30,0,0],'#bf616a'],['Y',[0,30,0],'#a3be8c'],['Z',[0,0,30],'#88c0d0']]) {
    const p=project(point,basis);
    axes.append(svg('path',{d:`M 48 52 L ${48+p.x} ${52+p.y}`,stroke:color,'stroke-width':1.4}));
    axes.append(svg('text',{x:48+p.x*1.3,y:55+p.y*1.3,fill:color,'font-family':'monospace','font-size':10},label));
  }
  axes.append(svg('circle',{cx:48,cy:52,r:2,fill:'#d8dee9'}));
}
function updateControls() {
  $('#tilt').min=state.orientation==='flat'?-80:-70;
  $('#tilt').max=state.orientation==='flat'?-10:70;
  $('#azimuth').disabled=$('#tilt').disabled=state.mode!=='all';
  for(const name of ['separation','opacity','azimuth','tilt']) {
    $(`#${name}`).value=state[name];
    $(`#${name}-value`).textContent=Math.round(state[name])+(name==='opacity'?'%':name==='separation'?'':'°');
  }
  $('#layer-d2').textContent=state.orientation==='flat'?`Y = ${state.separation} · upper`:'Z = 0';
  $('#layer-z').textContent=state.orientation==='flat'?'Y = 0 · lower':`Z = ${state.separation}`;
  $('#orientation').value=state.orientation;
  $('#zoom-value').textContent=`${Math.round(state.scale*100)}%`;
  const count=edges.filter(e=>state.enabled.has(e.component)).length;
  $('#edge-count').textContent=`${count} edges`;
  $('#status').textContent=state.mode==='all'?`${state.enabled.size} shared components · ${count} correspondences`:`${state.mode} · original diagram · scroll to zoom`;
  $('#view-label').textContent=state.mode==='all'?(state.orientation==='flat'?'D2 ↓ D5 / flat':'D2 ↔ D5 / upright'):`${state.mode} / reading view`;
  document.querySelectorAll('[data-view]').forEach(b=>b.setAttribute('aria-pressed',b.dataset.view===state.mode));
  document.querySelectorAll('.correspondence').forEach(row=>{
    row.classList.toggle('is-active',active()===row.dataset.component);
    row.querySelector('button').setAttribute('aria-pressed',state.selected===row.dataset.component);
    row.querySelector('input').checked=state.enabled.has(row.dataset.component);
  });
  $('#clear-selection').disabled=!state.selected;
  const current=component(active());
  $('#detail-title').textContent=current?`${current.id} / ${current.name}`:'SHARED DOCUMENT MODEL';
  $('#detail-body').textContent=current?diagrams.flatMap(d=>d.anchors.filter(a=>a.component===current.id)
    .map(a=>`${d.id} · ${a.label}\nRow ${a.row+1}, columns ${a.column+1}–${a.column+a.length}`)).join('\n\n'):
    'TextModel connects to both the original and modified document in D5.';
}
function setView(mode) {
  state.mode=mode;state.hovered=null;
  if(mode==='all') {state.azimuth=state.orientation==='flat'?25:defaults.azimuth;state.tilt=state.orientation==='flat'?-25:defaults.tilt;}
  schedule(true);
}
function zoom(factor,x=viewport.clientWidth/2,y=viewport.clientHeight/2) {
  const next=Math.max(.05,Math.min(4,state.scale*factor)),ratio=next/state.scale;
  state.panX=(state.panX-(x-viewport.clientWidth/2))*ratio+(x-viewport.clientWidth/2);
  state.panY=(state.panY-(y-viewport.clientHeight/2))*ratio+(y-viewport.clientHeight/2);
  state.scale=next;schedule();
}
const clampTilt=value=>Math.max(state.orientation==='flat'?-80:-70,Math.min(state.orientation==='flat'?-10:70,value));
let suppressClick=false;
function bindInteractions() {
  document.querySelectorAll('[data-view]').forEach(b=>b.addEventListener('click',()=>setView(b.dataset.view)));
  $('#orientation').addEventListener('change',e=>{
    state.orientation=e.target.value;state.azimuth=state.orientation==='flat'?25:35;
    state.tilt=state.orientation==='flat'?-25:35;state.hovered=null;schedule(true);
  });
  $('#fit').addEventListener('click',()=>schedule(true));
  $('#reset').addEventListener('click',()=>{
    Object.assign(state,defaults,{selected:null,hovered:null,enabled:new Set(COMPONENTS.map(c=>c.id))});
    document.querySelectorAll('.correspondence input').forEach(i=>i.checked=true);schedule(true);
  });
  $('#clear-selection').addEventListener('click',()=>{state.selected=state.hovered=null;schedule();});
  $('#zoom-in').addEventListener('click',()=>zoom(1.25));$('#zoom-out').addEventListener('click',()=>zoom(.8));
  for(const name of ['separation','opacity','azimuth','tilt'])$(`#${name}`).addEventListener('input',e=>{
    state[name]=Number(e.target.value);schedule(name==='separation');
  });
  viewport.addEventListener('wheel',e=>{e.preventDefault();const r=viewport.getBoundingClientRect();zoom(Math.exp(-e.deltaY*.0015),e.clientX-r.left,e.clientY-r.top);},{passive:false});
  viewport.addEventListener('contextmenu',e=>e.preventDefault());
  viewport.addEventListener('pointerdown',e=>{
    if(drag||e.button>2)return;
    viewport.focus({preventScroll:true});
    drag={id:e.pointerId,x:e.clientX,y:e.clientY,lastX:e.clientX,lastY:e.clientY,pan:e.shiftKey||e.button!==0||state.mode!=='all',moved:false};
    suppressClick=false;state.hovered=null;
  });
  viewport.addEventListener('pointermove',e=>{
    if(!drag||drag.id!==e.pointerId)return;
    if(!drag.moved&&Math.hypot(e.clientX-drag.x,e.clientY-drag.y)<3)return;
    drag.moved=true;suppressClick=true;viewport.setPointerCapture(e.pointerId);viewport.classList.add('is-dragging');
    const dx=e.clientX-drag.lastX,dy=e.clientY-drag.lastY;
    if(drag.pan){state.panX+=dx;state.panY+=dy;}else{
      state.azimuth=Math.max(-75,Math.min(75,state.azimuth+dx*.22));state.tilt=clampTilt(state.tilt-dy*.22);
    }
    drag.lastX=e.clientX;drag.lastY=e.clientY;schedule();
  });
  const end=e=>{if(drag?.id===e.pointerId){drag=null;viewport.classList.remove('is-dragging');if(viewport.hasPointerCapture(e.pointerId))viewport.releasePointerCapture(e.pointerId);schedule();}};
  window.addEventListener('pointerup',end);window.addEventListener('pointercancel',end);
  viewport.addEventListener('keydown',e=>{
    if(e.target!==viewport)return;
    if(['ArrowLeft','ArrowRight','ArrowUp','ArrowDown'].includes(e.key)){
      e.preventDefault();const dx=e.key==='ArrowLeft'?-1:e.key==='ArrowRight'?1:0,dy=e.key==='ArrowUp'?-1:e.key==='ArrowDown'?1:0;
      if(e.shiftKey||state.mode!=='all'){state.panX+=dx*30;state.panY+=dy*30;}
      else{state.azimuth=Math.max(-75,Math.min(75,state.azimuth+dx*5));state.tilt=clampTilt(state.tilt+dy*5);}schedule();
    }else if(e.key==='+'||e.key==='='){e.preventDefault();zoom(1.25);}
    else if(e.key==='-'){e.preventDefault();zoom(.8);}
    else if(e.key.toLowerCase()==='f'){e.preventDefault();schedule(true);}
    else if(e.key==='Escape'){state.selected=state.hovered=null;schedule();}
  });
  let lastSize=viewportSize();
  new ResizeObserver(()=>{
    const next=viewportSize();
    if(next.width<=0||next.height<=0)return;
    if(lastSize.width>0&&lastSize.height>0) {
      const ratio=Math.min(next.width/lastSize.width,next.height/lastSize.height);
      state.scale*=ratio;state.panX*=ratio;state.panY*=ratio;
    }
    lastSize=next;schedule();
  }).observe(viewport);
}

function viewportSize() { return {width:viewport.clientWidth,height:viewport.clientHeight}; }
function saveMessage(message) { $('#save-status').textContent=message; }
function snapshot(name, id) { return createVisualization(name,sources,state,viewportSize(),id); }
let currentSaveTimer;
function persistCurrent() {
  clearTimeout(currentSaveTimer);
  try {localStorage.setItem(CURRENT_KEY,JSON.stringify(snapshot('Current view','current')));}
  catch {saveMessage('Automatic restore unavailable. Use Export JSON to keep this view.');}
}
function queueCurrentSave() {
  clearTimeout(currentSaveTimer);currentSaveTimer=setTimeout(persistCurrent,150);
}

function rebuildScene(nextSources,cellWidth) {
  const nextDiagrams=nextSources.map(s=>makeDiagram(s,cellWidth));
  const nextEdges=correspondences(nextDiagrams);
  sources=nextSources;diagrams=nextDiagrams;edges=nextEdges;
  for(const id of ['planes','edges','endpoints'])$(`#${id}`).replaceChildren();
  planeNodes.clear();edgeNodes.clear();endpointNodes.clear();
  const defs=svg('defs');
  for(const c of COMPONENTS) {
    const marker=svg('marker',{id:`arrow-${c.id}`,viewBox:'0 0 10 10',refX:9,refY:5,
      markerWidth:7,markerHeight:7,orient:'auto-start-reverse'});
    marker.append(svg('path',{d:'M 0 0 L 10 5 L 0 10 z',fill:c.color}));defs.append(marker);
  }
  $('#edges').append(defs);
  diagrams.forEach(createPlane);createEdges();
}
function loadVisualization(value,cellWidth) {
  if(value?.version===2) {
    const saved=validateVisualization(value);sessionStorage.setItem(BOX_PENDING_KEY,JSON.stringify(saved));
    location.assign('./boxes.html');return;
  }
  const saved=validateVisualization(value),next=restoreView(saved,viewportSize());
  rebuildScene(saved.diagrams,cellWidth);Object.assign(state,next);
  fitting=false;$('#visualization-name').value=saved.name;
  if([...$('#saved-views').options].some(option=>option.value===saved.id))$('#saved-views').value=saved.id;
  // Once explicitly loaded, refreshing should restore this view instead of the URL preset.
  const url=new URL(location.href);url.searchParams.delete('visualization');
  history.replaceState(null,'',url);
  schedule();
}
function bindSaves(cellWidth) {
  window.addEventListener('pagehide',persistCurrent);
  let savedViews=[];
  try {
    const raw=localStorage.getItem(STORAGE_KEY);
    if(raw) {
      const values=JSON.parse(raw);if(!Array.isArray(values))throw new Error('expected a saved list');
      savedViews=values.map(validateVisualization);
    }
  } catch(error) {saveMessage(`Saved views could not be read: ${error.message}`);}
  const choices=()=>[upright,flat,boxScene,...savedViews];
  const refresh=id=>{
    $('#saved-views').replaceChildren(...choices().map(v=>{
      const option=document.createElement('option');option.value=v.id;option.textContent=v.name;return option;
    }));
    if(id)$('#saved-views').value=id;
  };
  const persist=value=>{
    const next=[...savedViews,value];
    localStorage.setItem(STORAGE_KEY,JSON.stringify(next));
    savedViews=next;refresh(value.id);
  };
  refresh();
  $('#save-visualization').addEventListener('click',()=>{
    try {
      const name=$('#visualization-name').value.trim();
      const value=snapshot(name);persist(value);saveMessage(`Saved “${name}” in this browser.`);
    } catch(error) {saveMessage(`Could not save: ${error.message}. Export JSON to keep a file.`);}
  });
  $('#load-visualization').addEventListener('click',()=>{
    try {
      const value=choices().find(v=>v.id===$('#saved-views').value);
      loadVisualization(value,cellWidth);saveMessage(`Loaded “${value.name}”.`);
    } catch(error) {saveMessage(error.message);}
  });
  $('#export-visualization').addEventListener('click',()=>{
    try {
      const value=snapshot($('#visualization-name').value.trim());
      const blob=new Blob([JSON.stringify(value,null,2)+'\n'],{type:'application/json'});
      const url=URL.createObjectURL(blob),link=document.createElement('a');
      link.href=url;link.download=(value.name.replace(/[^a-z0-9_-]+/gi,'-')||'visualization')+'.json';
      link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);saveMessage(`Exported “${value.name}”.`);
    } catch(error) {saveMessage(error.message);}
  });
  $('#import-visualization').addEventListener('click',()=>$('#visualization-file').click());
  $('#visualization-file').addEventListener('change',async e=>{
    const file=e.target.files[0];if(!file)return;
    try {
      if(file.size>2_000_000)throw new Error('File exceeds 2 MB');
      const value=validateVisualization(JSON.parse(await file.text()));
      value.id=crypto.randomUUID();persist(value);loadVisualization(value,cellWidth);
      saveMessage(`Imported and saved “${value.name}”.`);
    } catch(error) {saveMessage(`Could not import: ${error.message}`);}
    finally {e.target.value='';}
  });
}

try {
  await document.fonts.ready;
  const probe=document.createElement('canvas').getContext('2d');
  probe.font=`${FONT_SIZE}px ${getComputedStyle(document.body).getPropertyValue('--font-mono')}`;
  const cellWidth=probe.measureText('MMMMMMMMMM').width/10;
  rebuildScene(sources,cellWidth);createControls();bindInteractions();bindSaves(cellWidth);
  const requested=new URLSearchParams(location.search).get('visualization');
  let initial=requested==='flat'?flat:requested==='upright'?upright:null;
  if(!initial) {
    try { const raw=localStorage.getItem(CURRENT_KEY);if(raw)initial=validateVisualization(JSON.parse(raw)); }
    catch(error) { saveMessage(`Previous view could not be restored: ${error.message}`); }
  }
  if(initial)loadVisualization(initial,cellWidth);else schedule(true);
  document.documentElement.dataset.ready='true';
} catch(error) {
  $('#error').hidden=false;$('#error').textContent=`Could not load the diagram viewer: ${error.message}`;
  console.error(error);
}
