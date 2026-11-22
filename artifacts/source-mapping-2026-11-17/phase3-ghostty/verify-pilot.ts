import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { sameMappingChoices, validateMappingRanges } from '../validation';
const dir=path.dirname(fileURLToPath(import.meta.url));
const read=async(file:string)=>JSON.parse(await readFile(path.join(dir,file),'utf8'));
const plan=await read('plan.json'),results=[];
for(const key of plan.pilot){
 const job=plan.jobs.find((j:any)=>j.key===key),base='jobs/'+key+'/',status=await read(base+'status.json'),response=await read(base+'response.json');
 assert.equal(status.status,'finished');assert.ok(status.children>0,'Pilot must exercise delegation');
 const c=await read(job.caseId+'-input.json'),output=typeof response.output==='string'?JSON.parse(response.output):response.output;
 assert.ok(validateMappingRanges(c,output).valid);
 const checks=(await readFile(path.join(dir,base,'validation-checks.jsonl'),'utf8')).trim().split('\n').map(line=>JSON.parse(line));
 assert.ok(checks.some(check=>check.valid&&sameMappingChoices(JSON.parse(check.candidate),output)));
 const children=await read(base+'children/subagents.json');assert.equal(children.length,status.children);assert.ok(children.every((child:any)=>child.status==='finished'));
 for(const child of children){
  const session=await read(base+'children/'+child.id+'/session.json');assert.deepEqual(session.tools.sort(),['bash','read']);assert.equal(session.model,'gpt-6-sol');assert.equal(session.effort,'medium');
  const transcript=await readFile(path.join(dir,base,'children',child.id,'transcript.jsonl'),'utf8');assert.ok(transcript.trim().split('\n').map(line=>JSON.parse(line)).some(entry=>entry.message?.content?.some?.((block:any)=>block.type==='text'&&block.text.includes(child.assignment))));
 }
 const total={...response.accounting.mainUsage};
 for(const child of children)for(const [k,v]of Object.entries(child.usage))if(typeof v==='number')total[k]=(total[k]??0)+v;
 assert.deepEqual(response.usage,total);
 const url=`http://localhost:5191/api/mapping/evals/runs/${job.runId}/output-result?cell=${encodeURIComponent(job.cellKey)}`;
 const r=await fetch(url);assert.ok(r.ok);const saved=await r.json();assert.equal(saved.canvases.length,1);
 const doc=saved.canvases[0].proposed.document;
 for(const diagram of c.diagrams)assert.equal(doc.scene.contents[diagram.contentId].content.ascii,diagram.ascii);
 results.push({key,runId:job.runId,children:children.length,mappedNodes:status.mappedNodes,nodes:status.nodes,usage:response.usage,accounting:response.accounting});
}
await writeFile(path.join(dir,'pilot-check.json'),JSON.stringify({passed:true,checkedAt:new Date().toISOString(),pilot:plan.pilot,results},null,2)+'\n');
console.log(JSON.stringify(results.map(({key,children,mappedNodes,nodes})=>({key,children,mappedNodes,nodes})),null,2));
