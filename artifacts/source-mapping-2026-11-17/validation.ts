import {execFileSync} from 'node:child_process';
import {Type} from 'typebox';
import {z} from 'zod';
import path from 'node:path';
export const mappingOutputSchema=z.object({diagrams:z.array(z.object({diagramId:z.string(),mappings:z.array(z.object({node:z.string(),path:z.string(),startLine:z.number().int().positive(),endLine:z.number().int().positive()}).strict())}).strict()),notes:z.string()}).strict();
export function validateMappingRanges(input:any,raw:unknown){
 const parsed=mappingOutputSchema.safeParse(raw);
 if(!parsed.success)return {valid:false,errors:parsed.error.issues.map(i=>({kind:'schema',location:i.path.join('.'),message:i.message}))};
 const errors:any[]=[],cache=new Map<string,string[]>();
 const expected=input.diagrams.map((d:any)=>d.diagramId).sort(),actual=parsed.data.diagrams.map(d=>d.diagramId).sort();
 if(JSON.stringify(expected)!==JSON.stringify(actual))errors.push({kind:'diagram-set',expected,actual});
 for(const d of parsed.data.diagrams){const diagram=input.diagrams.find((x:any)=>x.diagramId===d.diagramId);if(!diagram)continue;
  for(const [index,m]of d.mappings.entries()){
   const location={diagramId:d.diagramId,index,node:m.node,path:m.path,startLine:m.startLine,endLine:m.endLine};
   if(!diagram.nodes.some((n:any)=>n.ref===m.node))errors.push({...location,kind:'unknown-node'});
   if(path.isAbsolute(m.path)||m.path.split(/[\\/]/).includes('..')||m.path.includes('\\')){errors.push({...location,kind:'invalid-path'});continue;}
   let lines=cache.get(m.path);
   if(!lines){try{const text=execFileSync('git',['show',`${input.repo.commit}:${m.path}`],{cwd:input.repo.repositoryPath,encoding:'utf8',maxBuffer:20*1024*1024,stdio:['ignore','pipe','pipe']});lines=text.length?text.replace(/\n$/,'').split('\n'):[];cache.set(m.path,lines);}catch{errors.push({...location,kind:'missing-source-file'});continue;}}
   if(m.endLine<m.startLine||m.endLine>lines.length)errors.push({...location,kind:'invalid-source-range',actualFileLines:lines.length});
  }
 }
 return {valid:errors.length===0,errors};
}
export function mappingValidationTool(input:any,onResult:(result:any)=>Promise<void>){return {
 name:'validate_source_mappings',label:'Validate source mappings',description:'Check candidate node references and source ranges against the pinned repository. Returns all structural errors, including actual file line counts. Does not choose ranges, change mappings, or assess semantic correctness.',
 parameters:Type.Object({candidate:Type.String({description:'JSON mapping output using the submission schema in the prompt.'})}),
 async execute(_id:string,args:{candidate:string}){let result:any;try{result=validateMappingRanges(input,JSON.parse(args.candidate));}catch(e){result={valid:false,errors:[{kind:'invalid-json',message:String(e)}]};}await onResult({...result,candidate:args.candidate});return {content:[{type:'text' as const,text:JSON.stringify(result)}],details:result};}
};}

// Notes and serialization order are not source-mapping choices.
export function sameMappingChoices(a:any,b:any){
 const normalize=(x:any)=>x.diagrams.map((d:any)=>({diagramId:d.diagramId,mappings:d.mappings.map((m:any)=>[m.node,m.path,m.startLine,m.endLine]).sort((x:any,y:any)=>JSON.stringify(x).localeCompare(JSON.stringify(y)))})).sort((x:any,y:any)=>x.diagramId.localeCompare(y.diagramId));
 return JSON.stringify(normalize(a))===JSON.stringify(normalize(b));
}
