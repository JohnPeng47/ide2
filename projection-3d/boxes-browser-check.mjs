import assert from 'node:assert/strict';
import { spawn,execFileSync } from 'node:child_process';
import { createServer } from 'node:net';
import { once } from 'node:events';
import { homedir,tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { readFile,mkdtemp,rm,readdir,writeFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
const {withHeadlessBrowser,evaluate,waitFor,waitForSelector,captureScreenshot}=await import(pathToFileURL(resolve(homedir(),'.codex/skills/front-end/browser-test.mjs')));
const scene=JSON.parse(await readFile(new URL('./visualizations/d5-boxes.json',import.meta.url),'utf8'));
const port=await new Promise(done=>{const s=createServer();s.listen(0,'127.0.0.1',()=>{const p=s.address().port;s.close(()=>done(p));});});
const server=spawn(process.execPath,['../node_modules/vite/bin/vite.js','preview','--config','vite.config.mjs','--port',String(port)],{cwd:new URL('.',import.meta.url),stdio:'ignore'});
async function point(cdp,selector){return evaluate(cdp,`(()=>{const r=document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect();return{x:r.x+r.width/2,y:r.y+r.height/2};})()`);}
async function mouse(cdp,type,p,buttons=0,modifiers=0){await cdp.send('Input.dispatchMouseEvent',{type,...p,button:'left',buttons,modifiers,clickCount:1});}
async function click(cdp,selector){const p=await point(cdp,selector);await mouse(cdp,'mouseMoved',p);await mouse(cdp,'mousePressed',p,1);await mouse(cdp,'mouseReleased',p);}
async function key(cdp,key,modifiers=0){await cdp.send('Input.dispatchKeyEvent',{type:'keyDown',key,modifiers,...(key==='a'&&modifiers===2?{code:'KeyA',windowsVirtualKeyCode:65,commands:['selectAll']}:{})});await cdp.send('Input.dispatchKeyEvent',{type:'keyUp',key,modifiers});}
const transform=`document.querySelector('[data-node-id="repository"] .box-text').getAttribute('transform')`;
try{
 const url=`http://127.0.0.1:${port}/boxes.html`;
 await waitFor(async()=> (await fetch(url).catch(()=>null))?.ok,{timeoutMs:15000});
 await withHeadlessBrowser({url,width:1600,height:1100},async({cdp})=>{
  const errors=[];cdp.on('Runtime.exceptionThrown',e=>errors.push(e.exceptionDetails.text));await cdp.send('Runtime.enable');
  await waitForSelector(cdp,'html[data-ready="true"]');await waitFor(()=>evaluate(cdp,transform));
  assert.equal(await evaluate(cdp,`document.querySelectorAll('.box').length`),56);
  assert.equal(await evaluate(cdp,`document.querySelectorAll('[data-connection]').length`),60);
  const labels=await evaluate(cdp,`[...document.querySelectorAll('.box')].map(g=>({id:g.dataset.nodeId,label:g.getAttribute('aria-label'),text:[...g.querySelectorAll('.box-label')].map(t=>t.textContent).join('').replace(/\\s/g,'')}))`);
  for(const n of scene.nodes){const found=labels.find(l=>l.id===n.id);assert.equal(found.label,n.label);assert.equal(found.text,n.label.replace(/\s/g,''));}
  // Top-face corners and text use exactly the same oblique transform.
  const worst=await evaluate(cdp,`Math.max(...[...document.querySelectorAll('.box')].map(g=>{const top=g.querySelector('.box-top').points.getItem(0);const m=g.querySelector('.box-text').transform.baseVal.consolidate().matrix;return Math.hypot(top.x-m.e,top.y-m.f);}))`);
  assert.ok(worst<.001);
  if(process.env.BOX_SCREENSHOT)await captureScreenshot(cdp,{output:process.env.BOX_SCREENSHOT});
  await click(cdp,'[data-node-id="repository"] .box-top');
  await waitFor(()=>evaluate(cdp,`!document.querySelector('#node-panel').hidden`));
  assert.equal(await evaluate(cdp,`document.querySelector('#node-label').textContent`),'Repository');
  assert.ok((await evaluate(cdp,`document.querySelector('#source-line').textContent`)).includes('Explicit refresh'));
  await click(cdp,'#focus-node');await waitFor(()=>evaluate(cdp,`parseInt(document.querySelector('#box-zoom').textContent)>100`));
  await click(cdp,'#close-node');await click(cdp,'#overview');
  await click(cdp,'[data-chapter="0"]');await waitFor(()=>evaluate(cdp,`parseInt(document.querySelector('#box-zoom').textContent)>100`));
  if(process.env.BOX_DETAIL_SCREENSHOT)await captureScreenshot(cdp,{output:process.env.BOX_DETAIL_SCREENSHOT});
  await click(cdp,'#overview');
  const before=await evaluate(cdp,transform),center=await point(cdp,'#box-viewport');
  await mouse(cdp,'mousePressed',center,1);await mouse(cdp,'mouseMoved',{x:center.x+80,y:center.y+35},1);await mouse(cdp,'mouseReleased',{x:center.x+80,y:center.y+35});
  await waitFor(async()=>await evaluate(cdp,transform)!==before);
  await cdp.send('Input.dispatchMouseEvent',{type:'mouseWheel',...center,deltaX:0,deltaY:-140});
  await waitFor(()=>evaluate(cdp,`parseInt(document.querySelector('#box-zoom').textContent)>100`));
  const beforeOrbit=await evaluate(cdp,transform);
  await mouse(cdp,'mousePressed',center,1,8);await mouse(cdp,'mouseMoved',{x:center.x+80,y:center.y-30},1,8);await mouse(cdp,'mouseReleased',{x:center.x+80,y:center.y-30},0,8);
  await waitFor(async()=>await evaluate(cdp,transform)!==beforeOrbit);
  await click(cdp,'#connections');await waitFor(()=>evaluate(cdp,`[...document.querySelectorAll('.box-edge')].every(e=>e.style.display==='none')`));
  await click(cdp,'#connections');
  await click(cdp,'#save-menu');await click(cdp,'#box-name');await key(cdp,'a',2);await cdp.send('Input.insertText',{text:'Box browser round trip'});await click(cdp,'#save-boxes');
  await waitFor(()=>evaluate(cdp,`document.querySelector('#save-message').textContent.includes('Saved “Box browser round trip”')`));
  await waitFor(()=>evaluate(cdp,`localStorage.getItem('projection-3d.boxes.current.v2')!==null`));
  const saved=await evaluate(cdp,`JSON.parse(localStorage.getItem('projection-3d.boxes.library.v2'))[0]`);
  assert.equal(saved.nodes.length,56);assert.equal(saved.source.ascii,scene.source.ascii);
  await waitFor(()=>evaluate(cdp,`JSON.parse(localStorage.getItem('projection-3d.boxes.current.v2')).view.zoom===${saved.view.zoom}`));
  const beforeReload=await evaluate(cdp,transform);
  await cdp.send('Page.reload');await waitForSelector(cdp,'html[data-ready="true"]');
  await waitFor(async()=>await evaluate(cdp,transform)===beforeReload);
  // Load the named copy after changing the camera.
  await click(cdp,'#overview');await click(cdp,'#save-menu');await click(cdp,'#box-saved');await key(cdp,'End');await key(cdp,'Enter');await click(cdp,'#load-boxes');
  await waitFor(()=>evaluate(cdp,`document.querySelector('#save-message').textContent.includes('Loaded “Box browser round trip”')`));
  await waitFor(()=>evaluate(cdp,`parseInt(document.querySelector('#box-zoom').textContent)>100`));
  const windows=(await evaluate(cdp,'navigator.userAgent')).includes('Windows');
  const downloadDir=await mkdtemp(windows?'/mnt/c/Windows/Temp/box-download-':resolve(tmpdir(),'box-download-'));
  const browserPath=path=>windows?execFileSync('wslpath',['-w',path],{encoding:'utf8'}).trim():path;
  try{
   await cdp.send('Browser.setDownloadBehavior',{behavior:'allow',downloadPath:browserPath(downloadDir)});
   await click(cdp,'#export-boxes');await waitFor(async()=> (await readdir(downloadDir)).some(n=>n.endsWith('.json')));
   const filename=(await readdir(downloadDir)).find(n=>n.endsWith('.json'));
   const exported=JSON.parse(await readFile(resolve(downloadDir,filename),'utf8'));assert.equal(exported.kind,'node-boxes');assert.deepEqual(exported.nodes,scene.nodes);
   const {root}=await cdp.send('DOM.getDocument');const {nodeId}=await cdp.send('DOM.querySelector',{nodeId:root.nodeId,selector:'#box-file'});
   await cdp.send('DOM.setFileInputFiles',{nodeId,files:[browserPath(resolve(downloadDir,filename))]});
   await waitFor(()=>evaluate(cdp,`document.querySelector('#save-message').textContent.includes('Imported and saved')`));
   const invalidPath=resolve(downloadDir,'invalid.json');exported.edges[0].to='unknown';await writeFile(invalidPath,JSON.stringify(exported));
   await cdp.send('DOM.setFileInputFiles',{nodeId,files:[browserPath(invalidPath)]});
   await waitFor(()=>evaluate(cdp,`document.querySelector('#save-message').textContent.includes('invalid connection')`));
   assert.equal(await evaluate(cdp,`document.querySelectorAll('.box').length`),56);
  }finally{await rm(downloadDir,{recursive:true,force:true});}
  await click(cdp,'#save-menu');await click(cdp,'#overview');
  await cdp.send('Emulation.setDeviceMetricsOverride',{width:760,height:900,deviceScaleFactor:1,mobile:false});
  await waitFor(()=>evaluate(cdp,'innerWidth===760'));assert.equal(await evaluate(cdp,'document.documentElement.scrollWidth<=innerWidth'),true);
  assert.deepEqual(errors,[]);
  console.log('Box browser checks passed: 56 source labels/top-plane transforms, 60 connections, selection/focus/chapters, pan/orbit/zoom, save/reload/load, JSON export/import/rejection, resize.');
 });
}finally{if(server.exitCode===null){server.kill();await once(server,'exit');}}
