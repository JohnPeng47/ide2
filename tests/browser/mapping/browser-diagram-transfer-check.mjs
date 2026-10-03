import { canvasSaveFixture } from '../../support/mappingDiagram.ts';
import assert from 'node:assert/strict';
import { diagramContentNodes } from '../../../domain/core/diagrams/diagramContentNodes.ts';
import { defaultArrowAppearance } from '../../../domain/core/diagrams/diagramConnection.ts';
import { spawn } from 'node:child_process';
import { mkdtemp, rm, readFile, writeFile } from 'node:fs/promises';
import { tmpdir, homedir } from 'node:os';
import { createServer } from 'node:net';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { seedMappingFixture } from '../support/browser-mapping-fixture.mjs';
import { singleDiagramScene } from '../../../domain/core/diagrams/projectDiagramCanvas.ts';
import { RevisionedDiagramService } from '../../../domain/core/diagrams/diagramService.ts';
import { DiagramStore } from '../../../infrastructure/core/persistence/store.ts';
const { evaluate, waitFor, waitForSelector, withHeadlessBrowser, captureScreenshot } = await import(pathToFileURL(path.join(homedir(), '.codex/skills/front-end/browser-test.mjs')).href);
const root = await mkdtemp(path.join(tmpdir(), 'diagram-transfer-browser-'));
let server;
try {
  const ascii = 'Alpha\n|-- A branch\n`-- A tail';
  await seedMappingFixture(root, { ascii, nodes: [] });
  const catalogPath = path.join(root, '.diagrams/representations/catalog.json');
  const catalog = JSON.parse(await readFile(catalogPath, 'utf8'));
  const scene = singleDiagramScene(ascii);
  scene.contents = Object.fromEntries(['a','b','c'].map((id, i) => [id, new RevisionedDiagramService().create({ id, revision: 0,
    ascii: `${['Alpha','Beta','Gamma'][i]}\n|-- ${id.toUpperCase()} branch\n\x60-- ${id.toUpperCase()} tail`, structureKind: 'tree' }).diagram]));
  scene.root.children = ['a','b','c'].map((id, i) => ({ id, kind: 'diagram', contentId: id, collapsed: false, position: { column: i * 25, row: 5 } }));
  if (process.env.TRANSFER_LARGE_FIXTURE) {
    scene.contents.a.sourceContext.evidence.large = { id: 'large', label: 'Large captured source', sourceRanges: [
      { id: 'large-range', path: 'large.ts', startLine: 1, endLine: 1, originalLines: ['x'.repeat(2 * 1024 * 1024)] }
    ] };
  }
  const edges = [['a','b'],['b','a'],['a','a'],['b','c']].map(([a,b], i) => ({ id: `edge${i}`,
    source: { kind: 'content-node', displayNodeId: `grid:${a}`, contentNodeId: diagramContentNodes(scene.contents[a].content).find(n => n.line === 2).id,
      revisionId: scene.contents[a].content.revisionId, side: 'auto' },
    target: { kind: 'box', displayNodeId: `grid:${b}`, side: 'auto' }, appearance: { ...defaultArrowAppearance, label: `${a} to ${b}` } }));
  catalog.revisions['revision-overview'].content = { kind: 'canvas-history', history: canvasSaveFixture({ name: 'Fixture', scene, edges }).history };
  const existingScene = singleDiagramScene('Destination');
  existingScene.contents = {
    a: new RevisionedDiagramService().create({id:'a',revision:0,ascii:'Existing large diagram\n|-- Keep here\n|-- Still here\n`-- Fixed',structureKind:'tree'}).diagram,
    b: new RevisionedDiagramService().create({id:'b',revision:0,ascii:'Small\n`-- Keep',structureKind:'tree'}).diagram
  };
  existingScene.root.children = [{id:'a',kind:'diagram',contentId:'a',collapsed:false,position:{column:50,row:10}},
    {id:'b',kind:'diagram',contentId:'b',collapsed:false,position:{column:100,row:12}}];
  const persistedExistingScene = JSON.parse(JSON.stringify(existingScene));
  catalog.revisions['revision-existing'] = {...catalog.revisions['revision-overview'],id:'revision-existing',representationId:'representation-existing',
    content:{ kind: 'canvas-history', history: canvasSaveFixture({ name: 'Fixture', scene:existingScene, edges:[] }).history }};
  catalog.representations['representation-existing'] = {...catalog.representations['representation-overview'],id:'representation-existing',
    name:'Existing canvas',currentRevisionId:'revision-existing',revisionIds:['revision-existing']};
  await writeFile(catalogPath, JSON.stringify(catalog));
  const store = new DiagramStore(root);
  const port = await new Promise(resolve => { const socket = createServer(); socket.listen(0, '127.0.0.1', () => { const port = socket.address().port; socket.close(() => resolve(port)); }); });
  const url = `http://127.0.0.1:${port}`;
  server = spawn(process.execPath, ['scripts/dev/start-server.mjs', 'preview', '--host', '127.0.0.1', '--port', String(port), '--strictPort'],
    { cwd: process.cwd(), env: { ...process.env, NEW_DIAGRAM_PROJECT_ROOT: root, NEW_DIAGRAMS_DIR: store.storeRoot, NEW_DIAGRAM_AGENT: 'fake' }, stdio: ['ignore', 'ignore', 'pipe'] });
  let errors = ''; server.stderr.on('data', chunk => { errors += chunk; });
  await waitFor(async () => (await fetch(url).catch(() => null))?.ok, { timeoutMs: 20000 }).catch(error => { throw new Error(`${error}\n${errors}`); });
  await withHeadlessBrowser({ url: `${url}/mapping?diagram=representation-overview`, width: 1800, height: 1100, chromePath: process.env.CHROME_PATH,
    arguments: ['--disable-gpu', ...(process.platform === 'linux' ? ['--no-sandbox'] : [])] }, async ({ cdp }) => {
    const send = cdp.send.bind(cdp);
    cdp.send = async (method, params) => {
      let timer;
      try { return await Promise.race([send(method, params), new Promise((_, reject) => {
        timer = setTimeout(() => reject(Error(`CDP timed out: ${method}`)), 30000);
      })]); } finally { clearTimeout(timer); }
    };
    const exceptions = []; cdp.on('Page.javascriptDialogOpening', () => void cdp.send('Page.handleJavaScriptDialog', { accept: true }).catch(error => { if (!/navigated or closed/.test(String(error))) exceptions.push(String(error)); })); await cdp.send('Page.enable'); await cdp.send('Runtime.enable'); cdp.on('Runtime.exceptionThrown', event => exceptions.push(event.exceptionDetails.text));
    const reload = async () => {
      const previous = await evaluate(cdp, 'performance.timeOrigin');
      await cdp.send('Page.reload', { ignoreCache: true });
      await waitFor(async () => {
        try { return await evaluate(cdp, `performance.timeOrigin !== ${previous} && document.readyState === 'complete'`); }
        catch (error) { if (/context|navigated|closed/i.test(String(error))) return false; throw error; }
      }, { timeoutMs: 20000, message: 'New document finished loading' });
    };
    const click = async (selector, text) => {
      // The legacy world-space toolbar can remain offscreen even after Fit.
      // Exercise public history shortcuts independently of camera placement.
      if (selector.includes('.mapping-grid-tools') && ['Undo', 'Redo'].includes(text)) {
        await click('.mapping-document-view:not([hidden]) [title="Reset zoom and center diagram"]');
        const redo = text === 'Redo';
        await key(redo ? 'y' : 'z', redo ? 'KeyY' : 'KeyZ', redo ? 89 : 90, 2);
        return;
      }
      let point;
      await waitFor(async () => {
        point = await evaluate(cdp, `(async () => {
          const el = [...document.querySelectorAll(${JSON.stringify(selector)})].find(el=>!el.disabled && ${text ? `el.textContent.includes(${JSON.stringify(text)})` : 'true'});
          if(!el || el.closest('[inert]'))return null;
          const before=el.getBoundingClientRect();
          await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));
          const r=el.getBoundingClientRect();
          if(!r.width||!r.height||Math.abs(r.x-before.x)>=.1||Math.abs(r.y-before.y)>=.1)return null;
          // A canvas popup may be partly covered by the explorer; click a visible part.
          return [[.5,.5],[.95,.5],[.05,.5],[.5,.95],[.5,.05]].map(([x,y])=>({x:r.x+r.width*x,y:r.y+r.height*y}))
            .find(p=>{const hit=document.elementFromPoint(p.x,p.y);return hit&&el.contains(hit)})??null;
        })()`);
        return !!point;
      });
      await cdp.send('Input.dispatchMouseEvent', { type: 'mousePressed', ...point, button: 'left', buttons: 1, clickCount: 1 });
      await cdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', ...point, button: 'left', clickCount: 1 });
    };
    const key = async (key, code, windowsVirtualKeyCode, modifiers = 0) => {
      await cdp.send('Input.dispatchKeyEvent', { type: 'keyDown', key, code, windowsVirtualKeyCode, modifiers });
      await cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', key, code, windowsVirtualKeyCode });
    };

    const visible = '.mapping-document-view:not([hidden])';
    const readBox = async id => evaluate(cdp, `(() => { const r=document.querySelector('${visible} [data-grid-box="${id}"]').getBoundingClientRect(); return {left:r.left,top:r.top,right:r.right,bottom:r.bottom,x:r.x+r.width/2,y:r.y+r.height/2}; })()`);
    const box = async id => { let value; await waitFor(async () => { value = await readBox(id); return value.right - value.left > 2 && value.bottom - value.top > 2 && !await evaluate(cdp, `!!document.querySelector('.mapping-transfer-busy') || document.querySelector('${visible}').inert`); }); return value; };
    const selected = async ids => waitFor(async () => JSON.stringify(await evaluate(cdp, `[...document.querySelectorAll('${visible} [data-diagram-selected="true"]')].map(el=>el.dataset.gridBox).sort()`)) === JSON.stringify([...ids].sort()));
    const mouse = (type, point, modifiers = 0, clickCount = 1, button = 'left') => cdp.send('Input.dispatchMouseEvent', { type, x: point.x, y: point.y, modifiers,
      button, buttons: type === 'mouseReleased' ? 0 : button === 'right' ? 2 : button === 'middle' ? 4 : 1, clickCount });
    const double = async (id, modifiers = 0) => {
      // Use the diagram's left gutter so the node's single-click CodePanel action is not invoked.
      await box(id);
      let p;
      await waitFor(async () => {
        const before=await readBox(id);
        await evaluate(cdp, 'new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(()=>resolve(true))))');
        const b=await readBox(id); p={x:b.left+2,y:b.bottom-4};
        return Math.abs(b.left-before.left)<.5 && Math.abs(b.bottom-before.bottom)<.5;
      });
      const exposed = await evaluate(cdp, `(() => {const el=document.elementFromPoint(${p.x},${p.y});return !!el?.closest('[data-canvas-engine="tldraw"]')&&!el.closest('button,input,[data-mapping-static-ui],[data-diagram-canvas-static-ui]')})()`);
      if (!exposed) {
        // Saved camera positions can put the gutter under the explorer or offscreen.
        // Pan it into view through a real native gesture before double-clicking.
        const from={x:1100,y:700},delta={x:650-p.x,y:500-p.y},to={x:1100+delta.x,y:700+delta.y};
        await mouse('mousePressed',from,0,1,'middle');
        for(let i=1;i<=10;i++) await mouse('mouseMoved',{x:from.x+delta.x*i/10,y:from.y+delta.y*i/10},0,1,'middle');
        await evaluate(cdp,'new Promise(resolve=>setTimeout(resolve,100))');
        await mouse('mouseReleased',to,0,1,'middle');
        await waitFor(async()=>{const b=await readBox(id);p={x:b.left+2,y:b.bottom-4};return Math.abs(p.x-650)<3&&Math.abs(p.y-500)<3;});
      }
      await mouse('mousePressed',p,modifiers); await mouse('mouseReleased',p,modifiers);
      await mouse('mousePressed',p,modifiers,2); await mouse('mouseReleased',p,modifiers,2);
    };
    const drag = async (from,to,modifiers=2) => {
      await mouse('mousePressed',from,modifiers);
      await mouse('mouseMoved',to,modifiers);
      await mouse('mouseReleased',to,modifiers);
    };
    const openMenu = async id => { const b=await box(id); await mouse('mousePressed',{x:b.x,y:b.bottom-3},0,1,'right'); await mouse('mouseReleased',{x:b.x,y:b.bottom-3},0,1,'right'); };
    const transfer = async (mode, name, id='a') => {
      await openMenu(id); await click('.canvas-paste-menu button', mode+' to canvas');
      await waitForSelector(cdp, '.mapping-floating-pane.is-transfer-target');
      await click('.mapping-transfer-picker button', 'New canvas');
      await waitForSelector(cdp, '[aria-label="Transfer canvas name"]');
      await key('a','KeyA',65,2); await cdp.send('Input.insertText',{text:name});
      await click('.mapping-transfer-picker button',mode+' diagrams');
      await waitFor(async()=>await evaluate(cdp, `document.querySelector('[aria-label="Diagram name"]')?.value === ${JSON.stringify(name)}`)).catch(async error => { throw Error(`${error} ${await evaluate(cdp, 'document.querySelector("[role=alert]")?.textContent')}`); });
    };
    const persisted = async predicate => {
      let value; await waitFor(async()=>{value=await fetch(url+'/api/mapping/workspace').then(r=>r.json()).catch(()=>null);return predicate(value?.workspace ?? value);}).catch(async error=>{ console.log('UI:',await evaluate(cdp,`({name:document.querySelector('[aria-label="Diagram name"]')?.value,error:document.querySelector('.mapping-project-error')?.textContent,buttons:[...document.querySelectorAll('${visible} .mapping-grid-tools button')].map(el=>({label:el.textContent,disabled:el.disabled,x:el.getBoundingClientRect().x,y:el.getBoundingClientRect().y}))})`)); throw error; });
      return value.workspace ?? value;
    };
    await waitForSelector(cdp, `${visible} [data-grid-box="a"]`);
    await double('a'); await selected(['a']);
    await waitForSelector(cdp, '[aria-label="Selected diagrams"]');
    if (process.env.TRANSFER_LARGE_FIXTURE) {
      console.log('Large fixture selected');
      await click('[aria-label="Selected diagrams"] button', 'Copy to canvas');
      await click('.mapping-transfer-picker button', 'New canvas');
      await key('a','KeyA',65,2); await cdp.send('Input.insertText',{text:'Large copy'});
      await click('.mapping-transfer-picker button', 'Copy diagrams');
      console.log('Large form submitted');
      await waitForSelector(cdp, '.mapping-transfer-busy');
      console.log('Large progress visible');
      await waitFor(async()=>await evaluate(cdp, `document.querySelector('[aria-label="Diagram name"]')?.value==='Large copy'`), {timeoutMs:60000});
      console.log('Large destination opened');
      const saved = await persisted(w=>w?.transfers?.length===1);
      console.log('Large destination persisted');
      const requestBytes = Buffer.byteLength(JSON.stringify(saved));
      assert.ok(requestBytes > 10 * 1024 * 1024, `Regression fixture must exceed old request limit: ${requestBytes}`);
      const copied = saved.documents.find(d=>d.representationId===saved.transfers[0].destinationId);
      assert.equal(Object.values(copied.document.scene.contents)[0].sourceContext.evidence.large.sourceRanges[0].originalLines[0].length,2*1024*1024);
      console.log('Large request checked');
      await captureScreenshot(cdp,{output:process.env.TRANSFER_DESTINATION_SCREENSHOT || path.join(root,'large-copy.png')});
      await reload();
      await waitFor(async()=>await evaluate(cdp, `document.querySelector('[aria-label="Diagram name"]')?.value==='Large copy'`).catch(error => {
        if (/navigated or closed|context.*destroyed|Cannot find context/i.test(String(error))) return false;
        throw error;
      }), {timeoutMs:60000});
      await click(`${visible} .mapping-grid-tools button`,'Undo');
      await waitForSelector(cdp, `${visible} [data-grid-box="a"]`);
      await persisted(w=>w?.transfers?.[0]?.applied===false);
      assert.deepEqual(exceptions,[]);
      console.log(`PASS: large copy (${requestBytes} bytes) created, preserved evidence, reloaded and undone`);
      return;
    }
    await double('b',2); await selected(['a','b']);
    await double('b',2); await selected(['a']);
    await key('Escape','Escape',27); await selected([]);
    const a=await box('a'), b=await box('b');
    await drag({x:a.left-4,y:a.top+2},{x:a.x,y:a.bottom+4}); await selected([]); // one corner
    await drag({x:a.left-4,y:a.top-2},{x:a.right+4,y:a.bottom+4}); await selected(['a']); // complete enclosure
    await drag({x:b.left-4,y:b.top-2},{x:b.right+4,y:b.bottom+4}); await selected(['a','b']); // another Ctrl-drag adds
    await drag({x:a.left-4,y:a.top-2},{x:b.right+4,y:b.bottom+4}); await selected(['a','b']);
    await captureScreenshot(cdp,{output:path.join(root,'diagram-selection.png')});
    await click('[aria-label="Minimize explorer"]');
    await openMenu('a'); await click('.canvas-paste-menu button','Copy to canvas');
    await waitForSelector(cdp, '.mapping-floating-pane.is-transfer-target:not(.is-minimized)');
    assert.equal(await evaluate(cdp, `document.querySelector('[data-project-diagram="representation-overview"]').disabled`),true);
    await captureScreenshot(cdp,{output:process.env.TRANSFER_PICKER_SCREENSHOT || path.join(root,'destination-picker.png')});
    await key('Escape','Escape',27); await selected([]);
    assert.equal(await evaluate(cdp, `!!document.querySelector('.mapping-transfer-picker')`),false);
    await double('a'); await double('b',2);
    await openMenu('a'); await click('.canvas-paste-menu button','Move to canvas');
    await click('.mapping-transfer-picker button','New canvas');
    await key('Escape','Escape',27); await selected([]);
    await double('a'); await double('b',2); await selected(['a','b']);
    // A failed atomic write must leave both the source and explorer unchanged.
    let rejected = false;
    const unsubscribe = cdp.on('Fetch.requestPaused', event => {
      const body = event.request.postData && JSON.parse(event.request.postData);
      if (!rejected && event.request.method === 'POST' && body?.changes?.some(change => change.key === 'workspace' && change.value?.transfers?.length)) {
        rejected = true;
        void cdp.send('Fetch.fulfillRequest', { requestId: event.requestId, responseCode: 409,
          responseHeaders: [{ name: 'Content-Type', value: 'application/json' }], body: Buffer.from(JSON.stringify({error:'Test write failure'})).toString('base64') });
      } else void cdp.send('Fetch.continueRequest', { requestId: event.requestId });
    });
    await cdp.send('Fetch.enable', { patterns: [{ urlPattern: '*/api/mapping/workspace/records' }] });
    await openMenu('a'); await click('.canvas-paste-menu button','Copy to canvas');
    await click('.mapping-transfer-picker button', 'New canvas');
    await click('.mapping-transfer-picker button','Copy diagrams');
    await waitFor(async()=>await evaluate(cdp, `document.querySelector('.mapping-transfer-picker [role=alert]')?.textContent.includes('Test write failure')`));
    assert.equal(await evaluate(cdp, `document.querySelectorAll('[data-project-diagram]').length`),2);
    await waitForSelector(cdp, `${visible} [data-grid-box="c"]`);
    await cdp.send('Fetch.disable'); unsubscribe();
    // Retry in the same form; keep the selected diagrams and entered destination.
    assert.equal(await evaluate(cdp, `document.querySelector('[aria-label="Transfer canvas name"]').value`),'New canvas');
    await click('[aria-label="Transfer canvas name"]');
    await key('a','KeyA',65,2); await cdp.send('Input.insertText',{text:'Copied canvas'});
    console.log('Selection and failed-save retry passed; copying');
    // Lose the response AFTER publication. The worker must retry the same batch,
    // discover its receipt, and install exactly one transfer.
    let lostResponse;
    const attempts = [];
    const offResponse = cdp.on('Fetch.requestPaused', event => {
      const body = event.request.postData && JSON.parse(event.request.postData);
      if (event.request.method === 'POST' && body?.changes?.some(change => change.key === 'workspace' && change.value?.transfers?.length)) {
        attempts.push(body);
        if (!lostResponse) {
          lostResponse = body;
          void cdp.send('Fetch.failRequest', { requestId: event.requestId, errorReason: 'ConnectionClosed' });
          return;
        }
      }
      void cdp.send('Fetch.continueRequest', { requestId: event.requestId });
    });
    await cdp.send('Fetch.enable', { patterns: [{ urlPattern: '*/api/mapping/workspace/records', requestStage: 'Response' }] });
    await click('.mapping-transfer-picker button','Copy diagrams');
    await waitFor(async()=>await evaluate(cdp, `document.querySelector('[aria-label="Diagram name"]')?.value==='Copied canvas'`));
    await cdp.send('Fetch.disable'); offResponse();
    assert.ok(lostResponse, 'The committed transfer response must have been interrupted');
    assert.ok(attempts.length >= 2, 'The worker must retry an ambiguous result');
    assert.deepEqual(attempts[1], attempts[0], 'The retry must retain its request ID and exact content');
    let ws=await persisted(w=>w?.transfers?.length===1);
    const copy=ws.transfers[0], sourceBefore=ws.documents.find(d=>d.representationId===copy.sourceId);
    assert.equal(sourceBefore.document.edges.length,4);
    assert.equal(ws.documents.find(d=>d.representationId===copy.destinationId).document.edges.length,3);
    await click(`${visible} .mapping-grid-tools button`,'Undo');
    await waitForSelector(cdp,`${visible} [data-grid-box="a"]`);
    assert.equal(await evaluate(cdp, `document.querySelector('[data-project-diagram="${copy.destinationId}"]')`),null);
    await click(`${visible} .mapping-grid-tools button`,'Redo');
    await waitFor(async()=>await evaluate(cdp, `document.querySelector('[aria-label="Diagram name"]').value==='Copied canvas'`));
    await click(`${visible} .mapping-grid-tools button`,'Undo');
    await waitForSelector(cdp,`${visible} [data-grid-box="a"]`);
    await double('a'); await selected(['a']);
    console.log('Copy undo/redo passed; moving');
    await transfer('Move','Moved canvas');
    ws=await persisted(w=>w?.transfers?.length===2);
    const move=ws.transfers[1], source=ws.documents.find(d=>d.representationId===move.sourceId), dest=ws.documents.find(d=>d.representationId===move.destinationId);
    assert.equal(source.document.edges.length,0); assert.equal(dest.document.edges.length,0);
    assert.equal(source.document.jumps.length,2); assert.equal(dest.document.jumps.length,2);
    assert.equal(source.history.snapshots[source.history.headId].transactionId,move.id);
    assert.equal(dest.history.snapshots[dest.history.headId].transactionId,move.id);
    console.log('Following jump');
    await click(`${visible} [data-native-node="grid:a"] .diagram-jump`);
    await waitForSelector(cdp, '[aria-label="Linked diagrams"]');
    await click('[aria-label="Linked diagrams"] button','a to b');
    await waitForSelector(cdp,`${visible} [data-grid-box="b"]`);
    assert.equal(await evaluate(cdp,`document.querySelector('${visible} [data-grid-box="a"]')`),null);
    console.log('Following jump');
    await click(`${visible} [data-native-node="grid:b"] .diagram-jump`);
    await click('[aria-label="Linked diagrams"] button','b to a');
    await waitForSelector(cdp,`${visible} [data-grid-box="a"]`);
    console.log('Reloading');
    await reload();
    await waitForSelector(cdp,`${visible} [data-grid-box="a"]`);
    await click(`${visible} .mapping-grid-tools button`,'Undo');
    await waitForSelector(cdp,`${visible} [data-grid-box="c"]`);
    ws=await persisted(w=>w?.transfers?.[1]?.applied===false);
    assert.equal(ws.documents.find(d=>d.representationId===move.sourceId).document.edges.length,4);
    assert.equal(ws.documents.find(d=>d.representationId===move.destinationId).hidden,true);
    console.log('Reloading');
    await reload();
    await waitForSelector(cdp,`${visible} [data-grid-box="c"]`);
    await click(`${visible} .mapping-grid-tools button`,'Redo');
    await waitFor(async () => await evaluate(cdp, `document.querySelector('[aria-label="Diagram name"]').value === 'Moved canvas'`));
    await waitForSelector(cdp,`${visible} [data-grid-box="a"]`);
    // Move the sole remaining diagram in this canvas, then undo the empty source.
    await double('a'); await selected(['a']);
    await transfer('Move','All moved');
    await click(`[data-project-diagram="${move.destinationId}"]`);
    await waitForSelector(cdp, `${visible} .mapping-empty-canvas`);
    await click('.mapping-submenu button', 'Save');
    await waitFor(async()=>await evaluate(cdp, `document.querySelector('.mapping-submenu [role=status]')?.textContent === 'Saved'`));
    await click(`${visible} .mapping-grid-tools button`,'Undo');
    await waitForSelector(cdp,`${visible} [data-grid-box="a"]`);
    // Deletion must work for both unsaved transfer canvases and saved participants.
    await double('a'); await selected(['a']);
    await transfer('Copy', 'Delete draft');
    const beforeDelete = await persisted(w => w?.transfers?.length === 4);
    const deletedDraft = beforeDelete.transfers[3].destinationId;
    await click('[aria-label="Delete diagram Delete draft"]');
    await waitFor(async () => await evaluate(cdp, `!document.querySelector('[data-project-diagram="${deletedDraft}"]') && !document.querySelector('.mapping-transfer-busy')`));
    const afterDelete = await persisted(w => !w?.documents?.some(d => d.representationId === deletedDraft));
    assert.ok(!afterDelete.transfers.some(tx => tx.sourceId === deletedDraft || tx.destinationId === deletedDraft));
    await click('[aria-label="Delete diagram Moved canvas"]');
    await waitFor(async () => await evaluate(cdp, `!document.querySelector('[aria-label="Delete diagram Moved canvas"]') && !document.querySelector('.mapping-transfer-busy')`));
    await persisted(w => !w?.documents?.some(d => d.representationId === move.destinationId));
    await reload();
    await waitForSelector(cdp, `${visible} [data-grid-box="b"]`);
    assert.equal(await evaluate(cdp, `document.querySelector('.mapping-project-error')?.textContent ?? ''`), '');
    await click(`${visible} .mapping-grid-tools button`, 'Undo');
    await waitForSelector(cdp, `${visible} [data-grid-box="a"]`);
    // Existing destinations can be chosen before they have been opened.
    await double('a'); await double('b',2); await selected(['a','b']);
    await openMenu('a'); await click('.canvas-paste-menu button','Copy to canvas');
    await click('[data-project-diagram="representation-existing"]');
    await waitFor(async()=>await evaluate(cdp, `document.querySelector('[aria-label="Diagram name"]').value==='Existing canvas'`));
    let existingWorkspace = await persisted(w => w?.transfers?.at(-1)?.destinationId === 'representation-existing');
    const copyExisting = existingWorkspace.transfers.at(-1);
    assert.equal(copyExisting.destinationCreated,false);
    let existing = existingWorkspace.documents.find(d => d.representationId==='representation-existing');
    assert.equal(existing.document.scene.root.children.length,4);
    assert.deepEqual(existing.document.scene.root.children.slice(0,2),existingScene.root.children);
    const inserted = existing.document.scene.root.children.slice(2);
    assert.equal(inserted[1].position.column-inserted[0].position.column,25);
    assert.equal(inserted[1].position.row-inserted[0].position.row,0);
    await click(`${visible} .mapping-grid-tools button`,'Undo');
    existingWorkspace = await persisted(w => w?.transfers?.at(-1)?.applied===false);
    existing = existingWorkspace.documents.find(d=>d.representationId==='representation-existing');
    assert.ok(!existing.hidden); assert.deepEqual(existing.document.scene,persistedExistingScene);
    await waitForSelector(cdp, `${visible} [data-grid-box="c"]`);
    await double('a'); await double('b',2); await selected(['a','b']);
    await openMenu('a'); await click('.canvas-paste-menu button','Move to canvas');
    await click('[data-project-diagram="representation-existing"]');
    await waitFor(async()=>await evaluate(cdp, `document.querySelector('[aria-label="Diagram name"]').value==='Existing canvas'`));
    existingWorkspace = await persisted(w => w?.transfers?.at(-1)?.mode==='move' && w?.transfers?.at(-1)?.destinationCreated===false);
    const movedExisting = existingWorkspace.transfers.at(-1);
    existing = existingWorkspace.documents.find(d=>d.representationId==='representation-existing');
    assert.deepEqual(existing.document.scene.root.children.slice(0,2),existingScene.root.children);
    assert.equal(existing.document.scene.root.children.length,4);
    assert.equal(existingWorkspace.documents.find(d=>d.representationId===movedExisting.sourceId).document.scene.root.children.length,1);
    await captureScreenshot(cdp,{output:process.env.TRANSFER_DESTINATION_SCREENSHOT || path.join(root,'existing-destination.png')});
    await reload();
    await waitForSelector(cdp, `${visible} [data-grid-box="a"]`);
    await click(`${visible} .mapping-grid-tools button`,'Undo');
    await waitForSelector(cdp, `${visible} [data-grid-box="c"]`);
    const restored = await persisted(w => w?.transfers?.at(-1)?.applied===false);
    assert.deepEqual(restored.documents.find(d=>d.representationId==='representation-existing').document.scene,persistedExistingScene);
    assert.ok(!restored.documents.find(d=>d.representationId==='representation-existing').hidden);
    await click(`${visible} .mapping-grid-tools button`,'Redo');
    await waitFor(async()=>await evaluate(cdp, `document.querySelector('[aria-label="Diagram name"]').value==='Existing canvas'`));
    const redone = await persisted(w => w?.transfers?.at(-1)?.applied===true);
    assert.deepEqual(redone.documents.find(d=>d.representationId==='representation-existing').document,existing.document);
    assert.deepEqual(exceptions,[]);
    console.log('PASS: double-click, Ctrl toggle, Ctrl-marquee full enclosure, additive selection, copy/move, all edge directions, fan-out jumps, paired CanvasHistory, undo/redo, reload, empty source, draft/saved canvas deletion, explorer destination picking, Escape deselection, existing-canvas copy/move, unchanged destination layout');
  });
} finally {
  if (server && server.exitCode === null) { server.kill('SIGTERM'); await new Promise(resolve => server.once('exit', resolve)); }
  await rm(root, { recursive: true, force: true });
}
