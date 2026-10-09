import { canvasSaveFixture } from '../../support/mappingDiagram.ts';
// node --import tsx tests/browser/mapping/browser-change-sessions-check.mjs
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, rm, readFile, writeFile } from 'node:fs/promises';
import { tmpdir, homedir } from 'node:os';
import { createServer } from 'node:net';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { seedMappingFixture } from '../support/browser-mapping-fixture.mjs';
import { RevisionedDiagramService } from '../../../domain/core/diagrams/diagramService.ts';
import { projectCanvasSnapshot, singleDiagramScene } from '../../../domain/core/diagrams/projectDiagramCanvas.ts';
import { controllerBefore, controllerPatch, expectedAddedLabels, expectedUnchangedLabels } from '../../../domain/mapping/changes/__tests__/controllerDiffFixture.ts';
import { floatingBefore, floatingAfter } from '../../../domain/mapping/changes/__tests__/floatingPaneDiffFixture.ts';
const { evaluate, waitFor, waitForSelector, withHeadlessBrowser, captureScreenshot } = await import(pathToFileURL(path.join(homedir(), '.codex/skills/front-end/browser-test.mjs')).href);
const root = await mkdtemp(path.join(tmpdir(), 'change-sessions-browser-'));
let server, client;
try {
  const ascii = 'Root\n|-- Original\n|-- Keep\n`-- Gone';
  await seedMappingFixture(root, { ascii, nodes: [] });
  const catalogPath = path.join(root,'.diagrams/representations/catalog.json');
  const catalog = JSON.parse(await readFile(catalogPath,'utf8')), scene = singleDiagramScene(ascii);
  scene.contents.overview=new RevisionedDiagramService().create({id:'overview',revision:0,ascii,structureKind:'tree'}).diagram;
  catalog.revisions['revision-overview'].content={ kind: 'canvas-history', history: canvasSaveFixture({ name: 'Fixture', scene, edges:[] }).history };
  catalog.revisions['revision-overview'].ascii=projectCanvasSnapshot(scene).ascii;
  const controllerScene=singleDiagramScene(controllerBefore);
  controllerScene.contents.overview=new RevisionedDiagramService().create({id:'overview',revision:0,ascii:controllerBefore,structureKind:'tree'}).diagram;
  catalog.representations['representation-controller']={...catalog.representations['representation-overview'],id:'representation-controller',handle:'controller',name:'Controller diff regression',currentRevisionId:'revision-controller',revisionIds:['revision-controller']};
  const controllerAscii=projectCanvasSnapshot(controllerScene).ascii;
  catalog.revisions['revision-controller']={...catalog.revisions['revision-overview'],id:'revision-controller',representationId:'representation-controller',ascii:controllerAscii,asciiSha256:createHash('sha256').update(controllerAscii).digest('hex'),content:{ kind: 'canvas-history', history: canvasSaveFixture({ name: 'Fixture', scene:controllerScene, edges:[] }).history }};
  const floatingScene=singleDiagramScene(floatingBefore);
  floatingScene.contents.overview=new RevisionedDiagramService().create({id:'overview',revision:0,ascii:floatingBefore,structureKind:'tree'}).diagram;
  const floatingAscii=projectCanvasSnapshot(floatingScene).ascii;
  catalog.representations['representation-floating']={...catalog.representations['representation-overview'],id:'representation-floating',handle:'floating',name:'FloatingPane diff regression',currentRevisionId:'revision-floating',revisionIds:['revision-floating']};
  catalog.revisions['revision-floating']={...catalog.revisions['revision-overview'],id:'revision-floating',representationId:'representation-floating',ascii:floatingAscii,asciiSha256:createHash('sha256').update(floatingAscii).digest('hex'),content:{ kind: 'canvas-history', history: canvasSaveFixture({ name: 'Fixture', scene:floatingScene, edges:[] }).history }};
  const originalCatalog=JSON.stringify(catalog); await writeFile(catalogPath,originalCatalog);
  const port=await new Promise(resolve=>{const s=createServer();s.listen(0,'127.0.0.1',()=>{const p=s.address().port;s.close(()=>resolve(p));});});
  const url=`http://127.0.0.1:${port}`;
  server=spawn(process.execPath,['scripts/dev/start-server.mjs', '--http','preview','--host','127.0.0.1','--port',String(port),'--strictPort'],{
    env:{...process.env,NEW_DIAGRAM_PROJECT_ROOT:root,NEW_DIAGRAMS_DIR:path.join(root,'.diagrams'),NEW_DIAGRAM_AGENT:'fake'},stdio:['ignore','ignore','pipe']});
  let serverErrors=''; server.stderr.on('data',data=>serverErrors+=data);
  await waitFor(async()=>(await fetch(url).catch(()=>null))?.ok,{timeoutMs:20000}).catch(e=>{throw Error(`${e}\n${serverErrors}`);});
  client=new Client({name:'change-session-browser-test',version:'1'});
  await client.connect(new StdioClientTransport({command:process.execPath,args:['--import','tsx','scripts/mapping/mcp.ts',url],stderr:'pipe'}));
  const schemas=await client.listTools(); assert.ok(schemas.tools.some(t=>t.name==='create_diagram_change_session'));
  const tool=async(name,args)=>{const result=await client.callTool({name,arguments:args});assert.ok(!result.isError,JSON.stringify(result));return JSON.parse(result.content[0].text);};
  let sequence=0;
  const exec=(code,options={})=>tool('exec',{code,requestId:`exec-${++sequence}`,...options});
  await withHeadlessBrowser({url:`${url}/mapping`,width:1800,height:1100,chromePath:process.env.CHROME_PATH,arguments:['--disable-gpu']},async({cdp})=>{
    const send=cdp.send.bind(cdp);
    cdp.send=(method,params)=>{let timer;return Promise.race([send(method,params),new Promise((_,reject)=>{timer=setTimeout(()=>reject(new Error(`CDP timeout: ${method}`)),15000);})]).finally(()=>clearTimeout(timer));};
    await cdp.send('Page.enable'); cdp.on('Page.javascriptDialogOpening',()=>void cdp.send('Page.handleJavaScriptDialog',{accept:true}));
    const errors=[]; await cdp.send('Runtime.enable');cdp.on('Runtime.exceptionThrown',e=>errors.push(e.exceptionDetails.text));
    const click=async(selector,text)=>{
      const p=await evaluate(cdp,`(()=>{const e=[...document.querySelectorAll(${JSON.stringify(selector)})].find(e=>e.getClientRects().length&&(!${JSON.stringify(text??'')}||e.textContent.trim()===${JSON.stringify(text??'')}));if(!e)throw Error('Missing '+${JSON.stringify(selector)});const r=e.getBoundingClientRect();return{x:r.left+r.width/2,y:r.top+r.height/2};})()`);
      await cdp.send('Input.dispatchMouseEvent',{type:'mousePressed',...p,button:'left',buttons:1,clickCount:1});
      await cdp.send('Input.dispatchMouseEvent',{type:'mouseReleased',...p,button:'left',buttons:0,clickCount:1});
    };
    await waitForSelector(cdp,'.mapping-poc-ascii');
    // A real unsaved name edit must survive preview navigation.
    await click('[aria-label="Diagram name"]');
    await cdp.send('Input.dispatchKeyEvent',{type:'keyDown',key:'a',code:'KeyA',modifiers:2,windowsVirtualKeyCode:65});
    await cdp.send('Input.dispatchKeyEvent',{type:'keyUp',key:'a',code:'KeyA',modifiers:2,windowsVirtualKeyCode:65});
    await cdp.send('Input.insertText',{text:'Unsaved working draft'});
    let canvases;
    await waitFor(async()=>{canvases=(await exec('return canvas.list();')).value;return canvases.some(c=>c.documents.some(d=>d.name==='Unsaved working draft'));});
    const canvas=canvases.find(c=>c.documents.some(d=>d.name==='Unsaved working draft'));
    // Preview navigation must also retain the working canvas camera.
    await cdp.send('Input.dispatchMouseEvent',{type:'mousePressed',x:850,y:600,button:'left',buttons:1,clickCount:1});
    await cdp.send('Input.dispatchMouseEvent',{type:'mouseMoved',x:970,y:660,button:'left',buttons:1});
    await cdp.send('Input.dispatchMouseEvent',{type:'mouseReleased',x:970,y:660,button:'left',buttons:0,clickCount:1});
    const workingTransform=await evaluate(cdp,'document.querySelector(".mapping-document-view:not([hidden]) .diagram-canvas__surface").style.transform');
    const created=await tool('create_diagram_change_session',{title:'Review feature',canvasId:canvas.canvasId,requestId:'create-session'});
    const changeSessionId=created.changeSessionId;
    const attached=(await exec(`return canvas.attach({canvasId:${JSON.stringify(created.canvasId)},documentId:'representation-overview'});`,{changeSessionId})).value;
    const scope={changeSessionId,sessionId:attached.sessionId};
    await exec('nodes.patchDiagram({nodeId:"grid:overview",start:2,end:2,patch:"|-- Proposed"});return nodes.patchDiagram({nodeId:"grid:overview",start:4,end:4,patch:""});',{...scope,expectedVersion:0});
    const added=await exec('return nodes.draw({ascii:"Detail\\n`-- New child",structureKind:"tree",position:{column:42,row:80}});',{...scope,expectedVersion:1});
    await exec(`const a=nodes.get({nodeId:'grid:overview'});return edges.create({source:{kind:'content-node',displayNodeId:a.id,contentNodeId:Object.values(a.content.structure.nodes)[0].id,revisionId:a.content.revisionId},target:{kind:'box',displayNodeId:${JSON.stringify(added.value.id)}},appearance:{label:'Details'}});`,{...scope,expectedVersion:2});
    let session=await (await fetch(`${url}/api/mapping/agent/change-sessions/${changeSessionId}`)).json();
    await tool('update_diagram_change_session',{changeSessionId,requestId:'annotate',expectedVersion:session.version,status:'ready',changes:session.changes.map(c=>({...c,title:c.type===1?'Update overview':'Add detail',reasons:c.type===1?['1b']:[]}))});
    const createdCanvas=(await exec(`return canvas.createDocument({canvasId:${JSON.stringify(created.canvasId)},name:'New canvas'});`,{changeSessionId})).value;
    await exec('return nodes.replace({nodeId:"grid:overview",ascii:"New canvas preview"});',{changeSessionId,sessionId:createdCanvas.sessionId,expectedVersion:0});
    session=await (await fetch(`${url}/api/mapping/agent/change-sessions/${changeSessionId}`)).json();
    assert.deepEqual(session.changes.map(c=>c.type).sort(),[1,2,3]);
    const second=await tool('create_diagram_change_session',{title:'Second proposal',canvasId:canvas.canvasId,requestId:'create-second'});
    const secondAttached=(await exec(`return canvas.attach({canvasId:${JSON.stringify(second.canvasId)},documentId:'representation-overview'});`,{changeSessionId:second.changeSessionId})).value;
    await exec('return nodes.patchDiagram({nodeId:"grid:overview",start:2,end:2,patch:"|-- Alternative"});',{changeSessionId:second.changeSessionId,sessionId:secondAttached.sessionId,expectedVersion:0});
    console.log('Opening Changes');
    await click('[role=tab]','Changes');
    await waitFor(async()=>await evaluate(cdp,'document.querySelector("nav[aria-label=\\"Diagram changes\\"]")?.textContent.includes("Review feature")'));
    await click('nav[aria-label="Diagram changes"] summary','Review feature draft · 3');
    // Start on a target far below the origin. Every visible frame must already
    // focus it; checking only the settled position misses the opening sweep.
    await evaluate(cdp,`(()=>{
      window.changeFocusFrames=[]; window.changeFocusDone=false;
      let started;
      const record=time=>{
        const viewport=document.querySelector('.change-session-preview .diagram-canvas');
        const surface=viewport?.querySelector('.diagram-canvas__surface');
        const target=viewport?.querySelector('.is-change-target');
        if(surface && target && getComputedStyle(surface).visibility==='visible') {
          started??=time;
          const v=viewport.getBoundingClientRect(), r=target.getBoundingClientRect();
          const inset=Math.min(340,v.width/2);
          window.changeFocusFrames.push({
            x:r.left+r.width/2-(v.left+(v.width+inset)/2),
            y:r.top+r.height/2-(v.top+Math.min(v.height/2,r.height/2+80))
          });
        }
        if(started!==undefined && time-started>=400) { window.changeFocusDone=true; return; }
        requestAnimationFrame(record);
      };
      requestAnimationFrame(record);
    })()`);
    await click('[data-change-id]', 'Add detail2 Add diagram');
    await waitFor(async()=>await evaluate(cdp,'window.changeFocusDone'));
    const focusFrames=await evaluate(cdp,'window.changeFocusFrames');
    assert.ok(focusFrames.length>=2,'Opening focus was not observed across frames');
    assert.ok(focusFrames.every(frame=>Math.abs(frame.x)<1 && Math.abs(frame.y)<1),
      `Preview moved before reaching its initial target: ${JSON.stringify(focusFrames)}`);
    console.log('Selecting modification preview');
    await click('[data-change-id]', 'Update overview1b Modify');
    await waitForSelector(cdp,'.change-session-preview .mapping-poc-ascii');
    assert.ok(await evaluate(cdp,'document.querySelector(".change-session-preview .mapping-poc-ascii").textContent.includes("Proposed")'));
    await waitForSelector(cdp,'[data-preview-edge]');
    const diffLabels = () => evaluate(cdp,`[...document.querySelectorAll('.change-session-preview .diagram-content-node')].map(n=>({text:n.textContent,status:n.dataset.diffStatus,moved:n.dataset.diffMoved,inside:n.dataset.diffDescendants}))`);
    const assertModifiedPair = async(previous,current)=>{
      const rows=await evaluate(cdp,`[...document.querySelectorAll('.change-session-preview .ascii-line')].map(row=>({text:row.textContent,highlights:[...row.querySelectorAll('[data-diff-status="modified"]')].map(n=>({text:n.textContent,color:getComputedStyle(n).backgroundColor}))}))`);
      const oldIndex=rows.findIndex(row=>row.text.includes('[-] '+previous)), newIndex=rows.findIndex(row=>row.text.includes('[+] '+current));
      assert.ok(oldIndex>=0,`Missing previous line: ${previous}`); assert.equal(newIndex,oldIndex+1,'Modified lines must be consecutive and previous-first');
      for(const row of [rows[oldIndex],rows[newIndex]]) {
        assert.ok(row.highlights.length); assert.ok(row.highlights.every(n=>n.color==='rgb(81, 64, 30)'),JSON.stringify(row));
      }
    };
    const proposedLabels = await diffLabels();
    assert.equal(proposedLabels.find(n=>n.text==='Proposed').status,'modified');
    await assertModifiedPair('Original','Proposed');
    const newChild=proposedLabels.find(n=>n.text==='New child');
    assert.ok(newChild);
    assert.equal(newChild.status,undefined,'New diagrams must not receive text highlighting');
    assert.equal(newChild.moved,undefined);
    assert.equal(newChild.inside,undefined);
    assert.equal(proposedLabels.find(n=>n.text==='Keep').status,undefined);
    assert.equal(proposedLabels.find(n=>n.text==='Root').status,undefined);
    assert.equal(proposedLabels.find(n=>n.text==='Root').inside,'true');
    assert.equal(await evaluate(cdp,'!!document.querySelector(".mapping-submenu")'),false);
    assert.equal(await evaluate(cdp,'!!document.querySelector(".mapping-workspace-actions")'),false);
    const removedLabels = () => evaluate(cdp,`[...document.querySelectorAll('.change-preview-stage [data-diff-status="removed"]')].map(n=>({text:n.textContent,color:getComputedStyle(n).backgroundColor}))`);
    assert.deepEqual(await removedLabels(),[{text:'Gone',color:'rgb(83, 44, 53)'}]);
    assert.equal(await evaluate(cdp,'!!document.querySelector(".change-preview-toolbar")'),false,'The corner submenu must be removed');
    assert.equal(await evaluate(cdp,`[...document.querySelectorAll('.change-preview-stage .ascii-line')].find(row=>row.textContent.includes('Gone')).querySelector('[data-diff-status="removed"]').textContent`),'Gone','Only the deleted label receives a red background');
    // DOM presence alone does not prove the canvas or its contents are visible.
    await waitFor(async()=>await evaluate(cdp,`(()=>{
      const viewport=document.querySelector('.change-session-preview .mapping-poc-canvas').getBoundingClientRect();
      const label=document.querySelector('.change-session-preview .diagram-content-node');
      const r=label?.getBoundingClientRect();
      if(!r || viewport.height < 300 || r.left < 340 || r.top < 120 || r.right > innerWidth || r.bottom > innerHeight) return false;
      const hit=document.elementFromPoint(r.left+r.width/2,r.top+r.height/2);
      return !!hit && (label.contains(hit)||hit.contains(label));
    })()`));
    await waitFor(async()=>await evaluate(cdp,`document.querySelector('.change-session-preview .diagram-canvas__surface').getAnimations().length===0`));
    await click('.change-session-preview [aria-label="Collapse subtree Root"]');
    await waitForSelector(cdp,'.change-session-preview [aria-label="Expand subtree Root"]');
    assert.equal((await diffLabels()).find(n=>n.text==='Root').inside,'true');
    assert.equal((await diffLabels()).some(n=>n.text==='Proposed'),false);
    assert.deepEqual(await removedLabels(),[],'Deleted descendants must fold with their surviving ancestor');
    await click('.change-session-preview [aria-label="Expand subtree Root"]');
    await waitForSelector(cdp,'.change-session-preview [aria-label="Collapse subtree Root"]');
    assert.deepEqual(await removedLabels(),[{text:'Gone',color:'rgb(83, 44, 53)'}]);
    await captureScreenshot(cdp,{output:process.env.CHANGE_SESSION_SCREENSHOT??path.join(root,'changes.png')});
    await click('[role=tab]','Diagrams');
    assert.equal(await evaluate(cdp,'document.querySelector("[aria-label=\\"Diagram name\\"]").value'),'Unsaved working draft');
    assert.equal(await evaluate(cdp,'document.querySelector(".mapping-document-view:not([hidden]) .mapping-poc-ascii").textContent'),ascii);
    assert.equal(await evaluate(cdp,'document.querySelector(".mapping-document-view:not([hidden]) .diagram-canvas__surface").style.transform'),workingTransform);
    await click('[role=tab]','Changes');
    await waitForSelector(cdp,'nav[aria-label="Diagram changes"] summary');
    await click('nav[aria-label="Diagram changes"] summary','Review feature draft · 3');
    await click('[data-change-id]','New canvas3 New canvas');
    await waitFor(async()=>await evaluate(cdp,'document.querySelector(".change-session-preview .mapping-poc-ascii")?.textContent.includes("New canvas preview")'));
    const highlightedNodes = () => evaluate(cdp,`document.querySelectorAll('.change-preview-stage [data-diff-status], .change-preview-stage [data-diff-moved], .change-preview-stage [data-diff-descendants]').length`);
    assert.equal(await highlightedNodes(),0,'New canvases must not receive text highlighting');
    await click('nav[aria-label="Diagram changes"] summary','Second proposal draft · 1');
    await click('[data-change-id]','Root1 Modify');
    await waitFor(async()=>await evaluate(cdp,'document.querySelector(".change-session-preview .mapping-poc-ascii")?.textContent.includes("Alternative")'));
    const controllerAttachment=(await exec(`return canvas.attach({canvasId:${JSON.stringify(second.canvasId)},documentId:'representation-controller'});`,{changeSessionId:second.changeSessionId})).value;
    await exec(`nodes.patchDiagram({nodeId:'grid:overview',start:9,end:23,patch:${JSON.stringify(controllerPatch)}});return true;`,{changeSessionId:second.changeSessionId,sessionId:controllerAttachment.sessionId,expectedVersion:0});
    await waitFor(async()=>await evaluate(cdp,`[...document.querySelectorAll('[data-change-id]')].some(n=>n.textContent.includes('[D] Controller edits'))`));
    await click('[data-change-id]','[D] Controller edits / agent access1 Modify');
    await waitFor(async()=>await evaluate(cdp,`document.querySelector('.change-session-preview .mapping-poc-ascii')?.textContent.includes('Session edits (preview copies)')`));
    const actualLabels=await evaluate(cdp,`[...document.querySelectorAll('.change-session-preview .diagram-content-node')].map(n=>({text:n.textContent,status:n.dataset.diffStatus,background:getComputedStyle(n).backgroundColor}))`);
    for(const label of expectedAddedLabels){const found=actualLabels.find(n=>n.text===label);assert.equal(found?.status,'added',label);assert.equal(found.background,'rgb(36, 72, 50)',label+' must have a visible green background');}
    for(const label of expectedUnchangedLabels){const found=actualLabels.find(n=>n.text===label);assert.ok(found,label);assert.equal(found.status,undefined,label);assert.equal(found.background,'rgba(0, 0, 0, 0)',label+' must stay unhighlighted');}
    const addedText=await evaluate(cdp,`[...document.querySelectorAll('.change-preview-stage [data-diff-status="added"]')].map(n=>n.textContent).join('\\n')`);
    assert.ok(addedText.includes('Session edits persist without saving originals.'));
    if(process.env.CHANGE_SESSION_SCREENSHOT) await captureScreenshot(cdp,{output:process.env.CHANGE_SESSION_SCREENSHOT+'.controller.png'});
    await waitFor(async()=>await evaluate(cdp,`document.querySelector('.change-session-preview .mapping-poc-ascii')?.textContent.includes('CanvasSessionBridge -> browser poll/reply')`));
    assert.ok((await removedLabels()).some(n=>n.text==='CanvasSessionBridge -> browser poll/reply'));
    const floatingAttachment=(await exec(`return canvas.attach({canvasId:${JSON.stringify(second.canvasId)},documentId:'representation-floating'});`,{changeSessionId:second.changeSessionId})).value;
    await exec(`return nodes.patchDiagram({nodeId:'grid:overview',start:1,end:${floatingBefore.split('\n').length},patch:${JSON.stringify(floatingAfter)}});`,{changeSessionId:second.changeSessionId,sessionId:floatingAttachment.sessionId,expectedVersion:0});
    await exec(`const d=nodes.get({nodeId:'grid:overview'});const from=Object.values(d.content.structure.nodes).find(n=>n.label==='DisplayNodeBase');const to=Object.values(d.content.structure.nodes).find(n=>n.label==='SelectionRegion');return edges.create({source:{kind:'content-node',displayNodeId:d.id,contentNodeId:from.id,revisionId:d.content.revisionId,side:'right'},target:{kind:'content-node',displayNodeId:d.id,contentNodeId:to.id,revisionId:d.content.revisionId,side:'left'},appearance:{}});`,{changeSessionId:second.changeSessionId,sessionId:floatingAttachment.sessionId,expectedVersion:1});
    await waitFor(async()=>await evaluate(cdp,`[...document.querySelectorAll('[data-change-id]')].some(n=>n.textContent.includes('FloatingBox variants'))`));
    await click('[data-change-id]','FloatingBox variants1 Modify');
    await waitFor(async()=>await evaluate(cdp,`document.querySelector('.change-session-preview .mapping-poc-ascii')?.textContent.includes('FloatingPane')`));
    const floatingLabels=await diffLabels();
    assert.equal(floatingLabels.find(n=>n.text==='FloatingPane').status,'added');
    assert.equal(floatingLabels.find(n=>n.text==='pixel geometry / expansion').status,'added');
    const renamed=floatingLabels.find(n=>n.text==='DisplayNodeBase');
    assert.equal(renamed.status,'modified'); assert.equal(renamed.moved,'true'); assert.equal(renamed.inside,'true');
    await assertModifiedPair('DisplayNodeBase: pixel geometry + policies','DisplayNodeBase');
    await waitFor(async()=>await evaluate(cdp,`(()=>{
      const label=[...document.querySelectorAll('.change-session-preview .diagram-content-node')].find(n=>n.textContent==='DisplayNodeBase');
      const control=document.querySelector('.change-session-preview [aria-label="Collapse subtree DisplayNodeBase"]');
      const previous=[...document.querySelectorAll('.change-session-preview [data-diff-version="previous"]')].find(n=>n.textContent.includes('DisplayNodeBase:'));
      const path=document.querySelector('.change-session-preview [data-preview-edge] path');
      if(!label||!control||!previous||!path) return false;
      const r=label.getBoundingClientRect(), c=control.getBoundingClientRect();
      const before=previous.getBoundingClientRect();
      const point=path.getPointAtLength(0), p=new DOMPoint(point.x,point.y).matrixTransform(path.getScreenCTM());
      return Math.abs(before.top-c.top)<2 && r.top>c.top && Math.abs(p.x-r.right)<2 && Math.abs(p.y-(r.top+r.height/2))<2;
    })()`),{message:'Fold control must align with the previous row while the edge stays on the current label'});
    for(const label of ['expandedGeometry?','geometryPolicy','placement: automatic | manual','sizing: content | fixed']) {
      const found=floatingLabels.find(n=>n.text===label); assert.ok(found,label);
      assert.equal(found.status,undefined,label); assert.equal(found.moved,undefined,label); assert.equal(found.inside,undefined,label);
    }
    await click('.change-session-preview [aria-label="Collapse subtree DisplayNodeBase"]');
    await waitForSelector(cdp,'.change-session-preview [aria-label="Expand subtree DisplayNodeBase"]');
    assert.equal((await diffLabels()).find(n=>n.text==='DisplayNodeBase').inside,'true');
    assert.equal((await diffLabels()).some(n=>n.text==='geometryPolicy'),false);
    await click('.change-session-preview [aria-label="Expand subtree DisplayNodeBase"]');
    if(process.env.CHANGE_SESSION_SCREENSHOT) await captureScreenshot(cdp,{output:process.env.CHANGE_SESSION_SCREENSHOT+'.floating.png'});
    console.log('Reloading original page');
    await cdp.send('Page.navigate',{url:`${url}/mapping`});
    await waitForSelector(cdp,'[role=tab]'); await click('[role=tab]','Changes');
    await waitFor(async()=>await evaluate(cdp,'document.querySelector("nav[aria-label=\\"Diagram changes\\"]")?.textContent.includes("Review feature")'));
    await click('nav[aria-label="Diagram changes"] summary','Review feature draft · 3');
    await click('[data-change-id]','Update overview1b Modify');
    await waitFor(async()=>await evaluate(cdp,'document.querySelector(".change-session-preview .mapping-poc-ascii")?.textContent.includes("Proposed")'));
    await waitForSelector(cdp,'[data-preview-edge]');
    // A patch applied while viewing the session refreshes the cumulative baseline diff.
    await exec('return nodes.patchDiagram({nodeId:"grid:overview",start:2,end:2,patch:"|-- Original"});',{...scope,expectedVersion:3});
    await waitFor(async()=>(await diffLabels()).some(n=>n.text==='Original' && !n.status));
    assert.equal((await diffLabels()).find(n=>n.text==='Original').status,undefined);
    const beforeUndo=await (await fetch(`${url}/api/mapping/agent/change-sessions/${changeSessionId}`)).json();
    await tool('update_diagram_change_session',{changeSessionId,requestId:'undo-visible-patch',expectedVersion:beforeUndo.version,action:'undo',documentId:'representation-overview'});
    await waitFor(async()=>(await diffLabels()).some(n=>n.text==='Proposed' && n.status==='modified'));
    assert.equal((await diffLabels()).find(n=>n.text==='Proposed').status,'modified');
    // Classification changes must update decoration even without a document edit.
    const beforeMajor=await (await fetch(`${url}/api/mapping/agent/change-sessions/${changeSessionId}`)).json();
    await tool('update_diagram_change_session',{changeSessionId,requestId:'classify-major',expectedVersion:beforeMajor.version,
      changes:beforeMajor.changes.map(change=>change.type===1?{...change,type:4}:change)});
    await waitFor(async()=>await highlightedNodes()===0,{message:'Major updates must not receive text highlighting'});
    assert.ok((await diffLabels()).some(n=>n.text==='Proposed'));
    assert.equal(await readFile(catalogPath,'utf8'),originalCatalog,'Canonical catalog was modified');
    assert.deepEqual(errors,[]);
    console.log('Change sessions: three-change set, colored node diff, wrapper/rename recovery, unchanged descendants, inline removals with label-only highlighting, folded indicators, multiple sessions, draft/camera retention and reload passed; originals unchanged.');
  });
}finally{await client?.close();server?.kill('SIGTERM');await rm(root,{recursive:true,force:true});}
