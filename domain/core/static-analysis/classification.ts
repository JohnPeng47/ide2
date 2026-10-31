/** Shared with the architecture boundary test. Input is a repository-relative POSIX path. */
export function sourceClassification(relative: string) {
  const segments = relative.split('/');
  const [runtime, area, feature] = segments[0] === 'src' && segments[1] === 'server' ? segments.slice(1) : segments;
  const composition = runtime === 'src' && (area === 'app' || area === 'main.tsx') || runtime === 'server' && area === 'app';
  const owner = ['domain', 'application', 'infrastructure'].includes(runtime) ? area
    : area === 'features' || area === 'routes' ? feature : 'core';
  return { runtime, owner, composition, bootstrap: runtime === 'server' && area === 'app' && feature === 'bootstrap.ts' };
}
