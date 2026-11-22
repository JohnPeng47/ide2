// Install one per-user collector and one five-minute poll job; no model generations.
import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
const root = fileURLToPath(new URL('../..', import.meta.url));
const installation = path.join(homedir(), '.local/share/new-diagram-usage');
const database = process.env.NEW_DIAGRAM_USAGE_DB || path.join(homedir(), '.local/share/new-diagram/codex-usage.sqlite');
const codexHome = process.env.CODEX_HOME || path.join(homedir(), '.codex');
const searchPath = `${path.dirname(process.execPath)}:/usr/local/bin:/usr/bin:/bin`;
const quote = value => `'${value.replaceAll("'", "'\\''")}'`;
const unitQuote = value => `"${value.replaceAll('\\', '\\\\').replaceAll('"', '\\"').replaceAll('%', '%%')}"`;
mkdirSync(installation, { recursive: true, mode: 0o700 });
await build({ entryPoints: [path.join(root, 'scripts/usage/collector.ts')], outfile: path.join(installation, 'collector.mjs'), bundle: true, platform: 'node', format: 'esm', target: 'node22', logLevel: 'warning' });
const units = path.join(homedir(), '.config/systemd/user'); mkdirSync(units, { recursive: true });
writeFileSync(path.join(units, 'new-diagram-usage.service'), `[Unit]
Description=Collect Codex agent token usage for New Diagram

[Service]
Type=simple
ExecStart=${unitQuote(process.execPath)} ${unitQuote(path.join(installation, 'collector.mjs'))} watch
Environment=${unitQuote('PATH=' + searchPath)}
Environment=${unitQuote('CODEX_HOME=' + codexHome)}
Environment=${unitQuote('NEW_DIAGRAM_USAGE_DB=' + database)}
Restart=on-failure
RestartSec=5
UMask=0077

[Install]
WantedBy=default.target
`);
let existing = '';
try { existing = execFileSync('crontab', ['-l'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }); }
catch (error) { if (!String(error.stderr).includes('no crontab')) throw error; }
const marker = '# new-diagram-codex-usage';
const entry = `*/5 * * * * PATH=${quote(searchPath)} CODEX_HOME=${quote(codexHome)} NEW_DIAGRAM_USAGE_DB=${quote(database)} /usr/bin/flock -n ${quote(path.join(installation, 'poll.lock'))} ${quote(process.execPath)} ${quote(path.join(installation, 'collector.mjs'))} poll > ${quote(path.join(installation, 'poll.log'))} 2>&1 ${marker}`;
const preserved = existing.split('\n').filter(line => !line.endsWith(marker));
execFileSync('crontab', ['-'], { input: [...preserved, entry, ''].join('\n') });
execFileSync('systemctl', ['--user', 'daemon-reload']);
execFileSync('systemctl', ['--user', 'enable', '--now', 'new-diagram-usage.service'], { stdio: 'inherit' });
execFileSync('systemctl', ['--user', 'restart', 'new-diagram-usage.service']);
execFileSync(process.execPath, [path.join(installation, 'collector.mjs'), 'poll'], { env: { ...process.env, PATH: searchPath, CODEX_HOME: codexHome, NEW_DIAGRAM_USAGE_DB: database }, stdio: 'inherit', timeout: 40000 });
console.log(`Installed five-minute budget polling and automatic token collection. Database: ${database}`);
