import assert from 'node:assert/strict';
import { access, mkdir, readdir, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { withHeadlessBrowser, evaluate, waitFor, waitForSelector, captureScreenshot, DEFAULT_CHROME_PATHS } from '../../lib/browser.mjs';
import { withFixture } from '../../lib/fixture.mjs';
import { sourceText } from '../fixtures/source.mjs';

export { evaluate, waitFor, waitForSelector, captureScreenshot };
export const pane=id=>`[data-display-node="source-${id}"]`;
export const viewer=id=>`${pane(id)} .source-code-viewer`;
export const parameters=JSON.parse(process.env.BENCH_PARAMETERS??'{}');
export const output=process.env.BENCH_OUTPUT;
const app=process.env.BENCH_APP_ROOT;
export const settle=cdp=>evaluate(cdp,'new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))).then(()=>true)');
export const positions=cdp=>evaluate(cdp,`Object.fromEntries([...document.querySelectorAll('[data-pane-content="source-code"]')].map(p=>{const v=p.querySelector('.source-code-viewer');return[p.dataset.displayNode,v?{top:v.scrollTop,left:v.scrollLeft}:null]}))`);
export async function point(cdp,selector){
  return evaluate(cdp,`(()=>{const e=document.querySelector(${JSON.stringify(selector)});if(!e)throw Error('Missing target');const r=e.getBoundingClientRect(),p={x:r.x+Math.min(100,r.width/2),y:r.y+Math.min(100,r.height/2)};if(!e.contains(document.elementFromPoint(p.x,p.y)))throw Error('Occluded target: '+${JSON.stringify(selector)});return p})()`);
}
export async function click(cdp,selector){
  let p;
  await waitFor(async()=>{p=await evaluate(cdp,`(()=>{const e=document.querySelector(${JSON.stringify(selector)});if(!e)return null;const r=e.getBoundingClientRect(),p={x:r.x+r.width/2,y:r.y+r.height/2};return e.contains(document.elementFromPoint(p.x,p.y))?p:null})()`);return !!p;},{message:`Click target unavailable: ${selector}`});
  await cdp.send('Input.dispatchMouseEvent',{type:'mousePressed',...p,button:'left',buttons:1,clickCount:1});
  await cdp.send('Input.dispatchMouseEvent',{type:'mouseReleased',...p,button:'left',buttons:0,clickCount:1});
}
export async function ready(cdp,count){
  await waitFor(async()=>evaluate(cdp,`document.querySelectorAll('.source-code-viewer[data-highlighted="true"]').length===${count}&&!document.querySelector('.source-code-viewer[data-highlight-error]')`),{timeoutMs:60000,message:`Expected ${count} highlighted source panes`});
  await settle(cdp);
}
async function chromePath(){
  if(process.env.CHROME_PATH){await access(process.env.CHROME_PATH);return process.env.CHROME_PATH;}
  const cache=path.join(homedir(),'.cache/ms-playwright');
  const versions=(await readdir(cache).catch(()=>[])).filter(x=>/^chromium-\d+$/.test(x)).sort((a,b)=>Number(b.split('-')[1])-Number(a.split('-')[1]));
  // Prefer native Linux Chrome in WSL; Windows profile locks have different lifetimes.
  const candidates=[...DEFAULT_CHROME_PATHS.filter(p=>!p.endsWith('.exe')),...versions.map(v=>path.join(cache,v,'chrome-linux64/chrome')),...DEFAULT_CHROME_PATHS.filter(p=>p.endsWith('.exe'))];
  for(const file of candidates)if(await access(file).then(()=>true,()=>false))return file;
  throw Error('Chrome/Chromium not found. Set CHROME_PATH to its executable.');
}
export async function session(name,run){
  assert(app&&output,'Run through benchmarks/runner.mjs');
  const destination=path.join(output,name);await mkdir(destination,{recursive:true});
  await withFixture({app,output:destination,workspaceFile:fileURLToPath(new URL('../fixtures/workspace.json',import.meta.url)),sourceText},async({url,fixtureSha256})=>{
    const launched=performance.now();
    await withHeadlessBrowser({url:`${url}/mapping?diagram=source`,width:parameters.width,height:parameters.height,chromePath:await chromePath(),arguments:process.platform==='linux'?['--no-sandbox']:[]},async({cdp})=>{
      const errors=[];await cdp.send('Runtime.enable');await cdp.send('Page.enable');await cdp.send('Performance.enable');
      cdp.on('Runtime.exceptionThrown',e=>errors.push(e.exceptionDetails.exception?.description??e.exceptionDetails.text));
      await cdp.send('Emulation.setDeviceMetricsOverride',{width:parameters.width,height:parameters.height,deviceScaleFactor:1,mobile:false});
      try {
        await waitForSelector(cdp,viewer(5),{timeoutMs:60000});await ready(cdp,5);await evaluate(cdp,'document.fonts.ready.then(()=>true)');await settle(cdp);
        assert.equal(await evaluate(cdp,`!!document.querySelector('script[src*="/@vite/client"]')`),false,'Benchmark must run a production build');
        const browser=await cdp.send('Browser.getVersion');
        const environment=await evaluate(cdp,`({width:innerWidth,height:innerHeight,dpr:devicePixelRatio,hardwareConcurrency:navigator.hardwareConcurrency,renderer:(()=>{const gl=document.createElement('canvas').getContext('webgl');if(!gl)return null;const ext=gl.getExtension('WEBGL_debug_renderer_info');return ext?gl.getParameter(ext.UNMASKED_RENDERER_WEBGL):gl.getParameter(gl.RENDERER)})()})`);
        await run({cdp,url,destination,metadata:{browser,environment,fixtureSha256,initialFivePaneReadyMs:performance.now()-launched,sourceLines:sourceText.split('\n').length}});
        assert.deepEqual(errors,[],'No browser runtime exceptions');
      } catch(error){await captureScreenshot(cdp,{output:path.join(destination,'failure.png')}).catch(()=>{});throw error;}
      finally{await writeFile(path.join(destination,'runtime-errors.json'),JSON.stringify(errors,null,2));}
    });
  });
}
