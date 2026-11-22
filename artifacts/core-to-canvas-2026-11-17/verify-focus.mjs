// Opens an experiment output, then steps → through its diagram stops, capturing each view.
// usage: node verify-focus.mjs <runId> <cellKey> <experimentId> <outDir>
import { chromium } from 'playwright';
const [runId, cellKey, experimentId, outDir] = process.argv.slice(2);
const browser = await chromium.launch({ executablePath: process.env.CHROME });
const page = await browser.newPage({ viewport: { width: 1500, height: 950 } });
const errors = [];
page.on('pageerror', e => errors.push(e.message));
await page.goto(`http://127.0.0.1:5191/evals?run=${runId}&output=${encodeURIComponent(cellKey)}&nav=${experimentId}`);
await page.waitForSelector('.output-navigation', { timeout: 30000 });
await page.waitForSelector('.compare-canvas', { timeout: 30000 });
const steps = [];
for (let i = 0; i < 7; i++) {
  await page.waitForTimeout(1500);
  const label = await page.locator('.output-navigation span[aria-live]').innerText();
  const focus = await page.locator('.compare-canvas').first().getAttribute('data-focus-diagram');
  await page.screenshot({ path: `${outDir}/focus-${i}.png` });
  steps.push({ i, label, focus, url: page.url().replace(/^.*\?/, '?') });
  const next = page.getByRole('button', { name: 'Next' });
  if (await next.isDisabled()) break;
  await next.click();
}
console.log(JSON.stringify({ steps, errors }, null, 1));
await browser.close();
