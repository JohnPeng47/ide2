import {createHash} from 'node:crypto';
import {readFile,realpath} from 'node:fs/promises';
import {Type} from 'typebox';
import {z} from 'zod';
import {validateMappingRanges as checkRanges} from '../validation';
const enums=<T extends string>(values:[T,...T[]])=>z.array(z.enum(values)).nonempty().refine(a=>new Set(a).size===a.length,'Repeated enum');
const scope=enums(['structure','entity','behavior','relationship','guarantee','subsystem']);
const role=enums(['declaration','use','implementation']);
const mapping=z.object({node:z.string(),path:z.string(),startLine:z.number().int().positive(),endLine:z.number().int().positive(),role}).strict();
export const mappingOutputSchema=z.object({diagrams:z.array(z.object({diagramId:z.string(),nodes:z.array(z.object({node:z.string(),scope}).strict()),mappings:z.array(mapping)}).strict()),notes:z.string()}).strict();
export const digest=(s:string)=>createHash('sha256').update(s).digest('hex');
export function validateMappingRanges(c:any,raw:unknown){
 const parsed=mappingOutputSchema.safeParse(raw);
 if(!parsed.success)return {valid:false,errors:parsed.error.issues};
 const plain=parsed.data.diagrams.map(d=>({diagramId:d.diagramId,mappings:d.mappings.map(({role,...range})=>range)}));
 const result=checkRanges(c,{diagrams:plain,notes:parsed.data.notes});
 const errors:unknown[]=[...result.errors];
 for(const d of parsed.data.diagrams){
  const expected=c.diagrams.find((x:any)=>x.diagramId===d.diagramId)?.nodes.map((n:any)=>n.ref).sort();
  if(JSON.stringify(expected)!==JSON.stringify(d.nodes.map(n=>n.node).sort()))errors.push({diagram:d.diagramId,issue:'Include each supplied node once in nodes'});
 }
 return {valid:errors.length===0,errors};
}
export function mappingValidationTool(c:any,save:(record:any)=>Promise<void>){return {
 name:'validate_source_mappings',label:'Validate source mappings',description:'Validate the complete candidate JSON. Supply candidate JSON text or a candidatePath in your private /tmp (exactly one). A successful check saves the complete candidate and returns its sha256 for submission.',
 parameters:Type.Object({candidate:Type.Optional(Type.String()),candidatePath:Type.Optional(Type.String())}),
 async execute(_id:string,args:{candidate?:string,candidatePath?:string}){
  let candidate=args.candidate??'',result;
  try{
   if((args.candidate!==undefined)===(args.candidatePath!==undefined))throw Error('Supply one candidate or candidatePath');
   if(args.candidatePath){const file=await realpath(args.candidatePath);if(!file.startsWith('/tmp/'))throw Error('Use your private /tmp directory');candidate=await readFile(file,'utf8');}
   result=validateMappingRanges(c,JSON.parse(candidate));
  }catch(e){result={valid:false,errors:[String(e)]};}
  const details={...result,...(result.valid?{sha256:digest(candidate)}:{})};await save({...details,candidate});return {content:[{type:'text' as const,text:JSON.stringify(details)}],details};
 }
};}
