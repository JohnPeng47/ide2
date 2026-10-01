import { spawn } from 'node:child_process';
import { cp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { createWriteStream } from 'node:fs';
import { once } from 'node:events';
import { cpus, platform, release } from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { git, inside, inventory, replaceFiles, sha256, snapshot } from './lib/inputs.mjs';
import { compareReports } from './lib/compare.mjs';

const root = path.resolve(fileURLToPath(new URL('..', import.meta.url)));
const args = process.argv.slice(2);
if (!args.length || args.includes('--help')) {
  console.log(`Usage: node benchmarks/runner.mjs <benchmark> [options]
  --ref <git-ref|working-tree>  App baseline (default: benchmark's baseRef)
  --trials <n>                 Override measurement repetitions
  --profile                   Extra CPU-profile pass, separate from timing trials
  --candidate-first           Reverse execution order to investigate order effects
  --build-only                Build both variants without browser tests
  --keep-builds               Retain isolated source trees and node_modules

Example: npm run benchmark -- code-panes-render --trials 3
CHROME_PATH may specify Chrome/Chromium. Results go to benchmarks/.runs/.`);
  process.exit(0);
}
const name = args.shift();
if (!/^[a-z0-9][a-z0-9-]*$/.test(name)) throw new Error('Invalid benchmark name');
const options = {};
while (args.length) {
  const flag = args.shift();
  if (['--ref', '--trials'].includes(flag)) { const value=args.shift(); if (!value || value.startsWith('--')) throw new Error(`Missing value: ${flag}`); options[flag.slice(2)] = value; }
  else if (['--profile', '--candidate-first', '--build-only', '--keep-builds'].includes(flag)) options[flag.slice(2)] = true;
  else throw new Error(`Unknown option: ${flag}`);
}
if (options.trials && (!Number.isInteger(Number(options.trials)) || Number(options.trials) < 1)) throw new Error('--trials must be a positive integer');
const definitionSource = inside(path.join(root, 'benchmarks'), name);
const runId = `${new Date().toISOString().replaceAll(':','-')}-${name}-${process.pid}`;
const directory = path.join(root, 'benchmarks/.runs', runId), work = path.join(directory, 'work');
await mkdir(work, { recursive: true });
// Freeze harness and replacements independently of the chosen app Git ref.
await mkdir(path.join(directory, 'definition'));
for (const entry of await readdir(path.join(root, 'benchmarks'))) if (entry !== '.runs') {
  await cp(path.join(root, 'benchmarks', entry), path.join(directory, 'definition', entry), { recursive: true });
}
const definition = path.join(directory, 'definition', name);
const config = (await import(pathToFileURL(path.join(definition, 'build.mjs')).href)).default;
if (!Array.isArray(config.build) || !config.build.length || !Array.isArray(config.tests) || !config.replacements) throw new Error('Invalid benchmark build.mjs');
for (const test of config.tests) inside(definition, test);
const parameters = { ...config.parameters, ...(options.trials ? { trials: Number(options.trials) } : {}) };
const manifest = { schemaVersion: 1, name, runId, startedAt: new Date().toISOString(), status: 'running', options, parameters,
  environment: { node: process.version, platform: platform(), release: release(), cpu: cpus()[0]?.model, logicalCpus: cpus().length },
  order: options['candidate-first'] ? ['candidate','baseline'] : ['baseline','candidate'], variants: {} };
const save = () => writeFile(path.join(directory, 'manifest.json'), JSON.stringify(manifest, null, 2));
let child, interrupted=false;
async function command(argv, cwd, logFile, env={}) {
  if(interrupted)throw new Error('Benchmark interrupted');
  const log=createWriteStream(logFile); const started=Date.now();
  try {
    child=spawn(argv[0], argv.slice(1), {cwd, env:{...process.env,...env}, stdio:['ignore','pipe','pipe'], detached:process.platform!=='win32'});
    child.stdout.pipe(log,{end:false});child.stderr.pipe(log,{end:false});
    const [code, signal]=await once(child,'close');
    if(code!==0||interrupted)throw new Error(`${argv.join(' ')} failed (${interrupted?'interrupted':signal??code}). See ${logFile}`);
    return Date.now()-started;
  } finally {child=undefined;log.end();await once(log,'finish');}
}
function stop() {
  if (!child?.pid) return;
  try { if(process.platform==='win32')child.kill('SIGTERM');else process.kill(-child.pid,'SIGTERM'); } catch {}
}
const onSignal = () => {
  interrupted=true;const pid=child?.pid;stop();
  if(pid&&process.platform!=='win32')setTimeout(()=>{try{process.kill(-pid,'SIGKILL');}catch{}},5000).unref();
};
process.on('SIGINT', onSignal);process.on('SIGTERM', onSignal);
console.log(`Benchmark: ${name}\nResults: ${directory}`);
try {
  const baseRef = options.ref ?? config.baseRef ?? 'working-tree';
  manifest.definition = await inventory(path.join(directory,'definition'));
  manifest.definition.commit = (await git(root,['rev-parse','HEAD'])).trim();
  manifest.app = await snapshot(root,path.join(work,'source'),baseRef);
  manifest.lockfileSha256 = sha256(await readFile(path.join(work,'source/package-lock.json')));
  await save();
  // Preserve actual inputs, including uncommitted/untracked files, for reproduction.
  await command(['tar','-czf',path.join(directory,'app-source.tar.gz'),'-C',path.join(work,'source'),'.'],root,path.join(directory,'archive.log'));
  for(const variant of manifest.order) {
    const app=path.join(work,variant), output=path.join(directory,variant);
    await mkdir(output); await cp(path.join(work,'source'),app,{recursive:true,verbatimSymlinks:true});
    const record=manifest.variants[variant]={status:'building',replacements:variant==='candidate'?await replaceFiles(app,definition,config.replacements):[]};
    record.inputSha256=(await inventory(app)).sha256;
    await save(); console.log(`[${variant}] Installing frozen dependencies and building production app`);
    record.installMs=await command(['npm','ci','--no-audit','--no-fund'],app,path.join(output,'install.log'));
    record.buildMs=await command(config.build,app,path.join(output,'build.log'));
    record.status='built';record.tests=[];await save();
    if(!options['build-only'])for(const test of config.tests) {
      const testName=path.basename(test,'.mjs');console.log(`[${variant}] ${testName}`);
      const elapsedMs=await command([process.execPath,inside(definition,test)],app,path.join(output,`${testName}.log`),{
        BENCH_APP_ROOT:app,BENCH_OUTPUT:output,BENCH_PARAMETERS:JSON.stringify(parameters),BENCH_PROFILE:options.profile?'1':'0',BENCH_VARIANT:variant,
      });
      record.tests.push({test,elapsedMs,status:'passed'});await save();
    }
    record.status=options['build-only']?'built':'passed';await save();
  }
  if(!options['build-only']) {
    const baseline=JSON.parse(await readFile(path.join(directory,'baseline/measurements.json'),'utf8'));
    const candidate=JSON.parse(await readFile(path.join(directory,'candidate/measurements.json'),'utf8'));
    const comparison=compareReports(baseline,candidate);
    await writeFile(path.join(directory,'comparison.json'),JSON.stringify(comparison,null,2));
    await writeFile(path.join(directory,'report.md'),`Benchmark: ${name}\n\nApp commit: ${manifest.app.commit}\n\nSnapshot: ${manifest.app.sha256}\n\nOrder: ${manifest.order.join(' → ')}. Medians of ${parameters.trials} unprofiled trials. Positive deltas mean more time. These are observations, not a statistical significance test. See manifest.json for inputs and each variant's measurements.json for browser/graphics details.\n\n| Panes | Gesture | Metric | Baseline ms | Candidate ms | Delta |\n|---|---|---|---:|---:|---:|\n`+comparison.map(x=>`| ${x.panes} | ${x.gesture} | ${x.metric} | ${x.baselineMedian.toFixed(2)} | ${x.candidateMedian.toFixed(2)} | ${x.deltaPercent===null?'n/a':x.deltaPercent.toFixed(1)+'%'} |`).join('\n')+'\n');
  }
  manifest.status='passed';console.log(`Passed. ${path.join(directory,options['build-only']?'manifest.json':'report.md')}`);
} catch(error) { manifest.status='failed';manifest.error=error.stack;console.error(error.message);process.exitCode=1; }
finally {
  stop();process.off('SIGINT',onSignal);process.off('SIGTERM',onSignal);
  manifest.finishedAt=new Date().toISOString();await save();
  if(!options['keep-builds'])await rm(work,{recursive:true,force:true});
}
