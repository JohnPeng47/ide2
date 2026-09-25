import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { expect, it } from 'vitest';
import { DiagramChangeSessionStore } from '../diagramChangeSessionStore';
import { ChangeSessionService } from '../../../../application/mapping/changes/changeSessionService';
import { AgentDiagrammingSessionService } from '../../../../application/mapping/agent/sessionService';
import { QuickJsAgentRuntime } from '../../agent/execRuntime';
import { ProjectCatalogStore } from '../../../core/persistence/projectCatalogStore';
import type { CanvasSessionPort } from '../../../../application/mapping/agent/ports';
import type { DiagramRepository } from '../../../../application/core/ports/diagramRepository';
import type { MappingDiagramService } from '../../../../application/mapping/diagrams/diagramService';
import { createDiagram } from '../../../../domain/core/diagrams/diagram';
import { diagramContentNodes } from '../../../../domain/core/diagrams/diagramContentNodes';
import { singleDiagramScene } from '../../../../domain/core/diagrams/projectDiagramCanvas';
import { diffChangeDocument } from '../../../../domain/mapping/changes/changeDocumentDiff';
import { floatingBefore, floatingAfter } from '../../../../domain/mapping/changes/__tests__/floatingPaneDiffFixture';

it('recomputes inferred correspondence after cumulative patches, undo, redo and reset without persisting it as provenance', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'change-session-matching-'));
  try {
    const catalog = new ProjectCatalogStore(root), scene = singleDiagramScene(floatingBefore);
    scene.contents = { ...scene.contents, overview: createDiagram({ id: 'overview', revision: 0, ascii: floatingBefore, structureKind: 'tree' }) };
    const saved = await catalog.saveMappingDiagram('project', { name: 'Floating', scene });
    const source = { loadProject: async () => ({ id: 'project' }), projectCatalogs: catalog } as unknown as DiagramRepository;
    const bridge: CanvasSessionPort = { register() {}, list: () => [], poll: async () => [], reply() {}, unregister() {}, dispose() {}, dispatch: async () => { throw Error('Touched live bridge'); } };
    const changes = new ChangeSessionService(new DiagramChangeSessionStore(root), source, bridge);
    await changes.create({ title: 'Matching regression', requestId: 'create' });
    const id = (await changes.list())[0].id, documentId = saved.representation.id;
    await changes.apply(id, documentId, 0, [{ method: 'patchDiagram', nodeId: 'grid:overview', start: 1,
      end: floatingBefore.split('\n').length, patch: floatingAfter }], 'wrapper');
    const check = async (modified: number, cleared = false) => {
      const session = await changes.get(id), doc = session.documents[0], snapshot = structuredClone(doc);
      expect(diffChangeDocument(doc).counts).toEqual(cleared
        ? { added: 0, removed: 0, modified: 0, moved: 0 }
        : { added: 2, removed: 0, modified, moved: 2 });
      expect(doc).toEqual(snapshot);
      if (!cleared) {
        // The broad patch provides no exact origins for this diagram; unrelated
        // content (including the collapsed summary) retains its real provenance.
        for (const node of diagramContentNodes(doc.proposed.document.scene.contents.overview.content)) {
          expect(doc.proposed.nodeOrigins?.[node.id]).toBeUndefined();
        }
      }
      expect(doc.baseline!.document.scene).toEqual(scene);
      return session;
    };
    await check(1);
    await changes.apply(id, documentId, 1, [{ method: 'patchDiagram', nodeId: 'grid:overview', start: 7, end: 8,
      patch: '    |       |-- placement = automatic / manual\n    |       `-- sizing = content / fixed' }], 'fields');
    await check(3);
    for (const [action, modified, cleared] of [['undo', 1, false], ['redo', 3, false], ['reset', 0, true], ['undo', 3, false]] as const) {
      const session = await changes.get(id);
      await changes.update({ changeSessionId: id, documentId, expectedVersion: session.version, action, requestId: `${action}-${session.version}` });
      await check(modified, cleared);
    }
    const reopened = new ChangeSessionService(new DiagramChangeSessionStore(root), source, bridge);
    expect(await reopened.get(id)).toEqual(await changes.get(id));
    expect(diffChangeDocument((await reopened.get(id)).documents[0]).counts.modified).toBe(3);
    expect(await catalog.loadRepresentationCatalog('project')).toEqual(saved.catalog);
  } finally { await rm(root, { recursive: true, force: true }); }
});

