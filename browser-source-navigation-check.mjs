import assert from 'node:assert/strict';

/** Runs against the disposable five-pane workspace owned by the performance runner. */
export async function checkSourceNavigation({ cdp, url, evaluate, waitFor, waitForSelector, click, pane, viewer, reload, captureScreenshot, screenshotPath }) {
  const p = pane(2), v = viewer(2);
  const open = async file => {
    await click(cdp, `${p} [data-repository-file="${file}"]`);
    await waitForSelector(cdp, `${p} [data-projected-source="${file}"] .source-code-viewer[data-highlighted=true]`, { timeoutMs: 30000 });
  };
  const symbol = async (line, name, modifiers = 2) => {
    const point = await evaluate(cdp, `(() => {
      const code = document.querySelector(${JSON.stringify(v + ' [data-line="' + line + '"] code[data-source-text]')});
      const walk = document.createTreeWalker(code, NodeFilter.SHOW_TEXT);
      while (walk.nextNode()) {
        const n = walk.currentNode, index = n.textContent.indexOf(${JSON.stringify(name)});
        if (index < 0) continue;
        const range = document.createRange(); range.setStart(n, index + 1); range.setEnd(n, index + 2);
        const r = range.getBoundingClientRect();
        const x = r.left + r.width / 2, y = r.top + r.height / 2;
        if (!code.contains(document.elementFromPoint(x, y))) throw new Error('Symbol is occluded');
        return { x, y };
      }
      throw new Error('Symbol not found');
    })()`);
    await cdp.send('Input.dispatchMouseEvent', { type: 'mousePressed', ...point, button: 'left', buttons: 1, clickCount: 1, modifiers });
    await cdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', ...point, button: 'left', clickCount: 1, modifiers });
  };
  console.log('Navigation: collapsed explorer, lazy directories, same-pane files');
  assert.equal(await evaluate(cdp, `document.querySelectorAll('.repository-file-explorer').length`), 0);
  const otherPaths = await evaluate(cdp, `Array.from(document.querySelectorAll('[data-projected-source]')).filter(el => el.closest('[data-display-node]').dataset.displayNode !== 'source-2').map(el => el.dataset.projectedSource)`);
  await click(cdp, `${p} .mapping-source-toolbar button:first-child`);
  await click(cdp, `${p} [aria-label="Toggle repository files"]`);
  await waitForSelector(cdp, `${p} [data-directory="src"]`);
  assert.equal(await evaluate(cdp, `document.querySelector(${JSON.stringify(p + ' [data-repository-file="src/main.ts"]')}) === null`), true);
  await click(cdp, `${p} [data-directory="src"]`);
  await waitForSelector(cdp, `${p} [data-repository-file="src/main.ts"]`);
  await open('src/main.ts');
  assert.equal(await evaluate(cdp, `document.querySelector(${JSON.stringify(p + ' .mapping-source-toolbar button')}).disabled`), true);
  console.log('Navigation: real Ctrl+click across imports and UTF-16 positions');
  // Close the sidebar for code-width hit testing; selected file remains in the same pane.
  await click(cdp, `${p} [aria-label="Toggle repository files"]`);
  await symbol(3, 'double');
  await waitForSelector(cdp, `${p} [data-projected-source="src/math.ts"] .source-code-viewer[data-highlighted=true]`, { timeoutMs: 30000 });
  await waitFor(async () => await evaluate(cdp, 'window.getSelection()?.toString()') === 'double');
  await click(cdp, `${p} [aria-label="Back in source history"]`);
  await waitForSelector(cdp, `${p} [data-projected-source="src/main.ts"] .source-code-viewer[data-highlighted=true]`);
  await click(cdp, `${p} [aria-label="Forward in source history"]`);
  await waitForSelector(cdp, `${p} [data-projected-source="src/math.ts"] .source-code-viewer[data-highlighted=true]`);
  await click(cdp, `${p} [aria-label="Back in source history"]`);
  await waitForSelector(cdp, `${p} [data-projected-source="src/main.ts"] .source-code-viewer[data-highlighted=true]`);
  console.log('Navigation: F12 same-file definition and folded cross-file destination');
  await symbol(5, 'local', 0);
  await cdp.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'F12', code: 'F12', windowsVirtualKeyCode: 123 });
  await cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'F12', code: 'F12', windowsVirtualKeyCode: 123 });
  await waitFor(async () => await evaluate(cdp, 'window.getSelection()?.toString()') === 'local');
  await symbol(6, 'context12');
  await waitForSelector(cdp, `${p} [data-projected-source="src/large.ts"] .source-code-viewer[data-highlighted=true]`);
  await waitFor(async () => await evaluate(cdp, 'window.getSelection()?.toString()') === 'context12', { message: 'Definition inside a compaction must expand and select original source' });
  await click(cdp, `${p} [aria-label="Back in source history"]`);
  await waitForSelector(cdp, `${p} [data-projected-source="src/main.ts"] .source-code-viewer[data-highlighted=true]`);
  console.log('Navigation: history restores the scrolled viewport');
  const wheelPoint = await evaluate(cdp, `(() => { const r = document.querySelector(${JSON.stringify(v)}).getBoundingClientRect(); return {x: r.left + 80, y: r.top + 80}; })()`);
  await cdp.send('Input.dispatchMouseEvent', { type: 'mouseWheel', ...wheelPoint, deltaX: 0, deltaY: 450 });
  await waitFor(async () => await evaluate(cdp, `document.querySelector(${JSON.stringify(v)}).scrollTop > 400`));
  const historyTop = await evaluate(cdp, `document.querySelector(${JSON.stringify(v)}).scrollTop`);
  await click(cdp, `${p} [aria-label="Toggle repository files"]`);
  await waitForSelector(cdp, `${p} [data-directory="src"]`);
  await click(cdp, `${p} [data-directory="src"]`);
  await waitForSelector(cdp, `${p} [data-repository-file="src/math.ts"]`);
  await open('src/math.ts');
  await click(cdp, `${p} [aria-label="Back in source history"]`);
  await waitForSelector(cdp, `${p} [data-projected-source="src/main.ts"] .source-code-viewer[data-highlighted=true]`);
  await waitFor(async () => await evaluate(cdp, `document.querySelector(${JSON.stringify(v)}).scrollTop === ${historyTop}`), { message: 'Back must restore the previous scroll offset, including after a definition jump' });
  console.log('Navigation: save/reload arbitrary file and default-collapsed explorer');
  await click(cdp, '.mapping-workspace-actions button:first-child');
  await waitFor(async () => (await (await fetch(`${url}/api/mapping/workspace`)).json()).documents[0].canvas.display.nodes['source-2'].content.sourceFile === 'src/main.ts');
  const saved = await (await fetch(`${url}/api/mapping/workspace`)).json();
  assert.equal(saved.schemaVersion, 3);
  assert.equal(saved.documents[0].canvas.display.nodes['source-2'].content.files.length, 1);
  await reload(cdp);
  await waitForSelector(cdp, `${p} [data-projected-source="src/main.ts"] .source-code-viewer[data-highlighted=true]`);
  assert.equal(await evaluate(cdp, `document.querySelectorAll('.repository-file-explorer').length`), 0);
  assert.deepEqual(await evaluate(cdp, `Array.from(document.querySelectorAll('[data-projected-source]')).filter(el => el.closest('[data-display-node]').dataset.displayNode !== 'source-2').map(el => el.dataset.projectedSource)`), otherPaths);
  await click(cdp, `${p} [aria-label="Toggle repository files"]`);
  await waitForSelector(cdp, `${p} [data-directory="src"]`);
  await click(cdp, `${p} [data-directory="src"]`);
  await waitForSelector(cdp, `${p} [data-repository-file="src/main.ts"]`);
  await captureScreenshot(cdp, { output: screenshotPath });
  console.log('Source explorer and real language-server navigation checks passed');
}
