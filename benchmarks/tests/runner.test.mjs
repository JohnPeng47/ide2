import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { cp, mkdtemp, mkdir, writeFile, readFile, readdir, rm, access } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { git } from '../lib/inputs.mjs';
const exec=promisify(execFile);

test('runner builds isolated baseline/candidate, archives inputs, and records build failure',async()=>{
  const root=await mkdtemp(path.join(tmpdir(),'benchmark-runner-test-'));
  try {
    await mkdir(path.join(root,'benchmarks/lib'),{recursive:true});await mkdir(path.join(root,'benchmarks/example/src'),{recursive:true});
    await cp(new URL('../runner.mjs',import.meta.url),path.join(root,'benchmarks/runner.mjs'));
    await cp(new URL('../lib/inputs.mjs',import.meta.url),path.join(root,'benchmarks/lib/inputs.mjs'));
    await cp(new URL('../lib/compare.mjs',import.meta.url),path.join(root,'benchmarks/lib/compare.mjs'));
    await writeFile(path.join(root,'.gitignore'),'node_modules/\nbenchmarks/.runs/\n');
    await writeFile(path.join(root,'package.json'),JSON.stringify({name:'benchmark-fixture',version:'1.0.0',type:'module',scripts:{build:'node build.mjs'}}));
    await writeFile(path.join(root,'package-lock.json'),JSON.stringify({name:'benchmark-fixture',version:'1.0.0',lockfileVersion:3,requires:true,packages:{'':{name:'benchmark-fixture',version:'1.0.0'}}}));
    await writeFile(path.join(root,'component.js'),'export default "baseline";');
    await writeFile(path.join(root,'build.mjs'),'import value from "./component.js"; console.log("BUILT:"+value);');
    await writeFile(path.join(root,'benchmarks/example/src/component.js'),'export default "candidate";');
    const config=`export default {baseRef:'working-tree',replacements:{'component.js':'./src/component.js'},build:['npm','run','build'],tests:[],parameters:{}};`;
    await writeFile(path.join(root,'benchmarks/example/build.mjs'),config);
    await git(root,['init','-q']);await git(root,['add','.']);await git(root,['-c','user.name=Benchmark Test','-c','user.email=benchmark@example.invalid','commit','-qm','fixture']);
    await exec(process.execPath,['benchmarks/runner.mjs','example','--build-only'],{cwd:root});
    const runs=path.join(root,'benchmarks/.runs'),first=path.join(runs,(await readdir(runs))[0]);
    const manifest=JSON.parse(await readFile(path.join(first,'manifest.json'),'utf8'));
    assert.equal(manifest.status,'passed');assert.equal(manifest.variants.candidate.replacements.length,1);
    assert.match(await readFile(path.join(first,'baseline/build.log'),'utf8'),/BUILT:baseline/);
    assert.match(await readFile(path.join(first,'candidate/build.log'),'utf8'),/BUILT:candidate/);
    assert.equal(await readFile(path.join(root,'component.js'),'utf8'),'export default "baseline";');
    await access(path.join(first,'app-source.tar.gz'));await assert.rejects(access(path.join(first,'work')));
    await writeFile(path.join(root,'benchmarks/example/src/component.js'),'throw Error("intentional failure"); export default null;');
    await assert.rejects(exec(process.execPath,['benchmarks/runner.mjs','example','--build-only'],{cwd:root}));
    const second=path.join(runs,(await readdir(runs)).find(p=>path.join(runs,p)!==first));
    assert.equal(JSON.parse(await readFile(path.join(second,'manifest.json'),'utf8')).status,'failed');
    await assert.rejects(access(path.join(second,'work')));assert.match(await readFile(path.join(second,'candidate/build.log'),'utf8'),/intentional failure/);
  } finally {await rm(root,{recursive:true,force:true});}
});
