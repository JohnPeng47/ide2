import { modelDescription, originalDiscovery } from './prompts';
/** Used only by the disposable end-to-end smoke test; never in a production directory. */
export function fixtureOutput(stage:string,files:Record<string,any>,pointCount=1) {
  if(stage==='author')return {plain:originalDiscovery,model:originalDiscovery+'\n'+modelDescription,rationale:'Deterministic fixture'};
  if(stage==='discover')return {summary:'Fixture discovery',points:Array.from({length:pointCount},(_,i)=>({id:i===0?'core':`point${i+1}`,title:`Fixture point ${i+1}`,rationale:'Exercise the pipeline',sourcePaths:[files['source-index.json'].files[0].path],relationships:[]})),reviewedPaths:[files['source-index.json'].files[0].path],limitations:['Deterministic fixture, not a model inspection']};
  if(stage==='tree')return {ascii:'Core fixture\n`-- Supported detail'};
  if(stage==='expand')return {explanation:'Deterministic fixture',diagrams:[{id:'central',ascii:'Core fixture\n`-- Detail',position:{column:0,row:0}},{id:'detail',ascii:'Supporting detail\n`-- Implementation',position:{column:100,row:0}}],edges:[{source:{diagram:'central',line:2},target:{diagram:'detail',line:1},label:'expands'}]};
  if(stage==='select')return {assessments:files['variants.json'].map((v:any)=>({variantId:v.variantId,strengths:'Fixture',weaknesses:'Fixture',improvementPotential:'Fixture'})),selectedVariantIds:['A1','C2'],rationale:'Deterministic fixture selection'};
  if(stage==='critique')return {summary:'Fixture critique',strengths:['Readable'],issues:[{evidence:'central line 2',impact:'Fixture only',recommendation:'Retain structure'}],regenerationInstructions:'Preserve the supporting detail.'};
  throw Error('Unknown fixture stage');
}
