import { test as base, type CDPSession } from '@playwright/test';
import { PhaseRecorder } from './harness/phases';
import { installCollector } from './harness/collector';
import { resetFixture, type Seeded } from './harness/fixture';

type Fixtures = { phases: PhaseRecorder; cdp: CDPSession; seeded: Seeded };
export const test = base.extend<Fixtures>({
  phases: async ({}, use, testInfo) => {
    const file = testInfo.outputPath('phases.jsonl');
    try { await use(new PhaseRecorder(file, { flow: 'F02', test: testInfo.title })); }
    finally { await testInfo.attach('phases', { path: file, contentType: 'application/x-ndjson' }); }
  },
  seeded: async ({ phases }, use) => {
    const fixture = await phases.run('fixture-preparation', () => resetFixture('normal'));
    try { await use(fixture); }
    finally { await phases.run('cleanup-fixture', () => fixture.remove()); }
  },
  page: async ({ page }, use) => {
    await page.addInitScript(installCollector);
    await use(page);
  },
  cdp: async ({ page, context }, use) => {
    const cdp = await context.newCDPSession(page);
    try { await use(cdp); } finally { await cdp.detach(); }
  },
});
export { expect } from '@playwright/test';
