// Run with node --import tsx after npm run build.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir, homedir } from 'node:os';
import { createServer } from 'node:net';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { seedMappingFixture } from '../support/browser-mapping-fixture.mjs';
import { canvasSaveFixture } from '../../support/mappingDiagram.ts';
import { singleDiagramScene } from '../../../domain/core/diagrams/projectDiagramCanvas.ts';
import { revisionFixture } from '../../support/diagramRevisions.ts';
import { diagramContentNodes } from '../../../domain/core/diagrams/diagramContentNodes.ts';
import { defaultArrowAppearance } from '../../../domain/core/diagrams/diagramConnection.ts';
const { evaluate, waitFor, waitForSelector, withHeadlessBrowser, captureScreenshot } = await import(pathToFileURL(path.join(homedir(), '.codex/skills/front-end/browser-test.mjs')).href);
const root = await mkdtemp(path.join(tmpdir(), 'edge-obstacles-'));
let server;
try {
  await seedMappingFixture(root, { ascii: 'Fixture', nodes: [] });
  const scene = singleDiagramScene('Fixture');
  const contents = {
    source: 'Source\n|\n|\n|\n`-- From', target: 'Target\n|\n|\n|\n`-- To',
    blocker: 'Blocker\n|-- Branch\n|   |-- First long label\n|   |-- Second long label\n|   |-- Third long label\n|   |-- Fourth long label\n|   |-- Fifth long label\n|   `-- Sixth long label\n`-- Tail',
    ports: 'Root\n|-- Apply variant\n|   |-- A long intervening label that should not force a detour to the right\n|   `-- Another long intervening label to avoid\n`-- Persistence',
    laneSource: 'Lane source\n`-- Exit', laneTarget: 'Lane target\n|-- One\n`-- Two',
    gutterSource: 'Outside\n`-- From', gutter: 'Gutter\n' + '|\n'.repeat(7) + '|-- Destination\n' + '|\n'.repeat(7) + '`-- Tail'
  };
  scene.contents = Object.fromEntries(Object.entries(contents).map(([id, ascii]) => [id, revisionFixture().create({ id, revision: 0, ascii, structureKind: 'tree' }).diagram]));
  scene.root.children = Object.keys(contents).map(id => ({ id, kind: 'diagram', contentId: id, collapsed: false,
    position: { column: { source: 0, blocker: 25, target: 70, ports: 0, gutterSource: 45, gutter: 65, laneSource: 45, laneTarget: 75 }[id],
      row: { ports: 15, gutterSource: 31, gutter: 24, laneSource: 21, laneTarget: 21 }[id] ?? 0 } }));
  const from = diagramContentNodes(scene.contents.source.content).find(node => node.label === 'From');
  const edge = { id: 'around-text', source: { kind: 'content-node', displayNodeId: 'grid:source', contentNodeId: from.id,
    revisionId: scene.contents.source.content.revisionId, side: 'right' },
    target: { kind: 'content-node', displayNodeId: 'grid:target', side: 'left', offset: 0.9,
      contentNodeId: diagramContentNodes(scene.contents.target.content).find(node => node.label === 'To').id, revisionId: scene.contents.target.content.revisionId }, appearance: defaultArrowAppearance };
  const portAnchor = label => ({ kind: 'content-node', displayNodeId: 'grid:ports',
    contentNodeId: diagramContentNodes(scene.contents.ports.content).find(node => node.label === label).id,
    revisionId: scene.contents.ports.content.revisionId, side: 'horizontal' });
  const flexibleEdge = { id: 'choose-sides', source: portAnchor('Apply variant'), target: portAnchor('Persistence'), appearance: defaultArrowAppearance };
  const gutterAnchor = (id, label, side) => ({ kind: 'content-node', displayNodeId: `grid:${id}`,
    contentNodeId: diagramContentNodes(scene.contents[id].content).find(node => node.label === label).id,
    revisionId: scene.contents[id].content.revisionId, side });
  const gutterEdge = { id: 'cross-guide', source: gutterAnchor('gutterSource', 'From', 'right'), target: gutterAnchor('gutter', 'Destination', 'left'), appearance: defaultArrowAppearance };
  const laneEdges = ['lane-a', 'lane-b', 'lane-c'].map(id => ({ id,
    source: gutterAnchor('laneSource', 'Lane source', 'right'),
    target: { kind: 'box', displayNodeId: 'grid:laneTarget', side: 'left' }, appearance: defaultArrowAppearance }));
  const file = path.join(root, '.diagrams/representations/catalog.json'), catalog = JSON.parse(await readFile(file, 'utf8'));
  catalog.revisions['revision-overview'].content = { kind: 'canvas-history', history: canvasSaveFixture({ name: 'Routing fixture', scene, edges: [edge, flexibleEdge, gutterEdge, ...laneEdges] }).history };
  await writeFile(file, JSON.stringify(catalog));
  const port = await new Promise(resolve => { const socket=createServer(); socket.listen(0,'127.0.0.1',()=>{const port=socket.address().port;socket.close(()=>resolve(port));}); });
  const url = `http://127.0.0.1:${port}`;
  server = spawn(process.execPath, ['scripts/dev/start-server.mjs', 'preview', '--http', '--host', '127.0.0.1', '--port', String(port), '--strictPort'],
    { detached: true, env: { ...process.env, NEW_DIAGRAM_PROJECT_ROOT: root, NEW_DIAGRAMS_DIR: path.join(root,'.diagrams') }, stdio:['ignore','ignore','pipe'] });
  let errors='';server.stderr.on('data',chunk=>{errors+=chunk;});
  await waitFor(async()=>(await fetch(url).catch(()=>null))?.ok,{timeoutMs:20000}).catch(error=>{throw Error(`${error}\n${errors}`);});
  await withHeadlessBrowser({url:`${url}/mapping?diagram=representation-overview`,width:1600,height:1050,chromePath:process.env.CHROME_PATH,
    arguments:['--no-sandbox','--disable-gpu']},async({cdp})=>{
    cdp.on('Page.javascriptDialogOpening', () => cdp.send('Page.handleJavaScriptDialog', { accept: true }));
    await cdp.send('Page.enable');await cdp.send('Runtime.enable');
    const exceptions=[];cdp.on('Runtime.exceptionThrown',event=>exceptions.push(event.exceptionDetails.text));
    const routeSelector='[data-connection-id="around-text"] .diagram-connection-hit';
    const route=()=>evaluate(cdp,`document.querySelector(${JSON.stringify(routeSelector)})?.getAttribute('d')`);
    const mouse=(type,p,clickCount=1)=>cdp.send('Input.dispatchMouseEvent',{type,...p,button:'left',buttons:type==='mouseReleased'?0:1,clickCount});
    const click=async(selector,label)=>{
      let p;await waitFor(async()=>{p=await evaluate(cdp,`(()=>{const el=[...document.querySelectorAll(${JSON.stringify(selector)})].find(el=>!el.disabled&&(!${JSON.stringify(label)}||el.textContent.trim()===${JSON.stringify(label)}));if(!el)return null;
        const r=el.getBoundingClientRect(),p={x:r.x+r.width/2,y:r.y+r.height/2};return el.contains(document.elementFromPoint(p.x,p.y))?p:null;})()`);return !!p;}).catch(async error=>{
          await captureScreenshot(cdp,{output:process.env.EDGE_OBSTACLES_SCREENSHOT??path.join(root,'failure.png')});
          const detail=await evaluate(cdp,`(()=>{const el=document.querySelector(${JSON.stringify(selector)});if(!el)return 'missing';const r=el.getBoundingClientRect();return {element:el.outerHTML,hit:document.elementFromPoint(r.x+r.width/2,r.y+r.height/2)?.outerHTML};})()`);
          throw Error(String(error)+' '+JSON.stringify(detail));
        });
      await mouse('mousePressed',p);await mouse('mouseReleased',p);
    };
    const avoidsText=async()=>{
      const result=await evaluate(cdp,`(()=>{const path=document.querySelector(${JSON.stringify(routeSelector)}),m=path.getScreenCTM();
        const rows=[...document.querySelectorAll('[data-native-node="grid:blocker"] .diagram-content-node')].map(label=>{
          const r=label.getBoundingClientRect();return {x:r.x,y:r.y,width:r.width,height:r.height,text:label.textContent};});
        const violations=[];for(let i=1;i<path.getTotalLength();i+=1){const p=path.getPointAtLength(i),s=new DOMPoint(p.x,p.y).matrixTransform(m);
          if(rows.some(r=>s.x>r.x&&s.x<r.x+r.width&&s.y>r.y&&s.y<r.y+r.height))violations.push({x:s.x,y:s.y});}
        return {violations:violations.slice(0,3),length:path.getTotalLength(),labels:rows,path:path.getAttribute('d')};})()`);
      if(result.violations.length){console.error(JSON.stringify(result));await captureScreenshot(cdp,{output:process.env.EDGE_OBSTACLES_SCREENSHOT??path.join(root,'failure.png')});}
      assert.deepEqual(result.violations,[],'Route must avoid every visible text label');return result.length;
    };
    await waitForSelector(cdp,routeSelector);
    await waitFor(async()=>await evaluate(cdp,"document.querySelector('[data-connection-id=\"around-text\"]').dataset.geometrySource==='measured'"));
    const checkSides = async () => {
      await waitFor(async()=>await evaluate(cdp,"document.querySelector('[data-connection-id=\"choose-sides\"]')?.dataset.geometrySource==='measured'"));
      const bounds = await evaluate(cdp,"(()=>{const p=document.querySelector('[data-connection-id=\"choose-sides\"] .diagram-connection-hit'),b=p.getBBox();return {width:b.width,length:p.getTotalLength()};})()");
      assert.ok(bounds.width < 180 && bounds.length < 350, `Flexible sides must choose the short left channel: ${JSON.stringify(bounds)}`);
    };
    await checkSides();
    const checkGuide = async () => {
      await waitFor(async()=>await evaluate(cdp,"document.querySelector('[data-connection-id=\"cross-guide\"]')?.dataset.geometrySource==='measured'"));
      const route = await evaluate(cdp, `(()=>{const p=document.querySelector('[data-connection-id="cross-guide"] .diagram-connection-hit'),m=p.getScreenCTM(),b=p.getBBox();
        const labels=[...document.querySelectorAll('[data-native-node="grid:gutter"] .diagram-content-node')].map(e=>e.getBoundingClientRect());
        const first=p.getPointAtLength(0),last=p.getPointAtLength(p.getTotalLength());
        const start=new DOMPoint(first.x,first.y).matrixTransform(m),end=new DOMPoint(last.x,last.y).matrixTransform(m);
        const box=document.querySelector('[data-grid-box=gutter]').getBoundingClientRect();
        let crossesText=false;for(let i=1;i<p.getTotalLength();i++){const q=p.getPointAtLength(i),s=new DOMPoint(q.x,q.y).matrixTransform(m);
          crossesText ||= labels.some(r=>s.x>r.left&&s.x<r.right&&s.y>r.top&&s.y<r.bottom);}
        return {height:b.height,length:p.getTotalLength(),crossesGutter:start.x<box.left&&end.x>box.left+10,crossesText};})()`);
      assert.ok(route.height < 1 && route.length < 180 && route.crossesGutter && !route.crossesText,
        `Cross the tall guide directly, avoiding labels: ${JSON.stringify(route)}`);
    };
    await checkGuide();
    const checkLanes = async () => {
      await waitFor(async()=>await evaluate(cdp, `[...document.querySelectorAll('[data-connection-id^="lane-"]')].length===3 &&
        [...document.querySelectorAll('[data-connection-id^="lane-"]')].every(e=>e.dataset.geometrySource==='measured')`));
      const lanes = await evaluate(cdp, `(()=>{
        const root=[...document.querySelectorAll('[data-native-node="grid:laneTarget"] .diagram-content-node')].find(e=>e.textContent==='Lane target').getBoundingClientRect();
        return [...document.querySelectorAll('[data-connection-id^="lane-"] .diagram-connection-hit')].map(p=>{
          const end=p.getPointAtLength(p.getTotalLength()),m=p.getScreenCTM(),screen=new DOMPoint(end.x,end.y).matrixTransform(m);
          return {path:p.getAttribute('d'),dx:screen.x-root.left,dy:screen.y-(root.top+root.height/2)};
        });})()`);
      assert.equal(new Set(lanes.map(l=>l.path)).size,3,'Three shared runs must occupy different lanes');
      for(const lane of lanes) assert.ok(Math.abs(lane.dx)<1 && Math.abs(lane.dy)<1,`Diagram destination must terminate on its root label: ${JSON.stringify(lane)}`);
      return lanes.map(l=>l.path);
    };
    const initialLanes=await checkLanes();
    const initial=await route(), initialLength=await avoidsText();
    await captureScreenshot(cdp,{output:process.env.EDGE_OBSTACLES_SCREENSHOT??path.join(root,'routing.png')});
    await cdp.send('Input.dispatchMouseEvent',{type:'mouseWheel',x:1300,y:800,deltaX:40,deltaY:30});
    assert.equal(await route(),initial,'Panning must not change canvas-space routes');
    assert.deepEqual(await checkLanes(),initialLanes,'Panning must preserve spaced lanes');
    const select=await evaluate(cdp,"(()=>{const r=document.querySelector('[data-grid-box=blocker]').getBoundingClientRect();return {x:r.right-8,y:r.bottom-8};})()");
    await mouse('mousePressed',select);await mouse('mouseReleased',select);await mouse('mousePressed',select,2);await mouse('mouseReleased',select,2);
    await waitForSelector(cdp,'[data-diagram-move-handle="grid:blocker"]');
    const handle=await evaluate(cdp,"(()=>{const r=document.querySelector('[data-diagram-move-handle=\"grid:blocker\"]').getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2};})()");
    await evaluate(cdp,"window.__routingLongTasks=[];window.__routingObserver=new PerformanceObserver(list=>window.__routingLongTasks.push(...list.getEntries().map(entry=>entry.duration)));window.__routingObserver.observe({type:'longtask'});");
    await mouse('mouseMoved',handle);await mouse('mousePressed',handle);
    for(let i=1;i<=12;i++)await mouse('mouseMoved',{x:handle.x,y:handle.y+i*20});
    await waitFor(async()=>await route()!==initial); // The non-endpoint obstacle moves before the gesture is saved.
    await avoidsText();
    await mouse('mouseReleased',{x:handle.x,y:handle.y+240});
    await waitFor(async()=>Number(await evaluate(cdp,"document.querySelector('[data-grid-box=blocker]').dataset.gridRow"))>0);
    const movedLength=await avoidsText();assert.ok(movedLength<initialLength,'Moving the blocker out of the channel should shorten the route');
    const longTasks=await evaluate(cdp,'window.__routingObserver.disconnect();window.__routingLongTasks');
    await click('.mapping-grid-tools button','Undo');
    await waitFor(async()=>Number(await evaluate(cdp,"document.querySelector('[data-grid-box=blocker]').dataset.gridRow"))===0);
    await avoidsText();
    await cdp.send('Input.dispatchKeyEvent',{type:'keyDown',key:'Escape',code:'Escape',windowsVirtualKeyCode:27});
    await cdp.send('Input.dispatchKeyEvent',{type:'keyUp',key:'Escape',code:'Escape',windowsVirtualKeyCode:27});
    await click('[data-subtree-owner="grid:blocker"][data-subtree-line="2"]');
    await waitFor(async()=>await evaluate(cdp,"document.querySelector('[data-subtree-owner=\"grid:blocker\"][data-subtree-line=\"2\"]').getAttribute('aria-expanded')==='false'"));
    assert.ok(await avoidsText()<initialLength,'Hidden rows must stop obstructing routes');
    await click('[aria-label="Menu"]');await click('.mapping-workspace-actions button','Save workspace');
    await waitFor(async()=>{const result=await fetch(url+'/api/mapping/workspace').then(r=>r.json());return (result.workspace??result)?.documents?.[0]?.canvas.diagramViews?.['grid:blocker']?.collapsedContentNodeIds.length===1;});
    await evaluate(cdp,'window.__beforeRoutingReload=true');await cdp.send('Page.reload',{ignoreCache:true});
    await waitFor(async()=>{try{return await evaluate(cdp,'window.__beforeRoutingReload!==true&&document.readyState==="complete"');}catch{return false;}});
    await waitForSelector(cdp,routeSelector);await avoidsText();await checkSides();await checkGuide();await checkLanes();
    assert.deepEqual(exceptions,[]);
    console.log(JSON.stringify({result:'PASS root destinations, shared lanes, guide crossing, label avoidance, flexible attachment, pan stability, live obstacle drag, undo, collapse and reload',initialLength,movedLength,dragLongTasksMs:longTasks}));
  });
}finally{
  if(server){try{process.kill(-server.pid,'SIGTERM');}catch{}}
  await rm(root,{recursive:true,force:true});
}
