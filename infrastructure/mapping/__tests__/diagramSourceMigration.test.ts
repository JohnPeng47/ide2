import {mkdtemp,mkdir,readFile,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {expect,it} from 'vitest';
import {migrateDirectory,TARGET_REPRESENTATION} from '../../../scripts/migrations/migrate-diagram-sources';
import {sceneFromRevision,projectCanvasSnapshot} from '../../../domain/core/diagrams/projectDiagramCanvas';
it('backs up only an explicitly selected directory and moves its legacy binding into diagrams',async()=>{
  const temp=await mkdtemp(path.join(tmpdir(),'diagram-source-migration-'));
  try {
    const root=path.join(temp,'project');await mkdir(path.join(root,'representations'),{recursive:true});
    const project={schemaVersion:1,id:'project',name:'Canvas',diagramSetIds:[],canonicalRepoRoot:'/repo',repositoryIdentity:'repo',domainProfileId:'source-code',corpus:{kind:'git-worktree',root:'/repo'}};
    const catalog={representations:{[TARGET_REPRESENTATION]:{id:TARGET_REPRESENTATION,currentRevisionId:'r',revisionIds:['r']}},revisions:{r:{id:'r',representationId:TARGET_REPRESENTATION,revision:1,ascii:'A',representationKind:'tree',evidence:{},mappings:[]}}};
    await writeFile(path.join(root,'project.json'),JSON.stringify(project));
    await writeFile(path.join(root,'representations/catalog.json'),JSON.stringify(catalog));
    await expect(migrateDirectory(root,'some-other-representation')).rejects.toThrow('scoped');
    const result=await migrateDirectory(root);
    expect(JSON.parse(await readFile(path.join(result.backup!,'project.json'),'utf8'))).toEqual(project);
    const next=JSON.parse(await readFile(path.join(root,'project.json'),'utf8'));
    expect(next.id).toBe(project.id);expect(next).not.toHaveProperty('corpus');expect(next).not.toHaveProperty('canonicalRepoRoot');
    const saved=JSON.parse(await readFile(path.join(root,'representations/catalog.json'),'utf8'));
    const scene=sceneFromRevision(saved.revisions.r);expect(scene.contents.overview.sourceContext.binding?.corpus.root).toBe('/repo');
    expect(projectCanvasSnapshot(scene).ascii).toBe('A');
    expect(await migrateDirectory(root)).toEqual({alreadyMigrated:true});
  } finally {await rm(temp,{recursive:true,force:true});}
});
