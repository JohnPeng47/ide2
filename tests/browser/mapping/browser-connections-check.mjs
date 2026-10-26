// npm run build && node --import tsx tests/browser/mapping/browser-connections-check.mjs
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, rm, readFile, writeFile } from 'node:fs/promises';
import { tmpdir, homedir } from 'node:os';
import { createServer } from 'node:net';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { seedMappingFixture } from '../support/browser-mapping-fixture.mjs';
import { canvasSaveFixture } from '../../support/mappingDiagram.ts';
import { revisionFixture } from '../../support/diagramRevisions.ts';
import { connectionContentNodes, defaultArrowAppearance } from '../../../domain/core/diagrams/diagramConnection.ts';
import { singleDiagramScene } from '../../../domain/core/diagrams/projectDiagramCanvas.ts';
const { evaluate, waitFor, waitForSelector, withHeadlessBrowser, captureScreenshot } = await import(pathToFileURL(path.join(homedir(), '.codex/skills/front-end/browser-test.mjs')).href);
async function checkConnections(nodeFocus) {
const root = await mkdtemp(path.join(tmpdir(), 'edge-focus-'));
let server;
try {
  const ascii = 'Root\n|-- Branch\n|   `-- Leaf\n`-- Footer';
  await seedMappingFixture(root, { ascii, nodes: [] });
  const catalogPath = path.join(root, '.diagrams/representations/catalog.json');
  const catalog = JSON.parse(await readFile(catalogPath, 'utf8')), scene = singleDiagramScene(ascii);
  scene.contents.overview = revisionFixture().create({ id: 'overview', revision: 0, ascii, structureKind: 'tree' }).diagram;
  scene.root.children[0].position = { column: 8, row: 8 };
  scene.root.children.push({ ...scene.root.children[0], id: 'second', position: { column: 65, row: 16 } });
  const content = scene.contents.overview.content;
  const leaf = connectionContentNodes(content).find(n => n.label === 'Leaf');
  const anchor = (box, side) => ({kind:'content-node',displayNodeId:`grid:${box}`,contentNodeId:leaf.id,revisionId:content.revisionId,side});
  const edge = {id:'route',source:anchor('overview','right'),target:anchor('second','left'),appearance:{...defaultArrowAppearance,label:'Uses'}};
  const incoming = { ...edge, id: 'incoming', source: { ...anchor('second', 'left'), contentNodeId: connectionContentNodes(content).find(n => n.label === 'Branch').id }, target: anchor('overview', 'right') };
  const outgoing = { ...edge, id: 'outgoing', target: { ...anchor('second', 'left'), contentNodeId: connectionContentNodes(content).find(n => n.label === 'Footer').id } };
  catalog.revisions['revision-overview'].content = {kind:'canvas-history',history:canvasSaveFixture({name:'Fixture',scene,edges:nodeFocus ? [edge,incoming,outgoing] : [edge]}).history};
  const original = JSON.stringify(catalog); await writeFile(catalogPath, original);
  const port = await new Promise(resolve=>{const s=createServer();s.listen(0,'127.0.0.1',()=>{const p=s.address().port;s.close(()=>resolve(p));});});
  const url=`http://127.0.0.1:${port}`;
  server=spawn(process.execPath,['scripts/dev/start-server.mjs', '--http','preview','--host','127.0.0.1','--port',String(port),'--strictPort'],{env:{...process.env,NEW_DIAGRAM_PROJECT_ROOT:root,NEW_DIAGRAMS_DIR:path.join(root,'.diagrams'),NEW_DIAGRAM_AGENT:'fake'},stdio:['ignore','ignore','pipe']});
  let logs='';server.stderr.on('data',chunk=>logs+=chunk);
  await waitFor(async()=>(await fetch(url).catch(()=>null))?.ok,{timeoutMs:20000}).catch(e=>{throw Error(`${e}\n${logs}`)});
  await withHeadlessBrowser({url:`${url}/mapping`,width:1800,height:1100,chromePath:process.env.CHROME_PATH,arguments:['--disable-gpu','--no-sandbox']},async({cdp})=>{
    const errors=[]; await cdp.send('Runtime.enable'); await cdp.send('Page.enable');
    cdp.on('Runtime.exceptionThrown',event=>errors.push(event.exceptionDetails.exception?.description??event.exceptionDetails.text));
    cdp.on('Page.javascriptDialogOpening',()=>void cdp.send('Page.handleJavaScriptDialog',{accept:true}));
    const read=expression=>evaluate(cdp,expression);
    const key=async(key,code,value)=>{await cdp.send('Input.dispatchKeyEvent',{type:'keyDown',key,code,windowsVirtualKeyCode:value,...(key.length===1?{text:key}:{})});await cdp.send('Input.dispatchKeyEvent',{type:'keyUp',key,code,windowsVirtualKeyCode:value});};
    const clickAt=async p=>{await cdp.send('Input.dispatchMouseEvent',{type:'mousePressed',...p,button:'left',buttons:1,clickCount:1});await cdp.send('Input.dispatchMouseEvent',{type:'mouseReleased',...p,button:'left',buttons:0,clickCount:1});};
    const click=async selector=>clickAt(await read(`(()=>{const r=document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect();return{x:r.x+r.width/2,y:r.y+r.height/2}})()`));
    const camera=()=>read('document.querySelector(".diagram-canvas__surface").style.transform');
    const stableCamera=async()=>{let previous;await waitFor(async()=>{const value=await camera(),same=value===previous;previous=value;return same;});};
    const settle=()=>read('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))');
    const edgePoint=orientation=>read(`(()=>{const p=document.querySelector('[data-connection-id=route] .diagram-connection-hit'),m=p.getScreenCTM();const points=[...p.getAttribute('d').matchAll(/[ML]([^ML]+)/g)].map(v=>{const [x,y]=v[1].trim().split(/\\s+/).map(Number);return{x,y}});return points.slice(1).map((b,i)=>({a:points[i],b})).filter(({a,b})=>Math.hypot(a.x-b.x,a.y-b.y)>15&&(${JSON.stringify(orientation)}==='horizontal'?a.y===b.y:a.x===b.x)).sort((a,b)=>Math.hypot(b.a.x-b.b.x,b.a.y-b.b.y)-Math.hypot(a.a.x-a.b.x,a.a.y-a.b.y)).map(({a,b})=>new DOMPoint((a.x+b.x)/2,(a.y+b.y)/2).matrixTransform(m)).filter(q=>document.elementFromPoint(q.x,q.y)===p).map(q=>({x:q.x,y:q.y}))[0]})()`);
    const focused=()=>read('!!document.querySelector("[data-edge-focused=true]")');
    const centered=(box,line=3)=>read(`(()=>{const n=document.querySelector('[data-native-node="grid:${box}"] [data-content-node-id][data-source-line="${line}"]').getBoundingClientRect(),v=document.querySelector('.mapping-editor-canvas').getBoundingClientRect();return Math.abs(n.x+n.width/2-v.x-v.width/2)<2&&Math.abs(n.y+n.height/2-v.y-v.height/2)<2})()`);
    await waitForSelector(cdp,'.diagram-connection-hit');
    await waitFor(async()=>!!await edgePoint('horizontal'));
    assert.ok(await read(`(()=>{
      const edge=document.querySelector('.diagram-connection-hit').closest('.tl-shape');
      const diagrams=[...document.querySelectorAll('.mapping-native-diagram')].map(node=>node.closest('.tl-shape'));
      return diagrams.length>0&&diagrams.every(node=>Number(getComputedStyle(edge).zIndex)>Number(getComputedStyle(node).zIndex));
    })()`),'Edges must render above diagram shapes');
    assert.equal(await read('!!document.querySelector(".diagram-connections-panel")||[...document.querySelectorAll(".mapping-grid-tools button")].some(b=>b.textContent.startsWith("Connections"))'),false);
    if (!nodeFocus) {
    const before=await camera();await key('[','BracketLeft',219);await settle();assert.equal(await camera(),before,'Unfocused brackets moved the canvas');
    const horizontal=await edgePoint('horizontal');assert.ok(horizontal);await clickAt(horizontal);
    await waitFor(focused);await waitForSelector(cdp,'.edge-focus-hint');
    assert.equal(await read('document.querySelectorAll("[data-edge-endpoint]").length'),2);
    assert.equal(await read('document.querySelector(".edge-focus-hint").dataset.orientation'),'horizontal');
    assert.ok(await read(`(()=>{const r=document.querySelector('.edge-focus-hint').getBoundingClientRect();return r.bottom<${horizontal.y}&&Math.abs(r.x+r.width/2-${horizontal.x})<2})()`),'Horizontal hint must sit above the click');
    if(process.env.EDGE_SCREENSHOT)await captureScreenshot(cdp,{output:process.env.EDGE_SCREENSHOT});
    const assertFocus = async () => {
      assert.equal(await focused(),true,'Panning cleared edge focus');
      assert.equal(await read('document.querySelectorAll("[data-edge-endpoint]").length'),2,'Panning cleared endpoint highlights');
      assert.equal(await read('document.querySelectorAll(".edge-focus-hint").length'),1);
    };
    const dragPan = async (button, point) => {
      const before = await camera(), buttons = button === 'middle' ? 4 : 1;
      await cdp.send('Input.dispatchMouseEvent',{type:'mousePressed',...point,button,buttons,clickCount:1});
      await assertFocus();
      for(let step=1;step<=5;step++)await cdp.send('Input.dispatchMouseEvent',{type:'mouseMoved',x:point.x+step*12,y:point.y+step*5,button,buttons});
      await waitFor(async()=>await camera()!==before);
      await assertFocus();
      await cdp.send('Input.dispatchMouseEvent',{type:'mouseReleased',x:point.x+60,y:point.y+25,button,buttons:0,clickCount:1});
      await stableCamera();await assertFocus();
    };
    const wheelBefore = await camera();
    await cdp.send('Input.dispatchMouseEvent',{type:'mouseWheel',x:1400,y:800,deltaX:60,deltaY:40});
    await waitFor(async()=>await camera()!==wheelBefore);await stableCamera();await assertFocus();
    await dragPan('middle',{x:1400,y:800});
    await cdp.send('Input.dispatchKeyEvent',{type:'keyDown',key:' ',code:'Space',windowsVirtualKeyCode:32});
    await assertFocus();
    await dragPan('left',await edgePoint('horizontal'));
    await cdp.send('Input.dispatchKeyEvent',{type:'keyUp',key:' ',code:'Space',windowsVirtualKeyCode:32});
    await click('.diagram-canvas__controls button:nth-child(2)');await assertFocus();
    await dragPan('left',{x:1400,y:800});
    await click('.diagram-canvas__controls button:first-child');await assertFocus();
    if(process.env.EDGE_SCREENSHOT)await captureScreenshot(cdp,{output:process.env.EDGE_SCREENSHOT.replace('.png','-panned.png')});
    const zoom=await read('document.querySelector(".diagram-connection-hit").getScreenCTM().a');
    await key('[','BracketLeft',219);await waitFor(()=>centered('overview'));
    await key(']','BracketRight',221);await waitFor(()=>centered('second'));
    assert.equal(await read('document.querySelector(".diagram-connection-hit").getScreenCTM().a'),zoom,'Endpoint navigation changed zoom');
    assert.equal(await focused(),true);
    await stableCamera();
    await key('Escape','Escape',27);await waitFor(async()=>!await focused());
    assert.equal(await read('document.querySelectorAll(".edge-focus-hint,[data-edge-endpoint]").length'),0,'Escape left edge focus UI behind');
    const afterEscape=await camera();await key('[','BracketLeft',219);await settle();assert.equal(await camera(),afterEscape);
    // Reset through the public canvas control before clicking another segment of the same edge.
    await click('[title="Reset zoom and center diagram"]');
    await waitFor(async()=>!!await edgePoint('vertical'));
    // Let the fit animation finish by observing stable geometry.
    await stableCamera();
    const vertical=await edgePoint('vertical');assert.ok(vertical);await clickAt(vertical);await waitFor(focused);
    assert.equal(await read('document.querySelector(".edge-focus-hint").dataset.orientation'),'vertical');
    assert.ok(await read(`(()=>{const r=document.querySelector('.edge-focus-hint').getBoundingClientRect();return r.left>${vertical.x}&&Math.abs(r.y+r.height/2-${vertical.y})<2})()`),'Vertical hint must sit to the right');
    if(process.env.EDGE_SCREENSHOT)await captureScreenshot(cdp,{output:process.env.EDGE_SCREENSHOT.replace('.png','-vertical.png')});
    await clickAt(vertical);await waitFor(async()=>!await focused());
    assert.equal(await read('document.querySelectorAll(".edge-focus-hint,[data-edge-endpoint]").length'),0);
    await key('Enter','Enter',13);await waitFor(focused);
    await key('Enter','Enter',13);await waitFor(async()=>!await focused());
    await clickAt(vertical);await waitFor(focused);
    await click('[aria-label="Filter diagrams"]');await waitFor(async()=>!await focused());
    const beforeTyping=await camera();await key('[','BracketLeft',219);await key(']','BracketRight',221);await settle();
    assert.equal(await camera(),beforeTyping,'Typing brackets moved the canvas');
    assert.ok(await read(`document.querySelector('[aria-label="Filter diagrams"]').value.includes('[]')`));
    }
    if (nodeFocus) {
    await click('[title="Reset zoom and center diagram"]');await stableCamera();
    const leafSelector = '[data-native-node="grid:overview"] [data-content-node-id][data-source-line="3"]';
    await click(leafSelector);
    await waitFor(async()=>await read('document.querySelectorAll("[data-edge-focused=true]").length')===3);
    assert.equal(await read('document.querySelectorAll(".edge-focus-hint").length'),3,'Node click must expose all connected edge controls');
    assert.ok(await read(`(()=>{const hints=[...document.querySelectorAll('.edge-focus-hint')].map(node=>node.getBoundingClientRect());
      return hints.every((a,i)=>hints.slice(i+1).every(b=>a.right<=b.left||b.right<=a.left||a.bottom<=b.top||b.bottom<=a.top));})()`),
      'Connected edge controls must not overlap');
    if(process.env.EDGE_SCREENSHOT)await captureScreenshot(cdp,{output:process.env.EDGE_SCREENSHOT.replace('.png','-node.png')});
    const nodeZoom=await read('document.querySelector(".diagram-connection-hit").getScreenCTM().a');
    await key(']','BracketRight',221);await waitFor(()=>centered('second',3));
    await key(']','BracketRight',221);await waitFor(()=>centered('second',4));
    await key(']','BracketRight',221);await waitFor(()=>centered('second',3));
    await key('[','BracketLeft',219);await waitFor(()=>centered('second',2));
    assert.equal(await read('document.querySelector(".diagram-connection-hit").getScreenCTM().a'),nodeZoom);
    await click('[data-focused-edge="route"] [aria-label="Focus source node"]');await waitFor(()=>centered('overview'));
    await stableCamera();
    await click(leafSelector);await waitFor(focused);
    // Clicking another label with no connections clears the previous highlights.
    await click('[data-native-node="grid:overview"] [data-content-node-id][data-source-line="4"]');
    await waitFor(async()=>!await focused());
    await click(leafSelector);await waitFor(focused);
    await key('Escape','Escape',27);await waitFor(async()=>!await focused());
    assert.equal(await read('document.querySelectorAll(".edge-focus-hint,[data-edge-endpoint]").length'),0);
    }
    assert.equal(await readFile(catalogPath,'utf8'),original,'Edge focus changed the saved diagram');
    assert.deepEqual(errors,[]);
    console.log(nodeFocus ? 'PASS: plain node clicks highlight incoming/outgoing edges and cycle bracket jumps; click-away and Escape clear focus without saving changes.' : 'PASS: edge toggle, endpoint hints, panning, bracket navigation, text input and unchanged diagram.');
  });
}finally{if(server&&server.exitCode===null){server.kill('SIGTERM');await new Promise(resolve=>server.once('exit',resolve));}await rm(root,{recursive:true,force:true});}

}
await checkConnections(false);
await checkConnections(true);