it('isolates shared MCP operations, persists sessions and history, rejects bad routing, and validates proposal readiness', async () => {
  const root = await mkdtemp(path.join(tmpdir(),'change-sessions-'));
  try {
    const catalog = new ProjectCatalogStore(root), scene = singleDiagramScene('Root\n|-- Old\n`-- Keep');
    scene.contents = { ...scene.contents, overview: createDiagram({id:'overview',revision:0,ascii:scene.contents.overview.content.ascii,structureKind:'tree'}) };
    const saved = await catalog.saveMappingDiagram('project',{name:'Original',scene});
    const store = { loadProject: async()=>({id:'project'}), projectCatalogs:catalog } as unknown as DiagramRepository;
    const bridge: CanvasSessionPort = {register(){},list:()=>[],poll:async()=>[],reply(){},unregister(){},dispose(){},dispatch:async()=>{throw Error('Touched live bridge');}};
    const repository = new DiagramChangeSessionStore(root);
    const changes = new ChangeSessionService(repository,store,bridge);
    const agent = new AgentDiagrammingSessionService(bridge,{} as MappingDiagramService,store,new QuickJsAgentRuntime(),changes);
    const call = (name: Parameters<typeof agent.call>[0], input: unknown) => agent.call(name,input) as Promise<any>;
    const create = {title:'Feature',requestId:'create'};
    const created = await call('create_diagram_change_session',create);
    expect(await call('create_diagram_change_session',create)).toEqual(created);
    const changeSessionId=created.changeSessionId, documentId=saved.representation.id;
    let seq=0;
    const exec=(code:string,extra:Record<string,unknown>={})=>call('exec',{changeSessionId,requestId:`r${++seq}`,code,...extra});
    expect((await exec('return canvas.list();')).value[0].canvasId).toBe(changeSessionId);
    const attached=await exec(`return canvas.attach({canvasId:${JSON.stringify(changeSessionId)},documentId:${JSON.stringify(documentId)}});`);
    const sessionId=attached.value.sessionId;
    await expect(call('exec',{sessionId,requestId:'bad',code:'return nodes.list();'})).rejects.toThrow('MISMATCH');
    await expect(call('exec',{sessionId,changeSessionId:'another',requestId:'bad',code:'return nodes.list();'})).rejects.toThrow();
    const patch={sessionId,changeSessionId,requestId:'patch',expectedVersion:0,code:'return nodes.patchDiagram({nodeId:"grid:overview",start:2,end:2,patch:"|-- Changed"});'};
    const result=await call('exec',patch);
    expect(result.value.content.ascii).toContain('Changed');
    expect(await call('exec',patch)).toEqual(result);
    const current = await changes.get(changeSessionId);
    expect(current.documents[0].baseline!.document.scene).toEqual(scene);
    expect(current.documents[0].version).toBe(1);
    expect(current.changes).toMatchObject([{type:1,nodeId:'grid:overview'}]);
    await expect(call('save_diagram',{sessionId,changeSessionId,requestId:'save',expectedVersion:1,name:'Bad'})).rejects.toThrow('SAVE_FORBIDDEN');
    await expect(exec('nodes.patchDiagram({nodeId:"grid:overview",start:2,end:2,patch:"X"}); nodes.remove({nodeId:"grid:root"});',{sessionId,expectedVersion:1})).rejects.toThrow('protected');
    expect((await changes.get(changeSessionId)).documents[0].version).toBe(1);
    const newNode=await exec('return nodes.draw({ascii:"Detail\\n`-- Child",structureKind:"tree",position:{column:40,row:0}});',{sessionId,expectedVersion:1});
    let session=await changes.get(changeSessionId);
    await expect(call('update_diagram_change_session',{changeSessionId,requestId:'readybad',expectedVersion:session.version,status:'ready'})).rejects.toThrow('needs an edge');
    await exec(`const source=nodes.get({nodeId:'grid:overview'}); return edges.create({source:{kind:'content-node',displayNodeId:source.id,contentNodeId:source.contentNodes[0].id,revisionId:source.content.revisionId},target:{kind:'box',displayNodeId:${JSON.stringify(newNode.value.id)}},appearance:{}});`,{sessionId,expectedVersion:2});
    session=await changes.get(changeSessionId);
    await call('update_diagram_change_session',{changeSessionId,requestId:'ready',expectedVersion:session.version,status:'ready',changes:session.changes.map(c=>({...c,title:`Review ${c.title}`,type:c.type===1?4:c.type}))});
    expect((await changes.get(changeSessionId)).status).toBe('ready');
    const beforeUndo=await changes.get(changeSessionId);
    await call('update_diagram_change_session',{changeSessionId,requestId:'undo',expectedVersion:beforeUndo.version,documentId,action:'undo'});
    expect((await changes.get(changeSessionId)).documents[0].proposed.document.edges).toEqual([]);
    const afterUndo=await changes.get(changeSessionId);
    await call('update_diagram_change_session',{changeSessionId,requestId:'redo',expectedVersion:afterUndo.version,documentId,action:'redo'});
    expect((await changes.get(changeSessionId)).documents[0].proposed.document.edges).toHaveLength(1);
    const createdDoc = await exec(`return canvas.createDocument({canvasId:${JSON.stringify(changeSessionId)},name:'New canvas'});`);
    expect(createdDoc.value.documentId).toMatch(/^draft-/);
    const reopenedService = new ChangeSessionService(new DiagramChangeSessionStore(root),store,bridge);
    expect((await reopenedService.list())[0].changes.some(c=>c.type===3)).toBe(true);
    expect(await reopenedService.get(changeSessionId)).toEqual(await changes.get(changeSessionId));
    const reopenedAgent = new AgentDiagrammingSessionService(bridge,{} as MappingDiagramService,store,new QuickJsAgentRuntime(),reopenedService);
    expect(await reopenedAgent.call('exec',patch)).toEqual(result); // replay after restart, despite stale version / expired attachment
    expect(await catalog.loadRepresentationCatalog('project')).toEqual(saved.catalog);
    const search=await call('diagram-search',{operation:'search',changeSessionId,query:'Changed'});
    expect(search.total).toBe(1); expect(search.changeSession.changes.length).toBeGreaterThan(0);
    await expect(repository.read('project','../escape')).rejects.toThrow();
  } finally {await rm(root,{recursive:true,force:true});}
});

