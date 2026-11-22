import { readFile, writeFile, rename } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { AgentContext } from '../../../domain/core/agents/agentContext';
import { AgentContextLibrary } from '../../../application/mapping/agent/agentContextLibrary';
import { FileAgentContextRepository } from '../../../infrastructure/core/persistence/fileAgentContextRepository';
import { experimentDesignSchema } from '../../../domain/mapping/evals/experiment';
const directory = path.dirname(fileURLToPath(import.meta.url)), root = path.resolve(directory, '../../..');
const read = async (p:string) => JSON.parse(await readFile(p,'utf8'));
const write = async (p:string,v:unknown) => writeFile(p,JSON.stringify(v,null,2)+'\n');
const api = async (route:string,body?:unknown) => {
 const r=await fetch('http://localhost:5191/api/mapping/evals'+route,body===undefined?{}:{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)});
 const v=await r.json(); if(!r.ok)throw Error(JSON.stringify(v));return v;
};
const baseline=await read(path.join(directory,'../repository-discovery-01/setup.json'));
let ids;
try{ids=await read(path.join(directory,'ids.json'));}catch(e){if((e as NodeJS.ErrnoException).code!=='ENOENT')throw e;
 ids={forkRequestId:randomUUID(),contextCommentId:randomUUID(),sampleId:randomUUID(),designRequestId:randomUUID(),groundTruthRequestId:randomUUID()};await write(path.join(directory,'ids.json'),ids);}
