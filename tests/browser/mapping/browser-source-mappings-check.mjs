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
const root = await mkdtemp(path.join(tmpdir(), 'agent-diagramming-'));
let server, client;
try {
  await seedMappingFixture(root, { ascii: '[Existing]', nodes: [] });
  const port = await new Promise(resolve => { const socket = createServer(); socket.listen(0, '127.0.0.1', () => { const port = socket.address().port; socket.close(() => resolve(port)); }); });
  const url = `http://127.0.0.1:${port}`;
  server = spawn(process.execPath, ['scripts/dev/start-server.mjs', '--http', 'preview', '--host', '127.0.0.1', '--port', String(port), '--strictPort'],
    { cwd: process.cwd(), env: { ...process.env, NEW_DIAGRAM_PROJECT_ROOT: root, NEW_DIAGRAMS_DIR: path.join(root, '.diagrams'), NEW_DIAGRAM_AGENT: 'fake' }, stdio: ['ignore','ignore','pipe'] });
  let errors = ''; server.stderr.on('data', chunk => { errors += chunk; });
  await waitFor(async () => (await fetch(url).catch(() => null))?.ok, { timeoutMs: 20000 }).catch(error => { throw new Error(`${error}\n${errors}`); });
  client = new Client({ name: 'mapping-browser-check', version: '1' });
  await client.connect(new StdioClientTransport({ command: process.execPath, args: ['node_modules/tsx/dist/cli.mjs','scripts/mapping/mcp.ts',url], cwd: process.cwd(), stderr: 'pipe' }));
  const call = async (name, args, error = false) => {
    console.log('MCP call', name, args.code?.slice(0, 70) ?? args.operation ?? '');
    const result = await client.callTool({ name, arguments: args });
    console.log('MCP result', name, result.isError ? 'error' : 'ok');
    const value = JSON.parse(result.content[0].text);
    assert.equal(Boolean(result.isError), error, JSON.stringify(value));
    return value;
  };
  const exec = args => call('exec', { requestId: randomUUID(), ...args });
  assert.ok((await client.listTools()).tools.some(t => t.name === 'set_diagram_source_mappings'));
  await withHeadlessBrowser({ url: `${url}/mapping`, chromePath: process.env.BROWSER_CHROME_PATH, width: 1800, height: 1100, arguments: ['--disable-gpu'] }, async ({ cdp }) => {
    await cdp.send('Page.enable');
    await waitForSelector(cdp, '[data-grid-box="overview"]');
    const visitedCanvases = new Set();
    const attach = async () => {
      let canvases;
      await waitFor(async () => { canvases = (await exec({code:'return canvas.list();'})).value; return canvases.some(c=>c.documents.length && !visitedCanvases.has(c.canvasId)); });
      const canvas = canvases.find(c=>c.documents.length && !visitedCanvases.has(c.canvasId));
      visitedCanvases.add(canvas.canvasId);
      return (await exec({code:`return canvas.attach(${JSON.stringify({canvasId:canvas.canvasId,documentId:canvas.documents[0].documentId})});`})).value;
    };
    let attached = await attach();
    const read = async () => (await exec({sessionId:attached.sessionId,code:'return nodes.get({nodeId:"grid:overview"});'})).value;
    const before = await read();
    const input = {sessionId:attached.sessionId,requestId:randomUUID(),expectedVersion:before.version,nodeId:before.id,expectedContentHash:before.content.asciiSha256,
      mappings:[{id:'map',entityId:'e',sourceRangeIndex:0,line:1,startColumn:2,endColumn:9}],
      evidence:{e:{id:'e',handle:'Existing',label:'Existing',category:'operation',summary:'Existing source',sourceRanges:[{id:'range',path:'existing.ts',startLine:1,endLine:1,originalLines:['function Existing() {}']}]}}};
    await call('set_diagram_source_mappings', input);
    await waitForSelector(cdp, '[data-mapping-ids~="map"]');
    assert.deepEqual((await read()).content,before.content);
    const workspace = async () => (await (await fetch(`${url}/api/mapping/workspace`)).json());
    await waitFor(async () => (await workspace())?.documents[0]?.document.scene.contents.overview.sourceContext.mappings.length === 1);
    await cdp.send('Page.reload');
    await waitForSelector(cdp, '[data-mapping-ids~="map"]');
    attached = await attach();
    assert.equal((await read()).diagram.sourceContext.mappings.length,1);
    const click = async selector => {
      const p = await evaluate(cdp, `(() => {const r=document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect();return {x:r.left+r.width/2,y:r.top+r.height/2};})()`);
      await cdp.send('Input.dispatchMouseEvent',{type:'mousePressed',...p,button:'left',buttons:1,clickCount:1});
      await cdp.send('Input.dispatchMouseEvent',{type:'mouseReleased',...p,button:'left',buttons:0,clickCount:1});
    };
    await click('.mapping-grid-tools button:first-child');
    await waitFor(async()=>!(await evaluate(cdp,'Boolean(document.querySelector("[data-mapping-ids~=map]"))')));
    await click('.mapping-grid-tools button:nth-child(2)');
    await waitForSelector(cdp,'[data-mapping-ids~="map"]');
    // Publish this fixture, then create a newer catalog revision outside its workspace.
    let current = await read();
    const saved = await call('save_diagram',{sessionId:attached.sessionId,requestId:randomUUID(),expectedVersion:current.version,name:'Fixture mapped'});
    await waitFor(async()=>(await workspace())?.documents[0]?.revisionId===saved.revisionId);
    const staleWorkspace = await workspace();
    const scene = structuredClone(staleWorkspace.documents[0].document.scene);
    scene.contents.overview.sourceContext.mappings=[];
    scene.contents.overview.sourceContext.evidence={};
    const publish = await fetch(`${url}/api/mapping/diagrams`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({representationId:saved.representationId,expectedRevisionId:saved.revisionId,name:'New saved revision',scene,edges:[]})});
    assert.ok(publish.ok,await publish.clone().text());
    const latest = await publish.json();
    await cdp.send('Page.reload');
    await waitForSelector(cdp,'[data-grid-box="overview"]');
    await waitFor(async()=>(await workspace())?.documents[0]?.revisionId===latest.representation.currentRevisionId);
    attached = await attach();
    assert.equal((await read()).diagram.sourceContext.mappings.length,0);
    assert.equal(await evaluate(cdp,'Boolean(document.querySelector("[data-mapping-ids~=map]"))'),false);
    // A locally modified stale workspace must survive the same startup path.
    staleWorkspace.documents[0].name='Local unsaved name';
    const restore = await fetch(`${url}/api/mapping/workspace`,{method:'PUT',headers:{'content-type':'application/json'},body:JSON.stringify(staleWorkspace)});
    assert.ok(restore.ok,await restore.clone().text());
    await cdp.send('Page.reload');
    await waitForSelector(cdp,'[data-mapping-ids~="map"]');
    await waitFor(async()=>await evaluate(cdp,'document.querySelector(".mapping-poc-status").textContent.includes("newer saved revision")'));
    assert.equal((await workspace()).documents[0].name,'Local unsaved name');
    console.log('Mappings render live, survive reload, undo/redo; clean stale drafts refresh and dirty drafts are preserved.');
  });
} finally {
  await client?.close(); server?.kill('SIGTERM'); await rm(root,{recursive:true,force:true});
}
