import './boxes.css';
import original from './visualizations/d5-boxes.json';
import { project, fitBounds } from './geometry.mjs';
import { validateBoxScene, boxBasis, projectBox, wrapLabel, connectionRoute,
  BOX_CURRENT_KEY, BOX_PENDING_KEY, BOX_LIBRARY_KEY } from './box-scene.mjs';
const $=selector=>document.querySelector(selector), NS='http://www.w3.org/2000/svg';
const viewport=$('#box-viewport'),svgRoot=$('#box-scene');
let scene=validateBoxScene(original),state={...scene.view},hovered=null,frame=0,drag=null,suppressClick=false;
let metrics=null,saveTimer,library=[];
const objects=new Map(),paths=new Map(),labels=new Map();
function svg(tag,attrs={},text) {
  const el=document.createElementNS(NS,tag);for(const [key,value] of Object.entries(attrs))el.setAttribute(key,value);
  if(text!==undefined)el.textContent=text;return el;
}
const size=()=>({width:viewport.clientWidth,height:viewport.clientHeight});
const nodeById=id=>scene.nodes.find(n=>n.id===id);
function snapshot(id=crypto.randomUUID(),name=$('#box-name').value.trim()) {
  return validateBoxScene({...scene,id,name,view:{...state},viewport:size()});
}
function message(text){$('#save-message').textContent=text;}
function persistCurrent() {
  clearTimeout(saveTimer);
  try{localStorage.setItem(BOX_CURRENT_KEY,JSON.stringify(snapshot('current-boxes',scene.name)));}
  catch{message('Automatic restore unavailable. Export JSON to keep a file.');}
}
function schedule(){if(!frame)frame=requestAnimationFrame(render);}
function bounds() {
  return {left:Math.min(...scene.nodes.map(n=>n.box.x))-245,right:Math.max(...scene.nodes.map(n=>n.box.x+n.box.width))+100,
    back:Math.min(...scene.nodes.map(n=>n.box.z))-170,front:Math.max(...scene.nodes.map(n=>n.box.z+n.box.depth))+100};
}
function buildScene() {
  svgRoot.replaceChildren();objects.clear();paths.clear();labels.clear();
  const defs=svg('defs');
  const hatch=svg('pattern',{id:'hatching',patternUnits:'userSpaceOnUse',width:5,height:5,patternTransform:'rotate(32)'});
  hatch.append(svg('rect',{width:5,height:5,fill:'#dedab4'}),svg('path',{d:'M 0 0 L 0 5',stroke:'#57583d','stroke-width':.75}));
  const marker=svg('marker',{id:'box-arrow',viewBox:'0 0 8 8',refX:7,refY:4,markerWidth:5,markerHeight:5,orient:'auto'});
  marker.append(svg('path',{d:'M 0 0 L 8 4 L 0 8 z',fill:'#41432e'}));defs.append(hatch,marker);svgRoot.append(defs);
  for(const id of ['floor','routes','boxes'])svgRoot.append(svg('g',{id}));
  for(const e of scene.edges) {
    const path=svg('path',{class:`box-edge ${e.kind}`,'data-connection':e.id,...(e.kind==='flow'?{'marker-end':'url(#box-arrow)'}:{})});
    $('#routes').append(path);paths.set(e.id,path);
    if(e.label){const label=svg('text',{class:'edge-label','data-route-label':e.id,'text-anchor':'middle'},e.label);$('#routes').append(label);labels.set(e.id,label);}
  }
  for(const [index,n] of scene.nodes.entries()) {
    const g=svg('g',{class:'box','data-node-id':n.id,tabindex:0,role:'button','aria-label':n.label,'aria-pressed':'false'});
    g.append(svg('polygon',{class:'box-face box-side front'}),svg('polygon',{class:'box-face box-side right'}),svg('polygon',{class:'box-face box-top'}));
    if(n.kind==='document')for(const fraction of [.25,.5,.75])g.append(svg('path',{class:'box-rule','data-stack':fraction}));
    const text=svg('g',{class:'box-text'});
    text.append(svg('text',{class:'box-code',x:18,y:23},`N${String(index+1).padStart(2,'0')}`));
    const maxChars=Math.max(1,Math.floor((n.box.width-36)/(18*.61)));
    const lines=wrapLabel(n.label,maxChars),fontSize=Math.min(18,(n.box.depth-40)/(lines.length*1.3));
    for(const [i,line] of lines.entries())text.append(svg('text',{class:`box-label ${n.kind}`,x:18,
      y:45+i*fontSize*1.3,style:`font-size:${fontSize}px`},line));
    g.append(text,svg('title',{},`${n.label}\nD5 · line ${n.source.line}`));
    g.addEventListener('pointerenter',()=>{if(!drag){hovered=n.id;schedule();}});
    g.addEventListener('pointerleave',()=>{hovered=null;schedule();});
    g.addEventListener('click',()=>{if(!suppressClick)select(state.selected===n.id?null:n.id);});
    g.addEventListener('dblclick',()=>{select(n.id);focusNodes([n]);});
    g.addEventListener('keydown',e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();select(state.selected===n.id?null:n.id);}});
    $('#boxes').append(g);objects.set(n.id,g);
  }
  $('#node-count').textContent=`${scene.nodes.length} BOXES / ${scene.edges.length} LINKS`;
  $('#box-status').textContent=`${scene.nodes.length} source nodes / ${scene.nodes.length} boxes`;
  $('#scene-summary').textContent=`${scene.nodes.length} labels from the original ASCII · one box per node`;
  $('#box-name').value=scene.name;select(state.selected);schedule();
}
function render() {
  frame=0;const basis=boxBasis(state),b=bounds();
  const floorCorners=[[b.left,0,b.back],[b.right,0,b.back],[b.right,0,b.front],[b.left,0,b.front]].map(p=>project(p,basis));
  const fit=fitBounds(floorCorners,viewport.clientWidth,viewport.clientHeight,75);
  metrics={...fit,scale:fit.scale*state.zoom,basis};
  const screen=p=>({x:(p.x-fit.center.x)*metrics.scale+viewport.clientWidth/2+state.panX,
    y:(p.y-fit.center.y)*metrics.scale+viewport.clientHeight/2+state.panY});
  const world=p=>screen(project(p,basis));
  const points=ps=>ps.map(p=>{const q=screen(p);return `${q.x},${q.y}`;}).join(' ');
  const path=ps=>ps.map((p,i)=>{const q=world(p);return `${i?'L':'M'} ${q.x} ${q.y}`;}).join(' ');
  const transform=(x,y,z)=>{
    const o=world([x,y,z]),a=world([x+1,y,z]),c=world([x,y,z+1]);
    return `matrix(${a.x-o.x} ${a.y-o.y} ${c.x-o.x} ${c.y-o.y} ${o.x} ${o.y})`;
  };
  const floor=$('#floor');floor.replaceChildren();
  for(let x=Math.floor(b.left/80)*80;x<b.right;x+=80)floor.append(svg('path',{class:'floor-line',d:path([[x,0,b.back],[x,0,b.front]])}));
  for(let z=Math.floor(b.back/80)*80;z<b.front;z+=80)floor.append(svg('path',{class:'floor-line',d:path([[b.left,0,z],[b.right,0,z]])}));
  floor.append(svg('polygon',{class:'floor-border',points:points(floorCorners)}));
  for(const c of scene.chapters)floor.append(svg('text',{class:'floor-heading',transform:transform(c.x,0,c.z)},c.name));
  const active=hovered??state.selected,neighbors=new Set(active?[active]:[]);
  for(const e of scene.edges)if(e.from===active||e.to===active){neighbors.add(e.from);neighbors.add(e.to);}
  for(const [index,e] of scene.edges.entries()) {
    const route=connectionRoute(nodeById(e.from),nodeById(e.to),index),el=paths.get(e.id);
    const emphasized=e.from===active||e.to===active;
    el.setAttribute('d',path(route));el.style.display=state.showConnections?'':'none';
    el.classList.toggle('emphasized',emphasized);el.setAttribute('opacity',active && !emphasized ? .10 : 1);
    const label=labels.get(e.id);
    if(label) {
      const p=route[Math.floor(route.length/2)];
      label.setAttribute('transform',transform(p[0],1,p[2]-7));label.style.display=state.showConnections?'':'none';
      label.setAttribute('opacity',active && !emphasized ? .12 : 1);
    }
  }
  const ordered=[...scene.nodes].sort((a,b)=>project([a.box.x+a.box.width/2,0,a.box.z+a.box.depth/2],basis).depth
    -project([b.box.x+b.box.width/2,0,b.box.z+b.box.depth/2],basis).depth);
  for(const [order,n] of ordered.entries()) {
    const g=objects.get(n.id),p=projectBox(n.box,state);
    g.querySelector('.front').setAttribute('points',points(p.front));g.querySelector('.right').setAttribute('points',points(p.right));
    g.querySelector('.box-top').setAttribute('points',points(p.top));
    g.querySelector('.box-text').setAttribute('transform',transform(n.box.x,n.box.height,n.box.z));
    for(const stack of g.querySelectorAll('[data-stack]')) {
      const {x,z,width:w,depth:d,height:h}=n.box,y=h*Number(stack.dataset.stack);
      stack.setAttribute('d',path([[x,y,z+d],[x+w,y,z+d],[x+w,y,z]]));
    }
    g.classList.toggle('selected',state.selected===n.id);g.classList.toggle('hovered',hovered===n.id);
    g.setAttribute('aria-pressed',state.selected===n.id);g.setAttribute('opacity',active && !neighbors.has(n.id) ? .38 : 1);
    const sibling=$('#boxes').children[order];if(sibling!==g)$('#boxes').insertBefore(g,sibling??null);
  }
  $('#box-zoom').textContent=`${Math.round(state.zoom*100)}%`;
  $('#connections').checked=state.showConnections;
  $('#hover-label').textContent=hovered?`${nodeById(hovered).label} · source line ${nodeById(hovered).source.line}`:'';
  clearTimeout(saveTimer);saveTimer=setTimeout(persistCurrent,200);
}
function select(id) {
  state.selected=id;const n=nodeById(id);$('#node-panel').hidden=!n;
  if(n) {
    $('#save-panel').hidden=true;$('#save-menu').setAttribute('aria-expanded','false');
    $('#node-id').textContent=`N${String(scene.nodes.indexOf(n)+1).padStart(2,'0')} / ${n.kind.toUpperCase()}`;
    $('#node-label').textContent=n.label;$('#source-location').textContent=`D5 · line ${n.source.line} · columns ${n.source.startColumn}–${n.source.endColumn}`;
    $('#source-line').textContent=scene.source.ascii.split('\n')[n.source.line-1];
    $('#node-links').replaceChildren(...scene.edges.filter(e=>e.from===id||e.to===id).map(e=>{
      const other=nodeById(e.from===id?e.to:e.from),li=document.createElement('li'),button=document.createElement('button');
      button.textContent=`${e.from===id?'→':'←'} ${other.label}${e.label?' / '+e.label:''}`;
      button.addEventListener('click',()=>{select(other.id);focusNodes([other]);});li.append(button);return li;
    }));
  }
  schedule();
}
function focusNodes(nodes) {
  if(!metrics||!nodes.length)return;
  const projected=nodes.flatMap(n=>Object.values(projectBox(n.box,state)).flat());
  const fit=fitBounds(projected,viewport.clientWidth*.72,viewport.clientHeight*.75,40);
  const baseScale=metrics.scale/state.zoom;
  state.zoom=Math.min(7,Math.max(.2,fit.scale/baseScale));
  state.panX=-(fit.center.x-metrics.center.x)*baseScale*state.zoom;
  state.panY=-(fit.center.y-metrics.center.y)*baseScale*state.zoom;
  schedule();
}
function markChapter(index=null){$('#overview').setAttribute('aria-pressed',index===null);document.querySelectorAll('[data-chapter]').forEach(b=>b.setAttribute('aria-pressed',Number(b.dataset.chapter)===index));}
function overview(){markChapter();Object.assign(state,{zoom:1,panX:0,panY:0});hovered=null;select(null);schedule();}
function zoom(factor,x=viewport.clientWidth/2,y=viewport.clientHeight/2) {
  const next=Math.max(.2,Math.min(12,state.zoom*factor)),ratio=next/state.zoom;
  state.panX=(state.panX-(x-viewport.clientWidth/2))*ratio+x-viewport.clientWidth/2;
  state.panY=(state.panY-(y-viewport.clientHeight/2))*ratio+y-viewport.clientHeight/2;
  state.zoom=next;schedule();
}
function load(value) {
  const checked=validateBoxScene(value);const next={...checked.view};
  const ratio=Math.min(viewport.clientWidth/checked.viewport.width,viewport.clientHeight/checked.viewport.height);
  next.panX*=ratio;next.panY*=ratio;scene=checked;state=next;hovered=null;buildScene();
}
function refreshLibrary(id) {
  $('#box-saved').replaceChildren(...[original,...library].map(v=>{const option=document.createElement('option');option.value=v.id;option.textContent=v.name;return option;}));
  if(id)$('#box-saved').value=id;
}
function saveCopy(value) {
  const next=[...library,value];localStorage.setItem(BOX_LIBRARY_KEY,JSON.stringify(next));library=next;refreshLibrary(value.id);
}
function bindSaves() {
  try {const raw=localStorage.getItem(BOX_LIBRARY_KEY);if(raw){const parsed=JSON.parse(raw);if(!Array.isArray(parsed))throw new Error('invalid library');library=parsed.map(validateBoxScene);}}
  catch(e){message(`Saved views could not be read: ${e.message}`);}refreshLibrary();
  $('#save-menu').addEventListener('click',()=>{const panel=$('#save-panel');panel.hidden=!panel.hidden;$('#save-menu').setAttribute('aria-expanded',!panel.hidden);});
  $('#save-boxes').addEventListener('click',()=>{try{const value=snapshot();saveCopy(value);message(`Saved “${value.name}” in this browser.`);}catch(e){message(`Could not save: ${e.message}`);}});
  $('#load-boxes').addEventListener('click',()=>{try{const value=[original,...library].find(v=>v.id===$('#box-saved').value);load(value);message(`Loaded “${value.name}”.`);}catch(e){message(e.message);}});
  $('#export-boxes').addEventListener('click',()=>{try{const value=snapshot(),link=document.createElement('a');const url=URL.createObjectURL(new Blob([JSON.stringify(value,null,2)+'\n'],{type:'application/json'}));link.href=url;link.download=(value.name.replace(/[^a-z0-9_-]+/gi,'-')||'box-visualization')+'.json';link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);message(`Exported “${value.name}”.`);}catch(e){message(e.message);}});
  $('#import-boxes').addEventListener('click',()=>$('#box-file').click());
  $('#box-file').addEventListener('change',async e=>{const file=e.target.files[0];if(!file)return;try{if(file.size>2000000)throw new Error('File exceeds 2 MB');const value=validateBoxScene(JSON.parse(await file.text()));value.id=crypto.randomUUID();saveCopy(value);load(value);message(`Imported and saved “${value.name}”.`);}catch(error){message(`Could not import: ${error.message}`);}finally{e.target.value='';}});
  window.addEventListener('pagehide',persistCurrent);
}
function bindInteractions() {
  $('#overview').addEventListener('click',overview);$('#box-fit').addEventListener('click',overview);
  $('#close-node').addEventListener('click',()=>select(null));$('#focus-node').addEventListener('click',()=>focusNodes([nodeById(state.selected)]));
  $('#box-zoom-in').addEventListener('click',()=>zoom(1.3));$('#box-zoom-out').addEventListener('click',()=>zoom(1/1.3));
  $('#connections').addEventListener('change',e=>{state.showConnections=e.target.checked;schedule();});
  document.querySelectorAll('[data-chapter]').forEach(button=>button.addEventListener('click',()=>{select(null);const index=Number(button.dataset.chapter);markChapter(index);const chapter=scene.chapters[index];const end=scene.chapters[index+1]?.z??Infinity;focusNodes(scene.nodes.filter(n=>n.box.z>=chapter.z&&n.box.z<end));}));
  viewport.addEventListener('wheel',e=>{if(e.target.closest('section'))return;e.preventDefault();const r=viewport.getBoundingClientRect();zoom(Math.exp(-e.deltaY*.0015),e.clientX-r.left,e.clientY-r.top);},{passive:false});
  viewport.addEventListener('pointerdown',e=>{
    if(e.target.closest('section,.camera-tools')||e.button!==0||drag)return;
    if(!e.target.closest('.box'))viewport.focus({preventScroll:true});
    drag={id:e.pointerId,x:e.clientX,y:e.clientY,startX:e.clientX,startY:e.clientY,orbit:e.shiftKey,moved:false};suppressClick=false;
  });
  viewport.addEventListener('pointermove',e=>{
    if(!drag||drag.id!==e.pointerId)return;
    if(!drag.moved&&Math.hypot(e.clientX-drag.startX,e.clientY-drag.startY)<3)return;
    drag.moved=true;suppressClick=true;hovered=null;viewport.setPointerCapture(e.pointerId);viewport.classList.add('dragging');
    const dx=e.clientX-drag.x,dy=e.clientY-drag.y;
    if(drag.orbit){state.azimuth=Math.max(15,Math.min(75,state.azimuth+dx*.15));state.elevation=Math.max(15,Math.min(65,state.elevation-dy*.15));}
    else{state.panX+=dx;state.panY+=dy;}
    drag.x=e.clientX;drag.y=e.clientY;schedule();
  });
  const end=e=>{if(drag?.id!==e.pointerId)return;drag=null;viewport.classList.remove('dragging');if(viewport.hasPointerCapture(e.pointerId))viewport.releasePointerCapture(e.pointerId);schedule();};
  window.addEventListener('pointerup',end);window.addEventListener('pointercancel',end);
  viewport.addEventListener('keydown',e=>{
    if(e.target.closest('section'))return;
    if(e.key==='Escape'){select(null);hovered=null;$('#save-panel').hidden=true;$('#save-menu').setAttribute('aria-expanded','false');}
    else if(e.target===viewport&&['ArrowLeft','ArrowRight','ArrowUp','ArrowDown'].includes(e.key)) {
      e.preventDefault();const x=e.key==='ArrowLeft'?-1:e.key==='ArrowRight'?1:0,y=e.key==='ArrowUp'?-1:e.key==='ArrowDown'?1:0;
      if(e.shiftKey){state.azimuth=Math.max(15,Math.min(75,state.azimuth+x*5));state.elevation=Math.max(15,Math.min(65,state.elevation-y*5));}
      else{state.panX+=x*35;state.panY+=y*35;}schedule();
    }else if(e.target===viewport&&(e.key==='+'||e.key==='=')){e.preventDefault();zoom(1.3);}
    else if(e.target===viewport&&e.key==='-'){e.preventDefault();zoom(1/1.3);}
    else if(e.target===viewport&&e.key.toLowerCase()==='f'){e.preventDefault();overview();}
  });
  let last=size();new ResizeObserver(()=>{const next=size();if(last.width&&last.height){const ratio=Math.min(next.width/last.width,next.height/last.height);state.panX*=ratio;state.panY*=ratio;}last=next;schedule();}).observe(viewport);
}
try {
  await document.fonts.ready;
  bindSaves();bindInteractions();
  let stored=null;
  try{stored=sessionStorage.getItem(BOX_PENDING_KEY)||localStorage.getItem(BOX_CURRENT_KEY);if(stored)load(JSON.parse(stored));else buildScene();sessionStorage.removeItem(BOX_PENDING_KEY);}
  catch(e){message(`Previous view could not be restored: ${e.message}`);scene=validateBoxScene(original);state={...scene.view};buildScene();}
  document.documentElement.dataset.ready='true';
}catch(e){$('#box-error').hidden=false;$('#box-error').textContent=e.message;console.error(e);}
