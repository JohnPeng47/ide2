import { randomUUID } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import { reloadTrigger } from './manual-reload';

writeFileSync(reloadTrigger(), randomUUID(), { mode: 0o600 });
console.log(`Requested reload of all Vite dev servers started from ${process.cwd()}.`);
