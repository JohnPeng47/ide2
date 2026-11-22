import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { JsonDirectoryStore } from '../../../infrastructure/mapping/evals/jsonDirectoryStore';
import type { EvalRun } from '../../../domain/mapping/evals/evalRun';
import { experimentDesignSchema } from '../../../domain/mapping/evals/experiment';
const directory=path.dirname(fileURLToPath(import.meta.url)),root=path.resolve(directory,'../../..');
const read=async(p:string)=>JSON.parse(await readFile(p,'utf8'));
const plan=await read(path.join(directory,'inputs.json')),coverage=await read(path.join(directory,'source-coverage.json'));
const config=await read(path.join(root,'artifacts/codebase-canvas-2026-11-11/config.json'));
const runs=new JsonDirectoryStore<EvalRun>(config.storeRoot,'eval-runs');
const api=async(route:string,body?:unknown)=>{const r=await fetch('http://localhost:5191/api/mapping/evals'+route,body===undefined?{}:{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)});const v=await r.json();if(!r.ok)throw Error(`${route}: ${JSON.stringify(v)}`);return v;};
const fmt=(x:number)=>x.toLocaleString('en-US',{maximumFractionDigits:1});
const key='source-coverage:1:analysis',firstId=plan.cases[0].runId;
const markdown=`# Pi source coverage\n\nThree independent gpt-6-astra/high runs using unchanged prompt v2, pinned to Pi commit \`${plan.sourceCommit}\`.\n\n**Average per run: ${fmt(coverage.meanSourceLinesSeen)} unique source lines — ${coverage.meanPercent.toFixed(2)}% of eligible application source.**\n\nThe eligible source contains **${fmt(coverage.eligibleSourceLines)} lines across ${fmt(coverage.eligibleSourceFiles)} files**.\n\n| Run | Unique source lines read | Coverage |\n|---|---:|---:|\n${coverage.runs.map((r:{sample:number;sourceLinesSeen:number;percent:number;runId:string})=>`| [${r.sample}](http://localhost:5191/evals?run=${r.runId}) | ${fmt(r.sourceLinesSeen)} | ${r.percent.toFixed(2)}% |`).join('\n')}\n| **Mean** | **${fmt(coverage.meanSourceLinesSeen)}** | **${coverage.meanPercent.toFixed(2)}%** |\n\nAcross all three runs, ${fmt(coverage.summedPerRunLines)} source-line exposures were counted after deduplicating within each run. The union across all runs is **${fmt(coverage.unionSourceLinesSeen)} distinct lines (${coverage.unionPercent.toFixed(2)}%)**.\n\nAll tracked code, including excluded tests/tooling, contains ${fmt(coverage.allTrackedSourceLines)} lines across ${fmt(coverage.allTrackedSourceFiles)} files; average exposure against that broader denominator is ${(coverage.meanSourceLinesSeen/coverage.allTrackedSourceLines*100).toFixed(2)}%.\n\n## Method\n\n${coverage.method}\n\nCoverage means the proportion of repository source returned to the model, rather than the proportion of context tokens occupied by code. The initial AgentContext contains a repository descriptor, not a bundled source dump. Shell output includes grep/rg, sed, cat and equivalent exact source excerpts. Tool output was checked against the pinned Git blobs, and file/line pairs were deduplicated.\n\nThis is deterministic trace analysis; it made no additional model calls. The three exact raw generations remain separate Markdown outputs. Canvas materialization failed the single-root parser check for all three; the original validation failures remain attached, and no repair generations were made.\n`;
await writeFile(path.join(directory,'source-coverage.md'),markdown);
for(const row of coverage.runs){
 const run=await runs.read(row.runId);if(!run||!run.cells.some(c=>c.key==='raw-generation:1:analysis'&&c.status==='finished'))throw Error(`Run ${row.sample} raw output is not saved`);
 const cell=run.cells.find(c=>c.stage==='alternative')!;
 cell.explanation=`Source coverage: ${fmt(row.sourceLinesSeen)} unique lines (${row.percent.toFixed(2)}%). Three-run mean: ${fmt(coverage.meanSourceLinesSeen)} lines (${coverage.meanPercent.toFixed(2)}%). Deterministic read/bash trace analysis; repeated reads deduplicated.`;
 if(row.runId===firstId&&!run.cells.some(c=>c.key===key))run.cells.push({key,pass:1,stage:'analysis',status:'queued',candidateName:'Source coverage · aggregate',explanation:'Deterministic aggregate of the three independent Pi traces; no additional model generation.'});
 await runs.save(run);
}
await api(`/runs/${firstId}/output-result`,{cellKey:key,format:'markdown',markdown});
const experiment=await api(`/experiments/${plan.experimentId}`);
const design=experimentDesignSchema.parse(Object.fromEntries(['name','description','workflow','phases','cases','conditions','samples','comparisons'].filter(k=>experiment[k]!==undefined).map(k=>[k,experiment[k]])));
const sample=design.samples.find(s=>s.id===plan.cases[0].sampleId)!;
if(!sample.outputs.some(o=>o.stageId==='coverage')){
 design.workflow.stages.push({id:'coverage',name:'Source coverage',dependsOn:['tree']});design.workflow.version++;
 sample.outputs.push({stageId:'coverage',runId:firstId,cellKey:key});
 const phase=design.phases!.find(p=>p.id===plan.phaseId)!;
 phase.description=`Three independent Astra/high samples at Pi ${plan.sourceCommit.slice(0,7)}, using unchanged prompt v2. Mean source exposure: ${fmt(coverage.meanSourceLinesSeen)} lines (${coverage.meanPercent.toFixed(2)}% of ${fmt(coverage.eligibleSourceLines)} eligible source lines); three-run union: ${fmt(coverage.unionSourceLinesSeen)} lines (${coverage.unionPercent.toFixed(2)}%). Includes file reads and shell source output, deduplicated per run. All three model calls completed; canvas validation rejected root-level source/legend annotations. Exact raw outputs and the validation failures are retained. Source coverage is a deterministic aggregate, not another generation.`;
 await api('/experiments',{requestId:plan.coverageAttachRequestId,experimentId:experiment.id,expectedRevision:experiment.revision,experiment:design});
}
const outputUrl=`http://localhost:5191/evals?run=${firstId}&output=${encodeURIComponent(key)}`;
await writeFile(path.join(directory,'coverage-result.json'),JSON.stringify({status:'finished',outputUrl,meanSourceLinesSeen:coverage.meanSourceLinesSeen,meanPercent:coverage.meanPercent,unionSourceLinesSeen:coverage.unionSourceLinesSeen,unionPercent:coverage.unionPercent},null,2)+'\n');
console.log(JSON.stringify({status:'finished',outputUrl,meanSourceLinesSeen:coverage.meanSourceLinesSeen,meanPercent:coverage.meanPercent}));
