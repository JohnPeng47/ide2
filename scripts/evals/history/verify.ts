// Offline checks only: this command has no generation runtime and does not publish eval outputs.
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { FileCanvasTimeline } from '../../../infrastructure/mapping/history/fileCanvasTimeline';
import { preflightHistory } from './preflight';
import { materializeHistoryStep, type HistoryCanvasSet } from '../../../application/mapping/history/historyMaterializer';
import { validateHistoryPlan } from '../../../domain/mapping/history/diagramHistory';
const directory=path.resolve(process.argv[2]??'artifacts/diagram-history-2026-11-10-rerun');
const config=JSON.parse(await readFile(path.join(directory,'config.json'),'utf8'));
const timeline=new FileCanvasTimeline(config.storeRoot);
const report:unknown[]=[];
for(const mode of ['history','structure-first']) {
  const setup=config.experiments[mode];
  const preflight=await preflightHistory(timeline,setup.id,config.baseline);
  console.log(JSON.stringify({mode,preflight}));
  const state=JSON.parse(await readFile(path.join(directory,mode,'state.json'),'utf8'));
  const baseline=(await timeline.read(setup.id)).steps.find(s=>s.id==='baseline')!;
  const set:HistoryCanvasSet={};
  for(const [key,value] of Object.entries(config.baseline) as [string,any][])set[key]={...value,history:await timeline.editingHistory(setup.id,baseline.canvases.find(c=>c.documentId===value.id)!)};
  const runs=[{run:state.globalRun,stage:'plan'},...Object.values(state.batches).flatMap((entry:any)=>entry.executeRun?[{run:entry.executeRun,stage:'execute'}]:[])];
  for(const {run,stage}of runs)for(let attempt=1;attempt<=3;attempt++) {
    let saved;
    try{saved=JSON.parse(await readFile(path.join(directory,mode,`${run.id}-attempt-${attempt}.json`),'utf8'));}
    catch(e){if((e as NodeJS.ErrnoException).code==='ENOENT')continue;throw e;}
    try{
      if(stage==='plan') {
        const plan=validateHistoryPlan(saved.output,config.commits.map((c:any)=>c.commit),Object.fromEntries(Object.entries(config.baseline).map(([key,v]:[string,any])=>[key,Object.keys(v.diagramIds)])),mode==='structure-first');
        if(JSON.stringify(plan.batches[0].commits)!==JSON.stringify(config.firstBatchCommits))throw Error('Incorrect first batch');
        if(mode==='structure-first'){let scaffold=set;for(const batch of plan.batches)scaffold=materializeHistoryStep(scaffold,batch,`h-${setup.id.slice(0,12)}`,'scaffold',undefined,undefined,true);}
      } else materializeHistoryStep(set,state.plan.batches[0],`h-${setup.id.slice(0,12)}`,'execute',saved.output);
      const result={mode,stage,attempt,status:'passed'};report.push(result);console.log(JSON.stringify(result));
    }catch(e){const result={mode,stage,attempt,status:'failed',error:e instanceof Error?e.message:String(e)};report.push(result);console.log(JSON.stringify(result));}
  }
}
console.log(JSON.stringify({modelCalls:0,replayed:report.length,passed:report.filter((r:any)=>r.status==='passed').length}));
if(report.some((r:any)=>r.status==='failed'))process.exitCode=1;
