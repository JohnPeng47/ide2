import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {execFileSync} from 'node:child_process';
import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {StdioClientTransport} from '@modelcontextprotocol/sdk/client/stdio.js';
import {AgentContext} from '../../domain/core/agents/agentContext.ts';
const dir=path.dirname(fileURLToPath(import.meta.url)),root=path.resolve(dir,'../..');
const manifest=JSON.parse(await fs.readFile(path.join(dir,'manifest.json'),'utf8'));
const c=new Client({name:'changesession-context-builder',version:'1'},{capabilities:{}});
await c.connect(new StdioClientTransport({command:'node',args:['--import','tsx','scripts/mapping/mcp.ts','http://127.0.0.1:5191'],cwd:root,stderr:'pipe'}));
async function call(name,args){const r=await c.callTool({name,arguments:args},undefined,{timeout:120000});if(r.isError)throw Error(JSON.stringify(r));return r.structuredContent?.result??JSON.parse(r.content.find(x=>x.type==='text').text);}
const verification=[];
try {
 for(const g of manifest.groups){
  const req=JSON.parse(await fs.readFile(path.join(dir,g.createRequestFile),'utf8'));
  const saved=await call('create-agent-context',req);
  await fs.writeFile(path.join(dir,g.key,'receipt.json'),JSON.stringify(saved,null,2)+'\n');
  if(saved.agentContextId!==g.agentContextId)throw Error('ID mismatch');
  const read=await call('read-agent-context',{agentContextId:saved.agentContextId});
  if(read.contentHash!==saved.contentHash||AgentContext.fromSnapshot(read.snapshot).contentHash!==saved.contentHash)throw Error('Hash mismatch');
  if(read.group!==manifest.group)throw Error('Group mismatch');
  const blocks=read.snapshot.messages.flatMap(m=>m.content),resolved=read.resolvedSnapshot?.messages.flatMap(m=>m.content);
  if(!resolved||blocks.length!==req.context.length||resolved.length!==blocks.length)throw Error('Missing resolved blocks');
  let pinned=0;
  for(let i=0;i<blocks.length;i++){
   const b=blocks[i],input=req.context[i],result=resolved[i];
   if(input.type==='text'){if(b.type!=='text'||b.text!==input.text||result.text!==input.text)throw Error('Text input changed');continue;}
   if(b.type!=='sourceRange'||b.version.kind!=='git'||b.version.commit!==manifest.head||b.path!==input.path||b.startLine!==input.startLine||b.endLine!==input.endLine)throw Error('Source pin mismatch');
   const body=execFileSync('git',['show',`${manifest.head}:${input.path}`],{cwd:root,encoding:'utf8',maxBuffer:4*1024*1024});
   const expected=`${input.path}:${input.startLine}-${input.endLine}\n${body.split(/\r?\n/).slice(input.startLine-1,input.endLine).join('\n')}`;
   if(result.type!=='text'||result.text!==expected)throw Error(`Resolved source mismatch: ${input.path}`);
   pinned++;
  }
  AgentContext.fromSnapshot(read.resolvedSnapshot);
  const {resolvedSnapshot,...compact}=read;
  await fs.writeFile(path.join(dir,g.key,'saved-context.json'),JSON.stringify(compact,null,2)+'\n');
  Object.assign(g,{contentHash:saved.contentHash,savedAt:saved.createdAt,verified:true,resolvedBytes:Buffer.byteLength(JSON.stringify(resolvedSnapshot))});
  verification.push({key:g.key,agentContextId:saved.agentContextId,contentHash:saved.contentHash,sourcePinsVerified:pinned,visibleTextBlocksVerified:blocks.length-pinned,resolvedSnapshotHash:resolvedSnapshot.contentHash,verifiedAt:new Date().toISOString()});
  await fs.writeFile(path.join(dir,'manifest.json'),JSON.stringify(manifest,null,2)+'\n');
  await fs.writeFile(path.join(dir,'saved-context-verification.json'),JSON.stringify(verification,null,2)+'\n');
  console.log(JSON.stringify({group:g.key,id:saved.agentContextId,pinnedSources:pinned,bytes:g.resolvedBytes,verified:true}));
 }
 const listed=await call('list-agent-contexts',{query:'ChangeSession ',limit:100});
 for(const g of manifest.groups)if(!listed.items.some(x=>x.agentContextId===g.agentContextId&&x.contentHash===g.contentHash&&x.group===manifest.group))throw Error('Saved context not discoverable');
 console.log('All three saved AgentContexts are discoverable and verified.');
} finally {await c.close();}