const overview=await api(`/experiments/${baseline.experimentId}/overview`);
const findRefs=(node:any):string[]=>[...(node.actions??[]).flatMap((a:any)=>a.refs??[]),...(node.children??[]).flatMap(findRefs)];
const gtRef=findRefs(overview.root).find((r:string)=>r==='ground-truth/dcd726cc-0b99-44e1-9383-82c20dcb2a12');
if(!gtRef)throw Error('Expected ground truth unavailable');
const gtRead=await api(`/experiments/${baseline.experimentId}/read`,{refs:[gtRef]});
const gt=gtRead.results[0].value.data;
const commit=execFileSync('git',['rev-parse','--verify',`${gt.source.commit}^{commit}`],{cwd:root,encoding:'utf8'}).trim();
if(commit!=='8ca143700ca4d2c870f1101b8cd4601ab68abd41')throw Error('Unexpected diagram snapshot');
const config=await read(path.join(root,'artifacts/codebase-canvas-2026-11-11/config.json'));
const repository=new FileAgentContextRepository(config.storeRoot), contexts=new AgentContextLibrary(repository);
const parent=await contexts.read(baseline.agentContextId,false);
const fork=await contexts.fork({requestId:ids.forkRequestId,agentContextId:parent.agentContextId,expectedContentHash:parent.contentHash,name:'Core discovery · 8ca1437',description:`Repository discovery at pinned commit ${commit}; prompt and exclusions unchanged.`});
let record=(await repository.read(fork.agentContextId))!;
const block=record.snapshot.messages[0].content[0];
if(block.type!=='repository')throw Error('Expected repository context');
const parentBlock=parent.snapshot.messages[0].content[0] as any;
const rootNames=execFileSync('git',['ls-tree','-z','--name-only',commit],{cwd:root,encoding:'utf8'}).split('\0').filter(Boolean);
const allowedRoots=new Set(['src','application','domain','infrastructure','packages','index.html','package.json','tsconfig.json','vite.config.ts']);
const additionalExclusions=rootNames.filter(name=>!allowedRoots.has(name)&&!parentBlock.exclusions.some((pattern:string)=>path.posix.matchesGlob(name,pattern)||path.posix.matchesGlob(name+'/_',pattern))).map(name=>name.includes('.')&& !name.startsWith('.') ? name : name+'/**');
const exclusions=[...new Set([...parentBlock.exclusions,...additionalExclusions])].sort();
if(block.commit!==commit || JSON.stringify(block.exclusions)!==JSON.stringify(exclusions)){
 const messages=structuredClone(record.snapshot.messages);(messages[0].content[0] as any).commit=commit;(messages[0].content[0] as any).exclusions=exclusions;
 record.snapshot=AgentContext.fromTrajectory({agentType:record.snapshot.source.agentType,sourceSessionId:record.snapshot.source.sourceSessionId,format:'messages-v1',fromEntryId:'context',throughEntryId:'context',entries:[{id:'context',parentId:null,message:messages[0]}]}).toSnapshot();
 const file=path.join(config.storeRoot,'agent-contexts',`${fork.agentContextId}.json`),temp=file+'.snapshot.tmp';
 await write(temp,record);await rename(temp,file);
}
ids.scopeCommentId??=randomUUID();await write(path.join(directory,'ids.json'),ids);
await contexts.addComment({requestId:ids.scopeCommentId,agentContextId:fork.agentContextId,expectedContentHash:record.snapshot.contentHash,text:`Pinned repository commit ${commit}; retained the task and browsing instructions, and extended inherited exclusions to new non-source root directories and files: ${additionalExclusions.join(', ')}.`});
const saved=await contexts.read(fork.agentContextId,false);
const paths=execFileSync('git',['ls-tree','-rz','--name-only',commit],{cwd:root,encoding:'utf8',maxBuffer:32*1024*1024}).split('\0').filter(Boolean);
const available=paths.filter(file=>!exclusions.some(pattern=>path.posix.matchesGlob(file,pattern))).sort();
for(const required of ['src/features/mapping/tldraw/MappingEditorRuntime.ts','domain/core/diagrams/diagramRevisionStore.ts'])if(!available.includes(required))throw Error(`Required source unavailable: ${required}`);
await write(path.join(directory,'context.json'),saved.snapshot);await write(path.join(directory,'eligible-paths.json'),available);
const plan={...baseline,status:'authorized',executionAuthorized:true,modelCalls:0,sampleId:ids.sampleId,agentContextId:saved.agentContextId,contextHash:saved.contentHash,sourceCommit:commit,eligibleFiles:available.length,parentAgentContextId:parent.agentContextId,groundTruthId:ids.groundTruthRequestId};
await write(path.join(directory,'setup.json'),plan);
const experiment=await api(`/experiments/${baseline.experimentId}`);
const design=experimentDesignSchema.parse(Object.fromEntries(['name','description','workflow','phases','cases','conditions','samples','comparisons'].filter(k=>experiment[k]!==undefined).map(k=>[k,experiment[k]])));
if(!design.samples.some(s=>s.id===ids.sampleId)){
 design.cases.push({id:'source-8ca1437',name:'Repository · 8ca1437',agentContextId:saved.agentContextId,contentHash:saved.contentHash});
 design.conditions.push({id:'astra-high-8ca1437',name:'Astra/high · matched snapshot',description:`One gpt-6-astra/high sample using unchanged prompt v2 and source-only exclusions, with repository commit ${commit}.`});
 design.samples.push({id:ids.sampleId,caseId:'source-8ca1437',conditionId:'astra-high-8ca1437',number:1,attempt:1,outputs:[]});
 design.description+=' Rerun: one Astra/high sample at 8ca1437, matching the reference source snapshot; earlier runs retain their original 03f2168 inputs.';
 await write(path.join(directory,'experiment-request.json'),{requestId:ids.designRequestId,experimentId:experiment.id,expectedRevision:experiment.revision,experiment:design});
 await api('/experiments',{requestId:ids.designRequestId,experimentId:experiment.id,expectedRevision:experiment.revision,experiment:design});
} else {
 const selected=design.cases.find(c=>c.id==='source-8ca1437')!;
 if(selected.contentHash!==saved.contentHash){selected.contentHash=saved.contentHash;
 design.conditions.find(c=>c.id==='astra-high-8ca1437')!.description=`One gpt-6-astra/high sample, unchanged prompt v2; source at ${commit}, excluding non-source archives and references.`;
 ids.scopeDesignRequestId??=randomUUID();await write(path.join(directory,'ids.json'),ids);
 await api('/experiments',{requestId:ids.scopeDesignRequestId,experimentId:experiment.id,expectedRevision:experiment.revision,experiment:design});}
}
await api(`/experiments/${baseline.experimentId}/ground-truth`,{requestId:ids.groundTruthRequestId,name:'Core editing kernel · matched snapshot',description:'Identical reference diagram scoped to the rerun at its exact source commit, 8ca1437.',format:gt.format,ascii:gt.ascii,caseIds:['source-8ca1437'],source:gt.source,provenance:gt.provenance});
console.log(JSON.stringify({agentContextId:saved.agentContextId,sourceCommit:commit,eligibleFiles:available.length,sampleId:ids.sampleId,model:'gpt-6-astra',effort:'high',samples:1}));
