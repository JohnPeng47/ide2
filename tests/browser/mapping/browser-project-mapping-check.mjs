import { tsImport } from 'tsx/esm/api';
const { revisionCanvasFixture } = await tsImport('../../support/mappingDiagram.ts', import.meta.url);
import assert from "node:assert/strict";
import { spawn, execFileSync } from "node:child_process";
import { createServer } from "node:net";
import { mkdtemp, mkdir, writeFile, readFile, rm } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { createHash } from "node:crypto";
const { evaluate, waitFor, waitForSelector, captureScreenshot, withHeadlessBrowser } = await import(pathToFileURL(path.join(homedir(), ".codex/skills/front-end/browser-test.mjs")).href);
const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '../../..');
const temp = await mkdtemp(path.join(tmpdir(), "project-mapping-check-"));
const port = await new Promise((resolve) => { const s = createServer(); s.listen(0, "127.0.0.1", () => { const p = s.address().port; s.close(() => resolve(p)); }); });
let server;
const url = `http://127.0.0.1:${port}`;
async function click(cdp, selector) {
  let point;
  let previous = "";
  let stable = 0;
  await waitFor(async () => {
    point = await evaluate(cdp, `(() => { const e=document.querySelector(${JSON.stringify(selector)}); if (!e) return null; const r=e.getBoundingClientRect(); const x=r.x+r.width/2,y=r.y+r.height/2; return e.contains(document.elementFromPoint(x,y)) ? {x,y} : null; })()`);
    const next = JSON.stringify(point);
    stable = point && next === previous ? stable + 1 : 0;
    previous = next;
    return stable >= 2;
  }, { message: `Click target did not settle: ${selector}` });
  await cdp.send("Input.dispatchMouseEvent", {type:"mousePressed",...point,button:"left",buttons:1,clickCount:1});
  await cdp.send("Input.dispatchMouseEvent", {type:"mouseReleased",...point,button:"left",clickCount:1});
}
async function key(cdp, key, code, modifiers=0) {
  await cdp.send("Input.dispatchKeyEvent", {type:"keyDown",key,code,modifiers});
  await cdp.send("Input.dispatchKeyEvent", {type:"keyUp",key,code,modifiers});
}
async function fill(cdp, selector, text) {
  await click(cdp, selector);
  await cdp.send("Input.dispatchKeyEvent", { type: "rawKeyDown", key: "Control", code: "ControlLeft", windowsVirtualKeyCode: 17 });
  await cdp.send("Input.dispatchKeyEvent", { type: "rawKeyDown", key: "a", code: "KeyA", windowsVirtualKeyCode: 65, modifiers: 2 });
  await cdp.send("Input.dispatchKeyEvent", { type: "keyUp", key: "a", code: "KeyA", windowsVirtualKeyCode: 65, modifiers: 2 });
  await cdp.send("Input.dispatchKeyEvent", { type: "keyUp", key: "Control", code: "ControlLeft", windowsVirtualKeyCode: 17 });
  await cdp.send("Input.insertText",{text});
}
async function drag(cdp, start, end, modifiers = 0) {
  await cdp.send("Input.dispatchMouseEvent", {type:"mousePressed",...start,button:"left",modifiers,buttons:1,clickCount:1});
  await cdp.send("Input.dispatchMouseEvent", {type:"mouseMoved",...end,button:"left",modifiers,buttons:1});
  await cdp.send("Input.dispatchMouseEvent", {type:"mouseReleased",...end,button:"left",modifiers,clickCount:1});
}
async function selectWorker(cdp) {
  let rect;
  let previous = "";
  let stable = 0;
  await waitFor(async () => {
    rect = await evaluate(cdp, `(() => { const e=document.querySelector('.mapping-document-view:not([hidden]) [data-selectable-node]'); if (!e) return null; const r=e.getBoundingClientRect(); return r.width > 0 && r.height > 0 ? {x:r.x,y:r.y,width:r.width,height:r.height} : null; })()`);
    const next = JSON.stringify(rect);
    stable = rect && next === previous ? stable + 1 : 0;
    previous = next;
    return stable >= 2;
  }, { message: "Selection target did not settle" });
  await drag(cdp,{x:rect.x+1,y:rect.y+rect.height/2},{x:rect.x+rect.width-1,y:rect.y+rect.height/2}, 2);
  await waitForSelector(cdp,".mapping-document-view:not([hidden]) .mapping-poc-selection-actions");
}
async function catalog() { return (await (await fetch(`${url}/api/core/project/representations`)).json()).catalog; }
try {
  execFileSync("git", ["init","-q",temp]);
  const projectId=`project-${createHash("sha256").update(path.join(temp,".git")).digest("hex").slice(0,12)}`;
  const timestamp=new Date().toISOString();
  const evidence={ worker: {id:"worker",handle:"worker",label:"Worker",category:"operation",summary:"Does work",sourceRanges:[{id:"range-worker",path:"worker.ts",startLine:1,endLine:1,originalLines:["export function worker() {}"]}]} };
  const representation={schemaVersion:1,id:"representation-seed",projectId,handle:"worker",name:"Worker overview",viewKind:"diagram",representationKind:"diagram",status:"settled",currentRevisionId:"revision-seed",revisionIds:["revision-seed"],createdAt:timestamp,updatedAt:timestamp};
  const revision={schemaVersion:1,id:"revision-seed",projectId,representationId:representation.id,revision:1,ascii:"Worker\n +-- task",asciiSha256:createHash("sha256").update("Worker\n +-- task").digest("hex"),representationKind:"diagram",evidence,mappings:[{id:"m-worker",evidenceId:"worker",sourceRangeId:"range-worker",line:1,startColumn:1,endColumn:6}],createdAt:timestamp};
  revision.content = revisionCanvasFixture(revision);
  await mkdir(path.join(temp,".diagrams/representations"),{recursive:true});
  await writeFile(path.join(temp,".diagrams/project.json"),JSON.stringify({schemaVersion:1,id:projectId,name:"Mapping fixture",repositoryIdentity:path.join(temp,".git"),canonicalRepoRoot:temp,domainProfileId:"source-code",corpus:{kind:"git-worktree",root:temp},diagramSetIds:[],createdAt:timestamp,updatedAt:timestamp}));
  await writeFile(path.join(temp,".diagrams/representations/catalog.json"),JSON.stringify({schemaVersion:1,projectId,activeByKind:{diagram:representation.id},representations:{[representation.id]:representation},revisions:{[revision.id]:revision},createdAt:timestamp,updatedAt:timestamp}));
  server=spawn(process.execPath,["scripts/dev/start-server.mjs", "--http","preview","--host","127.0.0.1","--port",String(port),"--strictPort"],{cwd:root,env:{...process.env,NEW_DIAGRAM_PROJECT_ROOT:temp,NEW_DIAGRAM_AGENT:"fake",NEW_DIAGRAM_FAKE_PROMPT_DELAY_MS:"1200"},stdio:"ignore"});
  await waitFor(async()=>Boolean((await fetch(url).catch(()=>null))?.ok),{timeoutMs:15000});
  await withHeadlessBrowser({ chromePath: process.env.CHROME_PATH, arguments: process.env.CHROME_PATH ? ['--no-sandbox'] : [],url:`${url}/mapping`,width:1600,height:1000},async({cdp})=>{
    await cdp.send("Page.enable"); await cdp.send("Runtime.enable");
    const errors=[]; cdp.on("Runtime.exceptionThrown",({exceptionDetails})=>errors.push(exceptionDetails.exception?.description??exceptionDetails.text));
    const dialogs=[];
    let acceptDialog = false;
    cdp.on("Page.javascriptDialogOpening", async (dialog) => { dialogs.push(dialog.message); await cdp.send("Page.handleJavaScriptDialog", { accept: acceptDialog }); });
    await waitForSelector(cdp,"[data-project-diagram='representation-seed']");
    await waitForSelector(cdp,"[data-selectable-node]");
    assert.equal(await evaluate(cdp,"Boolean(document.querySelector('.mapping-poc-toolbar'))"),false);
    assert.equal(await evaluate(cdp, "document.querySelectorAll('.screen-tabs button').length"), 1);
    const paneBefore=await evaluate(cdp,"(()=>{const r=document.querySelector('.mapping-floating-pane').getBoundingClientRect();return {x:r.x,y:r.y,width:r.width};})()");
    await click(cdp,".mapping-submenu button:first-of-type");
    await waitForSelector(cdp,".mapping-create-dialog");
    await fill(cdp,"[aria-label='New diagram name']","Second diagram");
    await fill(cdp,"[aria-label='Initial diagram content']","Second\n +-- item");
    await click(cdp,".mapping-create-dialog button[type=submit]");
    await waitFor(async()=>Object.values((await catalog()).representations).length===2,{message:"New diagram was not persisted"});
    await waitFor(async()=>await evaluate(cdp,"document.querySelector('[aria-label=\"Diagram name\"]').value==='Second diagram'"))
      .catch(async (error) => { throw new Error(error.message + JSON.stringify(await evaluate(cdp, "({text:document.body.innerText,name:document.querySelector('[aria-label=\"Diagram name\"]')?.value})"))); });
    const secondId=Object.values((await catalog()).representations).find(x=>x.name==="Second diagram").id;
    await click(cdp,".mapping-document-view:not([hidden]) [data-grid-box='overview'] button:nth-child(3)");
    await waitForSelector(cdp,".mapping-document-view:not([hidden]) .mapping-grid-box.is-container");
    const groupId=await evaluate(cdp,"document.querySelector('.mapping-document-view:not([hidden]) .mapping-grid-box.is-container').dataset.gridBox");
    await click(cdp,`.mapping-document-view:not([hidden]) [data-grid-box='${groupId}'] > .mapping-grid-box-tools button:first-child`);
    await waitFor(async()=>await evaluate(cdp,`document.querySelector('.mapping-document-view:not([hidden]) [data-grid-box="${groupId}"]').dataset.collapsed==='true'`));
    await click(cdp,".mapping-submenu button:nth-of-type(2)");
    await waitFor(async()=>(await catalog()).representations[secondId].revisionIds.length===2,{message:"Save did not append revision"});
    // Child navigation expands the group and focuses the child without moving the floating pane.
    await click(cdp,"[data-explorer-box='overview']");
    await waitForSelector(cdp,".mapping-document-view:not([hidden]) [data-grid-box='overview']");
    assert.deepEqual(await evaluate(cdp,"(()=>{const r=document.querySelector('.mapping-floating-pane').getBoundingClientRect();return {x:r.x,y:r.y,width:r.width};})()"),paneBefore);
    await click(cdp,".mapping-submenu button:nth-of-type(2)");
    await waitFor(async()=>(await catalog()).representations[secondId].revisionIds.length===3);
    // Reopen saved scene with its group intact.
    await cdp.send("Page.reload",{ignoreCache:true});
    await waitForSelector(cdp,`.mapping-document-view:not([hidden]) [data-grid-box='${groupId}']`);
    await click(cdp,"[data-project-diagram='representation-seed']");
    await waitForSelector(cdp,".mapping-document-view:not([hidden]) [data-selectable-node]");
    await selectWorker(cdp); await key(cdp,"n","KeyN");
    await waitForSelector(cdp, ".mapping-document-view:not([hidden]) .mapping-projection-status");
    assert.ok(await evaluate(cdp, "document.querySelector('.mapping-document-view:not([hidden]) .mapping-projection-status').textContent.includes('No call-tree projection')"));
    await key(cdp, "Escape", "Escape");
    await selectWorker(cdp); await key(cdp,"p","KeyP");
    await waitForSelector(cdp,".mapping-document-view:not([hidden]) #mapping-poc-prompt");
    await fill(cdp,".mapping-document-view:not([hidden]) #mapping-poc-prompt","Explain worker");
    await click(cdp,".mapping-document-view:not([hidden]) .mapping-poc-prompt-form button[type=submit]");
    await waitFor(async()=>await evaluate(cdp,"document.querySelector('.mapping-submenu').textContent.includes('Editing')"));
    await click(cdp,`[data-project-diagram='${secondId}']`);
    await waitFor(async()=>await evaluate(cdp,"Array.from(document.querySelectorAll('.mapping-poc-ascii')).some(e=>e.textContent.includes('[edited: Explain worker]'))"),{timeoutMs:10000});
    assert.equal(await evaluate(cdp,"document.querySelector('.mapping-document-view:not([hidden]) .mapping-poc-ascii').textContent.includes('Explain worker')"),false);
    await click(cdp,"[data-project-diagram='representation-seed']");
    // Existing edit semantics invalidate bindings on replaced rows.
    await waitFor(async () => await evaluate(cdp, "document.querySelector('.mapping-document-view:not([hidden]) .mapping-poc-ascii').textContent.includes('Explain worker')"));
    await click(cdp,".mapping-submenu button:nth-of-type(2)");
    await waitFor(async()=>(await catalog()).representations[representation.id].revisionIds.length===2);
    const saved=await catalog();
    assert.equal(saved.revisions[saved.representations[representation.id].currentRevisionId].content.kind,"mapping-canvas");
    assert.equal(saved.revisions["revision-seed"].ascii,"Worker\n +-- task");
    await cdp.send("Page.reload",{ignoreCache:true});
    await waitFor(async()=>await evaluate(cdp,"document.querySelector('.mapping-poc-ascii')?.textContent.includes('[edited: Explain worker]')"));
    // Root and old bookmarks all reopen the Mapping workspace and saved catalog.
    for (const pathname of ['/', '/experiments', '/mapping']) {
      await cdp.send('Page.navigate', { url: url + pathname });
      await waitForSelector(cdp, `[data-project-diagram="${secondId}"]`);
      assert.equal(await evaluate(cdp, "Boolean(document.querySelector('.mapping-poc-header'))"), true);
      assert.equal(await evaluate(cdp, "document.querySelectorAll('.screen-tabs button').length"), 1);
    }
    await click(cdp, `[data-project-diagram="${secondId}"]`);
    await waitForSelector(cdp,".mapping-floating-pane");
    await captureScreenshot(cdp,{output:process.env.MAPPING_SCREENSHOT??path.join(temp,"mapping.png")});
    // Save both open diagrams, then delete an inactive one without navigating to it.
    await click(cdp, "[data-project-diagram='representation-seed']");
    await fill(cdp, "[aria-label='Diagram name']", "Unsaved worker");
    await click(cdp, `[data-project-diagram='${secondId}']`);
    await click(cdp, ".mapping-workspace-actions button:first-child");
    await waitFor(async () => (await evaluate(cdp, "document.querySelector('.mapping-poc-status').textContent")).includes("Workspace saved"));
    const deleteSeed = '[aria-label="Delete diagram Worker overview"]';
    const dialogCount = dialogs.length;
    await click(cdp, deleteSeed);
    await waitFor(() => dialogs.length > dialogCount);
    assert.ok(dialogs.at(-1).includes("unsaved changes"));
    assert.equal((await catalog()).representations[representation.id].status, "settled");
    assert.equal(await evaluate(cdp, "document.querySelector('[aria-label=\"Diagram name\"]').value"), "Second diagram");
    // A failed delete keeps the diagram available and reports the error.
    acceptDialog = true;
    await cdp.send("Fetch.enable", { patterns: [{ urlPattern: "*/api/mapping/diagrams/*", requestStage: "Request" }] });
    cdp.on("Fetch.requestPaused", async ({ requestId }) => {
      await cdp.send("Fetch.fulfillRequest", { requestId, responseCode: 500,
        responseHeaders: [{ name: "Content-Type", value: "application/json" }],
        body: Buffer.from(JSON.stringify({ error: "Delete failed for test" })).toString("base64") });
    });
    await click(cdp, deleteSeed);
    await waitFor(async () => (await evaluate(cdp, "document.querySelector('.mapping-project-error')?.textContent ?? ''")).includes("Delete failed for test"));
    assert.equal((await catalog()).representations[representation.id].status, "settled");
    await cdp.send("Fetch.disable");
    await waitForSelector(cdp, `${deleteSeed}:not(:disabled)`);
    await click(cdp, deleteSeed);
    await waitFor(async () => !await evaluate(cdp, "Boolean(document.querySelector('[data-project-diagram=\"representation-seed\"]'))"));
    assert.equal(await evaluate(cdp, "document.querySelector('[aria-label=\"Diagram name\"]').value"), "Second diagram");
    assert.equal((await catalog()).representations[representation.id].status, "archived");
    // Explicit restore and reload must not resurrect the deleted saved draft.
    await click(cdp, ".mapping-workspace-actions button:nth-child(2)");
    await waitFor(async () => (await evaluate(cdp, "document.querySelector('.mapping-poc-status').textContent")).includes("Workspace restored"));
    assert.equal(await evaluate(cdp, "document.querySelectorAll('.mapping-document-view').length"), 1);
    await cdp.send("Page.reload", { ignoreCache: true });
    await waitForSelector(cdp, `[data-project-diagram='${secondId}'][aria-current='page']`);
    assert.equal(await evaluate(cdp, "document.querySelectorAll('.mapping-document-view').length"), 1);
    // Deleting the active diagram selects its neighbor.
    await click(cdp, ".mapping-submenu button:first-of-type");
    await fill(cdp, "[aria-label='New diagram name']", "Temporary diagram");
    await click(cdp, ".mapping-create-dialog button[type=submit]");
    await waitForSelector(cdp, "[aria-label='Delete diagram Temporary diagram']:not(:disabled)");
    await click(cdp, "[aria-label='Delete diagram Temporary diagram']");
    await waitForSelector(cdp, `[data-project-diagram='${secondId}'][aria-current='page']`);
    assert.equal(await evaluate(cdp, "new URL(location.href).searchParams.get('diagram')"), secondId);
    // The final deletion clears the canvas and URL, including after restoring the old workspace.
    await click(cdp, "[aria-label='Delete diagram Second diagram']:not(:disabled)");
    await waitForSelector(cdp, ".mapping-empty");
    assert.equal(await evaluate(cdp, "document.querySelectorAll('[data-project-diagram]').length"), 0);
    assert.equal(await evaluate(cdp, "new URL(location.href).searchParams.get('diagram')"), null);
    await cdp.send("Page.reload", { ignoreCache: true });
    await waitFor(async () => (await evaluate(cdp, "document.querySelector('.mapping-empty h1')?.textContent ?? ''")).includes("Create a project diagram"));
    assert.equal(await evaluate(cdp, "document.querySelectorAll('.mapping-document-view').length"), 0);
    assert.deepEqual(errors,[]);
  });
  console.log("project Mapping browser check passed: create, save, reload, grouped scene, navigation, internal prompt across a switch, Mapping-only entry paths, delete cancellation/failure/retry, inactive/active/last deletion, workspace restore");
} finally {
  if(server?.exitCode===null) { server.kill("SIGTERM"); await new Promise(resolve=>server.once("exit",resolve)); }
  await rm(temp,{recursive:true,force:true});
}
