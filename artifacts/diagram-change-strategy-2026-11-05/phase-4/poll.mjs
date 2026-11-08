import fs from 'node:fs/promises';
const dir='artifacts/diagram-change-strategy-2026-11-05/phase-4';
const {runs:ids}=JSON.parse(await fs.readFile(`${dir}/ids.json`));
const api='http://127.0.0.1:5191/api/mapping/evals';
for (;;) {
  const start=Date.now();
  try {
    const runs=await Promise.all(ids.map(async id=>{const r=await fetch(`${api}/runs/${id}`);if(!r.ok)throw Error(`HTTP ${r.status}`);return r.json()}));
    const counts={},errors=[];
    for(const [i,r] of runs.entries())for(const c of r.cells){counts[c.status]=(counts[c.status]??0)+1;if(c.status==='failed')errors.push({context:i+1,sample:c.pass,error:c.error});}
    const entry={at:new Date().toISOString(),counts,errors};
    await fs.appendFile(`${dir}/poll-log.jsonl`,JSON.stringify(entry)+'\n');
    console.log(JSON.stringify(entry));
    await fs.writeFile(`${dir}/latest-runs.json`,JSON.stringify(runs,null,2)+'\n');
    if(runs.flatMap(r=>r.cells).length===14&&runs.every(r=>r.cells.every(c=>['finished','failed','cancelled','skipped'].includes(c.status))))break;
  }catch(e){console.log(JSON.stringify({at:new Date().toISOString(),pollError:String(e)}));}
  await new Promise(resolve=>setTimeout(resolve,Math.max(0,30000-(Date.now()-start))));
}
