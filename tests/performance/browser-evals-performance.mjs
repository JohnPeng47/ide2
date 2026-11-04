// Build first. Run with CHROME_PATH as needed; EVALS_PERF_STORE and EVALS_PERF_RUN select the source fixture.
import { chromium, expect } from '@playwright/test';
import { mkdtemp, cp, rm, readFile, writeFile } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';
const cwd=process.cwd();
const storeRoot=process.env.EVALS_PERF_STORE ?? path.join(cwd,'.diagrams-local/canvas-domain-model');
const label=process.argv[2] ?? 'after';
if (!/^[a-z0-9-]+$/.test(label)) throw Error('Invalid result label');
const runId=process.env.EVALS_PERF_RUN ?? '062c7abc-2c47-4621-8104-8a3e7de28a85';
const run=JSON.parse(await readFile(path.join(storeRoot,'eval-runs',runId+'.json'),'utf8'));
const cell=run.cells.find(c=>c.canvasId&&!c.deleted);
const results=[];
for(let trial=1;trial<=3;trial++){
 const root=await mkdtemp(path.join(tmpdir(),'evals-perf-fixture-'));
 let server,browser;
 try{
  await cp(storeRoot,path.join(root,'.diagrams'),{recursive:true});
  const port=await new Promise(resolve=>{const s=createServer();s.listen(0,'127.0.0.1',()=>{const p=s.address().port;s.close(()=>resolve(p));});});
  const url=`http://127.0.0.1:${port}`;
  server=spawn(process.execPath,['scripts/dev/start-server.mjs','preview','--host','127.0.0.1','--port',String(port),'--strictPort'],{cwd,env:{...process.env,NEW_DIAGRAM_PROJECT_ROOT:root,NEW_DIAGRAMS_DIR:path.join(root,'.diagrams'),NEW_DIAGRAM_AGENT:'fake'},stdio:['ignore','pipe','pipe']});
  let logs='';server.stdout.on('data',c=>logs+=c);server.stderr.on('data',c=>logs+=c);
  await expect.poll(async()=>(await fetch(url).catch(()=>null))?.status,{timeout:60000}).toBe(200);
  browser=await chromium.launch({headless:true,...(process.env.CHROME_PATH ? { executablePath:process.env.CHROME_PATH } : {}),args:['--no-sandbox']});
  const page=await browser.newPage({viewport:{width:1500,height:940},timezoneId:'America/Toronto'});
  page.on('dialog',d=>void d.accept());
  const start=performance.now();
  await page.goto(`${url}/evals?run=${run.id}&output=${encodeURIComponent(cell.key)}`);
  await expect(page.locator('.compare-canvas .mapping-poc-ascii').first()).toBeVisible({timeout:120000});
  await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
  const loadMs=performance.now()-start;
  const resources=await page.evaluate(()=>performance.getEntriesByType('resource').filter(r=>r.name.includes('/api/')).map(r=>({url:new URL(r.name).pathname,duration:r.duration,bytes:r.decodedBodySize})));

  const selected=page.getByRole('tree',{name:'Evals outputs'}).locator('.evals-tree-row.is-current');
  await expect(selected).toHaveCount(1);
  const responseWait=page.waitForResponse(r=>r.request().method()==='DELETE'&&r.url().includes(`/canvases/${cell.canvasId}`),{timeout:120000});
  let deleteStart=performance.now();
  await selected.getByRole('button',{name:/Delete output/}).click();
  const modal=page.getByRole('dialog',{name:'Delete output'});
  let modalMs;
  if(label!=='before'){
   await expect(modal).toBeVisible();modalMs=performance.now()-deleteStart;

   deleteStart=performance.now();await modal.getByRole('button',{name:'Delete',exact:true}).click();
  }
  const response=await responseWait;await response.finished();
  const apiMs=performance.now()-deleteStart;
  if(!response.ok())throw Error(await response.text());
  await expect(selected).toHaveCount(0,{timeout:120000});
  const deleteMs=performance.now()-deleteStart;
  const result={trial,loadMs,deleteMs,apiMs,modalMs,resources};results.push(result);console.log(JSON.stringify(result));
 }finally{
  await browser?.close();
  if(server){const exited=new Promise(r=>server.once('exit',r));server.kill('SIGTERM');await exited;}
  await rm(root,{recursive:true,force:true});
 }
}
await writeFile(`/tmp/evals-perf-${label}.json`,JSON.stringify(results,null,2));
