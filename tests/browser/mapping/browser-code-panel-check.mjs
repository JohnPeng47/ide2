import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, rm, writeFile, mkdir } from 'node:fs/promises';
import { tmpdir, homedir } from 'node:os';
import { createServer } from 'node:net';
import { createServer as createProxy, request as httpRequest } from 'node:http';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { seedMappingFixture } from '../support/browser-mapping-fixture.mjs';
const { evaluate, waitFor, waitForSelector, withHeadlessBrowser, captureScreenshot } = await import(pathToFileURL(path.join(homedir(), '.codex/skills/front-end/browser-test.mjs')).href);
const root = await mkdtemp(path.join(tmpdir(), 'code-panel-browser-'));
let server, proxy;
const sourceReads = new Map();
try {
  const ascii = 'Root\n|-- Parent\n|   |-- Child\n|   `-- Sibling\n|-- Other\n`-- Unmapped';
  const nodes = [
    {id:'parent',label:'Parent → café 🧭',head:{line:2,startColumn:5,endColumn:10},sourceRanges:[{path:'src/a.ts',startLine:3,endLine:5}]},
    {id:'child',label:'Child',head:{line:3,startColumn:9,endColumn:13},sourceRanges:[{path:'src/a.ts',startLine:12,endLine:14}]},
    {id:'other',label:'Other mapped operation with a long source annotation '.repeat(4),head:{line:5,startColumn:5,endColumn:9},sourceRanges:[{path:'src/b.ts',startLine:2,endLine:25}]},
  ];
  await seedMappingFixture(root, { ascii, nodes });
  await mkdir(path.join(root, 'src'));
  for (const file of ['src/a.ts','src/b.ts']) {
    const lines = Array.from({length:35},(_,i)=>`// Unmapped context ${i+1}`);
    for (const node of nodes) for (const range of node.sourceRanges.filter(range=>range.path===file)) {
      for(let n=range.startLine;n<=range.endLine;n++) lines[n-1]=`// ${node.label}: fixture source line ${n}`;
    }
    await writeFile(path.join(root,file), lines.join('\n'));
  }
  const port = await new Promise(resolve => { const s=createServer();s.listen(0,'127.0.0.1',()=>{const p=s.address().port;s.close(()=>resolve(p));}); });
  const backendUrl=`http://127.0.0.1:${port}`;
  server=spawn(process.execPath,['scripts/dev/start-server.mjs', '--http','preview','--host','127.0.0.1','--port',String(port),'--strictPort'],
    {cwd:process.cwd(),env:{...process.env,NEW_DIAGRAM_PROJECT_ROOT:root,NEW_DIAGRAMS_DIR:path.join(root,'.diagrams'),NEW_DIAGRAM_AGENT:'fake'},stdio:['ignore','ignore','pipe']});
  let errors='';server.stderr.on('data',chunk=>{errors+=chunk;});
  await waitFor(async()=>(await fetch(backendUrl).catch(()=>null))?.ok,{timeoutMs:20000});
  proxy = createProxy((request, response) => {
    const parsed = new URL(request.url, backendUrl);
    if (parsed.pathname === '/api/core/project/source') {
      const file = parsed.searchParams.get('path'); sourceReads.set(file, (sourceReads.get(file) ?? 0) + 1);
    }
    const upstream = httpRequest(parsed, { method: request.method, headers: request.headers }, result => {
      response.writeHead(result.statusCode, result.headers); result.pipe(response);
    });
    upstream.on('error', error => { response.writeHead(502); response.end(String(error)); });
    request.pipe(upstream);
  });
  await new Promise(resolve => proxy.listen(0, '127.0.0.1', resolve));
  const url = `http://127.0.0.1:${proxy.address().port}`;
  await withHeadlessBrowser({url:`${url}/mapping?diagram=representation-overview`,width:2300,height:1300,chromePath:process.env.CHROME_PATH,
    arguments:['--disable-gpu',...(process.platform==='linux'?['--no-sandbox']:[])]},async({cdp})=>{
    const send = cdp.send.bind(cdp);
    cdp.send = async (method, params) => {
      let timer;
      try { return await Promise.race([send(method, params), new Promise((_, reject) => {
        timer = setTimeout(() => reject(Error(`CDP timed out: ${method} ${JSON.stringify(params).slice(0, 300)}`)), 20000);
      })]); } finally { clearTimeout(timer); }
    };
    const exceptions=[]; await cdp.send('Page.enable'); await cdp.send('Runtime.enable'); cdp.on('Runtime.exceptionThrown',e=>exceptions.push(e.exceptionDetails.text));
    cdp.on('Page.javascriptDialogOpening', () => void cdp.send('Page.handleJavaScriptDialog', { accept: true }).catch(error => exceptions.push(String(error))));
    const click=async(selector)=>{
      let p, previous, stable = 0;
      await waitFor(async () => {
        p=await evaluate(cdp,`(()=>{const el=document.querySelector(${JSON.stringify(selector)});if(!el)return null;el.scrollIntoView({block:'nearest'});const r=el.getBoundingClientRect();const x=r.x+r.width/2,y=r.y+r.height/2;return el.contains(document.elementFromPoint(x,y))?{x,y}:null})()`);
        const next = JSON.stringify(p); stable = p && next === previous ? stable + 1 : 0; previous = next; return stable >= 2;
      }, { message: `Click target unavailable: ${selector}` });
      await cdp.send('Input.dispatchMouseEvent',{type:'mousePressed',...p,button:'left',buttons:1,clickCount:1});
      await cdp.send('Input.dispatchMouseEvent',{type:'mouseReleased',...p,button:'left',clickCount:1});
    };
    const key = async (key, code, windowsVirtualKeyCode) => {
      await cdp.send('Input.dispatchKeyEvent', {type:'keyDown',key,code,windowsVirtualKeyCode});
      await cdp.send('Input.dispatchKeyEvent', {type:'keyUp',key,code,windowsVirtualKeyCode});
    };
    const openSources = async () => {
      await key('a', 'KeyA', 65);
      await waitForSelector(cdp, '[aria-label="Selected node operations"]');
      await click('[title="Open mapped source ranges for the selected nodes"]');
      await waitForSelector(cdp, '[data-code-panel]');
    };
    const label=line=>`[data-content-node-id][data-source-line="${line}"]`;
    await waitForSelector(cdp,label(3));
    await waitFor(() => sourceReads.get('src/a.ts') === 1 && sourceReads.get('src/b.ts') === 1);
    assert.equal(await evaluate(cdp, 'document.querySelectorAll(".source-window-host").length'), 0);
    console.log('Verified background preload of all mapped files before opening source');
    // Pointer-rate selection is only a preview; Escape cancels it before panel/history commands.
    const previewPoints=await evaluate(cdp,`(()=>{const a=document.querySelector(${JSON.stringify(label(2))}).getBoundingClientRect(),b=document.querySelector(${JSON.stringify(label(4))}).getBoundingClientRect();return{start:{x:a.x+2,y:a.y+a.height/2},end:{x:b.right+20,y:b.y+b.height/2}}})()`);
    await cdp.send('Input.dispatchMouseEvent',{type:'mousePressed',...previewPoints.start,button:'left',buttons:1,modifiers:2,clickCount:1});
    await cdp.send('Input.dispatchMouseEvent',{type:'mouseMoved',...previewPoints.end,button:'left',buttons:1,modifiers:2});
    await waitForSelector(cdp,'[data-selection-preview]');
    assert.equal(await evaluate(cdp,'document.querySelectorAll("[data-code-panel]").length'),0);
    await cdp.send('Input.dispatchKeyEvent',{type:'keyDown',key:'Escape',code:'Escape',windowsVirtualKeyCode:27});
    await cdp.send('Input.dispatchKeyEvent',{type:'keyUp',key:'Escape',code:'Escape',windowsVirtualKeyCode:27});
    await cdp.send('Input.dispatchMouseEvent',{type:'mouseReleased',...previewPoints.end,button:'left',modifiers:2,clickCount:1});
    await waitFor(async()=>await evaluate(cdp,'!document.querySelector("[data-selection-preview]")&&!document.querySelector("[data-code-panel]")'));
    // Stationary Ctrl-clicks must leave the target intact for additive diagram double-click.
    for (const clickCount of [1,2]) {
      await cdp.send('Input.dispatchMouseEvent',{type:'mousePressed',...previewPoints.start,button:'left',buttons:1,modifiers:2,clickCount});
      await cdp.send('Input.dispatchMouseEvent',{type:'mouseReleased',...previewPoints.start,button:'left',modifiers:2,clickCount});
      assert.equal(await evaluate(cdp,'document.querySelectorAll("[data-code-panel]").length'),0);
    }
    await waitForSelector(cdp,'[data-diagram-selected="true"]');
    await cdp.send('Input.dispatchKeyEvent',{type:'keyDown',key:'Escape',code:'Escape',windowsVirtualKeyCode:27});
    await cdp.send('Input.dispatchKeyEvent',{type:'keyUp',key:'Escape',code:'Escape',windowsVirtualKeyCode:27});
    await waitFor(async()=>await evaluate(cdp,'!document.querySelector("[data-diagram-selected=true]")'));
    // Plain double-clicks on labels must not be reinterpreted as diagram selection
    // after the pan viewport captures the pointer.
    for (const clickCount of [1,2]) {
      await cdp.send('Input.dispatchMouseEvent',{type:'mousePressed',...previewPoints.start,button:'left',buttons:1,clickCount});
      await cdp.send('Input.dispatchMouseEvent',{type:'mouseReleased',...previewPoints.start,button:'left',clickCount});
    }
    await waitForSelector(cdp, '[data-selection-active=true]');
    assert.equal(await evaluate(cdp, `document.querySelectorAll('[data-code-panel], [aria-label="Selected node operations"]').length`),0);
    assert.equal(await evaluate(cdp,'document.querySelectorAll(".diagram-content-node.is-selected").length'),1);
    // The selected-node outline is identical to hover and survives moving away / clicking blank canvas.
    const hoverPoint = await evaluate(cdp, `(()=>{const r=document.querySelector(${JSON.stringify(label(3))}).getBoundingClientRect();return{x:r.x+2,y:r.y+r.height/2}})()`);
    await cdp.send('Input.dispatchMouseEvent',{type:'mouseMoved',...hoverPoint});
    await waitFor(async()=>await evaluate(cdp, `document.querySelector(${JSON.stringify(label(3))}).matches(':hover')`));
    const hoverOutline = await evaluate(cdp, `getComputedStyle(document.querySelector(${JSON.stringify(label(3))})).outline`);
    const selectedOutline = await evaluate(cdp, 'getComputedStyle(document.querySelector(".diagram-content-node.is-selected")).outline');
    const outside = await evaluate(cdp, '(()=>{const r=document.querySelector("[data-grid-box=overview]").getBoundingClientRect();return{x:r.right+40,y:r.bottom+80}})()');
    await cdp.send('Input.dispatchMouseEvent',{type:'mouseMoved',...outside});
    await cdp.send('Input.dispatchMouseEvent',{type:'mousePressed',...outside,button:'left',buttons:1,clickCount:1});
    await cdp.send('Input.dispatchMouseEvent',{type:'mouseReleased',...outside,button:'left',clickCount:1});
    assert.equal(await evaluate(cdp, 'getComputedStyle(document.querySelector(".diagram-content-node.is-selected")).outline'), selectedOutline);
    assert.match(selectedOutline, /solid/);
    assert.equal(selectedOutline, hoverOutline);
    assert.equal(await evaluate(cdp,'document.querySelectorAll("[data-selection-active=true]").length'),1);
    if(process.env.SELECTION_SCREENSHOT) await captureScreenshot(cdp,{output:process.env.SELECTION_SCREENSHOT});
    await click('.retained-selection-controls button[aria-keyshortcuts=A]');
    await waitForSelector(cdp, '[aria-label="Selected node operations"]');
    assert.equal(await evaluate(cdp, `document.querySelector('[aria-label="Selected node operations"]').textContent.includes('open call tree')`), false);
    await click('[title="Open mapped source ranges for the selected nodes"]');
    await waitForSelector(cdp,'[data-code-panel-file="src/a.ts"] [data-line="3"][data-selected=true]');
    assert.equal(await evaluate(cdp,'document.querySelectorAll("[data-diagram-selected=true]").length'),0);
    assert.equal(await evaluate(cdp, 'document.querySelectorAll(".source-window-host .window-panel").length'), 1);
    assert.equal(await evaluate(cdp, `document.querySelectorAll('.source-window-host [role=tablist], .source-window-host [aria-label="Window panel layout"]').length`), 0);
    assert.ok(await evaluate(cdp, '(()=>{const p=document.querySelector(".source-window-host .window-panel").getBoundingClientRect(),v=document.querySelector(".mapping-viewport").getBoundingClientRect();return Math.abs(p.right-v.right+12)<2 && p.left>v.left+v.width*.4})()'));
    assert.equal(sourceReads.get('src/a.ts'), 1);
    assert.equal(sourceReads.get('src/b.ts'), 1);
    assert.equal(await evaluate(cdp, 'getComputedStyle(document.querySelector(".code-panel-summary")).fontSize'), '12px');
    assert.equal(await evaluate(cdp, 'getComputedStyle(document.querySelector(".code-panel-file > header strong")).fontSize'), '12px');
    const pinchPoint = await evaluate(cdp, `(()=>{const r=document.querySelector('.source-window-host .window-panel').getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2}})()`);
    await cdp.send('Input.synthesizePinchGesture', { ...pinchPoint, scaleFactor: 1.15, relativeSpeed: 800, gestureSourceType: 'mouse' });
    await evaluate(cdp, 'new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))');
    const pageScale = await evaluate(cdp, '({scale:visualViewport.scale,left:visualViewport.offsetLeft,top:visualViewport.offsetTop})');
    if (pageScale.scale !== 1 && process.env.CODE_PANEL_SCREENSHOT) await captureScreenshot(cdp,{output:process.env.CODE_PANEL_SCREENSHOT.replace('.png','-pinch.png')});
    assert.deepEqual(pageScale, {scale:1,left:0,top:0}, 'Pinching a source panel zoomed or shifted the entire page');
    assert.equal(await evaluate(cdp,'document.querySelectorAll("[data-selection-root]").length'),1);
    const escape = async () => {
      await cdp.send('Input.dispatchKeyEvent',{type:'keyDown',key:'Escape',code:'Escape',windowsVirtualKeyCode:27});
      await cdp.send('Input.dispatchKeyEvent',{type:'keyUp',key:'Escape',code:'Escape',windowsVirtualKeyCode:27});
    };
    // Escape works with keyboard focus inside a panel, and unwinds one layer per press.
    await click('[data-code-panel-file="src/a.ts"] header button:first-of-type');
    await waitForSelector(cdp,'[data-projected-source="src/a.ts"]');
    await escape();
    await waitFor(async()=>await evaluate(cdp,'!document.querySelector("[data-code-panel]")'));
    assert.equal(await evaluate(cdp,'document.querySelectorAll("[data-selection-root]").length'),1);
    await escape();
    await waitFor(async()=>await evaluate(cdp,'!document.querySelector("[data-selection-root]")&&!document.querySelector(".mapping-poc-selection-rect")'));
    await click(label(3));
    assert.equal(await evaluate(cdp,'document.querySelectorAll("[data-code-panel]").length'),0);
    await openSources();
    await waitForSelector(cdp,'[data-code-panel-file="src/a.ts"] [data-line="12"][data-selected=true]');
    assert.equal(await evaluate(cdp,'document.querySelectorAll("[data-code-panel]").length'),1);
    await escape(); await escape();
    await click(label(4));
    await openSources();
    await waitFor(async()=>await evaluate(cdp,'document.querySelector("[data-code-panel]")?.textContent.includes("Sibling — via Parent")'));
    await escape(); await escape();
    assert.equal(await evaluate(cdp, 'document.querySelectorAll("[data-code-panel-highlight]").length'), 0);
    // Child precedes Sibling in the diagram, but Sibling inherits earlier source lines.
    const reversePoints=await evaluate(cdp,`(()=>{const a=document.querySelector(${JSON.stringify(label(3))}).getBoundingClientRect(),b=document.querySelector(${JSON.stringify(label(4))}).getBoundingClientRect();return{start:{x:a.left+1,y:a.top+a.height/2},end:{x:b.right+30,y:b.top+b.height/2}}})()`);
    await cdp.send('Input.dispatchMouseEvent',{type:'mousePressed',...reversePoints.start,button:'left',buttons:1,modifiers:2,clickCount:1});
    await cdp.send('Input.dispatchMouseEvent',{type:'mouseMoved',...reversePoints.end,button:'left',buttons:1,modifiers:2});
    await cdp.send('Input.dispatchMouseEvent',{type:'mouseReleased',...reversePoints.end,button:'left',modifiers:2,clickCount:1});
    await openSources();
    await waitFor(async()=>await evaluate(cdp, `(()=>{const sections=[...document.querySelectorAll('[data-code-panel-file]')];return sections.length===2&&sections.every(section=>section.querySelector('[data-selected=true]'))})()`));
    assert.deepEqual(await evaluate(cdp, `[...document.querySelectorAll('[data-code-panel-file]')].map(section=>[section.dataset.codePanelFile,Number(section.querySelector('[data-selected=true]').dataset.line)])`), [['src/a.ts',12],['src/a.ts',3]], 'Snippets must follow diagram nodes even when source line order is reversed');
    assert.equal(sourceReads.get('src/a.ts'),1,'Repeated sections must share the preloaded source file');
    await escape(); await escape();
    const points=await evaluate(cdp,`(()=>{const a=document.querySelector(${JSON.stringify(label(2))}).getBoundingClientRect(),b=document.querySelector(${JSON.stringify(label(5))}).getBoundingClientRect();return{start:{x:a.left+1,y:a.top+a.height/2},end:{x:b.right+100,y:b.top+b.height/2}}})()`);
    await cdp.send('Input.dispatchMouseEvent',{type:'mousePressed',...points.start,button:'left',buttons:1,modifiers:2,clickCount:1});
    await cdp.send('Input.dispatchMouseEvent',{type:'mouseMoved',...points.end,button:'left',buttons:1,modifiers:2});
    await cdp.send('Input.dispatchMouseEvent',{type:'mouseReleased',...points.end,button:'left',modifiers:2,clickCount:1});
    assert.equal(await evaluate(cdp,'document.querySelectorAll("[data-code-panel]").length'),0);
    assert.equal(await evaluate(cdp,'document.querySelectorAll(".diagram-content-node.is-selected").length'),4);
    if(process.env.SELECTION_SCREENSHOT) await captureScreenshot(cdp,{output:process.env.SELECTION_SCREENSHOT});
    await openSources();
    await waitFor(async()=>await evaluate(cdp,'document.querySelectorAll("[data-code-panel-file]").length===2'));
    await waitForSelector(cdp,'[data-code-panel-file="src/b.ts"] [data-line="2"][data-selected=true]');
    assert.equal(await evaluate(cdp,'document.querySelectorAll("[data-code-panel]").length'),1);
    assert.match(await evaluate(cdp,'document.querySelector(".code-panel-summary").textContent'),/4 selected nodes · 3 mapped resources/);
    const workspaceGeometry = () => evaluate(cdp, `['.workspace-header','.mapping-floating-pane','.mapping-viewport','.source-window-host .window-panel'].map(selector=>{const r=document.querySelector(selector).getBoundingClientRect();return {selector,x:r.x,y:r.y,width:r.width,height:r.height}})`);
    const beforeSourceScroll = await workspaceGeometry();
    const sourceScrollPoint = await evaluate(cdp, `(()=>{const r=document.querySelector('[data-code-panel-file="src/b.ts"] .source-code-viewer').getBoundingClientRect();return {x:r.x+100,y:r.y+30}})()`);
    await cdp.send('Input.dispatchMouseEvent',{type:'mouseWheel',...sourceScrollPoint,deltaX:500,deltaY:0});
    await waitFor(async()=>await evaluate(cdp, `document.querySelector('[data-code-panel-file="src/b.ts"] .source-code-viewer').scrollLeft > 100`));
    assert.deepEqual(await workspaceGeometry(), beforeSourceScroll, 'Horizontal source scrolling moved the workspace');
    assert.equal(await evaluate(cdp, 'document.querySelector(".code-panel-content").scrollLeft'), 0);
    await cdp.send('Input.dispatchMouseEvent',{type:'mouseWheel',...sourceScrollPoint,deltaX:-10000,deltaY:0});
    await waitFor(async()=>await evaluate(cdp, `document.querySelector('[data-code-panel-file="src/b.ts"] .source-code-viewer').scrollLeft === 0`));
    await cdp.send('Emulation.setDeviceMetricsOverride', { width: 1024, height: 900, deviceScaleFactor: 1, mobile: false });
    await waitFor(async()=>await evaluate(cdp, 'innerWidth === 1024'));
    assert.ok(await evaluate(cdp, `(()=>{const panel=document.querySelector('.source-window-host .window-panel').getBoundingClientRect();return panel.left>=0&&panel.right<=innerWidth&&panel.top>=0&&panel.bottom<=innerHeight})()`));
    assert.ok(await evaluate(cdp, `[...document.querySelectorAll('.source-window-host .window-panel-header button,.code-panel-file > header button')].every(e=>{const r=e.getBoundingClientRect();return r.left>=0&&r.right<=innerWidth})`));
    if(process.env.CODE_PANEL_SCREENSHOT) await captureScreenshot(cdp,{output:process.env.CODE_PANEL_SCREENSHOT.replace('.png','-narrow.png')});
    await cdp.send('Emulation.clearDeviceMetricsOverride');
    await waitFor(async()=>await evaluate(cdp, 'innerWidth === 2300'));
    assert.equal(await evaluate(cdp,'document.querySelectorAll("[data-code-panel-file=\\"src/a.ts\\"] [data-line=\\"3\\"][data-selected=true]").length'),1);
    if(process.env.CODE_PANEL_SCREENSHOT) await captureScreenshot(cdp,{output:process.env.CODE_PANEL_SCREENSHOT});
    await click('[data-code-panel-file="src/a.ts"] [aria-label="Reveal all original lines 6 through 11"]');
    await waitForSelector(cdp,'[data-code-panel-file="src/a.ts"] .source-code-line[data-line="8"]');
    if(process.env.CODE_PANEL_SCREENSHOT) await captureScreenshot(cdp,{output:process.env.CODE_PANEL_SCREENSHOT});
    await click('[data-code-panel-file="src/a.ts"] header button:first-of-type');
    await waitForSelector(cdp,'[data-projected-source="src/a.ts"] .source-code-line');
    await click('[aria-label="Toggle repository files"]');
    await waitForSelector(cdp,'[data-directory="src"]');
    await click('[data-directory="src"]');
    await waitForSelector(cdp,'[data-repository-file="src/b.ts"]');
    await click('[data-repository-file="src/b.ts"]');
    await waitForSelector(cdp,'[data-projected-source="src/b.ts"] .source-code-line');
    await click('.code-panel-summary button');
    await waitForSelector(cdp,'[data-code-panel-file="src/a.ts"] [data-line="12"][data-selected=true]');
    await waitForSelector(cdp,'[data-code-panel-file="src/b.ts"] [data-line="25"][data-selected=true]');
    const bottomEdge = await evaluate(cdp, `(()=>{const r=document.querySelector('.source-window-host [aria-label="Resize window height"]').getBoundingClientRect();return{x:r.x+r.width/2,y:r.y+r.height/2}})()`);
    await cdp.send('Input.dispatchMouseEvent', { type: 'mousePressed', ...bottomEdge, button: 'left', buttons: 1, clickCount: 1 });
    await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: bottomEdge.x, y: bottomEdge.y - 350, button: 'left', buttons: 1 });
    await cdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: bottomEdge.x, y: bottomEdge.y - 350, button: 'left', buttons: 0, clickCount: 1 });
    await waitFor(async () => await evaluate(cdp, `document.querySelector('.source-window-host .window-panel').getBoundingClientRect().bottom < ${bottomEdge.y - 300}`));
    const scrollPoint = await evaluate(cdp, `(()=>{const r=document.querySelector('.code-panel-content').getBoundingClientRect();return{x:r.x+r.width-35,y:r.y+100}})()`);
    await cdp.send('Input.dispatchMouseEvent',{type:'mouseWheel',...scrollPoint,deltaX:0,deltaY:100});
    await waitFor(async()=>await evaluate(cdp,"document.querySelector('.code-panel-content').scrollTop>=90"));
    const savedScroll = await evaluate(cdp,"document.querySelector('.code-panel-content').scrollTop");
    const paneId = await evaluate(cdp, 'document.querySelector("[data-pane-content=code-panel]").dataset.displayNode');
    await click('.retained-selection-controls button[aria-keyshortcuts=A]');
    await click('[title="Open mapped source ranges for the selected nodes"]');
    assert.equal(await evaluate(cdp, 'document.querySelector("[data-pane-content=code-panel]").dataset.displayNode'), paneId);
    assert.equal(await evaluate(cdp,'document.querySelectorAll("[data-selection-root], [data-code-panel]").length'),2);
    await waitFor(async()=>Math.abs(await evaluate(cdp,"document.querySelector('.code-panel-content').scrollTop")-savedScroll)<2);
    assert.equal(sourceReads.get('src/a.ts'), 1, 'Opening, browsing and returning refetched a preloaded file');
    assert.equal(sourceReads.get('src/b.ts'), 1, 'Multi-file selection refetched a preloaded file');
    await click('.mapping-workspace-actions > button:first-of-type');
    await waitFor(async()=>{const workspace=await(await fetch(`${url}/api/mapping/workspace`)).json();return Object.values(workspace?.documents?.[0]?.canvas.display.nodes??{}).some(n=>n.content?.kind==='code-panel'&&n.content.panel.items.length===3);});
    await waitFor(async()=>await evaluate(cdp, '!document.querySelector(".mapping-workspace-actions > button:first-of-type").disabled'));
    await evaluate(cdp, 'window.__beforeCodePanelReload = true');
    await cdp.send('Page.reload',{ignoreCache:true});
    await waitFor(async () => {
      try { return await evaluate(cdp, 'window.__beforeCodePanelReload !== true && document.readyState === \"complete\"'); }
      catch (error) { if (/context|navigated|closed/i.test(String(error))) return false; throw error; }
    }, { timeoutMs: 20000 });
    await waitForSelector(cdp,'[data-code-panel-file="src/b.ts"] [data-line="2"][data-selected=true]',{timeoutMs:20000});
    await waitFor(async()=>Math.abs(await evaluate(cdp,"document.querySelector('.code-panel-content').scrollTop")-savedScroll)<2);
    const readsBeforeReload = sourceReads.get('src/b.ts');
    // A stale range affects its file, while the other file remains usable.
    await writeFile(path.join(root,'src/b.ts'),'// changed\n'.repeat(35));
    await click('[aria-label="Reload src/b.ts"]');
    await waitFor(async()=>await evaluate(cdp,'document.querySelector("[data-code-panel-file=\\"src/b.ts\\"]")?.textContent.includes("Stale mapping:")'));
    assert.equal(await evaluate(cdp,'document.querySelectorAll("[data-code-panel-file=\\"src/b.ts\\"] .source-code-viewer").length'),0, 'Stale block should show only a warning, not the whole file');
    assert.equal(await evaluate(cdp,'document.querySelectorAll("[data-code-panel-file=\\"src/b.ts\\"] [data-selected=true]").length'),0);
    assert.ok(await evaluate(cdp,'document.querySelector("[data-code-panel-file=\\"src/a.ts\\"] [data-selected=true]")!==null'));
    assert.equal(sourceReads.get('src/b.ts'), readsBeforeReload + 1, 'Reload must fetch fresh source');
    await escape(); await escape();
    await click(label(6));
    await openSources();
    await waitFor(async()=>await evaluate(cdp,'document.querySelector("[data-code-panel]")?.textContent.includes("1 selected nodes have no mapping")'));
    assert.deepEqual(exceptions,[]);
    console.log('CodePanel passed: selection-only click/drag, persistent hover-style highlights, outside clicks, Actions mapped sources, direct/ancestor mappings, multi-selection, deduplication, simultaneous files, expandable gaps, pane reuse, save/reload, stale source and unmapped nodes.');
  });
} finally {
  if (proxy) { proxy.closeAllConnections(); await new Promise(resolve => proxy.close(resolve)); }
  if(server&&server.exitCode===null){server.kill('SIGTERM');await new Promise(resolve=>server.once('exit',resolve));}
  await rm(root,{recursive:true,force:true});
}
