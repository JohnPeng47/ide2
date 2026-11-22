import {homedir} from 'node:os';
import {readFile} from 'node:fs/promises';
// The installed Pi model list predates these IDs. Use the advertised Codex
// catalog entries with the existing authenticated Codex Responses transport.
export async function modelDescriptor(runtime:any,id:string){
 if(!['gpt-6.2-astra','gpt-6.2-sol'].includes(id))throw Error('Unexpected model: '+id);
 const provider='openai-codex',catalog=JSON.parse(await readFile(homedir()+'/.codex/models_cache.json','utf8'));
 const entry=catalog.models.find((m:any)=>m.slug===id&&m.supported_reasoning_levels.some((r:any)=>r.effort==='high'));
 if(!entry||!runtime.hasConfiguredAuth(provider))throw Error('Requested model or provider credentials unavailable');
 const base=runtime.getModel(provider,id.replace('6.2','6'));
 const model=runtime.getModel(provider,id)??{...base,id,name:entry.display_name,contextWindow:entry.context_window};
 if(!model.api||!model.reasoning)throw Error('Missing model transport or reasoning support');
 return {runtime,model,provider,modelId:id};
}
