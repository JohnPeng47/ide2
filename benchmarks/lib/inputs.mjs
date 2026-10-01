import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createHash } from 'node:crypto';
import { cp, mkdir, readFile, readdir, lstat, readlink, realpath, writeFile } from 'node:fs/promises';
import path from 'node:path';

const exec = promisify(execFile);
export const sha256 = data => createHash('sha256').update(data).digest('hex');
export const git = async (root, args) => (await exec('git', ['-C', root, ...args], { maxBuffer: 32 * 1024 * 1024 })).stdout;
const excluded = name => /(^|\/)(\.git|node_modules|dist|coverage|artifacts)(\/|$)/.test(name) || name.startsWith('benchmarks/.runs/');

export function inside(root, name) {
  if (!name || path.isAbsolute(name)) throw new Error(`Expected a relative path: ${name}`);
  const target = path.resolve(root, name);
  if (target === root || !target.startsWith(path.resolve(root) + path.sep)) throw new Error(`Path escapes its root: ${name}`);
  return target;
}

export async function inventory(root) {
  const files = [];
  async function walk(dir) {
    for (const entry of (await readdir(dir, { withFileTypes: true })).sort((a,b) => a.name.localeCompare(b.name))) {
      const full = path.join(dir, entry.name), relative = path.relative(root, full).split(path.sep).join('/');
      if (excluded(relative)) continue;
      if (entry.isDirectory()) await walk(full);
      else if (entry.isSymbolicLink()) {
        const target = await readlink(full);
        const resolved = path.resolve(path.dirname(full), target);
        if (path.isAbsolute(target) || !resolved.startsWith(path.resolve(root) + path.sep)) throw new Error(`External symlink is not a reproducible input: ${relative}`);
        files.push({ path: relative, symlink: target });
      } else if (entry.isFile()) files.push({ path: relative, sha256: sha256(await readFile(full)), mode: (await lstat(full)).mode & 0o777 });
    }
  }
  await walk(root);
  return { sha256: sha256(JSON.stringify(files)), files };
}

export async function snapshot(root, destination, ref) {
  await mkdir(destination, { recursive: true });
  const commit = (await git(root, ['rev-parse', '--verify', `${ref === 'working-tree' ? 'HEAD' : ref}^{commit}`])).trim();
  if (ref === 'working-tree') {
    const names = [...new Set((await git(root, ['ls-files', '-z', '--cached', '--others', '--exclude-standard'])).split('\0').filter(Boolean))].sort();
    for (const name of names) {
      if (excluded(name)) continue;
      const source = inside(root, name), target = inside(destination, name);
      const stat = await lstat(source).catch(error => { if (error.code === 'ENOENT') return null; throw error; });
      if (!stat) continue; // Deleted tracked files are part of the working-tree state.
      if (stat.isDirectory()) throw new Error(`Submodule/directory input needs explicit support: ${name}`);
      await mkdir(path.dirname(target), { recursive: true });
      await cp(source, target, { verbatimSymlinks: true });
    }
  } else {
    const archive = `${destination}.tar`;
    await git(root, ['archive', '--format=tar', `--output=${archive}`, commit]);
    await exec('tar', ['-xf', archive, '-C', destination]);
    const { rm } = await import('node:fs/promises'); await rm(archive);
  }
  const inputs = await inventory(destination);
  return { ref, commit, ...inputs };
}

export async function replaceFiles(app, definition, replacements) {
  const records = [];
  for (const [targetName, sourceName] of Object.entries(replacements)) {
    if (excluded(targetName) || targetName.startsWith('benchmarks/')) throw new Error(`Invalid replacement destination: ${targetName}`);
    const target = inside(app, targetName), source = inside(definition, sourceName);
    if (!(await realpath(source)).startsWith(await realpath(definition) + path.sep)) throw new Error(`Replacement symlink escapes definition: ${sourceName}`);
    // Existing parent symlinks must not turn an in-checkout replacement into an external write.
    let parent = path.dirname(target);
    while (!(await lstat(parent).catch(() => null))) parent = path.dirname(parent);
    if (parent !== app && !(await realpath(parent)).startsWith(await realpath(app) + path.sep)) throw new Error(`Replacement parent escapes app: ${targetName}`);
    const prior = await lstat(target).catch(error => { if (error.code === 'ENOENT') return null; throw error; });
    if (prior && !prior.isFile()) throw new Error(`Replacement target is not a regular file: ${targetName}`);
    const content = await readFile(source);
    records.push({ target: targetName, source: sourceName, beforeSha256: prior ? sha256(await readFile(target)) : null, afterSha256: sha256(content) });
    await mkdir(path.dirname(target), { recursive: true }); await writeFile(target, content);
  }
  return records;
}
