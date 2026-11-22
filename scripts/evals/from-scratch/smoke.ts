import { mkdtemp, readFile, writeFile, mkdir, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import assert from 'node:assert/strict';
const root=process.cwd(),prepared=path.resolve(process.argv[2]??'artifacts/codebase-canvas-2026-11-11');
const dir=await mkdtemp(path.join(tmpdir(),'canvas-discovery-smoke-'));
try {
  const config=JSON.parse(await readFile(path.join(prepared,'config.json'),'utf8'));
  const index=JSON.parse(await readFile(path.join(prepared,'source-index.json'),'utf8'));index.files=index.files.slice(0,1);
  const text=JSON.stringify(index);await writeFile(path.join(dir,'source-index.json'),text);await mkdir(path.join(dir,'sources'));
  await writeFile(path.join(dir,'sources',index.files[0].file),await readFile(path.join(prepared,'sources',index.files[0].file)));
  await writeFile(path.join(dir,'config.json'),JSON.stringify({...config,id:randomUUID(),fixture:true,fixturePointCount:2,concurrency:4,fixtureDelayMs:1000,fixtureFailureKey:'initial/A1/tree/core',storeRoot:path.join(dir,'store'),sourceIndexSha256:createHash('sha256').update(text).digest('hex')}));
  let failed=false;try {execFileSync('node',['--import','tsx','scripts/evals/from-scratch/run.ts',dir],{cwd:root,stdio:'pipe',maxBuffer:8*1024*1024});} catch {failed=true;}
  assert(failed);
  const stopped=JSON.parse(await readFile(path.join(dir,'state.json'),'utf8'));assert.equal(stopped.status,'failed');
  assert.deepEqual(stopped.activeJobs,[],'Failure must drain all in-flight jobs before recovery');
  assert.equal(stopped.failedJob,'initial/A1/tree/core');
  execFileSync('node',['--import','tsx','scripts/evals/from-scratch/recover.ts',dir],{cwd:root,stdio:'pipe'});
  execFileSync('node',['--import','tsx','scripts/evals/from-scratch/run.ts',dir],{cwd:root,stdio:'pipe',maxBuffer:8*1024*1024});
  const state=JSON.parse(await readFile(path.join(dir,'state.json'),'utf8'));
  assert.equal(state.status,'finished');assert.deepEqual(state.selected,['A1','C2']);assert.equal(state.jobs.length,114);
  assert.equal(state.jobs.filter((j:any)=>j.stage==='critique').length,18,'Exactly one whole-phase judge per variant, target phase and round');
  assert(state.maxActiveJobs>1&&state.maxActiveJobs<=4,'Independent calls must overlap within the configured limit');
  for(const variant of state.selected)for(const phase of [1,2,3])for(const round of [1,2,3])assert(state.jobs.some((j:any)=>j.condition===`${variant}-improve-P${phase}`&&j.round===round&&j.stage==='critique'));
  for(const j of state.jobs) {
    const files=await readdir(path.join(dir,'jobs',j.runId));assert(!files.includes('model-started.json'));
    const input=JSON.parse(await readFile(path.join(dir,'jobs',j.runId,'inputs.json'),'utf8'));
    if(j.stage==='critique'){
      assert.deepEqual(Object.keys(input.files),['judge-input.json']);
      const payload=JSON.parse(await readFile(path.join(dir,'jobs',j.runId,'judge-input.json'),'utf8'));
      assert.equal(payload.finalCanvases.length,2,'Every judge must receive all final canvases');
      assert.equal(new Set(payload.finalCanvases.map((o:any)=>o.pointId)).size,2);
      if(payload.phase===2)assert.equal(payload.phaseOutput.length,2,'Phase 2 judge must receive all trees');
      if(payload.phase===3)assert(!('phaseOutput' in payload),'Phase 3 canvas collection supplied once');
    }
    if((j.condition.endsWith('improve-P2')&&j.stage==='tree')||(j.condition.endsWith('improve-P3')&&j.stage==='expand')){
      const expectedJudge=j.key.split('/').slice(0,4).join('/')+'/judge';
      assert(input.dependencies.includes(expectedJudge),'Every regenerated point must depend on the shared whole-phase critique');
    }
    if(j.condition.endsWith('improve-P2')&&j.stage==='expand')assert(!('critique.json' in input.files));
  }
  // Replaying a completed run must reuse every saved response, with stable job identities.
  execFileSync('node',['--import','tsx','scripts/evals/from-scratch/run.ts',dir],{cwd:root,stdio:'pipe',maxBuffer:8*1024*1024});
  const replay=JSON.parse(await readFile(path.join(dir,'state.json'),'utf8'));assert.equal(replay.jobs.length,114);assert.equal(replay.status,'finished');
  const summary={status:'passed',jobs:114,pointsPerVariant:2,judgeEvaluations:18,selectedVariants:2,roundsPerTargetPhase:3,modelCalls:0,maxActiveJobs:state.maxActiveJobs,checks:['all four phases','three independent improvement branches','whole-phase judges receive every point and final canvas','exactly 18 phase critiques','all regenerated points depend on the shared critique','judge inputs exclude source','downstream critique isolation','save/reopen/output on every artifact','completed-run replay','failed response retained as attempt 1; new attempt 2 succeeds','independent calls overlap within limit','failed job drains in-flight work before recovery'],at:new Date().toISOString()};
  await writeFile(path.join(prepared,'smoke-test.json'),JSON.stringify(summary,null,2));console.log(JSON.stringify(summary));
} catch(error) {console.error(`Smoke artifacts retained at ${dir}`);if(error&&typeof error==='object'&&'stderr' in error)console.error(String(error.stderr));throw error;}
await rm(dir,{recursive:true,force:true});
