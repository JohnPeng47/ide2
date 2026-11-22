import {readFile,writeFile} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import assert from 'node:assert/strict';
import {validateMappingRanges,mappingValidationTool,sameMappingChoices} from './validation';
const dir=path.dirname(fileURLToPath(import.meta.url));
const read=async(p:string)=>JSON.parse(await readFile(path.join(dir,p),'utf8'));
const input=await read('core-mapping-input.json'),checks=[];
for(const effort of ['low','medium'])for(const n of [1,2,3]){
 const key=`core-mapping-${effort}-${n}`,response=await read(`jobs/${key}/response.json`),raw=typeof response.output==='string'?JSON.parse(response.output):response.output;
 const result=validateMappingRanges(input,raw);assert.equal(result.valid,effort==='medium');
 let recorded;const tool=mappingValidationTool(input,async r=>{recorded=r;});const toolResult=await tool.execute('replay',{candidate:JSON.stringify(raw)});assert.deepEqual(toolResult.details,result);assert.deepEqual(recorded,{...result,candidate:JSON.stringify(raw)});
 checks.push({key,...result});
}
const empty={diagrams:input.diagrams.map((d:any)=>({diagramId:d.diagramId,mappings:[]})),notes:''};
assert.equal(validateMappingRanges(input,empty).valid,true);
const mapping={node:input.diagrams[0].nodes[0].ref,path:'src/app/App.tsx',startLine:12,endLine:12};
const one=(m:any)=>({...empty,diagrams:[{diagramId:input.diagrams[0].diagramId,mappings:[m]}]});
assert.equal(validateMappingRanges(input,one(mapping)).valid,true);
assert.equal(validateMappingRanges(input,one({...mapping,endLine:13})).valid,false);
assert.equal(validateMappingRanges(input,one({...mapping,node:'missing'})).valid,false);
assert.equal(validateMappingRanges(input,one({...mapping,path:'../outside'})).valid,false);
assert.equal(validateMappingRanges(input,one({...mapping,path:'missing.ts'})).valid,false);
assert.equal(validateMappingRanges(input,one({...mapping,startLine:12,endLine:11})).valid,false);
const malformed=await mappingValidationTool(input,async()=>{}).execute('bad',{candidate:'{'});assert.equal(malformed.details.valid,false);
await writeFile(path.join(dir,'validation-replay.json'),JSON.stringify({modelCalls:0,checks,edgeCases:['empty mappings','last actual line','past end','unknown node','path traversal','missing file','reversed range','invalid JSON']},null,2)+'\n');
console.log(checks.map(c=>({key:c.key,valid:c.valid,errors:c.errors.length})));

const response=await read('jobs/core-pi-low-3-v2/response.json');
const candidateChecks=(await readFile(path.join(dir,'jobs/core-pi-low-3-v2/validation-checks.jsonl'),'utf8')).trim().split('\n').map(s=>JSON.parse(s));
const final=typeof response.output==='string'?JSON.parse(response.output):response.output;
assert.ok(candidateChecks.some(c=>c.valid&&sameMappingChoices(JSON.parse(c.candidate),final)));
assert.equal(sameMappingChoices(final,{...final,notes:'Different explanation',diagrams:final.diagrams.map((d:any)=>({...d,mappings:[...d.mappings].reverse()}))}),true);
assert.equal(sameMappingChoices(final,{...final,diagrams:final.diagrams.map((d:any)=>({...d,mappings:d.mappings.slice(1)}))}),false);
console.log('Validated-choice replay passed: notes/order accepted, changed mappings rejected.');
