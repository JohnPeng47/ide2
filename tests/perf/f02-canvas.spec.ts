import { test, expect } from './fixtures';
import { act, gesture, line, paced, cadence, stableCanvas, type Point } from './harness/actions';
import { arch, cpus, platform, loadavg } from 'node:os';
import { execFileSync } from 'node:child_process';

const ACTIVE = '.mapping-document-view:not([hidden])';
const SHAPE = `${ACTIVE} [data-grid-box="d3"]`;
const EDGE = `${ACTIVE} [data-connection-id="d3-d4"] .diagram-connection-hit`;
const CONNECTION = `${ACTIVE} [data-connection-id="d3-d4"]`;
const SUBTREE_ROW = `${ACTIVE} [data-native-node="grid:d3"] [data-content-node-id][data-source-line="4"]`;
const TOGGLE = `${ACTIVE} [data-subtree-owner="grid:d3"][data-subtree-line="3"]`;
const CAMERA = `${ACTIVE} .mapping-editor-overlay`;
const TRIALS = 6; // trial zero is retained in artifacts, excluded from aggregates

for (let trial = 0; trial < TRIALS; trial++) {
  test(`F02 trial ${trial}${trial === 0 ? ' (warm-up)' : ''}`, async ({ page, browser, phases, seeded }, testInfo) => {
    const samples: Record<string, unknown> = { trial, warmup: trial === 0, fixture: seeded.description,
      browser: browser.version(), viewport: testInfo.project.use.viewport, build: 'production',
      machine: { platform: platform(), arch: arch(), cpu: cpus()[0]?.model, logicalCpus: cpus().length, loadavg: loadavg() },
      revision: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(),
      frameBudgetMs: 16.7, settleDefinition: 'predicate true with identical geometry for three consecutive rAF observations' };
    const errors: string[] = [];
    page.on('pageerror', error => errors.push(String(error)));
    const transform = () => page.locator(CAMERA).evaluate(el => (el as HTMLElement).style.transform);
    const edgePath = () => page.locator(EDGE).getAttribute('d');
    const fit = async () => {
      await page.locator(ACTIVE).getByRole('button', { name: 'Fit canvas', exact: true }).click();
      await stableCanvas(page, CAMERA);
    };
    try {
      await phases.run('scenario-preparation', async () => {
        await page.goto(seeded.canvasUrl);
        await expect(page.locator(`${ACTIVE} [data-native-node^="grid:"] pre`)).toHaveCount(6);
        await page.evaluate(() => document.fonts.ready);
        await fit();
        await expect(page.locator(SUBTREE_ROW)).toBeVisible();
        await expect(page.locator(EDGE)).toBeAttached();
        await expect(page.locator(CONNECTION)).toHaveAttribute('data-connection-status', 'resolved');
      });

      const empty = await phases.run('prepare:pan', async () => {
        await page.locator(ACTIVE).getByRole('button', { name: 'Pan', exact: true }).click();
        return page.locator(`${ACTIVE} [data-diagram-canvas]`).evaluate(element => {
          const r = element.getBoundingClientRect();
          for (let y = r.bottom - 100; y > r.top + 100; y -= 50) {
            for (let x = r.left + 100; x < r.right - 220; x += 50) {
              const hit = document.elementFromPoint(x, y);
              if (hit && element.contains(hit) && !hit.closest('[data-native-node],button,input,[role=button]')) return [x, y] as Point;
            }
          }
          throw Error('No blank canvas gesture origin');
        });
      });
      const cameraBeforePan = await transform();
      samples.pan = await phases.run('interaction:pan', () => gesture(page, async () => {
        await page.mouse.move(...empty); await page.mouse.down();
        try { return await paced(page, line(empty, [empty[0] + 120, empty[1] - 80], 60)); }
        finally { await page.mouse.up(); }
      }));
      await expect.poll(transform).not.toBe(cameraBeforePan);

      await phases.run('prepare:zoom', async () => {
        await fit();
        const box = (await page.locator(SHAPE).boundingBox())!;
        await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
      });
      const cameraBeforeZoom = await transform();
      samples.zoom = await phases.run('interaction:zoom', () => gesture(page, async () => {
        await page.keyboard.down('Control');
        try { return await cadence(20, () => page.mouse.wheel(0, -12)); }
        finally { await page.keyboard.up('Control'); }
      }));
      await expect.poll(transform).not.toBe(cameraBeforeZoom);

      await phases.run('prepare:drag', async () => {
        await fit();
        await page.locator(ACTIVE).getByRole('button', { name: 'Select', exact: true }).click();
      });
      const box = (await page.locator(SHAPE).boundingBox())!;
      const grid = await page.locator(SHAPE).evaluate(el => ({
        column: Number((el as HTMLElement).dataset.gridColumn), row: Number((el as HTMLElement).dataset.gridRow),
        columns: Number((el as HTMLElement).dataset.gridColumns), rows: Number((el as HTMLElement).dataset.gridRows),
      }));
      const cellX = box.width / grid.columns, cellY = box.height / grid.rows;
      const delta: Point = [7 * cellX, 4 * cellY];
      const grab: Point = [box.x + box.width - 3, box.y + box.height - 4];
      const drop: Point = [grab[0] + delta[0], grab[1] + delta[1]];
      const edgeBeforeDrag = await edgePath();
      samples.drag = await phases.run('interaction:drag', async () => {
        await page.mouse.move(...grab); await page.mouse.down();
        try {
          const frames = await gesture(page, () => paced(page, line(grab, drop, 40)));
          expect(await edgePath(), 'Edge follows while pointer is still held').not.toBe(edgeBeforeDrag);
          const release = await act(page, `() => {
            const el = document.querySelector(${JSON.stringify(SHAPE)});
            const r = el?.getBoundingClientRect();
            const d = document.querySelector(${JSON.stringify(EDGE)})?.getAttribute('d');
            return r && Number(el.dataset.gridColumn) === ${grid.column + 7}
              && Number(el.dataset.gridRow) === ${grid.row + 4}
              && Math.abs(r.x - ${box.x + delta[0]}) < 2 && Math.abs(r.y - ${box.y + delta[1]}) < 2
              && d && d !== ${JSON.stringify(edgeBeforeDrag)} && [r.x, r.y, r.width, r.height, d];
          }`, () => page.mouse.up(), 'pointerup');
          return { frames, release };
        } finally { await page.mouse.up(); }
      });

      const foldPredicate = (folded: boolean, before: string | null) => `() => {
        const row = document.querySelector(${JSON.stringify(SUBTREE_ROW)});
        const connection = document.querySelector(${JSON.stringify(CONNECTION)});
        const d = document.querySelector(${JSON.stringify(EDGE)})?.getAttribute('d');
        const r = document.querySelector(${JSON.stringify(SHAPE)})?.getBoundingClientRect();
        return ${folded ? '!row' : '!!row'} && r && d && d !== ${JSON.stringify(before)}
          && connection?.getAttribute('data-connection-status') === '${folded ? 'proxy' : 'resolved'}'
          && [r.x, r.y, r.width, r.height, d];
      }`;
      const edgeBeforeFold = await edgePath();
      samples.fold = await phases.run('interaction:fold', () => act(page, foldPredicate(true, edgeBeforeFold),
        () => page.locator(TOGGLE).click()));
      await expect(page.locator(SUBTREE_ROW)).toHaveCount(0);
      const edgeFolded = await edgePath();
      samples.unfold = await phases.run('interaction:unfold', () => act(page, foldPredicate(false, edgeFolded),
        () => page.locator(TOGGLE).click()));
      await expect(page.locator(SUBTREE_ROW)).toBeVisible();

      await phases.run('inspect-result', async () => {
        // Check actual SVG/DOM attachment, not just a changed path string.
        await expect.poll(() => page.evaluate(({ edge, row }) => {
          const path = document.querySelector(edge) as SVGPathElement;
          const r = document.querySelector(row)!.getBoundingClientRect();
          const p = path.getPointAtLength(0).matrixTransform(path.getScreenCTM()!);
          return p.x >= r.left - 1 && p.x <= r.right + 1 && p.y >= r.top - 1 && p.y <= r.bottom + 1
            && Math.min(Math.abs(p.x - r.left), Math.abs(p.x - r.right), Math.abs(p.y - r.top), Math.abs(p.y - r.bottom)) < 1;
        }, { edge: EDGE, row: SUBTREE_ROW })).toBe(true);
        expect(errors).toEqual([]);
        await testInfo.attach('canvas', { body: await page.screenshot(), contentType: 'image/png' });
      });
      samples.completed = true;
    } finally {
      await testInfo.attach('f02-samples', { body: JSON.stringify({ ...samples, errors, lastCompletedPhase: phases.lastCompleted }, null, 2),
        contentType: 'application/json' });
    }
  });
}
