import {readFile,writeFile} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
const dir=path.dirname(fileURLToPath(import.meta.url)),ids=JSON.parse(await readFile(path.join(dir,'ids.json'),'utf8'));
const api=async(route:string,body?:any)=>{const r=await fetch('http://localhost:5191/api/mapping/evals'+route,body?{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)}:{});const d=await r.json();if(!r.ok)throw Error(JSON.stringify(d));return d;};
const revisions:any={};
for(const kind of ['core','canvas']){
 const p=await api('/prompts/'+ids.promptIds[kind]),v1=p.versions.find((v:any)=>v.version===1);
 const text=v1.stages.alternative+'\n\nBefore submission, read each selected range with line numbers that restart for that file (for example, nl -ba one-file.ts). Do not infer range endpoints from search hits or use cumulative numbering across files. Call validate_source_mappings with your complete candidate JSON, inspect any reported errors, and verify corrected ranges against the source before returning the final JSON. The final JSON must match a candidate that passed this check. This tool checks node references, file existence and line bounds; semantic support still requires your inspection. Validation calls and any within-session corrections are retained as part of the same sample; they are not separate generation attempts.';
 const old=p.versions.find((v:any)=>v.stages.alternative===text);
 const saved=old?p:await api('/prompts',{requestId:randomUUID(),promptId:p.id,baseVersion:p.versions.at(-1).version,workflow:p.workflow,name:p.name,note:'Require per-file numbered evidence and candidate validation before final submission. Original v1 results retained. Prepared while experiment is paused.',stages:{alternative:text}});
 const version=saved.versions.find((v:any)=>v.stages.alternative===text);revisions[kind]={promptId:p.id,version:version.version,contentHash:version.contentHash};await writeFile(path.join(dir,kind+'-prompt-v2.txt'),text+'\n');
}
await writeFile(path.join(dir,'prepared-fix.json'),JSON.stringify({status:'prepared-paused',modelCalls:0,prompts:revisions,notes:'No existing run prompt pins or responses changed. Use revised prompts for new attempts on explicit resume; retain the six original v1 outcomes as baseline.'},null,2)+'\n');
const current=await api('/experiments/'+ids.experimentId);
const description=current.description.split('\n\nExecution paused:')[0]+'\n\nExecution paused: user requested pausing all potentially affected runs while invalid source ranges are investigated. Six v1 samples ran: three medium outputs registered; three low outputs failed source-range bounds. 66 samples remain unstarted. Revised prompts with pre-submission source-range validation are prepared; no further model calls have been made. Original outcomes and prompt pins are retained.';
if(current.description!==description){const {name,tags,phases,workflow,cases,conditions,samples,comparisons}=current;await api('/experiments',{requestId:randomUUID(),experimentId:current.id,expectedRevision:current.revision,experiment:{name,tags,phases,workflow,cases,conditions,samples,comparisons,description}});}
console.log(JSON.stringify(revisions));