it('persists mappings-only MCP proposals, preserves their baseline, and validates ready', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'mapping-proposal-'));
  try {
    const catalog = new ProjectCatalogStore(root), scene = singleDiagramScene('Root');
    const saved = await catalog.saveMappingDiagram('project', {name:'Original',scene});
    const store = {loadProject:async()=>({id:'project'}),projectCatalogs:catalog} as unknown as DiagramRepository;
    const bridge: CanvasSessionPort = {register(){},list:()=>[],poll:async()=>[],reply(){},unregister(){},dispose(){},dispatch:async()=>{throw Error('Touched live bridge');}};
    const changes = new ChangeSessionService(new DiagramChangeSessionStore(root),store,bridge);
    const agent = new AgentDiagrammingSessionService(bridge,{} as MappingDiagramService,store,new QuickJsAgentRuntime(),changes);
    const created = await agent.call('create_diagram_change_session',{title:'Source mappings',requestId:'create'}) as any;
    const changeSessionId = created.changeSessionId;
    const attached = await agent.call('exec',{changeSessionId,requestId:'attach',code:`return canvas.attach({canvasId:${JSON.stringify(changeSessionId)},documentId:${JSON.stringify(saved.representation.id)}});`}) as any;
    await agent.call('set_diagram_source_mappings',{changeSessionId,sessionId:attached.value.sessionId,requestId:'mappings',expectedVersion:0,
      nodeId:'grid:overview',expectedContentHash:scene.contents.overview.content.asciiSha256,
      mappings:[{id:'m',entityId:'e',sourceRangeIndex:0,line:1,startColumn:1,endColumn:4}],
      evidence:{e:{id:'e',handle:'Root',label:'Root',category:'operation',summary:'Root',sourceRanges:[{id:'r',path:'root.ts',startLine:1,endLine:1,originalLines:['function Root() {}']}]}}});
    const session = await changes.get(changeSessionId);
    expect(session.changes).toMatchObject([{type:1,nodeId:'grid:overview'}]);
    await agent.call('update_diagram_change_session',{changeSessionId,requestId:'ready',expectedVersion:session.version,status:'ready',changes:session.changes});
    const reopened = await new ChangeSessionService(new DiagramChangeSessionStore(root),store,bridge).get(changeSessionId);
    expect(reopened.status).toBe('ready');
    expect(reopened.documents[0].proposed.document.scene.contents.overview.sourceContext.mappings).toHaveLength(1);
    expect(reopened.documents[0].baseline!.document.scene).toEqual(scene);
    expect(await catalog.loadRepresentationCatalog('project')).toEqual(saved.catalog);
  } finally { await rm(root,{recursive:true,force:true}); }
});
