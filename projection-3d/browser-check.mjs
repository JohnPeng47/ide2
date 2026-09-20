import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { once } from 'node:events';
import { homedir } from 'node:os';
import { resolve } from 'node:path';
import { readFile, mkdtemp, writeFile, rm, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { execFileSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

const { withHeadlessBrowser, evaluate, waitFor, waitForSelector, captureScreenshot }=
  await import(pathToFileURL(resolve(homedir(),'.codex/skills/front-end/browser-test.mjs')));
const fixtureDir=await mkdtemp(resolve(tmpdir(),'projection-save-test-'));
const root=new URL('.',import.meta.url).pathname;
const source=JSON.parse(await readFile(new URL('./diagrams.json',import.meta.url),'utf8'));
const port=await new Promise(resolvePort=>{const s=createServer();s.listen(0,'127.0.0.1',()=>{const p=s.address().port;s.close(()=>resolvePort(p));});});
const server=spawn(process.execPath,['../node_modules/vite/bin/vite.js','preview','--config','vite.config.mjs','--port',String(port)],{cwd:root,stdio:'ignore'});

async function point(cdp,selector) {
  return evaluate(cdp,`(()=>{const r=document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2};})()`);
}
async function mouse(cdp,type,p,buttons=0,modifiers=0) {
  await cdp.send('Input.dispatchMouseEvent',{type,...p,button:'left',buttons,modifiers,clickCount:1});
}
async function click(cdp,selector) {
  await evaluate(cdp,`document.querySelector(${JSON.stringify(selector)}).scrollIntoView({block:'nearest'})`);
  const p=await point(cdp,selector);await mouse(cdp,'mouseMoved',p);await mouse(cdp,'mousePressed',p,1);await mouse(cdp,'mouseReleased',p);
}
async function key(cdp,key,code=key,modifiers=0) {
  await cdp.send('Input.dispatchKeyEvent',{type:'keyDown',key,code,modifiers,...(key==='a'&&modifiers===2?{windowsVirtualKeyCode:65,commands:['selectAll']}: {})});
  await cdp.send('Input.dispatchKeyEvent',{type:'keyUp',key,code,modifiers});
}
async function drag(cdp,start,end,modifiers=0) {
  await mouse(cdp,'mousePressed',start,1,modifiers);
  for(let i=1;i<=6;i++)await mouse(cdp,'mouseMoved',{x:start.x+(end.x-start.x)*i/6,y:start.y+(end.y-start.y)*i/6},1,modifiers);
  await mouse(cdp,'mouseReleased',end,0,modifiers);
}
const visibleEdges=`[...document.querySelectorAll('[data-edge]')].filter(e=>getComputedStyle(e).display!=='none').length`;
// Compare screen endpoints with independently transformed DOM text positions.
async function checkAnchors(cdp) {
  const error=await evaluate(cdp,`(()=>{
    let worst=0;
    for(const rect of document.querySelectorAll('[data-anchor-highlight]')){
      if(getComputedStyle(rect.closest('[data-plane]')).display==='none'||getComputedStyle(rect).display==='none')continue;
      const id=rect.dataset.anchorHighlight,endpoint=document.querySelector('[data-anchor="'+id+'"]');
      const p=new DOMPoint(rect.x.baseVal.value+rect.width.baseVal.value/2,rect.y.baseVal.value+rect.height.baseVal.value/2).matrixTransform(rect.getScreenCTM());
      const q=new DOMPoint(0,0).matrixTransform(endpoint.getScreenCTM());
      worst=Math.max(worst,Math.hypot(p.x-q.x,p.y-q.y));
      const [_, row, column]=endpoint.getAttribute('aria-label').match(/row ([0-9]+), column ([0-9]+)/);
      const text=rect.closest('[data-plane]').querySelector('[data-row="'+(+row-1)+'"]');
      const name=endpoint.getAttribute('aria-label').split(': ')[1].split(', row')[0].replace(/^(original|modified) /,'');
      const left=text.getStartPositionOfChar(+column-1).x;
      const right=text.getEndPositionOfChar(+column-2+name.length).x;
      const localError=Math.abs((left+right)/2-(rect.x.baseVal.value+rect.width.baseVal.value/2));
      const matrix=rect.getScreenCTM();
      worst=Math.max(worst,localError*Math.hypot(matrix.a,matrix.b));
    }return worst;
  })()`);
  assert.ok(error<.05,`Endpoint drift: ${error}px`);
}

try {
  const url=`http://127.0.0.1:${port}`;
  await waitFor(async()=> (await fetch(url).catch(()=>null))?.ok,{timeoutMs:15000});
  await withHeadlessBrowser({url,width:1600,height:1100},async({cdp})=>{
    const errors=[];cdp.on('Runtime.exceptionThrown',e=>errors.push(e.exceptionDetails.text));await cdp.send('Runtime.enable');
    await waitForSelector(cdp,'html[data-ready="true"]');
    await waitFor(()=>evaluate(cdp,`document.querySelector('[data-plane]').hasAttribute('transform')`));
    assert.equal(await evaluate(cdp,visibleEdges),6);
    assert.equal(await evaluate(cdp,`document.querySelectorAll('[data-anchor]').length`),11);
    const rendered=await evaluate(cdp,`['D2','D5'].map(id=>[...document.querySelectorAll('[data-plane="'+id+'"] .diagram-row')].map(t=>t.textContent).join(String.fromCharCode(10)))`);
    assert.deepEqual(rendered,source.map(d=>d.ascii));
    assert.ok(await evaluate(cdp,`document.querySelectorAll('.edge[data-hidden="true"]').length>0`));
    await checkAnchors(cdp);
    if(process.env.PROJECTION_SCREENSHOT)await captureScreenshot(cdp,{output:process.env.PROJECTION_SCREENSHOT});

    // Endpoints are real pointer targets, including the node on the lower plane.
    await click(cdp,'[data-anchor="D2-S1-0"]');
    await mouse(cdp,'mouseMoved',{x:900,y:80});
    await waitFor(()=>evaluate(cdp,`document.querySelector('.correspondence[data-component="S1"] button').getAttribute('aria-pressed')==='true'`));
    await click(cdp,'#clear-selection');

    await click(cdp,'.correspondence[data-component="S5"] button');
    await mouse(cdp,'mouseMoved',{x:900,y:80});
    await waitFor(()=>evaluate(cdp,`document.querySelector('.correspondence[data-component="S5"] button').getAttribute('aria-pressed')==='true'`));
    assert.ok((await evaluate(cdp,`document.querySelector('#detail-body').textContent`)).includes('modified TextModel'));
    assert.equal(await evaluate(cdp,`document.querySelector('[data-edge][data-component="S1"]').getAttribute('opacity')`),'0.12');
    await click(cdp,'.correspondence[data-component="S5"] input');
    await waitFor(async()=>await evaluate(cdp,visibleEdges)===4);
    await click(cdp,'.correspondence[data-component="S5"] input');
    await waitFor(async()=>await evaluate(cdp,visibleEdges)===6);

    const before=await evaluate(cdp,`document.querySelector('[data-plane="D5"]').getAttribute('transform')`);
    await click(cdp,'#separation');await key(cdp,'ArrowRight');
    await waitFor(()=>evaluate(cdp,`document.querySelector('#separation-value').textContent!=='1000'`));
    assert.notEqual(await evaluate(cdp,`document.querySelector('[data-plane="D5"]').getAttribute('transform')`),before);
    await checkAnchors(cdp);
    await click(cdp,'#opacity');await key(cdp,'ArrowLeft');
    await waitFor(()=>evaluate(cdp,`document.querySelector('.plane-paper').getAttribute('fill-opacity')!=='0.9'`));

    const view=await point(cdp,'#viewport');
    const orbitBefore=await evaluate(cdp,`document.querySelector('#azimuth').value`);
    await drag(cdp,view,{x:view.x+90,y:view.y-45});
    await waitFor(async()=>await evaluate(cdp,`document.querySelector('#azimuth').value`)!==orbitBefore);
    await checkAnchors(cdp);
    const panBefore=await evaluate(cdp,`document.querySelector('[data-plane="D2"]').getAttribute('transform')`);
    await drag(cdp,view,{x:view.x-65,y:view.y+40},8);
    await waitFor(async()=>await evaluate(cdp,`document.querySelector('[data-plane="D2"]').getAttribute('transform')`)!==panBefore);
    await checkAnchors(cdp);
    const zoomBefore=await evaluate(cdp,`document.querySelector('#zoom-value').textContent`);
    await cdp.send('Input.dispatchMouseEvent',{type:'mouseWheel',...view,deltaX:0,deltaY:-160});
    await waitFor(async()=>await evaluate(cdp,`document.querySelector('#zoom-value').textContent`)!==zoomBefore);
    await checkAnchors(cdp);

    await click(cdp,'.view-tabs [data-view="D2"]');
    await waitFor(async()=>await evaluate(cdp,visibleEdges)===0);
    assert.equal(await evaluate(cdp,`getComputedStyle(document.querySelector('[data-plane="D5"]')).display`),'none');
    await checkAnchors(cdp);
    await click(cdp,'.view-tabs [data-view="D5"]');
    await waitFor(()=>evaluate(cdp,`getComputedStyle(document.querySelector('[data-plane="D2"]')).display==='none'`));
    await checkAnchors(cdp);
    await click(cdp,'#reset');
    await waitFor(async()=>await evaluate(cdp,visibleEdges)===6);
    assert.equal(await evaluate(cdp,`document.querySelector('#separation').value`),'1000');
    assert.equal(await evaluate(cdp,`document.querySelector('#opacity').value`),'90');

    // Check keyboard camera controls using real input and rendered transforms.
    await mouse(cdp,'mousePressed',view,1);await mouse(cdp,'mouseReleased',view);
    await key(cdp,'ArrowRight');
    await waitFor(()=>evaluate(cdp,`document.querySelector('#azimuth').value==='40'`));
    await checkAnchors(cdp);
    await key(cdp,'f','KeyF');

    // Save a changed view, reload the page, and load the named copy after reset.
    await click(cdp,'#visualization-name');await key(cdp,'a','KeyA',2);
    await cdp.send('Input.insertText',{text:'Browser round trip'});
    await click(cdp,'#save-visualization');
    await waitFor(()=>evaluate(cdp,`document.querySelector('#save-status').textContent.includes('Saved “Browser round trip”')`));
    const saved=await evaluate(cdp,`JSON.parse(localStorage.getItem('projection-3d.visualizations.v1'))[0]`);
    assert.equal(saved.view.azimuth,40);
    const transform=await evaluate(cdp,`document.querySelector('[data-plane="D2"]').getAttribute('transform')`);
    await waitFor(()=>evaluate(cdp,`JSON.parse(localStorage.getItem('projection-3d.current.v1'))?.view.azimuth===40`));
    await cdp.send('Page.reload');await waitForSelector(cdp,'html[data-ready="true"]');
    await waitFor(()=>evaluate(cdp,`document.querySelector('[data-plane="D2"]').getAttribute('transform')===${JSON.stringify(transform)}`));
    await click(cdp,'#reset');
    await click(cdp,'#saved-views');await key(cdp,'End');await key(cdp,'Enter');
    await click(cdp,'#load-visualization');
    await waitFor(()=>evaluate(cdp,`document.querySelector('#azimuth').value==='40'`));
    await checkAnchors(cdp);

    // Load the shipped flat version through the public controls.
    await click(cdp,'#saved-views');await key(cdp,'Home');await key(cdp,'ArrowDown');await key(cdp,'Enter');
    await click(cdp,'#load-visualization');
    await waitFor(()=>evaluate(cdp,`document.querySelector('#orientation').value==='flat'`));
    assert.equal(await evaluate(cdp,visibleEdges),6);
    assert.equal(await evaluate(cdp,`document.querySelectorAll('.edge[marker-end]').length`),6);
    assert.equal(await evaluate(cdp,`document.querySelector('#planes').lastElementChild.dataset.plane`),'D2');
    assert.equal(await evaluate(cdp,`document.querySelector('#tilt').value`),'-25');
    await checkAnchors(cdp);
    if(process.env.PROJECTION_FLAT_SCREENSHOT)await captureScreenshot(cdp,{output:process.env.PROJECTION_FLAT_SCREENSHOT});
    await click(cdp,'.view-tabs [data-view="D2"]');
    await waitFor(async()=>await evaluate(cdp,visibleEdges)===0);
    await checkAnchors(cdp);
    assert.equal(await evaluate(cdp,`document.querySelector('#tilt').disabled`),true);
    await click(cdp,'.view-tabs [data-view="all"]');
    await waitFor(async()=>await evaluate(cdp,visibleEdges)===6);

    // Export a real download, then import it through the file picker.
    // This harness may run Windows Chrome against the WSL-hosted app.
    const windows=process.platform==='linux' && (await evaluate(cdp,'navigator.userAgent')).includes('Windows');
    const downloadDir=windows ? await mkdtemp('/mnt/c/Windows/Temp/projection-download-') : fixtureDir;
    const browserPath=path=>windows?execFileSync('wslpath',['-w',path],{encoding:'utf8'}).trim():path;
    try {
      await cdp.send('Browser.setDownloadBehavior',{behavior:'allow',downloadPath:browserPath(downloadDir)});
      await click(cdp,'#export-visualization');
      await waitFor(async()=> (await readdir(downloadDir)).some(name=>name.endsWith('.json')));
      const filename=(await readdir(downloadDir)).find(name=>name.endsWith('.json'));
      const exported=JSON.parse(await readFile(resolve(downloadDir,filename),'utf8'));
      assert.equal(exported.view.orientation,'flat');assert.deepEqual(exported.diagrams,source);
      await click(cdp,'#reset');
      const {root:doc}=await cdp.send('DOM.getDocument');
      const {nodeId}=await cdp.send('DOM.querySelector',{nodeId:doc.nodeId,selector:'#visualization-file'});
      await cdp.send('DOM.setFileInputFiles',{nodeId,files:[browserPath(resolve(downloadDir,filename))]});
      await waitFor(()=>evaluate(cdp,`document.querySelector('#save-status').textContent.includes('Imported and saved')`));
      await waitFor(()=>evaluate(cdp,`document.querySelector('#orientation').value==='flat'`));
      await checkAnchors(cdp);
      // Reject unknown versions without changing the visible scene.
      const beforeInvalid=await evaluate(cdp,`document.querySelector('[data-plane="D2"]').getAttribute('transform')`);
      const invalidPath=resolve(downloadDir,'invalid.json');
      await writeFile(invalidPath,JSON.stringify({...exported,version:999}));
      await cdp.send('DOM.setFileInputFiles',{nodeId,files:[browserPath(invalidPath)]});
      await waitFor(()=>evaluate(cdp,`document.querySelector('#save-status').textContent.includes('unsupported format or version')`));
      assert.equal(await evaluate(cdp,`document.querySelector('[data-plane="D2"]').getAttribute('transform')`),beforeInvalid);
    } finally {if(downloadDir!==fixtureDir)await rm(downloadDir,{recursive:true,force:true});}

    await cdp.send('Emulation.setDeviceMetricsOverride',{width:760,height:900,deviceScaleFactor:1,mobile:false});
    await waitFor(()=>evaluate(cdp,`innerWidth===760`));
    await checkAnchors(cdp);
    assert.equal(await evaluate(cdp,`document.documentElement.scrollWidth<=innerWidth`),true);
    assert.deepEqual(errors,[]);
    console.log('Browser checks passed: save/load/reload, JSON export/import, invalid import, flat orientation and arrows, original text, six edges, exact anchors, pin/toggle, separation, opacity, orbit, pan, zoom, reading views, reset, keyboard, resize.');
  });
} finally {
  if(server.exitCode===null){server.kill();await once(server,'exit');}
  await rm(fixtureDir,{recursive:true,force:true});
}
