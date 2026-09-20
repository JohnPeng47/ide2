// Source-specific transcription. Each visible label is retained verbatim and
// linked to its occurrence in the immutable D5 drawing; no labels are inferred.
import { readFileSync, writeFileSync } from 'node:fs';
const source=JSON.parse(readFileSync(new URL('./diagrams.json',import.meta.url)))[1];
const lines=source.ascii.split('\n');
const nodes=[];
function node(key,line,label,kind='detail') {
  const column=lines[line-1].indexOf(label);
  if(column<0 || lines[line-1].indexOf(label,column+1)>=0)throw new Error(`Ambiguous label: ${label}`);
  nodes.push({id:key,label,kind,source:{line,startColumn:column+1,endColumn:column+label.length},
    box:{x:0,z:0,width:kind==='service'?250:label.length<=16?190:240,depth:kind==='service'?155:kind==='document'?125:110,height:kind==='service'?72:kind==='document'?22:35}});
}
// The flow travels from the back of the floor toward the reader. Branches
// occupy adjacent lanes; every source leaf gets its own independent box.
node('file-changes',4,'File changes');
node('refresh',5,'Explicit refresh');
node('git-operations',6,'Git operations');
node('repository',5,'Repository','service');
node('ext-host',5,'ExtHostSCM','service');
node('registration',6,'provider / group registration');
node('splices',7,'resource splices');
node('main-thread',10,'MainThreadSCM','service');
node('provider',13,'MainThreadSCMProvider','service');
node('identity',14,'identity / root');
node('groups',15,'groups / resources');
node('notifications',16,'change notifications');
node('repositories',18,'SCMService.repositories','service');
node('focus',19,'focus / selection');
node('view',22,'SCMViewPane','service');
node('tree',23,'tree / list');
node('decorations',24,'decorations');
node('actions',25,'resource actions');
node('stage',30,'CommandCenter.stage','service');
node('add',32,'Repository.add','service');
node('git-add',33,'git add');
node('status-refresh',33,'status refresh');
node('resource-update',34,'resource groups update again');
node('command-resolver',39,'ResourceCommandResolver','service');
node('single',40,'single file');
node('open',40,'vscode.open');
node('conflict',41,'conflict');
node('merge',41,'merge editor');
node('comparison',42,'comparison');
node('diff-command',42,'vscode.diff [COMMAND]');
node('editor-service',42,'EditorService','service');
node('diff-input',42,'DiffEditorInput','service');
node('original-uri',44,'original URI','document');
node('modified-uri',44,'modified URI','document');
node('model-resolver',49,'TextModelResolverService','service');
node('reuse',50,'reuse loaded document');
node('resolve',51,'resolve missing contents');
node('file-service',54,'FileService','service');
node('git-provider',54,'GitFileSystemProvider','service');
node('readonly',55,'readonly revision contents');
node('buffer',56,'Repository.buffer','service');
node('git-show',57,'git show');
node('filesystem',56,'File-system provider','service');
node('working',57,'working-file contents','document');
node('text-file',62,'TextFileService','service');
node('decode',63,'decode each resource');
node('original-model',68,'original TextModel','document');
node('modified-model',68,'modified TextModel','document');
node('diff-model',73,'TextDiffEditorModel','service');
node('original-ref',74,'original reference');
node('modified-ref',75,'modified reference');
node('diff-editor',73,'TextDiffEditor / DiffEditorWidget','service');
node('compare',74,'compare models');
node('original-editor',75,'original code editor');
node('modified-editor',76,'modified code editor');
node('editing',77,'editing / undo / save');
const edges=[];
function edge(from,to,kind='flow',label=null,line=null) {edges.push({id:`${from}:${to}`,from,to,kind,label,sourceLine:line});}
function children(parent,...ids) {for(const id of ids)edge(parent,id,'contains');}
for(const id of ['file-changes','refresh','git-operations'])edge(id,'repository');
edge('repository','ext-host','flow','resource groups',5);
children('ext-host','registration','splices');
edge('registration','main-thread');edge('splices','main-thread');edge('main-thread','provider');
children('provider','identity','groups','notifications');
for(const id of ['provider','repositories','focus'])edge(id,'view');
children('view','tree','decorations','actions');
edge('view','stage','flow','Stage',27);edge('stage','add');children('repository','add');
children('add','git-add');edge('git-add','status-refresh');children('git-add','resource-update');
edge('view','command-resolver','flow','Open Changes',36);
children('command-resolver','single','conflict','comparison');edge('single','open');edge('conflict','merge');
edge('comparison','diff-command');edge('diff-command','editor-service');edge('editor-service','diff-input');
edge('diff-input','original-uri');edge('diff-input','modified-uri');
edge('original-uri','model-resolver');edge('modified-uri','model-resolver');
children('model-resolver','reuse','resolve');edge('model-resolver','file-service');
edge('file-service','git-provider','flow','git:',54);edge('file-service','filesystem','flow','file:',56);
children('git-provider','readonly','buffer');children('buffer','git-show');children('filesystem','working');
edge('git-show','text-file');edge('working','text-file');children('text-file','decode');
edge('text-file','original-model');edge('text-file','modified-model');
edge('original-model','diff-model');edge('modified-model','diff-model');
children('diff-model','original-ref','modified-ref');edge('diff-model','diff-editor');
children('diff-editor','compare','original-editor','modified-editor');children('modified-editor','editing');
const annotations=[{role:'heading',line:1,text:lines[0]},
  ...edges.filter(e=>e.label).map(e=>({role:'route',line:e.sourceLine,text:e.label})),
  ...[80,81].map(line=>({role:'legend',line,text:lines[line-1]}))];
// Compact the source into consecutive floor bands. Each node remains a
// separate occurrence; these positions can be edited in the saved JSON.
const chapterNames=['01 / SOURCE CONTROL','02 / OPEN CHANGES','03 / DOCUMENT MODELS'];
const chapters=chapterNames.map((name,i)=>({name,x:-30,z:i*1000-105}));
for(let chapter=0;chapter<3;chapter++) {
  const members=nodes.filter(n=>n.source.line<(chapter===0?30:chapter===1?54:Infinity)
    && n.source.line>=(chapter===0?0:chapter===1?30:54));
  members.forEach((n,index)=>{
    const row=Math.floor(index/6),column=row%2?5-index%6:index%6;
    n.box.x=column*330+(250-n.box.width)/2;n.box.z=chapter*1000+row*240;
  });
}
const scene={format:'projection-3d',version:2,kind:'node-boxes',id:'d5-boxes',name:'D5 — ink & paper',
  source,nodes,edges,annotations,
  chapters,
  view:{azimuth:45,elevation:35.264,zoom:1,panX:0,panY:0,selected:null,showConnections:true},viewport:{width:1400,height:850}};
writeFileSync(new URL('./visualizations/d5-boxes.json',import.meta.url),JSON.stringify(scene,null,2)+'\n');
console.log(`${nodes.length} boxes, ${edges.length} connections`);
