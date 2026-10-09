import { createRequire } from 'node:module';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

// Process-local opt-in: cannot be enabled by an inherited environment variable,
// saved workspace, browser request, or Vite's build configuration.
const args = process.argv.slice(2);
const flags = ['http', 'pi', 'lsp'];
for (const flag of flags) {
  const enabled = args.includes(`--${flag}`);
  globalThis[Symbol.for(`new-diagram.${flag}-enabled`)] = enabled;
  console.log(`[new-diagram] ${flag.toUpperCase()} ${enabled ? 'enabled' : `disabled (use --${flag} to enable)`}`);
}
const require = createRequire(import.meta.url);
const cli = path.join(path.dirname(require.resolve('vite/package.json')), 'bin/vite.js');
process.argv = [process.execPath, cli, ...args.filter(arg => !flags.some(flag => arg === `--${flag}`))];
await import(pathToFileURL(cli).href);
