import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { createAssistantMessageEventStream } from '@earendil-works/pi-ai';
import { AgentContext } from '../../../domain/core/agents/agentContext';
import { MappingSubagents } from './subagents';

async function fixture(options: { fail?: boolean; slow?: boolean } = {}) {
 const directory=await mkdtemp(path.join(tmpdir(),'mapping-children-test-'));
 await writeFile(path.join(directory,'source.txt'),'pinned evidence\n');
 const context=AgentContext.fromMessages('fixture',[{role:'user',timestamp:0,content:[{type:'text',text:'Shared pinned diagram input'}]}]);
 const requests:any[]=[],sessions:any[]=[];
 let active=0,peak=0;
 const model:any={id:'gpt-6-sol',name:'Offline',provider:'openai-codex',api:'openai-codex-responses',baseUrl:'http://offline.invalid',reasoning:true,input:['text'],contextWindow:272000,maxTokens:8192,cost:{input:0,output:0,cacheRead:0,cacheWrite:0}};
 const provider:any={hasConfiguredAuth:()=>true,isUsingOAuth:()=>false,getModel:()=>model,getAvailableSnapshot:()=>[model],streamSimple:(_model:any,history:any,opts:any)=>{
  requests.push({history:JSON.parse(JSON.stringify(history)),options:opts});active++;peak=Math.max(peak,active);
  const stream=createAssistantMessageEventStream();
  const toolResult=history.messages.findLast((m:any)=>m.role==='toolResult');
  const message:any={role:'assistant',api:model.api,provider:model.provider,model:model.id,timestamp:Date.now(),
   content:toolResult?[{type:'text',text:JSON.stringify({evidence:toolResult.content})}]:[{type:'toolCall',id:'inspect',name:'bash',arguments:{command:'cat source.txt; if touch source.txt 2>/dev/null; then echo WRITABLE; else echo READ_ONLY; fi'}}],
   stopReason:toolResult?'stop':'toolUse',usage:{input:10,output:4,cacheRead:2,cacheWrite:0,totalTokens:16,cost:{input:0.01,output:0.02,cacheRead:0,cacheWrite:0,total:0.03}}};
  let done=false;
  const finish=(aborted=false)=>{if(done)return;done=true;active--;clearTimeout(timer);opts.signal?.removeEventListener('abort',abort);
   if(aborted||options.fail){message.content=[];message.stopReason=aborted?'aborted':'error';message.errorMessage=aborted?'cancelled':'fixture failure';stream.push({type:'error',reason:message.stopReason,error:message});}
   else stream.push({type:'done',reason:message.stopReason,message});stream.end(message);
  };
  const abort=()=>finish(true),timer=setTimeout(()=>finish(),options.slow?5000:40);
  opts.signal?.addEventListener('abort',abort,{once:true});if(opts.signal?.aborted)abort();
  return stream;
 }};
 class OfflinePool extends MappingSubagents {
  protected async model(){return {runtime:provider,model,provider:model.provider,modelId:model.id};}
  protected async createSession(config:any,ctx?:AgentContext){const result=await super.createSession(config,ctx);sessions.push(result.session);return result;}
 }
 const pool=new OfflinePool({cwd:directory,context,prompt:'Map assigned nodes; children return partial results.',directory:path.join(directory,'audit'),model:'gpt-6-sol',effort:'medium',concurrency:2});
 return {pool,directory,requests,sessions,peak:()=>peak,cleanup:async()=>{await pool.close();await rm(directory,{recursive:true,force:true});}};
}

test('real SDK runs children concurrently, queues excess, isolates history, enforces read-only shell and records all usage',async()=>{
 const f=await fixture();
 try {
  const assignments=Array.from({length:5},(_,i)=>({name:'subtree '+i,assignment:'Map node '+i}));
  const result=await f.pool.tool().execute('batch',{assignments});
  f.pool.assertHealthy();
  assert.equal(f.peak(),2);assert.equal(f.pool.records.length,5);
  assert.equal(JSON.parse(result.content[0].text).length,5);
  for(const record of f.pool.records){
   assert.equal(record.status,'finished');assert.equal(record.usage.totalTokens,32);assert.equal(record.cost.total,0.06);
   assert.match(record.text,/pinned evidence/);assert.match(record.text,/READ_ONLY/);assert.doesNotMatch(record.text,/WRITABLE/);
   const transcript=await readFile(path.join(f.directory,'audit',record.id,'transcript.jsonl'),'utf8');assert.match(transcript,/Shared pinned diagram input/);assert.match(transcript,/Map node/);
   const meta=JSON.parse(await readFile(path.join(f.directory,'audit',record.id,'session.json'),'utf8'));assert.deepEqual(meta.tools.sort(),['bash','read']);
  }
  assert.equal(new Set(f.pool.records.map(r=>r.sessionId)).size,5);
  for(const request of f.requests){assert.equal(request.options.reasoning,'medium');assert.ok(request.history.messages.some((m:any)=>JSON.stringify(m).includes('Shared pinned diagram input')));}
  assert.equal(await readFile(path.join(f.directory,'source.txt'),'utf8'),'pinned evidence\n');
 }finally{await f.cleanup();}
});

test('cancellation stops active children and queued assignments without new model calls',async()=>{
 const f=await fixture({slow:true}),controller=new AbortController();
 try {
  const pending=f.pool.tool().execute('batch',{assignments:Array.from({length:5},(_,i)=>({name:String(i),assignment:'Map node'}))},controller.signal);
  const assertion=assert.rejects(pending);
  for(let i=0;f.requests.length<2&&i<500;i++)await new Promise(resolve=>setTimeout(resolve,10));
  assert.equal(f.requests.length,2);
  controller.abort();await assertion;await f.pool.close();
  assert.equal(f.requests.length,2);assert.ok(f.pool.records.every(r=>r.status==='cancelled'));assert.throws(()=>f.pool.assertHealthy());
 }finally{await f.cleanup();}
});

test('child failures persist and prevent a successful sample even if the lead ignores the tool error',async()=>{
 const f=await fixture({fail:true});
 try {
  await assert.rejects(f.pool.tool().execute('batch',{assignments:[{name:'bad',assignment:'Map node'}]}),/fixture failure/);
  assert.throws(()=>f.pool.assertHealthy(),/failed/);
  const records=JSON.parse(await readFile(path.join(f.directory,'audit','subagents.json'),'utf8'));assert.equal(records[0].status,'failed');assert.equal(records[0].usage.totalTokens,16);
 }finally{await f.cleanup();}
});


test('one failed child cancels siblings and never starts queued model calls',async()=>{
 const f=await fixture({fail:true});
 try {
  await assert.rejects(f.pool.tool().execute('batch',{assignments:Array.from({length:6},(_,i)=>({name:String(i),assignment:'Map node'}))}));
  assert.ok(f.requests.length<=2);assert.equal(f.pool.records.length,6);
  assert.ok(f.pool.records.some(r=>r.status==='failed'));
  assert.ok(f.pool.records.every(r=>['failed','cancelled'].includes(r.status)));
  await assert.rejects(f.pool.tool().execute('next',{assignments:[{name:'retry',assignment:'Map again'}]}),/closed/);
 }finally{await f.cleanup();}
});
