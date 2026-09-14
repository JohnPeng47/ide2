import { createRequire } from 'node:module';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

// Process-local opt-in: cannot be enabled by an inherited environment variable,
// saved workspace, browser request, or Vite's build configuration.
const args = process.argv.slice(2);
const enabled = args.includes('--lsp');
globalThis[Symbol.for('new-diagram.lsp-enabled')] = enabled;
const require = createRequire(import.meta.url);
const cli = path.join(path.dirname(require.resolve('vite/package.json')), 'bin/vite.js');
process.argv = [process.execPath, cli, ...args.filter(arg => arg !== '--lsp')];
console.log(`[new-diagram] LSP ${enabled ? 'enabled (starts on first definition lookup)' : 'disabled (use --lsp to enable)'}`);
await import(pathToFileURL(cli).href);
