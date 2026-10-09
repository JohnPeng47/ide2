import { execFileSync, spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createServer } from 'node:net';
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import { createWriteStream } from 'node:fs';
import { tmpdir } from 'node:os';
import { once } from 'node:events';
import path from 'node:path';
import { waitFor } from './browser.mjs';

export const hash = value => createHash('sha256').update(value).digest('hex');
export async function withFixture({app,output,workspaceFile,sourceText},run) {
  const root=await mkdtemp(path.join(tmpdir(),'diagram-benchmark-'));
  let server, log;
  try {
    execFileSync('git',['init','-q',root]);
    const projectId=`project-${hash(path.join(root,'.git')).slice(0,12)}`;
    const raw=await readFile(workspaceFile,'utf8'),workspace=JSON.parse(raw.replaceAll('performance-fixture',projectId));
    const doc=workspace.documents[0],ascii=doc.document.scene.contents.overview.content.ascii;
    const source={sourceId:'benchmark-source',repositoryIdentity:path.join(root,'.git'),domainProfileId:'source-code',corpus:{kind:'git-worktree',root}};
    doc.document.scene.contents.overview.sourceContext.binding=source;
    doc.savedScene=JSON.stringify(doc.document.scene);
    for(const node of Object.values(doc.canvas.display.nodes))if(node.content?.kind==='source-code')node.content.sourceId=source.sourceId;
    const timestamp='2026-09-26T00:00:00.000Z';
    const representation={schemaVersion:1,id:'source',projectId,handle:'source',name:doc.name,viewKind:'diagram',representationKind:'diagram',status:'settled',currentRevisionId:'revision-source',revisionIds:['revision-source'],createdAt:timestamp,updatedAt:timestamp};
    const revision={schemaVersion:1,id:'revision-source',projectId,representationId:'source',revision:1,ascii,asciiSha256:hash(ascii),representationKind:'diagram',evidence:{},mappings:[],content:{kind:'mapping-canvas',scene:doc.document.scene},createdAt:timestamp};
    await mkdir(path.join(root,'.diagrams/representations'),{recursive:true});await mkdir(path.join(root,'src'));
    await writeFile(path.join(root,'src/large.ts'),sourceText);
    await writeFile(path.join(root,'.diagrams/project.json'),JSON.stringify({schemaVersion:1,id:projectId,name:doc.name,sources:[source],defaultDomainProfileId:'source-code',diagramSetIds:[],createdAt:timestamp,updatedAt:timestamp}));
    await writeFile(path.join(root,'.diagrams/representations/catalog.json'),JSON.stringify({schemaVersion:1,projectId,activeByKind:{diagram:'source'},representations:{source:representation},revisions:{'revision-source':revision},projections:{},createdAt:timestamp,updatedAt:timestamp}));
    await writeFile(path.join(root,'.diagrams/mapping-workspace.json'),JSON.stringify(workspace));
    const port=await new Promise(resolve=>{const s=createServer();s.listen(0,'127.0.0.1',()=>{const port=s.address().port;s.close(()=>resolve(port));});});
    const url=`http://127.0.0.1:${port}`;
    log=createWriteStream(path.join(output,'server.log'));
    server=spawn(process.execPath,['scripts/dev/start-server.mjs', '--http','preview','--host','127.0.0.1','--port',String(port),'--strictPort'],{cwd:app,env:{...process.env,NEW_DIAGRAM_PROJECT_ROOT:root,NEW_DIAGRAMS_DIR:path.join(root,'.diagrams'),NEW_DIAGRAM_AGENT:'fake'},stdio:['ignore','pipe','pipe']});
    server.stdout.pipe(log,{end:false});server.stderr.pipe(log,{end:false});
    await waitFor(async()=>{if(server.exitCode!==null)throw Error('Preview server exited; see server.log');return(await fetch(url).catch(()=>null))?.ok;},{timeoutMs:30000,message:'Preview startup failed; see server.log'});
    await run({url,root,fixtureSha256:hash(raw+'\0'+sourceText)});
  } finally {
    if(server?.exitCode===null){const closed=once(server,'close');server.kill('SIGTERM');const timer=setTimeout(()=>server.kill('SIGKILL'),5000);await closed;clearTimeout(timer);}
    if(log){log.end();await once(log,'finish');}
    await rm(root,{recursive:true,force:true});
  }
}
