import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, rm, symlink, access } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { git, snapshot, replaceFiles } from '../lib/inputs.mjs';

test('working-tree snapshots preserve edits, additions and deletions; Git refs exclude them',async()=>{
  const temp=await mkdtemp(path.join(tmpdir(),'benchmark-input-test-'));
  try {
    const root=path.join(temp,'repo');await mkdir(root);await git(root,['init','-q']);
    await writeFile(path.join(root,'component.ts'),'committed');await writeFile(path.join(root,'deleted.ts'),'old');
    await writeFile(path.join(root,'.gitignore'),'node_modules/\nbenchmarks/.runs/\n');
    await git(root,['add','.']);await git(root,['-c','user.name=Benchmark Test','-c','user.email=benchmark@example.invalid','commit','-qm','fixture']);
    await writeFile(path.join(root,'component.ts'),'edited');await writeFile(path.join(root,'new.ts'),'untracked');await rm(path.join(root,'deleted.ts'));
    await mkdir(path.join(root,'benchmarks/.runs'),{recursive:true});await writeFile(path.join(root,'benchmarks/.runs/large.bin'),'exclude');
    const working=await snapshot(root,path.join(temp,'working'),'working-tree'),pinned=await snapshot(root,path.join(temp,'pinned'),'HEAD');
    assert.equal(await readFile(path.join(temp,'working/component.ts'),'utf8'),'edited');
    assert.equal(await readFile(path.join(temp,'working/new.ts'),'utf8'),'untracked');
    await assert.rejects(access(path.join(temp,'working/deleted.ts')));
    await assert.rejects(access(path.join(temp,'working/benchmarks/.runs/large.bin')));
    assert.equal(await readFile(path.join(temp,'pinned/component.ts'),'utf8'),'committed');
    assert.equal(await readFile(path.join(temp,'pinned/deleted.ts'),'utf8'),'old');
    await assert.rejects(access(path.join(temp,'pinned/new.ts')));assert.notEqual(working.sha256,pinned.sha256);assert.equal(working.commit,pinned.commit);
  } finally {await rm(temp,{recursive:true,force:true});}
});

test('replacement files stay inside the app and definition, including symlink parents',async()=>{
  const temp=await mkdtemp(path.join(tmpdir(),'benchmark-replace-test-'));
  try {
    const app=path.join(temp,'app'),definition=path.join(temp,'definition');await mkdir(app);await mkdir(definition);
    await writeFile(path.join(definition,'component.ts'),'variant');await writeFile(path.join(app,'component.ts'),'baseline');
    const records=await replaceFiles(app,definition,{'component.ts':'./component.ts'});assert.notEqual(records[0].beforeSha256,records[0].afterSha256);
    assert.equal(await readFile(path.join(app,'component.ts'),'utf8'),'variant');
    await assert.rejects(replaceFiles(app,definition,{'../outside.ts':'./component.ts'}),/escapes/);
    await assert.rejects(replaceFiles(app,definition,{'component.ts':'../outside.ts'}),/escapes/);
    await symlink(temp,path.join(app,'escape'));await assert.rejects(replaceFiles(app,definition,{'escape/outside.ts':'./component.ts'}),/escapes/);
    await writeFile(path.join(temp,'outside.ts'),'protected');await symlink(path.join(temp,'outside.ts'),path.join(definition,'escape.ts'));
    await assert.rejects(replaceFiles(app,definition,{'component.ts':'./escape.ts'}),/escapes/);
    assert.equal(await readFile(path.join(temp,'outside.ts'),'utf8'),'protected');
  } finally {await rm(temp,{recursive:true,force:true});}
});
