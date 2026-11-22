import {readFile,writeFile,rename} from 'node:fs/promises';
import path from 'node:path';import {fileURLToPath} from 'node:url';import assert from 'node:assert/strict';
import {sourceBindingFromLocation} from '../../domain/core/diagrams/diagram';
const dir=path.dirname(fileURLToPath(import.meta.url)),root=path.resolve(dir,'../..'),file=path.join(root,'.diagrams-local/canvas-domain-model/project.json');
const original=await readFile(file,'utf8'),project=JSON.parse(original),added=[];
for(const name of ['mapping','pi','opencode','ghostty']){const c=JSON.parse(await readFile(path.join(dir,`core-${name}-input.json`),'utf8')),binding=sourceBindingFromLocation({checkoutRoot:c.repo.repositoryPath,repositoryIdentity:c.repo.repositoryPath,gitRevision:c.repo.commit});project.sources??=[];const existing=project.sources.find((s:any)=>s.sourceId===binding.sourceId);if(existing){assert.deepEqual(existing,binding);}else{project.sources.push(binding);added.push(binding);}}
if(added.length){await writeFile(path.join(dir,'source-registration.json'),JSON.stringify({projectId:project.id,added,previousSources:JSON.parse(original).sources??[]},null,2)+'\n');assert.equal(await readFile(file,'utf8'),original,'Project changed concurrently');const temporary=file+'.source-mapping.tmp';await writeFile(temporary,JSON.stringify(project,null,2)+'\n');await rename(temporary,file);}
console.log({registered:added.length});
