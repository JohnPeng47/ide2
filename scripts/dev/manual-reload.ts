import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { Plugin } from 'vite';

// Shared by all instances launched from this cwd, isolated from other worktrees.
// Keep this outside the repository so requesting a reload never changes Git state.
export function reloadTrigger(cwd = process.cwd()): string {
  const key = createHash('sha256').update(realpathSync(cwd)).digest('hex');
  const directory = path.join(tmpdir(), `new-diagram-reload-${process.getuid?.() ?? 'local'}`);
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  return path.join(directory, key);
}

export function manualReload(): Plugin {
  return {
    name: 'new-diagram-manual-reload',
    apply: 'serve',
    // Retain file watching for cache invalidation, but disable automatic updates
    // and config-triggered restarts. The websocket still reconnects on restart.
    config: () => ({ server: { hmr: false } }),
    configureServer(server) {
      const trigger = reloadTrigger();
      writeFileSync(trigger, '', { flag: 'a', mode: 0o600 });
      let lastRequest = readFileSync(trigger, 'utf8');
      server.watcher.add(trigger);
      server.watcher.on('change', async (file) => {
        if (path.resolve(file) !== trigger) return;
        const request = readFileSync(trigger, 'utf8');
        if (!request || request === lastRequest) return;
        lastRequest = request;
        server.config.logger.info('[manual-reload] Reload requested for this cwd.');
        try {
          // Also reload server-side modules/configuration and clear Vite caches.
          // Connected browsers refresh through Vite's reconnect handling.
          await server.restart();
        } catch (error) {
          server.config.logger.error(`[manual-reload] ${String(error)}`);
        }
      });
    },
  };
}
