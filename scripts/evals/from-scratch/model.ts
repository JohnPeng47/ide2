import { runtimeUsageRecorder } from '../../../infrastructure/core/usage/runtimeUsage';
import { spawn } from 'node:child_process';
import { mkdir, readFile, writeFile, open, mkdtemp, copyFile, rm } from 'node:fs/promises';
import { createWriteStream } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { z } from 'zod';

/** Exactly one paid invocation per job. Retain raw events even when parsing fails. */
export async function modelCall(directory:string, prompt:string, schema:z.ZodType, signal:AbortSignal) {
  try { return JSON.parse(await readFile(path.join(directory,'response.json'),'utf8')); }
  catch(e) { if((e as NodeJS.ErrnoException).code!=='ENOENT') throw e; }
  await mkdir(directory,{recursive:true});
  // Keep the model outside the repository so it cannot inherit AGENTS.md,
  // previous outputs, neighbouring jobs, or the orchestrator's implementation.
  const workspace=await mkdtemp(path.join(tmpdir(),'canvas-discovery-model-'));
  try {
  const inputs=JSON.parse(await readFile(path.join(directory,'inputs.json'),'utf8'));
  for(const file of Object.keys(inputs.files)) {
    if(path.basename(file)!==file)throw Error('Model input filenames must be flat');
    await copyFile(path.join(directory,file),path.join(workspace,file));
  }
  await writeFile(path.join(directory,'prompt.txt'),prompt);
  await writeFile(path.join(directory,'output-schema.json'),JSON.stringify(z.toJSONSchema(schema),null,2));
  await copyFile(path.join(directory,'output-schema.json'),path.join(workspace,'output-schema.json'));
  // A crashed/incomplete attempt must be inspected, never silently paid for again.
  const marker=await open(path.join(directory,'model-started.json'),'wx');
  await marker.writeFile(JSON.stringify({at:new Date().toISOString(),model:'gpt-6-astra',effort:'high',pid:process.pid})); await marker.close();
  const events=createWriteStream(path.join(directory,'events.jsonl'),{flags:'wx'}), errors=createWriteStream(path.join(directory,'stderr.log'),{flags:'wx'});
  const result=await new Promise<{output:unknown;usage?:Record<string,number>}>((resolve,reject)=>{
    const child=spawn(process.env.NEW_DIAGRAM_CODEX_BIN||'codex',['exec','--model','gpt-6-astra','--sandbox','read-only','-c','approval_policy="never"','-c','model_reasoning_effort="high"','--ephemeral','--skip-git-repo-check','--json','--color','never','--output-schema',path.join(workspace,'output-schema.json'),'--cd',workspace,'-'],{cwd:workspace,stdio:['pipe','pipe','pipe']});
    let buffer='',reply='',failure='',usage:Record<string,number>|undefined,settled=false;
    let killTimer:ReturnType<typeof setTimeout>|undefined;
    const stop=()=>{child.kill('SIGTERM');killTimer=setTimeout(()=>child.kill('SIGKILL'),2000);killTimer.unref();};
    const finish=(error?:Error)=>{if(settled)return;settled=true;clearTimeout(timer);signal.removeEventListener('abort',abort);if(error){stop();reject(error);}else{try{resolve({output:JSON.parse(reply),usage});}catch{reject(Error('Invalid JSON response; raw events retained.'));}}};
    const abort=()=>finish(Error('Generation cancelled.'));
    const timer=setTimeout(()=>finish(Error('Generation timed out after 60 minutes.')),60*60*1000);
    const recordUsage=runtimeUsageRecorder('gpt-6-astra','high');
    const consume=(line:string)=>{try{const e=JSON.parse(line);recordUsage(e);if(e.type==='item.completed'&&e.item?.type==='agent_message')reply=e.item.text;if(e.type==='turn.completed')usage=e.usage;if(e.type==='turn.failed')failure=e.error?.message||'Generation failed';}catch{}};
    child.stdout.setEncoding('utf8');child.stdout.on('data',(chunk:string)=>{events.write(chunk);buffer+=chunk;const lines=buffer.split('\n');buffer=lines.pop()??'';lines.forEach(consume);});
    child.stderr.on('data',chunk=>errors.write(chunk));
    child.stdin.on('error',finish);child.on('error',finish);child.on('close',code=>{clearTimeout(killTimer);consume(buffer);events.end();errors.end();finish(failure||code!==0||!reply.trim()?Error(failure||`Model process exited ${code} without a result`):undefined);});
    signal.addEventListener('abort',abort,{once:true});if(signal.aborted)abort();else child.stdin.end(prompt);
  });
  await writeFile(path.join(directory,'response.json'),JSON.stringify(result,null,2),{flag:'wx'});
  return result;
  } finally {await rm(workspace,{recursive:true,force:true});}
}
