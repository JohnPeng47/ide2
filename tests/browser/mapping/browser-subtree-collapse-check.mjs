import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { tmpdir, homedir } from 'node:os';
import { createServer } from 'node:net';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { randomUUID } from 'node:crypto';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { seedMappingFixture } from '../support/browser-mapping-fixture.mjs';
const { evaluate, waitFor, waitForSelector, withHeadlessBrowser, captureScreenshot } = await import(pathToFileURL(path.join(homedir(), '.codex/skills/front-end/browser-test.mjs')).href);
const root = await mkdtemp(path.join(tmpdir(), 'subtree-collapse-'));
const ascii = 'DiagramContent\n+-- structure\n|   +-- kind: diagram\n|   `-- kind: tree\n|       +-- parserVersion\n|       `-- nodes[id]\n|           +-- label\n|           `-- foldRanges\n`-- footer';
let server, client;
try {
  await seedMappingFixture(root, { ascii, nodes: [] });
  const port = await new Promise(resolve => { const socket = createServer(); socket.listen(0, '127.0.0.1', () => { const port = socket.address().port; socket.close(() => resolve(port)); }); });
  const url = `http://127.0.0.1:${port}`;
  server = spawn(process.execPath, ['scripts/dev/start-server.mjs', 'preview', '--host', '127.0.0.1', '--port', String(port), '--strictPort'],
    { cwd: process.cwd(), env: { ...process.env, NEW_DIAGRAM_PROJECT_ROOT: root, NEW_DIAGRAMS_DIR: path.join(root, '.diagrams'), NEW_DIAGRAM_AGENT: 'fake' }, stdio: ['ignore','ignore','pipe'] });
  let errors='';server.stderr.on('data',chunk=>errors+=chunk);
  await waitFor(async () => (await fetch(url).catch(() => null))?.ok, { timeoutMs: 20000 }).catch(e=>{throw new Error(`${e}\n${errors}`);});
  client = new Client({ name: 'subtree-browser-check', version: '1' });
  await client.connect(new StdioClientTransport({ command: process.execPath, args: ['--import','tsx','scripts/mapping/mcp.ts',url], cwd: process.cwd(), stderr: 'pipe' }));
  const exec = async args => {
    const result=await client.callTool({name:'exec',arguments:{requestId:randomUUID(),...args}});
    assert.ok(!result.isError,JSON.stringify(result));return JSON.parse(result.content[0].text);
  };
  await withHeadlessBrowser({ url: `${url}/mapping`, width: 1800, height: 1100, arguments: ['--disable-gpu'] }, async ({ cdp }) => {
    const send=cdp.send.bind(cdp);
    cdp.send=(method,params)=>{let timer;return Promise.race([send(method,params),new Promise((_,reject)=>{timer=setTimeout(()=>reject(new Error(`CDP timeout: ${method}`)),15000);})]).finally(()=>clearTimeout(timer));};
    await cdp.send('Page.enable');cdp.on('Page.javascriptDialogOpening',()=>void cdp.send('Page.handleJavaScriptDialog',{accept:true}));
    const button=line=>`[data-subtree-owner="grid:overview"][data-subtree-line="${line}"]`;
    const click=async selector=>{
      const p=await evaluate(cdp,`(()=>{const r=document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect();return {x:r.left+r.width/2,y:r.top+r.height/2};})()`);
      await cdp.send('Input.dispatchMouseEvent',{type:'mousePressed',...p,button:'left',buttons:1,clickCount:1});
      await cdp.send('Input.dispatchMouseEvent',{type:'mouseReleased',...p,button:'left',buttons:0,clickCount:1});
    };
    const expanded=line=>evaluate(cdp,`document.querySelector(${JSON.stringify(button(line))})?.getAttribute('aria-expanded')`);
    const text=()=>evaluate(cdp,'document.querySelector(".mapping-poc-ascii").textContent');
    await waitForSelector(cdp,button(6));
    const geometry=()=>evaluate(cdp,`(()=>{const e=document.querySelector('[data-grid-box="overview"]');return {column:e.dataset.gridColumn,row:e.dataset.gridRow,columns:e.dataset.gridColumns,rows:e.dataset.gridRows};})()`);
    const initial=await geometry();
    // Each trigger occupies the branch junction, including nested indentation.
    for (const [line,column] of [[2,0],[4,4],[6,8]]) {
      const position=await evaluate(cdp,`(()=>{const b=document.querySelector(${JSON.stringify(button(line))}).getBoundingClientRect(),g=document.querySelector('[data-grid-box="overview"]'),r=g.getBoundingClientRect();return {column:(b.left-r.left)/(r.width/Number(g.dataset.gridColumns)),row:(b.top-r.top)/(r.height/Number(g.dataset.gridRows))};})()`);
      assert.ok(Math.abs(position.column-column)<.2);assert.ok(Math.abs(position.row-(line-1))<.2);
    }
    await captureScreenshot(cdp,{output:path.join(root,'subtree-expanded.png')});
    await click(button(6));await waitFor(async()=>await expanded(6)==='false');
    assert.ok(!(await text()).includes('foldRanges'));
    await click(button(4));await waitFor(async()=>!(await evaluate(cdp,`Boolean(document.querySelector(${JSON.stringify(button(6))}))`)));
    await click(button(4));await waitFor(async()=>await expanded(6)==='false');
    assert.deepEqual(await geometry(),initial);
    await click('.mapping-grid-tools button:first-child');await waitFor(async()=>await expanded(4)==='false');
    await click('.mapping-grid-tools button:nth-child(2)');await waitFor(async()=>await expanded(6)==='false');
    // Keyboard activation follows the same operation and doesn't pan/select.
    await click(button(6));await waitFor(async()=>await expanded(6)==='true');
    await cdp.send('Input.dispatchKeyEvent',{type:'keyDown',key:'Enter',code:'Enter',windowsVirtualKeyCode:13,text:'\r',unmodifiedText:'\r'});
    await cdp.send('Input.dispatchKeyEvent',{type:'keyUp',key:'Enter',code:'Enter',windowsVirtualKeyCode:13});
    await waitFor(async()=>await expanded(6)==='false');
    assert.equal(await evaluate(cdp,'Boolean(document.querySelector(".mapping-poc-selection-menu"))'),false);
    await click(button(2));await waitFor(async()=>await expanded(2)==='false');
    assert.match(await text(),/structure\n`-- footer/);
    // Selecting the shifted footer still targets source line nine.
    const point=await evaluate(cdp,`(()=>{const e=document.querySelector('[data-grid-box="overview"]'),r=e.getBoundingClientRect();return {x:r.left+4.5*r.width/Number(e.dataset.gridColumns),endX:r.left+9.5*r.width/Number(e.dataset.gridColumns),y:r.top+2.5*r.height/Number(e.dataset.gridRows)};})()`);
    await cdp.send('Input.dispatchMouseEvent',{type:'mousePressed',...point,button:'left',buttons:1,modifiers:2});
    await cdp.send('Input.dispatchMouseEvent',{type:'mouseReleased',x:point.endX,y:point.y,button:'left',buttons:0,modifiers:2});
    await waitForSelector(cdp,'.mapping-poc-selection-menu');
    await evaluate(cdp, `Object.defineProperty(navigator,'clipboard',{configurable:true,value:{writeText:async text=>{window.__copiedDiagram=text;}}})`);
    await click('[aria-label="Copy ASCII + code refs"]');
    await waitFor(async()=>await evaluate(cdp,'window.__copiedDiagram?.includes("footer")'));
    await click('.mapping-workspace-actions button:first-child');
    let saved;await waitFor(async()=>{try{saved=JSON.parse(await readFile(path.join(root,'.diagrams/mapping-workspace.json'),'utf8'));return !!saved.documents[0].canvas.diagramViews?.['grid:overview'];}catch{return false;}});
    assert.equal(saved.documents[0].document.scene.contents.overview.ascii,ascii);
    await captureScreenshot(cdp,{output:path.join(root,'subtree-collapsed.png')});
    const previousCanvasIds=new Set((await exec({code:'return canvas.list();'})).value.map(c=>c.canvasId));
    await cdp.send('Page.navigate',{url:`${url}/mapping`});await waitFor(async()=>await expanded(2)==='false');
    assert.deepEqual(await geometry(),initial);
    let canvases;await waitFor(async()=>{canvases=(await exec({code:'return canvas.list();'})).value;return canvases.some(c=>c.documents.length && !previousCanvasIds.has(c.canvasId));});
    const canvas=canvases.find(c=>c.documents.length && !previousCanvasIds.has(c.canvasId));
    const session=(await exec({code:`return canvas.attach(${JSON.stringify({canvasId:canvas.canvasId,documentId:canvas.documents[0].documentId})});`})).value;
    const state=await exec({sessionId:session.sessionId,code:'return nodes.list();'});
    const node=state.value.nodes.find(n=>n.id==='grid:overview'),target=node.collapsible.subtrees.find(t=>t.line===2);
    assert.equal(target.expansion,'collapsed');
    await exec({sessionId:session.sessionId,expectedVersion:state.version,code:`return nodes.collapse(${JSON.stringify({nodeId:node.id,contentNodeId:target.contentNodeId,collapsed:false})});`});
    await waitFor(async()=>await expanded(2)==='true');
    await waitFor(async()=>await expanded(6)==='false');
    // The three marked junctions in the user's pipe-branch example are already parsed.
    // Exercise those controls without changing parser behavior.
    const example = '[B] DiagramContent\n|\n|-- revisionId\n|-- ascii / asciiSha256\n|-- mappings[]\n`-- structure\n    |-- kind: diagram\n    `-- kind: tree\n        |-- parserVersion\n        |-- rootIds[]\n        `-- nodes[id]: DiagramContentNode\n            |-- label / line / branchColumn\n            |-- startColumn / endColumn\n            |-- parentId? / childIds[]\n            `-- foldRanges[]';
    const current=await exec({sessionId:session.sessionId,code:'return nodes.list();'});
    await exec({sessionId:session.sessionId,expectedVersion:current.version,code:`return nodes.replace(${JSON.stringify({nodeId:'grid:overview',ascii:example,structureKind:'tree'})});`});
    for(const line of [6,8,11]) await waitFor(async()=>await expanded(line)==='true');
    await cdp.send('Input.dispatchKeyEvent',{type:'keyDown',key:'Escape',code:'Escape',windowsVirtualKeyCode:27});
    await cdp.send('Input.dispatchKeyEvent',{type:'keyUp',key:'Escape',code:'Escape',windowsVirtualKeyCode:27});
    await captureScreenshot(cdp,{output:process.env.SUBTREE_SCREENSHOT ?? path.join(root,'subtree-example.png')});
    await click(button(11));await waitFor(async()=>await expanded(11)==='false');
    assert.ok(!(await text()).includes('foldRanges[]'));
    await click(button(11));await waitFor(async()=>await expanded(11)==='true');
    const leaf=await evaluate(cdp,`(()=>{const e=document.querySelector('[data-grid-box="overview"]'),r=e.getBoundingClientRect();return {x:r.left+16.5*r.width/Number(e.dataset.gridColumns),y:r.top+11.5*r.height/Number(e.dataset.gridRows)};})()`);
    await cdp.send('Input.dispatchMouseEvent',{type:'mousePressed',...leaf,button:'left',buttons:1,modifiers:2});
    await cdp.send('Input.dispatchMouseEvent',{type:'mouseReleased',...leaf,button:'left',buttons:0,modifiers:2});
    await waitForSelector(cdp,'.mapping-poc-selection-menu');
    await cdp.send('Input.dispatchKeyEvent',{type:'keyDown',key:'a',code:'KeyA',windowsVirtualKeyCode:65});
    await cdp.send('Input.dispatchKeyEvent',{type:'keyUp',key:'a',code:'KeyA',windowsVirtualKeyCode:65});
    await waitForSelector(cdp,'.local-chat-ask-form');
    await click('.local-chat-ask-form footer button:first-child');
    await waitForSelector(cdp,'[data-selection-root]');
    await click(button(8));await waitFor(async()=>await expanded(8)==='false');
    assert.equal(await evaluate(cdp,'Boolean(document.querySelector("[data-selection-root]"))'),false);
    await click(button(8));await waitForSelector(cdp,'[data-selection-root]');
    console.log('Branch positions, pointer/keyboard collapse, nested state, undo/redo, stable geometry, source-line selection, retained attachment visibility, workspace reload, and MCP/UI synchronization passed');
  });
} finally {await client?.close();server?.kill('SIGTERM');await rm(root,{recursive:true,force:true});}
