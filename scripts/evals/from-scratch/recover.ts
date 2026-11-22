import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
const directory=path.resolve(process.argv[2]??'artifacts/codebase-canvas-2026-11-11');
const load=async(file:string)=>JSON.parse(await readFile(path.join(directory,file),'utf8'));
const config=await load('config.json'),state=await load('state.json');
if(!['failed','cancelled'].includes(state.status))throw Error('Only recover a stopped runner');
const logical=process.argv[3]??state.jobs.find((j:any)=>j.key===state.activeJob)?.logicalKey??state.activeJob;
const previous=[...state.jobs].reverse().find((j:any)=>(j.logicalKey??j.key)===logical);
if(!previous)throw Error('No recorded job for this logical key');
let plan:any={};try{plan=await load('retry-plan.json');}catch(e){if((e as NodeJS.ErrnoException).code!=='ENOENT')throw e;}
const attempt=(plan[logical]?.attempt??1)+1;
if(attempt>3&&!process.argv.includes('--allow-more'))throw Error('Three attempts already recorded; investigate the repeated failure before allowing another');
let response:any;try{response=await load(`jobs/${previous.runId}/response.json`);}catch(e){if((e as NodeJS.ErrnoException).code!=='ENOENT')throw e;}
const entry={attempt,previousExecutionKey:previous.key,previousRunId:previous.runId,createdAt:new Date().toISOString(),authorization:'User explicitly requested restarting failed agents and regenerating prior outputs when needed.',feedback:{error:state.error,previousOutput:response?.output??null,instruction:'Correct the recorded failure while following the original task. Preserve all original evidence constraints.'}};
plan[logical]=entry;
await mkdir(path.join(directory,'recovery'),{recursive:true});
const key=createHash('sha256').update(logical).digest('hex').slice(0,16);
await writeFile(path.join(directory,'recovery',`${key}-attempt-${attempt}.json`),JSON.stringify({logicalKey:logical,...entry},null,2),{flag:'wx'});
await writeFile(path.join(directory,'retry-plan.json'),JSON.stringify(plan,null,2));
console.log(JSON.stringify({logicalKey:logical,attempt,previousRunId:previous.runId,paidCallsStarted:0,action:'Recovery plan recorded; restart run.ts to execute the new attempt.'}));
