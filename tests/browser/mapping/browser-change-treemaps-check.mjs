// npm run build && node --import tsx tests/browser/mapping/browser-change-treemaps-check.mjs
import assert from 'node:assert/strict';
import { spawn, execFileSync } from 'node:child_process';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir, homedir } from 'node:os';
import { createServer } from 'node:net';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { seedMappingFixture } from '../support/browser-mapping-fixture.mjs';
import { DiagramStore } from '../../../infrastructure/core/persistence/store.ts';
import { DiagramChangeSessionStore } from '../../../infrastructure/mapping/changes/diagramChangeSessionStore.ts';
import { ChangeSessionService } from '../../../application/mapping/changes/changeSessionService.ts';
import { revisionFixture } from '../../support/diagramRevisions.ts';
import { canvasSaveFixture } from '../../support/mappingDiagram.ts';
import { singleDiagramScene } from '../../../domain/core/diagrams/projectDiagramCanvas.ts';
import { diagramContentNodes } from '../../../domain/core/diagrams/diagramContentNodes.ts';
const { evaluate, waitFor, waitForSelector, withHeadlessBrowser, captureScreenshot } = await import(pathToFileURL(path.join(homedir(), '.codex/skills/front-end/browser-test.mjs')).href);
const root = await mkdtemp(path.join(tmpdir(), 'change-treemaps-'));
let server;
const git = (...args) => execFileSync('git', ['-C', root, ...args], { encoding: 'utf8' }).trim();
const commit = title => { git('add', '.'); git('-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.test', 'commit', '-qm', title); return git('rev-parse', 'HEAD'); };
try {
  await seedMappingFixture(root, { ascii: 'Overview', nodes: [] });
  await writeFile(path.join(root, '.gitignore'), '.diagrams/\n');
  await mkdir(path.join(root, 'src')); await mkdir(path.join(root, 'tests'));
  await writeFile(path.join(root, 'src/auth.ts'), 'old\nkeep\n'); commit('Baseline');
  await writeFile(path.join(root, 'src/auth.ts'), 'new\nkeep\nadded\n');
  await writeFile(path.join(root, 'README.md'), 'New docs\n');
  await writeFile(path.join(root, 'tests/auth.test.ts'), 'New test\n');
  await writeFile(path.join(root, 'binary.dat'), Buffer.from([0, 1, 0, 2]));
  const head = commit('Captured changes');
  const store = new DiagramStore(root), project = await store.loadProject(), repositoryId = project.repositories[0].id;
  const diagrams = revisionFixture();
  for (const [name, ascii] of [['Authentication', 'Authentication\n`-- Sign-in\n    `-- Create session'], ['Storage', 'Storage\n`-- Persist']]) {
    const scene = singleDiagramScene(ascii);
    scene.root.position = { column: 7, row: 3 };
    scene.contents = { ...scene.contents, overview: diagrams.create({ id: 'overview', revision: 0, ascii, structureKind: 'tree' }).diagram };
    await store.projectCatalogs.saveMappingDiagram(project.id, { ...canvasSaveFixture({ name, scene }), repositoryId });
  }
  const changes = new ChangeSessionService(new DiagramChangeSessionStore(store.storeRoot), store, { list: () => [] });
  const discovered = await changes.discoverHunks({ repositoryId, commits: [head], offset: 0, limit: 200, includePatches: true });
  const created = await changes.create({ title: 'Treemap review', repositoryId, commits: [head], requestId: 'create' });
  const empty = await changes.create({ title: 'Empty review', repositoryId, commits: [], requestId: 'empty' });
  const session = await changes.get(created.changeSessionId), auth = session.documents.find(d => d.name === 'Authentication'), storage = session.documents.find(d => d.name === 'Storage');
  const target = (doc, label) => ({ representationId: doc.id, displayNodeId: 'grid:overview', ...(label ? {
    contentNodeId: diagramContentNodes(doc.proposed.document.scene.contents.overview.content).find(n => n.label === label).id } : {}) });
  const mapping = (id, line, file, destination) => ({ id, source: { line }, targets: discovered.hunks.filter(h => h.path === file).map(h => ({ kind: 'diff-hunk', hunkId: h.id })), diagramTargets: [destination] });
  await changes.update({ changeSessionId: session.id, expectedVersion: session.version, requestId: 'map', diffTree: {
    expectedRevisionId: session.diffTree.revision.id, ascii: 'Review\n|-- Auth\n|-- Session\n`-- Storage', mappings: [
      mapping('auth', 2, 'src/auth.ts', target(auth, 'Sign-in')), mapping('session', 3, 'src/auth.ts', target(auth, 'Create session')),
      mapping('storage', 4, 'README.md', target(storage))
    ]
  } });
  const version = (await changes.get(session.id)).version;
  await writeFile(path.join(root, 'src/auth.ts'), 'LIVE CONTENT SHOULD NEVER APPEAR\n');
  const port = await new Promise(resolve => { const s = createServer(); s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => resolve(p)); }); });
  const url = `http://127.0.0.1:${port}`;
  // No --http or --pi: this visualization requires neither mutation nor generation.
  server = spawn(process.execPath, ['scripts/dev/start-server.mjs', 'preview', '--host', '127.0.0.1', '--port', String(port), '--strictPort'], {
    env: { ...process.env, NEW_DIAGRAM_PROJECT_ROOT: root, NEW_DIAGRAMS_DIR: store.storeRoot }, stdio: ['ignore', 'ignore', 'pipe'] });
  let logs = ''; server.stderr.on('data', data => { logs += data; });
  await waitFor(async () => (await fetch(url).catch(() => null))?.ok, { timeoutMs: 20000 }).catch(error => { throw Error(`${error}\n${logs}`); });
  await withHeadlessBrowser({ url: `${url}/mapping`, width: 1680, height: 1050, chromePath: process.env.CHROME_PATH,
    arguments: ['--disable-gpu', ...(process.platform === 'linux' ? ['--no-sandbox'] : [])] }, async ({ cdp }) => {
    const errors = [], requests = [];
    cdp.on('Page.javascriptDialogOpening', event => { if (event.type === 'beforeunload') void cdp.send('Page.handleJavaScriptDialog', { accept: true }); });
    await cdp.send('Page.enable');
    await cdp.send('Runtime.enable'); await cdp.send('Network.enable');
    cdp.on('Runtime.exceptionThrown', e => errors.push(e.exceptionDetails));
    cdp.on('Network.requestWillBeSent', e => requests.push(e.request.url));
    const click = async (selector, text) => {
      let point;
      await waitFor(async () => (point = await evaluate(cdp, `(() => {const e=[...document.querySelectorAll(${JSON.stringify(selector)})].find(e=>e.getBoundingClientRect().width>0 && (!${JSON.stringify(text)} || e.textContent.trim()===${JSON.stringify(text)})); if(!e)return null;const r=e.getBoundingClientRect(),p={x:r.x+r.width/2,y:r.y+r.height/2};return e.contains(document.elementFromPoint(p.x,p.y))?p:null;})()`)));
      for (const type of ['mousePressed', 'mouseReleased']) await cdp.send('Input.dispatchMouseEvent', { type, ...point, button: 'left', buttons: type === 'mousePressed' ? 1 : 0, clickCount: 1 });
    };
    const assertTooltip = async (label, name, percent) => {
      const camera = () => evaluate(cdp, "document.querySelector('.mapping-viewport > .change-session-preview .diagram-canvas__surface').style.transform");
      await evaluate(cdp, 'new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))');
      await waitFor(async () => await evaluate(cdp, "document.querySelector('.mapping-viewport > .change-session-preview .diagram-canvas__surface').getAnimations().every(animation=>animation.playState!=='running')"));
      const cameraBefore = await camera();
      const point = await evaluate(cdp, `(() => { const e=document.querySelector('.change-treemap-cell button[aria-label^="'+${JSON.stringify(label)}+':"]'); const r=e.getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2}; })()`);
      await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', ...point });
      await waitForSelector(cdp, '.change-treemap-tooltip');
      const tooltip = await evaluate(cdp, `(() => {const e=document.querySelector('.change-treemap-tooltip'),r=e.getBoundingClientRect();return {text:e.textContent,visible:r.left>=0 && r.top>=0 && r.right<=innerWidth && r.bottom<=innerHeight,described:!!document.querySelector('[aria-describedby="'+e.id+'"]')};})()`);
      assert.equal(tooltip.text.includes(name), false, 'Tooltip omits diagram names');
      assert.ok(tooltip.text.includes(label === 'Create session' ? '1.5 LOC' : '3 LOC'));
      assert.ok(tooltip.text.includes(percent + '%'));
      assert.ok(tooltip.text.includes(label === 'Create session' ? '+1' : '+2'));
      assert.ok(tooltip.text.includes(label === 'Create session' ? '−0.5' : '−1'));
      assert.equal(await evaluate(cdp, `(() => {
        const tip=document.querySelector('.change-treemap-tooltip'), css=getComputedStyle(tip);
        const added=getComputedStyle(tip.querySelector('[data-change=added]')).color;
        const deleted=getComputedStyle(tip.querySelector('[data-change=deleted]')).color;
        const rgb=color=>color.match(/[\\d.]+/g).map(Number);
        const a=rgb(added), d=rgb(deleted);
        return a[1]>a[0] && a[1]>a[2] && d[0]>d[1] && d[0]>d[2];
      })()`), true, 'Tooltip renders additions in green and deletions in red');
      assert.equal(tooltip.visible, true, 'Tooltip stays within viewport');
      assert.equal(await evaluate(cdp, `(() => {
        const tip=document.querySelector('.change-treemap-tooltip'), a=tip.getBoundingClientRect();
        const b=document.querySelector('[aria-describedby="'+tip.id+'"]').parentElement.getBoundingClientRect();
        return a.height<40 && (a.left>=b.right || a.right<=b.left || a.top>=b.bottom || a.bottom<=b.top);
      })()`), true, 'Compact tooltip never overlaps its full tile');
      if (label === 'Create session') {
        await waitForSelector(cdp, '.mapping-viewport > .change-session-preview .treemap-canvas-hover');
        assert.equal(await evaluate(cdp, `(() => {
          const tile=document.querySelector('.change-treemap-cell button[aria-label^="Create session:"]').parentElement;
          const outline=document.querySelector('.mapping-viewport > .change-session-preview .treemap-canvas-hover');
          const css=getComputedStyle(outline);
          return outline.dataset.diagramPosition===tile.dataset.diagramPosition && css.borderTopWidth==='2px' && css.pointerEvents==='none';
        })()`), true, 'Hover outlines the matching canvas subtree');
        assert.deepEqual(await camera(), cameraBefore, 'Hover does not move the preview camera');
      }
      assert.equal(tooltip.described, true, 'Tooltip is linked to its tile for keyboard users');
      if (process.env.CHANGE_TREEMAP_SCREENSHOT) await captureScreenshot(cdp, { output: process.env.CHANGE_TREEMAP_SCREENSHOT.replace('.png', '-tooltip.png') });
      await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 5, y: 5 });
      await waitFor(async () => await evaluate(cdp, "!document.querySelector('.change-treemap-tooltip') && !document.querySelector('.treemap-canvas-hover')"));
    };
    const assertBlueprintGeometry = async () => {
      const violations = await evaluate(cdp, `(() => {
        const plot = document.querySelector('.change-treemap-plot'), cells = [...plot.querySelectorAll('.change-treemap-cell')];
        const errors = [], rect = e => ({x:parseFloat(e.style.left),y:parseFloat(e.style.top),w:parseFloat(e.style.width),h:parseFloat(e.style.height)});
        for (const cell of cells) {
          const r = rect(cell);
          if (cell.parentElement !== plot) errors.push('Nested DOM origin');
          if (!Object.values(r).every(Number.isInteger)) errors.push('Fractional tile edge');
          if (getComputedStyle(cell).borderLeftWidth !== '0px') errors.push('Extra wrapper border');
          if (cell.dataset.nested === 'true') {
            const children = cells.filter(c=>c.dataset.parentId===cell.dataset.nodeId).map(rect);
            if (!children.length || Math.min(...children.map(c=>c.x))!==r.x || Math.max(...children.map(c=>c.x+c.w))!==r.x+r.w || Math.max(...children.map(c=>c.y+c.h))!==r.y+r.h || Math.min(...children.map(c=>c.y))!==r.y+22) errors.push('Inset breaks shared edges');
            if (getComputedStyle(cell,'::before').borderLeftStyle!=='dashed') errors.push('Missing dashed group frame');
          } else {
            if (getComputedStyle(cell.querySelector('button')).borderLeftWidth!=='1px') errors.push('Missing single outline');
          }
        }
        if (!getComputedStyle(plot).backgroundImage.includes('linear-gradient')) errors.push('Missing blueprint grid');
        return errors;
      })()`);
      assert.deepEqual(violations, [], 'Blueprint tiles share integer edges at every nesting level');
    };
    await waitForSelector(cdp, '.mapping-explorer-tabs');
    await click('[role=tab]', 'Changes');
    await waitForSelector(cdp, `[data-change-session-summary="${session.id}"]`);
    await click(`[data-change-session-summary="${session.id}"]`);
    await click(`[data-open-difftree="${session.id}"]`);
    await waitForSelector(cdp, '.window-panel [role=tab]');
    await click('.window-panel [role=tab]', 'Treemaps');
    await waitForSelector(cdp, '.change-treemap-cell');
    assert.equal(await evaluate(cdp, "document.querySelector('.change-treemap-switch button[aria-pressed=true]').textContent"), 'Diagrams', 'New viewers start with diagram colors');
    await click('.change-treemap-switch button', 'Files');
    assert.equal(await evaluate(cdp, "document.querySelectorAll('.window-panel .window-panel').length"), 0, 'Treemaps share the existing window');
    await click('.window-panel [role=tab]', 'Hunks');
    await waitForSelector(cdp, '[aria-label="Captured hunks"]');
    await click('.window-panel-header button', 'Minimize');
    await click('.window-panel [role=tab]', 'Treemaps');
    await waitForSelector(cdp, '.change-treemap-cell');
    assert.equal(await evaluate(cdp, "document.querySelector('.window-panel-minimized [role=tab][aria-selected=true]').textContent"), 'Treemaps');
    await click('.window-panel [role=tab]', 'Change tree');
    await waitForSelector(cdp, '.diff-tree-scroll');
    await click('.window-panel [role=tab]', 'Hunks');
    await cdp.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'ArrowRight', code: 'ArrowRight' });
    await cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'ArrowRight', code: 'ArrowRight' });
    await waitForSelector(cdp, '.change-treemap-cell');
    assert.equal(await evaluate(cdp, "document.activeElement.textContent"), 'Treemaps', 'Arrow navigation reaches third tab');
    await click('.window-panel-header button', 'Restore');
    await assertBlueprintGeometry();
    const totals = await evaluate(cdp, "document.querySelector('[aria-label=\"Change LOC totals\"]').textContent");
    assert.match(totals, /Actual LOC5/); assert.match(totals, /Allocated LOC4/); assert.match(totals, /Unmapped LOC1/); assert.match(totals, /Dup. discounted3/);
    assert.ok(await evaluate(cdp, "[...document.querySelectorAll('.change-treemap-cell')].some(e=>e.textContent.includes('auth.test.ts'))"), 'Tests contribute LOC');
    await assertTooltip('auth.ts', 'auth.ts', 60);
    await click('.change-treemap-cell button[aria-label^="auth.ts:"]');
    assert.equal(await evaluate(cdp, "document.querySelectorAll('.change-treemap-selection, .change-treemap-region-picker, .change-treemap-footnote').length"), 0, 'Inspector removed so tiles fill the panel');
    assert.equal(await evaluate(cdp, "document.querySelector('.change-treemap-cell[data-selected=true]').dataset.loc"), '3');
    assert.equal(await evaluate(cdp, "document.querySelectorAll('.change-treemap-panel .diff-hunk, .change-treemap-detail-pane').length"), 0, "Treemaps have no source-code pane");
    assert.ok(await evaluate(cdp, "document.querySelector('.change-treemap-plot').getBoundingClientRect().width > document.querySelector('[data-pane=treemaps]').getBoundingClientRect().width * .95"), "Map fills the panel width");
    assert.equal(await evaluate(cdp, "!!document.querySelector('.window-panel-minimized')"), false, 'File selection does not navigate');
    await click('.change-treemap-switch button', 'Diagrams');
    await waitFor(async () => await evaluate(cdp, "document.querySelectorAll('.change-treemap-plot > .change-treemap-cell[data-depth=\"0\"]').length===3"));
    await click('.change-treemap-cell[data-treemap-kind=diagram][data-diagram-position="4"] button');
    await waitForSelector(cdp, '.mapping-viewport > .change-session-preview .change-preview-treemap-tint');
    assert.deepEqual(await evaluate(cdp, "[...document.querySelectorAll('.change-treemap-cell[data-depth=\"0\"]')].map(e=>e.dataset.treemapKind)"), ['canvas', 'canvas', 'unmapped']);
    assert.equal(await evaluate(cdp, "document.querySelector('.change-treemap-breadcrumbs').textContent"), 'All canvases');
    await click('.theme-settings-toggle');
    assert.equal(await evaluate(cdp, 'document.querySelector(".theme-picker-panel select").value'), 'continuous', 'Continuous is the default');
    const readColors = () => evaluate(cdp, "[...document.querySelectorAll('.change-treemap-cell[data-treemap-color]')].map(e=>e.dataset.treemapColor)");
    const readCanvasColors = () => evaluate(cdp, "[...document.querySelectorAll('.change-preview-treemap-tint')].map(e=>e.dataset.treemapColor)");
    const readGeometry = () => evaluate(cdp, "[...document.querySelectorAll('.change-treemap-cell')].map(e=>[e.dataset.loc,e.style.left,e.style.top,e.style.width,e.style.height])");
    const chooseScale = async key => {
      await click('.theme-picker-panel select');
      for (const [k, code] of [[key, key === 'End' ? 35 : 36], ['Enter', 13]])
        for (const type of ['keyDown', 'keyUp']) await cdp.send('Input.dispatchKeyEvent', { type, key: k, code: k, windowsVirtualKeyCode: code });
    };
    await chooseScale('Home');
    await waitFor(async () => await evaluate(cdp, "document.querySelector('.treemap-loc-legend').textContent.includes('Ranked')"));
    const rankedColors = await readColors(), rankedCanvas = await readCanvasColors(), rankedGeometry = await readGeometry();
    await chooseScale('End');
    await waitFor(async () => await evaluate(cdp, "document.querySelector('.treemap-loc-legend').textContent.includes('Continuous')"));
    assert.notDeepEqual(await readColors(), rankedColors, 'Continuous changes tile shades');
    await waitFor(async () => JSON.stringify(await readCanvasColors()) !== JSON.stringify(rankedCanvas));
    assert.notDeepEqual(await readCanvasColors(), rankedCanvas, 'Continuous changes matching canvas shades');
    assert.deepEqual(await readGeometry(), rankedGeometry, 'Scale choice preserves LOC and tile geometry');
    assert.equal(await evaluate(cdp, "JSON.parse(localStorage.getItem('new-diagram-color-opacity')).scale"), 'continuous');
    await chooseScale('Home');
    await waitFor(async () => await evaluate(cdp, "document.querySelector('.treemap-loc-legend').textContent.includes('Ranked')"));
    assert.deepEqual(await readColors(), rankedColors, 'Ranked shades are deterministic');
    await click('.theme-settings-toggle');
    const identities = await evaluate(cdp, `[...document.querySelectorAll('.change-treemap-cell[data-treemap-kind="diagram"]')].map(e=>({color:e.dataset.treemapColor,position:e.dataset.diagramPosition}))`);
    assert.equal(identities.length, 2);
    assert.deepEqual(identities.map(i=>i.position), ['0','4']);
    assert.notEqual(identities[0].color, identities[1].color, 'Diagram positions get different colors');
    assert.equal(await evaluate(cdp, "document.querySelector('.change-treemap-cell[data-treemap-kind=unmapped]').hasAttribute('data-treemap-color')"), false);
    const tileIdentity = async label => evaluate(cdp, `(() => {
      const e=document.querySelector('.change-treemap-cell button[aria-label^="'+${JSON.stringify(label)}+':"]').parentElement;
      return {color:e.dataset.treemapColor,position:e.dataset.diagramPosition};
    })()`);
    const assertCanvasIdentity = async (identity, label) => {
      await waitForSelector(cdp, '.mapping-viewport > .change-session-preview .change-preview-treemap-tint');
      const overlay = await evaluate(cdp, `(() => {
        const stage=document.querySelector('.mapping-viewport > .change-session-preview .change-preview-stage');
        const tints=[...stage.querySelectorAll('.change-preview-treemap-tint')];
        const tint=tints.find(e=>e.dataset.diagramPosition===${JSON.stringify(identity.position)} && e.dataset.treemapColor===${JSON.stringify(identity.color)}) ?? tints[0];
        const box=stage.querySelector('[data-grid-box="'+tint.dataset.treemapDiagram.slice(5)+'"]');
        const rect=e=>({x:parseFloat(e.style.left),y:parseFloat(e.style.top),w:parseFloat(e.style.width),h:parseFloat(e.style.height)});
        const r=rect(box), tiles=tints.filter(e=>e.dataset.treemapDiagram===tint.dataset.treemapDiagram).map(rect);
        const overlap=tiles.some((a,i)=>tiles.slice(i+1).some(b=>Math.min(a.x+a.w,b.x+b.w)-Math.max(a.x,b.x)>.01 && Math.min(a.y+a.h,b.y+b.h)-Math.max(a.y,b.y)>.01));
        const label=${JSON.stringify(label)};
        const node=label && [...stage.querySelectorAll('.diagram-content-node')].find(e=>e.textContent===label);
        const matches=node && tints.filter(e=>e.dataset.treemapColor===tint.dataset.treemapColor).some(e=>{
          const a=e.getBoundingClientRect(),b=node.getBoundingClientRect();return a.top<=b.top+.5 && a.bottom>=b.bottom-.5 && a.left<=b.left+.5 && a.right>=b.right-.5;
        });
        return {color:tint.dataset.treemapColor,position:tint.dataset.diagramPosition,subtree:!!tint.dataset.contentNodeId,
          contained:tiles.every(t=>t.x>=r.x-.01 && t.y>=r.y-.01 && t.x+t.w<=r.x+r.w+.01 && t.y+t.h<=r.y+r.h+.01),
          fraction:tiles.reduce((sum,t)=>sum+t.w*t.h,0)/(r.w*r.h),overlap,matches,
          background:getComputedStyle(tint).backgroundColor,pointerEvents:getComputedStyle(tint).pointerEvents};
      })()`);
      if (label) { assert.equal(overlay.color, identity.color); assert.equal(overlay.position, identity.position); }
      assert.ok(Math.abs(overlay.fraction-1)<.0001, 'Tiling covers the entire containing diagram');
      assert.equal(overlay.contained, true, 'Every tint stays inside its containing diagram at a nonzero scene origin');
      assert.equal(overlay.overlap, false, 'Ancestor tints never stack over subtree colors');
      if (label) { assert.equal(overlay.subtree, true); assert.equal(overlay.matches, true, 'Node label lies in its matching colored subtree'); }
      assert.notEqual(overlay.background, 'rgba(0, 0, 0, 0)');
      assert.equal(overlay.pointerEvents, 'none');
      assert.equal(await evaluate(cdp, "[...document.querySelectorAll('.change-preview-stage .change-diff-mapped')].every(e=>getComputedStyle(e).textDecorationLine==='none')"), true, 'Mapped labels have no underline');
    };
    await assertBlueprintGeometry();
    const areas = await evaluate(cdp, "[...document.querySelectorAll('.change-treemap-plot > .change-treemap-cell[data-depth=\"0\"]')].map(e=>{const r=e.getBoundingClientRect();return {loc:Number(e.dataset.loc),area:r.width*r.height};})");
    assert.ok(Math.abs(areas[0].area / areas[1].area - 3) < .05, 'Diagram rectangles reflect 3:1 allocated LOC after sharing');
    assert.ok(await evaluate(cdp, "document.querySelector('.change-treemap-plot > [data-treemap-kind=unmapped]').textContent.includes('Unmapped')"));
    assert.equal(await evaluate(cdp, "document.querySelector('.change-treemap-plot > [data-treemap-kind=unmapped]').dataset.loc"), '1');
    await click('.change-treemap-cell[data-treemap-kind=unmapped] button');
    assert.equal(await evaluate(cdp, "!!document.querySelector('.window-panel-minimized')"), false, 'Unmapped region has no navigation target');
    assert.equal(await evaluate(cdp, "document.querySelectorAll('.change-treemap-hatching, .change-treemap-legend').length"), 0, 'Treemaps have plain fills without diff hatching');
    await captureScreenshot(cdp, { output: process.env.CHANGE_TREEMAP_SCREENSHOT ?? path.join(root, 'treemaps.png') });
    const widthBefore = await evaluate(cdp, "document.querySelector('.change-treemap-plot').getBoundingClientRect().width");
    await cdp.send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 900, deviceScaleFactor: 1, mobile: false });
    await waitFor(async () => await evaluate(cdp, `document.querySelector('.change-treemap-plot').getBoundingClientRect().width < ${widthBefore - 50}`));
    assert.equal(await evaluate(cdp, "[...document.querySelectorAll('.change-treemap-plot > .change-treemap-cell[data-depth=\"0\"]')].reduce((sum,e)=>sum+Number(e.dataset.loc),0)"), 5);
    await assertBlueprintGeometry();
    await click('.change-treemap-cell[data-treemap-kind=diagram] button[aria-label^="Storage:"]');
    await assertCanvasIdentity(identities[1]);
    await click('.change-treemap-cell[data-treemap-kind=diagram] button[aria-label^="Authentication:"]');
    await assertBlueprintGeometry();
    await waitForSelector(cdp, `[data-change-session="${session.id}"] .is-change-target`);
    await assertCanvasIdentity(identities[0]);
    await click('.change-treemap-zoom-controls button', 'Zoom in');
    await waitFor(async () => await evaluate(cdp, "document.querySelector('[aria-label=\"Treemap path\"]').textContent.includes('Authentication / Authentication')"));
    await assertTooltip('Sign-in', 'Authentication / Authentication', 60);
    const signInIdentity = await tileIdentity('Sign-in');
    assert.equal(signInIdentity.color, identities[0].color, 'Equal LOC gets the same shade even at different hierarchy levels');
    await click('.change-treemap-cell button[aria-label^="Sign-in:"]');
    await assertCanvasIdentity(signInIdentity, 'Sign-in');
    await click('.change-treemap-zoom-controls button', 'Zoom in');
    await waitForSelector(cdp, '.change-treemap-cell[data-treemap-kind=direct]');
    assert.equal(await evaluate(cdp, "document.querySelector('.change-treemap-cell[data-treemap-kind=direct]').dataset.loc"), '1.5');
    await assertTooltip('Create session', 'Authentication / Authentication', 30);
    const sessionIdentity = await tileIdentity('Create session');
    assert.notEqual(sessionIdentity.color, signInIdentity.color, 'Child and parent have distinct colors');
    await click('.change-treemap-cell button[aria-label^="Create session:"]');
    assert.equal(await evaluate(cdp, "document.querySelector('.change-treemap-cell[data-selected=true]').dataset.loc"), '1.5');
    assert.equal(await evaluate(cdp, "document.querySelector('.change-treemap-zoom-controls button').disabled"), true, 'A leaf cannot be zoomed into');
    assert.match(await evaluate(cdp, `document.querySelector('.change-treemap-cell button[aria-label^="Create session:"]').getAttribute('aria-label')`), /3 shared LOC; each shared hunk split across 2 mapped nodes/);
    await waitForSelector(cdp, `[data-change-session="${session.id}"] .is-change-target`);
    await assertCanvasIdentity(sessionIdentity, 'Create session');
    await click('[aria-label="Window panel layout"]');
    for (const [key, code] of [['End', 35], ['Enter', 13]]) for (const type of ['keyDown', 'keyUp'])
      await cdp.send('Input.dispatchKeyEvent', { type, key, code: key, windowsVirtualKeyCode: code });
    await waitForSelector(cdp, '.window-panel-canvas .change-preview-treemap-tint');
    await click('.change-treemap-cell button[aria-label^="Create session:"]');
    let canvasPoint;
    await waitFor(async () => (canvasPoint = await evaluate(cdp, `(() => {
      const tile=document.querySelector('.change-treemap-cell button[aria-label^="Create session:"]').parentElement;
      const region=[...document.querySelectorAll('.window-panel-canvas .change-preview-treemap-tint')].find(e=>e.dataset.treemapRegion===tile.dataset.nodeId);
      if(!region)return null;const r=region.getBoundingClientRect(),p={x:r.right-3,y:r.top+r.height/2};
      return document.querySelector('.window-panel-canvas').contains(document.elementFromPoint(p.x,p.y))?p:null;
    })()`)));
    const reverseCamera = await evaluate(cdp, "document.querySelector('.window-panel-canvas .diagram-canvas__surface').style.transform");
    for (const type of ['mousePressed', 'mouseReleased']) await cdp.send('Input.dispatchMouseEvent', { type, ...canvasPoint, button: 'left', buttons: type === 'mousePressed' ? 1 : 0, clickCount: 1 });
    await waitFor(async () => await evaluate(cdp, "document.querySelector('.change-treemap-cell[data-selected=true] button')?.getAttribute('aria-label').startsWith('Create session:') && !!document.querySelector('.change-treemap-tooltip')"));
    assert.equal(await evaluate(cdp, "document.querySelector('.window-panel-canvas .diagram-canvas__surface').style.transform"), reverseCamera);
    assert.equal(await evaluate(cdp, "document.querySelectorAll('.diagram-mapping-choices').length"), 0);
    if (process.env.CHANGE_TREEMAP_SCREENSHOT) await captureScreenshot(cdp, { output: process.env.CHANGE_TREEMAP_SCREENSHOT.replace('.png', '-reverse.png') });
    await click('[aria-label="Window panel layout"]');
    for (const [key, code] of [['Home', 36], ['ArrowDown', 40], ['Enter', 13]]) for (const type of ['keyDown', 'keyUp'])
      await cdp.send('Input.dispatchKeyEvent', { type, key, code: key, windowsVirtualKeyCode: code });
    await waitFor(async () => await evaluate(cdp, "document.querySelector('.window-panel-full-split') && !document.querySelector('.window-panel-canvas')"));
    await waitFor(async () => await evaluate(cdp, `(() => {
      const plot=document.querySelector('.change-treemap-plot'), cells=[...plot.children];
      return Math.max(...cells.map(e=>parseFloat(e.style.left)+parseFloat(e.style.width)))===Math.round(plot.getBoundingClientRect().width)
        && Math.max(...cells.map(e=>parseFloat(e.style.top)+parseFloat(e.style.height)))===Math.round(plot.getBoundingClientRect().height);
    })()`));
    const beforeTheme = await evaluate(cdp, `[...document.querySelectorAll('.change-treemap-cell')].map(e=>({id:e.dataset.nodeId,loc:e.dataset.loc,color:e.dataset.treemapColor,rect:e.getAttribute('style')}))`);
    await click('.theme-toggle');
    await waitFor(async () => await evaluate(cdp, "document.documentElement.dataset.theme==='light'"));
    const light = await evaluate(cdp, `(() => {
      const tile=document.querySelector('.change-treemap-cell button[aria-label^="Create session:"]');
      const tint=[...document.querySelectorAll('.change-preview-treemap-tint')].find(e=>e.dataset.treemapColor===tile.parentElement.dataset.treemapColor);
      return {canvas:getComputedStyle(document.querySelector('.mapping-viewport > .change-session-preview .mapping-poc-canvas')).backgroundColor,
        plot:getComputedStyle(document.querySelector('.change-treemap-plot')).backgroundColor,
        foreground:getComputedStyle(document.querySelector('.change-treemap-panel')).color,
        tile:getComputedStyle(tile).backgroundColor,tint:getComputedStyle(tint).backgroundColor,
        scheme:getComputedStyle(document.documentElement).colorScheme};
    })()`);
    assert.equal(light.canvas, 'rgb(255, 255, 255)');
    assert.equal(light.plot, light.canvas, 'Canvas and treemap share the same neutral light surface');
    assert.equal(light.tile, light.tint, 'Matching identities use the same tint opacity');
    assert.equal(light.foreground, 'rgb(32, 36, 43)');
    assert.equal(light.scheme, 'light');
    assert.deepEqual(await evaluate(cdp, `[...document.querySelectorAll('.change-treemap-cell')].map(e=>({id:e.dataset.nodeId,loc:e.dataset.loc,color:e.dataset.treemapColor,rect:e.getAttribute('style')}))`), beforeTheme, 'Changing theme preserves color identities, LOC and layout');
    await assertBlueprintGeometry();
    await assertTooltip('Create session', 'Authentication / Authentication', 30);
    if (process.env.CHANGE_TREEMAP_SCREENSHOT) await captureScreenshot(cdp, { output: process.env.CHANGE_TREEMAP_SCREENSHOT.replace('.png', '-light.png') });
    await click('.theme-settings-toggle');
    await waitForSelector(cdp, '.theme-picker-panel');
    const setSlider = async (label, key, code) => {
      await click(`input[aria-label="${label}"]`);
      for (const type of ['keyDown', 'keyUp']) await cdp.send('Input.dispatchKeyEvent', { type, key, code: key, windowsVirtualKeyCode: code });
    };
    const fills = () => evaluate(cdp, `({tile:getComputedStyle(document.querySelector('.change-treemap-cell[data-treemap-color] > button')).backgroundColor,canvas:getComputedStyle(document.querySelector('.change-preview-treemap-tint')).backgroundColor})`);
    const initialFills = await fills();
    await setSlider('Treemap color opacity', 'End', 35);
    const solidMap = await fills();
    assert.notEqual(solidMap.tile, initialFills.tile, 'Treemap opacity changes immediately');
    assert.equal(solidMap.canvas, initialFills.canvas, 'Treemap slider leaves canvas opacity alone');
    await setSlider('Diagram background opacity', 'Home', 36);
    const clearCanvas = await fills();
    assert.notEqual(clearCanvas.canvas, solidMap.canvas, 'Canvas opacity changes immediately');
    assert.equal(clearCanvas.tile, solidMap.tile, 'Canvas slider leaves treemap opacity alone');
    await setSlider('Diagram background opacity', 'ArrowRight', 39);
    const beforeShade = await fills();
    const geometryBeforeShade = await evaluate(cdp, "[...document.querySelectorAll('.change-treemap-cell')].map(e=>e.getAttribute('style'))");
    await setSlider('Shade shift', 'End', 35);
    const lighter = await fills();
    assert.notEqual(lighter.tile, beforeShade.tile, 'Shade changes the treemap');
    assert.notEqual(lighter.canvas, beforeShade.canvas, 'Shade changes canvas backgrounds');
    assert.deepEqual(await evaluate(cdp, "[...document.querySelectorAll('.change-treemap-cell')].map(e=>e.getAttribute('style'))"), geometryBeforeShade, 'Shade leaves LOC and geometry alone');
    const preferences = await evaluate(cdp, "JSON.parse(localStorage.getItem('new-diagram-color-opacity'))");
    assert.equal(preferences.treemap, 100);
    assert.equal(preferences.shade, 20);
    assert.ok(preferences.canvas > 0 && preferences.canvas < 100);
    if (process.env.CHANGE_TREEMAP_SCREENSHOT) await captureScreenshot(cdp, { output: process.env.CHANGE_TREEMAP_SCREENSHOT.replace('.png', '-settings.png') });
    for (const type of ['keyDown', 'keyUp']) await cdp.send('Input.dispatchKeyEvent', { type, key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
    assert.equal(await evaluate(cdp, "document.activeElement.classList.contains('theme-settings-toggle') && !document.querySelector('.theme-picker-panel')"), true, 'Escape closes settings and restores button focus');
    await click('.theme-toggle');
    assert.equal(await evaluate(cdp, "document.documentElement.dataset.theme"), 'dark');

    if (process.env.CHANGE_TREEMAP_SCREENSHOT) await captureScreenshot(cdp, { output: process.env.CHANGE_TREEMAP_SCREENSHOT.replace('.png', '-canvas.png') });
    await click('.change-treemap-zoom-controls button', '← Zoom out');
    await waitFor(async () => await evaluate(cdp, "document.querySelector('.change-treemap-breadcrumbs [aria-current]').textContent === 'Authentication'"));
    await click('.change-treemap-zoom-controls button', 'Reset zoom');
    await waitFor(async () => await evaluate(cdp, "document.querySelectorAll('.change-treemap-zoom-controls button').length===1 && document.querySelector('.change-treemap-zoom-controls button').disabled"));
    await waitFor(async () => await evaluate(cdp, "document.querySelectorAll('.change-treemap-cell[data-depth=\"0\"]').length===3"));
    await assertBlueprintGeometry();
    assert.deepEqual(await evaluate(cdp, `[...document.querySelectorAll('.change-treemap-cell[data-treemap-kind="diagram"]')].map(e=>({color:e.dataset.treemapColor,position:e.dataset.diagramPosition}))`), identities, 'Returning from zoom restores the original diagram colors');
    await click('[aria-label="Close Treemap review · DiffTree"]');
    await waitFor(async () => await evaluate(cdp, "!document.querySelector('.change-preview-treemap-tint')"));
    await click(`[data-open-treemaps="${session.id}"]`);
    await waitForSelector(cdp, '.window-panel-tabbed .change-treemap-cell');
    assert.equal(await evaluate(cdp, `document.querySelector('.window-panel-tabbed [role=tab][aria-selected=true]').textContent`), 'Treemaps');
    assert.deepEqual(await evaluate(cdp, `[...document.querySelectorAll('.window-panel-tabbed [aria-label="Change LOC totals"] strong')].map(e=>Number(e.textContent))`), [5, 4, 1, 3]);
    await click('.window-panel-tabbed [role=tab]', 'Search');
    await waitFor(async () => await evaluate(cdp, "!document.querySelector('.change-preview-treemap-tint')"));
    await click('.window-panel-tabbed [role=tab]', 'Treemaps');
    await waitForSelector(cdp, '.window-panel-tabbed .change-treemap-cell[data-treemap-kind=diagram]');
    await click('.window-panel-tabbed .change-treemap-cell button[aria-label^="Authentication:"]');
    await waitForSelector(cdp, '.change-preview-treemap-tint');
    await captureScreenshot(cdp, { output: path.join(root, 'workspace-treemaps.png') });
    await click('[aria-label="Close Workspace tools"]');
    await waitFor(async () => await evaluate(cdp, "!document.querySelector('.change-preview-treemap-tint')"));
    await click(`[data-open-difftree="${session.id}"]`);
    await waitForSelector(cdp, '.window-panel [role=tab]');
    await click('.window-panel [role=tab]', 'Treemaps');
    await waitForSelector(cdp, '.change-treemap-summary');
    if (await evaluate(cdp, "!!document.querySelector('.window-panel-minimized')")) await click('.window-panel-header button', 'Restore');
    assert.ok(await evaluate(cdp, "document.querySelector('.treemap-notice').textContent.includes('1 binary / metadata changes')"));
    assert.equal(await evaluate(cdp, "document.querySelector('.change-treemap-switch button[aria-pressed=true]').textContent"), 'Diagrams', 'Reopening remembers diagram grouping');
    await waitForSelector(cdp, '.change-treemap-cell[data-treemap-kind=diagram]');
    assert.deepEqual(await evaluate(cdp, `[...document.querySelectorAll('.change-treemap-cell[data-treemap-kind="diagram"]')].map(e=>({color:e.dataset.treemapColor,position:e.dataset.diagramPosition}))`), identities, 'Reopening retains fixed position colors');
    await click('.change-treemap-switch button', 'Files');
    await waitFor(async () => await evaluate(cdp, "!document.querySelector('.change-preview-treemap-tint')"));
    assert.equal(await evaluate(cdp, "document.querySelectorAll('.change-treemap-cell[data-treemap-color]').length"), 0, 'Files do not inherit diagram identities');
    await click('[aria-label="Close Treemap review · DiffTree"]');
    const emptyBottom = await evaluate(cdp, `document.querySelector('[data-change-session-summary="${empty.changeSessionId}"]').getBoundingClientRect().bottom`);
    if (emptyBottom > 660) await cdp.send('Input.dispatchMouseEvent', { type: 'mouseWheel', x: 180, y: 600, deltaX: 0, deltaY: emptyBottom - 550 });
    await click(`[data-change-session-summary="${empty.changeSessionId}"]`);
    await cdp.send('Input.dispatchMouseEvent', { type: 'mouseWheel', x: 180, y: 600, deltaX: 0, deltaY: 400 });
    await waitFor(async () => await evaluate(cdp, `(() => {const e=document.querySelector('[data-open-treemaps="${empty.changeSessionId}"]');const r=e.getBoundingClientRect();return r.top>0 && r.bottom<innerHeight && e.contains(document.elementFromPoint(r.x+r.width/2,r.y+r.height/2));})()`));
    await click(`[data-open-treemaps="${empty.changeSessionId}"]`);
    await waitFor(async () => await evaluate(cdp, "document.querySelector('.change-treemap-panel')?.textContent.includes('No added or deleted text lines')")).catch(async error => { console.log('Empty session state', await evaluate(cdp, "({panel:document.querySelector('.change-treemap-panel')?.textContent, alerts:[...document.querySelectorAll('[role=alert]')].map(e=>e.textContent), sessions:[...document.querySelectorAll('[data-open-treemaps]')].map(e=>({id:e.dataset.openTreemaps,rect:e.getBoundingClientRect().toJSON()}))})")); await captureScreenshot(cdp,{output:path.join(root,'empty-error.png')}); throw error; });
    assert.equal(await evaluate(cdp, "document.querySelectorAll('.change-treemap-cell').length"), 0);
    assert.equal(requests.some(url => /diagram-edits|create-diagram|extend-diagram/.test(url)), false, 'No LLM generation calls');
    await click('.theme-toggle');
    console.log('PASS Dark/light surfaces, identity fills, LOC and layout preservation; checking reload');
    const loaded = new Promise(resolve => cdp.on('Page.loadEventFired', resolve));
    await cdp.send('Page.reload', { ignoreCache: true });
    await loaded;
    await waitForSelector(cdp, '.theme-toggle[aria-label="Switch to Current Dark"]');
    assert.equal(await evaluate(cdp, "document.documentElement.dataset.theme"), 'light', 'Theme survives reload');
    await click('.theme-settings-toggle');
    assert.deepEqual(await evaluate(cdp, "({...Object.fromEntries([...document.querySelectorAll('.theme-picker-panel input')].map((e,i)=>[['treemap','canvas','shade'][i],Number(e.value)])),scale:document.querySelector('.theme-picker-panel select').value})"), preferences, 'Both opacity settings survive reload');
    await click('.theme-settings-toggle');
    await click('.theme-toggle');
    assert.equal(await evaluate(cdp, "document.documentElement.dataset.theme"), 'dark');
    assert.equal(await evaluate(cdp, "document.activeElement.classList.contains('theme-toggle')"), true, 'Floating toggle retains keyboard focus');
    await cdp.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Enter', code: 'Enter', text: '\r', windowsVirtualKeyCode: 13 });
    await cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 });
    await waitFor(async () => await evaluate(cdp, "document.documentElement.dataset.theme==='light'"));
    assert.deepEqual(errors, []);
    console.log('PASS Deterministic subtree colors, matching non-overlapping canvas tiles, zoom/reopen stability, Blueprint grid, plain fills, independent persisted opacity sliders, flush pixel-aligned tiles, Files/Diagrams LOC, fractional allocation and unmapped area, nested zoom, full-width map without source code, direct rectangle navigation without minimizing and explicit zoom, empty/binary states, and no LLM requests');
  });
  assert.equal((await changes.get(session.id)).version, version, 'Viewing never mutates the ChangeSession');
} finally {
  if (server && server.exitCode === null) { server.kill('SIGTERM'); await new Promise(resolve => server.once('exit', resolve)); }
  await rm(root, { recursive: true, force: true });
}
