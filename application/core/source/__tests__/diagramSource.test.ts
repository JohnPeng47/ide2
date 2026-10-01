import { canvasSaveFixture } from '../../../../tests/support/mappingDiagram';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, expect, it } from 'vitest';
import { sourceBindingFromLocation } from '../../../../domain/core/diagrams/diagram';
import { sceneFromRevision, singleDiagramScene } from '../../../../domain/core/diagrams/projectDiagramCanvas';
import { diagramSelectionNodes, mappingDocumentFromScene } from '../../../../domain/mapping/workspace/mappingDocument';
import { MappingDocumentController } from '../../../../domain/mapping/workspace/mappingDocumentController';
import { initialCanvasState } from '../../../../domain/mapping/workspace/mappingWorkspace';
import { DiagramStore } from '../../../../infrastructure/core/persistence/store';
import { QuickJsAgentRuntime } from '../../../../infrastructure/mapping/agent/execRuntime';
import { corpusAccess } from '../../../../src/server/app/bootstrap';
import type { CanvasSessionPort } from '../../../mapping/agent/ports';
import { AgentDiagrammingSessionService } from '../../../mapping/agent/sessionService';
import { MappingDiagramService } from '../../../mapping/diagrams/diagramService';
import { resolveDiagramSource } from '../diagramSource';
import { ProjectSourceService } from '../projectSource';

const roots: string[] = [];
afterEach(async () => { await Promise.all(roots.splice(0).map(root => rm(root,{recursive:true,force:true}))); });
it('isolates same-path source reads, mapped evidence and compactions across repos in one canvas', async () => {
  const root = await mkdtemp(path.join(tmpdir(),'diagram-sources-')); roots.push(root);
  const store = new DiagramStore(root);
  const project = await store.ensureProject({checkoutRoot:root,repositoryIdentity:'project-is-not-a-repo'});
  const sources = await Promise.all(['a','b'].map(async name => {
    const dir=path.join(root,name); await mkdir(path.join(dir,'.git'),{recursive:true});
    await writeFile(path.join(dir,'same.ts'),`export const origin = '${name}';\n`);
    return sourceBindingFromLocation({checkoutRoot:dir,repositoryIdentity:`repo-${name}`});
  }));
  expect(await store.ensureProject({checkoutRoot:path.join(root,'b'),repositoryIdentity:'repo-b'})).toEqual(project);
  expect(project).not.toHaveProperty('corpus');
  const controller = new MappingDocumentController(mappingDocumentFromScene(singleDiagramScene('Canvas')),initialCanvasState());
  for (const [i,source] of sources.entries()) controller.transact(controller.getSnapshot().version,[{
    method:'diagram-create',id:`repo-${i}`,ascii:`Root ${i}\n+-- same`,structureKind:'tree',source,
    mappings:[{id:'m',entityId:'worker',sourceRangeIndex:0,line:2,startColumn:5,endColumn:8}],
    evidence:{worker:{id:'worker',handle:'worker',label:`Worker ${i}`,category:'operation',summary:'',sourceRanges:[{id:'r',path:'same.ts',startLine:1,endLine:1,originalLines:[`snapshot ${i}`]}]}}
  }]);
  const scene = controller.getSnapshot().document.scene;
  const saved = await store.projectCatalogs.saveMappingDiagram(project.id,canvasSaveFixture({name:'Two repositories',scene}));
  const revision = saved.catalog.revisions[saved.representation.currentRevisionId];
  expect(Object.keys(revision.evidence)).toEqual(['repo-0:worker','repo-1:worker']);
  expect(revision.mappings.map(m=>m.evidenceId)).toEqual(['repo-0:worker','repo-1:worker']);
  const sourceApi = new ProjectSourceService(store,corpusAccess);
  expect((await sourceApi.source(project.id,'same.ts',sources[0].sourceId)).lines[0]).toContain("'a'");
  expect((await sourceApi.source(project.id,'same.ts',sources[1].sourceId)).lines[0]).toContain("'b'");
  await expect(sourceApi.source(project.id,'same.ts')).rejects.toThrow('sourceId');
  const selected = await resolveDiagramSource(store,{projectId:project.id,representationId:saved.representation.id,contentId:'repo-1'},corpusAccess);
  expect(selected.search('same.ts')[0].range.originalLines).toEqual(['snapshot 1']);
  expect(await selected.readText('same.ts')).toContain("'b'");
  expect(diagramSelectionNodes(scene.contents['repo-0'])[0].sourceRanges[0]).toMatchObject({path:'same.ts',originalLines:['snapshot 0']});
  expect(mappingDocumentFromScene(scene)).not.toHaveProperty('nodes');
  expect(mappingDocumentFromScene(scene)).not.toHaveProperty('evidence');
  expect(sceneFromRevision(revision)).toEqual(scene);
  const compact = {path:'same.ts',startLine:1,endLine:1,originalLines:['same text'],compactedSource:{level:'high' as const,sections:[{kind:'source' as const,startLine:1,endLine:1}]}};
  const ca=await store.projectCatalogs.upsertFileCompaction(project.id,{...compact,sourceId:sources[0].sourceId});
  const cb=await store.projectCatalogs.upsertFileCompaction(project.id,{...compact,sourceId:sources[1].sourceId});
  expect(ca.compaction.id).not.toBe(cb.compaction.id);
  expect(Object.keys(cb.catalog.activeByPath)).toHaveLength(2);
  // Saved and live MCP searches use the same diagram-local evidence query.
  const bridge: CanvasSessionPort = {register(){},list:()=>[{canvasId:'canvas',documents:[{documentId:'doc',name:'Both'}]}],poll:async()=>[],reply(){},unregister(){},dispose(){},
    async dispatch(_id,command){if(command.method==='snapshot')return {...controller.getSnapshot(),name:'Both'};throw new Error('unexpected command');}};
  const agent=new AgentDiagrammingSessionService(bridge,new MappingDiagramService(store,corpusAccess,root),store,new QuickJsAgentRuntime());
  const attached=await agent.call('exec',{requestId:'attach',code:'return canvas.attach({canvasId:"canvas",documentId:"doc"});'}) as any;
  for(const scope of [{representationId:saved.representation.id},{sessionId:attached.value.sessionId}]) {
    const found=await agent.call('diagram-search',{operation:'search',mode:'code-reference',query:'same.ts',...scope}) as any;
    expect(found.total).toBe(2); expect(found.hits.map((h:any)=>h.snippet)).toEqual(['Worker 0','Worker 1']);
    expect((await agent.call('diagram-search',{operation:'search',mode:'node',query:'same',...scope}) as any).total).toBe(2);
  }
  const read=await agent.call('diagram-search',{operation:'read',sessionId:attached.value.sessionId,nodeId:'grid:repo-1'}) as any;
  expect(read.node.diagram.sourceContext.binding.sourceId).toBe(sources[1].sourceId);
  expect(read.evidence.worker.sourceRanges[0].originalLines).toEqual(['snapshot 1']);
  const stale=structuredClone(scene.contents['repo-0']) as { content: { ascii: string } } & typeof scene.contents[string]; (stale.content as { ascii: string }).ascii='Changed';
  expect(()=>controller.commitDocument(mappingDocumentFromScene({...scene,contents:{...scene.contents,'repo-0':stale}}))).toThrow();
  // Domain validation rejects a mismatched source revision at the persistence boundary.
  await expect(async () => store.projectCatalogs.saveMappingDiagram(project.id,canvasSaveFixture({name:'Stale',scene:{...scene,contents:{...scene.contents,'repo-0':stale}}}))).rejects.toThrow();
});
