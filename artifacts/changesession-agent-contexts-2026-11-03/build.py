import json, subprocess, hashlib, pathlib, uuid, re, datetime
D=pathlib.Path(__file__).resolve().parent
ROOT=D.parent.parent
BASE='03f2168deba364103c2450ca9b8168cd1fc9ddc5'; HEAD='81f05a2bf9efa2334985d2298dcbd7b044dc4c1e'
REPO='repo-ce67f2af4410036fce1ce12f'
def git(*a): return subprocess.check_output(['git',*a],cwd=ROOT,text=True)
def digest(s):return hashlib.sha256(s.encode()).hexdigest()
def write(name,data):
 (D/name).parent.mkdir(parents=True,exist_ok=True)
 (D/name).write_text(data if isinstance(data,str) else json.dumps(data,indent=2)+'\n')
raw=json.load(open(D/'inputs/live-reads.json'))
old=json.load(open(D/'inputs/previous-ascii.json'))
features=json.load(open(D/'inputs/feature-briefs.json'))
tracked=set(git('ls-tree','-r','--name-only',HEAD).splitlines())
commits=git('rev-list','--reverse',BASE+'..'+HEAD).splitlines()
groups=[
 dict(key='01',title='Canvas interaction, presentation and change review',owned=[0,1,5,7,12,14],features=[1,4,7,8,9,10,11],new=['N1','N4','N5','N6','N7','N8'],migrations=['M1','M2','M3'],extras=[
 'src/features/mapping/MappingPage.tsx','domain/mapping/workspace/mappingDocumentController.ts','domain/mapping/workspace/canvasDisplayNode.ts','domain/mapping/selection/selectionGesture.ts','domain/mapping/selection/selectionState.ts',
 'domain/core/diagrams/diagramRevision.ts','domain/core/diagrams/diagramRevisionStore.ts','domain/core/diagrams/submitDiagramEdit.ts','domain/core/diagrams/diagramService.ts','application/core/diagrams/generateDiagram.ts','domain/core/diagrams/canvasCheckpointRecords.ts',
 'domain/core/presentation/diagramAlternative.ts','domain/core/presentation/diagramRevisionProjection.ts','domain/core/presentation/diagramDiffProjection.ts','domain/core/diagrams/diagramContentDiff.ts','domain/core/diagrams/projectDiagramCanvas.ts','domain/core/source/sourceNavigation.ts','src/features/mapping/prompt-composer/promptComposerCoordinator.ts','domain/mapping/changes/diagramChangeSession.ts','src/features/mapping/changes/DiffSessionWorkflowPanel.tsx','application/mapping/agent/sessionService.ts']),
 dict(key='02',title='Agent authoring, saved contexts and API orchestration',owned=[2,3],features=[2,3,5,6],new=['N2','N3'],migrations=[],extras=[
 'application/mapping/agent/diagramEditService.ts','domain/mapping/agent/diagramEdit.ts','application/core/diagrams/generateDiagram.ts','domain/core/diagrams/submitDiagramEdit.ts','domain/core/diagrams/diagramRevisionStore.ts','infrastructure/core/agents/agentRuntime.ts','src/server/app/bootstrap.ts',
 'application/mapping/changes/diffSessionWorkflowService.ts','application/core/integrations/pushIntegrationService.ts','application/mapping/changes/changeSessionService.ts','infrastructure/core/persistence/fileDiagramAgentContextStore.ts']),
 dict(key='03',title='Persistence, checkpoints and durable application state',owned=[4,6],features=[12],new=[],migrations=[],extras=[
 'domain/core/diagrams/canvasCheckpointRecords.ts','src/server/app/bootstrap.ts','infrastructure/core/persistence/fileAgentContextRepository.ts','infrastructure/core/persistence/fileAgentContextSources.ts','infrastructure/core/persistence/fileDiagramAgentContextStore.ts','infrastructure/mapping/agent-chat/chatStore.ts','infrastructure/core/integrations/pushIntegrationStore.ts',
 'application/mapping/changes/diffSessionWorkflowService.ts','application/mapping/agent/sessionService.ts','infrastructure/mapping/persistence/workspace/mappingWorkspaceStore.ts','application/mapping/workspace/workspaceService.ts'])
]
facts={
'01':'''Update the MappingPage overview as one coherent parent: live tldraw geometry/undo versus domain semantic commands/checkpoints; explicit owners for PromptComposer, CanvasViews, search, source windows, treemaps and focused projection. Update its [D] batch execution contract and [E] revision retention/CanvasViews/checkpoint record descriptions together. The old DiagramService file is deleted; immutable revision creation, explicit retention, generation and publication are distinct responsibilities. All modifications to this overview and its retained roll-up copies belong here, even when they summarize features whose detailed owner is another context.
Preserve existing detailed coverage in Projection [B]/[G]/[P1]/[P2], Saved CanvasViews, and Central and side diagrams - Attempt 2. Extend only genuinely missing content. Correct all retained stale baseline diagrams in the two g2 roll-up canvases without replacing their newer revision/presentation branches. Preserve old content that remains true, including GridBox/LineGridScene.
Selection: distinguish application diagram/content selection from native editor selection and NativeSelectionOwnership; preserve semantic selection when settling gestures; include captured chat references where relevant.
ChangeSession: represent repository/commit/head provenance, revisioned DiffTree/hunk mappings, paired migrations, workflow callers, readiness validation, and acceptance. Shared core matching/diff-row presentation is reused by alternative display and ChangeSession preview; alternative selection, revision review and proposal acceptance remain separate operations.
N1 scope: Mapping/tldraw projection, gesture settlement, subscription boundaries, native/application selection and live history coordination.
N4 scope: scoped authoring requests, pinned references, variant generation/review, alternative controls and side-panel presentation. Reuse existing revision/alternative/review domain coverage.
N5 scope: Git-driven diagram update workflows, push integration, persisted runs and DiffTree navigation; API parent ownership remains in context 02.
N6 scope: worker-backed diagram search, reveal navigation, mapped sources and source windows. The later uncommitted symbol-search hook is excluded.
N7 scope: shared canvas/change treemap data and presentation, region selection, colors and navigation.
N8 scope: selection/highlight projection into a focused child canvas, retained revisions/history and transfer undo/redo.
Managed generation orchestration, saved-context internals and API backend diagrams are read-only context 02 responsibilities; persistence detail diagrams are read-only context 03 responsibilities. Include their complete caller/owner relationships where they belong in your owned overview without editing their diagrams.''',
'02':'''Update both API diagrams together: exposed methods, persistent canvas binding, compact reads, buffered exec mutations and receipt/version semantics. Consecutive mutations share a commit; reads/state-dependent setters flush; script errors discard pending edits but do not roll back already flushed batches. Describe implemented target dispatch: live browser, isolated ChangeSession, and managed generation child. Do not implement or assume the proposed future backend-authority consolidation.
Represent AgentChatService ownership of chats/turns/binding, direct supplied edits and atomic batches, generation children and FileChatStore. Generation child editing can be headless; parent capture/update still uses the browser bridge. Include persistence, cancellation and completion/reconnection behavior based on source. Reuse the existing supplied-edit diagram in Central and side diagrams - Attempt 2 rather than duplicate it.
Update the AgentContext canvas as a coherent whole: uploaded and saved inputs; pinned file/source-range content; lazy resolution; immutable snapshot identity; whole/subtree edit scopes and generation options; explicit revision issuance/retention/publication; persisted Pi generation sessions. AgentContext parsing/conversion is distinct from repository/file I/O in the library/source adapters. Historical tool calls are context, not replayed actions.
Add explicit AgentContextLibrary, AgentChatService, GenerationCanvasBridge, DiffSessionWorkflowService and PushIntegrationService owners/callers to the API backend diagram before proposing missing details.
N2 scope: AgentChat and managed alternative generation lifecycle, captured references, chat binding, independent child controllers/chats, persisted candidates and parent synchronization. Reuse existing Saved CanvasViews and supplied-edit diagrams.
N3 scope: saved contexts, diagram associations, immutable Git/blob pins, lazy source resolution and portable context evidence.
All edits to the API backend parent belong here, including its summary references to search/projection/review workflows and persistence. Do not edit context 01's MappingPage/ChangeSession parents or context 03's persistence parents to express these same relationships.''',
'03':'''Update PersistentLayer as one whole parent, including every new feature's storage: saved AgentContexts, pinned source blobs, diagram-context associations, chat/generation state, DiffSession workflow runs and push-integration state. Preserve service/store ownership instead of incorrectly making every store a DiagramStore-owned feature. Trace actual composition in bootstrap and feature services.
Update Workspace persistence flow with checkpoint deltas, shared immutable values/text, retention dependencies, unchanged-write suppression, bounded durable writes, restore, and checkpoint capture/flush before whole-canvas catalog publication. Incremental autosave, debounce and record batching already exist in the baseline; do not claim they are newly introduced.
History retains already issued diagram revisions rather than allocating diagram revision identities. Persist CanvasViews/working copies and referenced presentation/alternative/review/context state through checkpoint records without treating transient selection/gesture state as new content revisions.
PersistentLayer's SearchArtifact branch is marked PROPOSED and is not implemented at the pinned target; do not present it as the implemented search worker's storage, or invent a migration away from it.
No new detail diagram is required by the previous proposal for this group; extend the existing persistence diagrams. The concrete source may justify listing a missing detail, but do not create a duplicate persistence canvas.
Related authoring/context/chat/view features are included as source evidence to make these two parent updates coherent. Their UI, domain-history, API and AgentContext parents are owned by other contexts and must remain unchanged.'''
}
migrations=[
 {'id':'M1','kind':'responsibility-transfer','owner':'01','source':{'canvas':0,'diagram':6},'destination':{'canvas':7,'diagram':1},'meaning':'Removed DiagramService responsibilities are split into pure revision operations, retention, generation and publication. Annotate both diagrams; preserve already accurate destination content.'},
 {'id':'M2','kind':'shared-code-extraction','owner':'01','source':{'canvas':5,'diagram':4},'destination':{'canvas':7,'diagram':2},'meaning':'ChangeSession preview uses shared core diagram diff and row projection also consumed by alternative/side-panel presentation. This does not merge review/acceptance semantics.'},
 {'id':'M3','kind':'rendering-responsibility-transfer','owner':'01','source':{'canvas':0,'diagram':3},'destination':{'canvas':0,'diagram':0},'meaning':'Source/code panel rendering belongs to SourceWindowPanel under MappingPage. Logical retained panel records still exist. The two locations are different diagrams in the same canvas.'}
]
owner={i:g['key'] for g in groups for i in g['owned']}
assert len(owner)==sum(len(g['owned']) for g in groups)
canvases=[]
for i,r in enumerate(raw):
 assert r['descriptor']['documentId']==old[i]['descriptor']['documentId']
 assert [n['content']['ascii'] for n in r['nodes']]==[n['content']['ascii'] for n in old[i]['nodes']]
 diagrams=[]
 for j,n in enumerate(r['nodes']):
  ascii=n['content']['ascii']; binding=n.get('diagram',{}).get('sourceContext',{}).get('binding',{})
  diagrams.append(dict(key=f'C{i:02d}/D{j:02d}',title=ascii.splitlines()[0].strip(),ascii=ascii,asciiSha256=digest(ascii),sourceBinding=binding,readScopedId=n['id'],readScopedRevisionId=n.get('diagram',{}).get('revisionId'),))
 canvases.append(dict(key=f'C{i:02d}',documentId=r['descriptor']['documentId'],representationId=r['descriptor'].get('representationId'),name=r['descriptor']['name'],capturedDocumentVersion=r['version'],owner=owner.get(i,'read-only'),diagrams=diagrams,edges=r['edges']))
write('inputs/live-reads.json',raw)
write('inputs/canvases.json',canvases)
write('inputs/commit-log.txt',git('log','--reverse','--format=%H %s',BASE+'..'+HEAD))
ownership=[{k:c[k] for k in ['key','documentId','name','owner']} for c in canvases]
write('ownership.json',{'unit':'whole canvas document; all contained diagrams','canvases':ownership,'migrations':migrations})
common='''ChangeSession evaluation input contract, version 1
Purpose: independently propose one ChangeSession for this assigned group, using the same previously reviewed changes. The supplied baseline diagrams are inputs to update, not expected outputs to imitate. No reference answer, generated replacement ASCII, hidden template, generic task placeholder or hidden runtime instruction is provided.
Code target is fixed at 81f05a2bf9efa2334985d2298dcbd7b044dc4c1e; the old pinned architecture baseline is 03f2168deba364103c2450ca9b8168cd1fc9ddc5. Newer diagrams already cover some target features. Unpinned diagrams have unknown code baseline: compare their captured contents to pinned evidence without inventing a commit. Exclude later commits, the working tree, the proposed backend-authority refactor, new Evals/comparison features and uncommitted DiagramPane/symbol-search work.
Inputs visible in this context: this prompt; assigned scope and feature briefs; complete owned-diagram ASCII and related read-only diagrams with per-diagram hashes; global ownership table and existing connections; pinned target source files; exact old-side source excerpts and changed-line indices derived from path-scoped Git diffs. Full per-group patches and immutable read captures are also saved in the local input bundle, but this context contains the evidence needed for its task without relying on those local files.
Exclusive ownership is at whole-canvas-document granularity, stronger than the parent-diagram constraint because acceptance checks/publishes whole documents. Only this group's owned canvases may be changed. Every modification to an existing diagram or parent, including feature introductions, caller/owner links, persistence/API summaries, migration annotations and new-detail attachment edges, must stay in its owner's group. Read-only diagrams may inform the result but may not be revised, removed, relaid out, reparented or annotated. Reading shared code is allowed; overlapping write ownership is not.
Keep related changes together within owned parents. Do not split the parent update by feature. Both endpoints of each assigned migration are owned here and must be represented together. Reuse existing accurate detailed diagrams. Before proposing missing detail, establish its explicit component owner, caller and owned state in an owned existing parent, and identify that exact component as the attachment point. Do not require a new node created by another group's future output. Report any newly discovered cross-group write requirement as an ownership dependency rather than silently writing outside the boundary.
Use the user's categories: [1a] correct obsolete structure; [1b] extend within existing scope; [2] annotate both different-diagram locations of a code move or responsibility transfer; [3] specify missing detailed diagrams by high-level features and source files/ranges only; [4] replace a structurally obsolete diagram only when ordinary modifications/migrations cannot express the change, and list its replacement under [3]. Do not draw new missing-detail diagrams in this eval. These user-facing categories differ from the backend numeric change-type schema: discover that schema before recording API metadata.
Output the modified existing-diagram excerpts, missing-detail specifications and an ASCII recap with a legend. Use ** for new branch connections and ** ---- [description] ---- ** / ** ---- ... ---- ** around changed existing sections. Do not emit diff-renderer [+]/[-] prefixes or cosmetic spacing/punctuation edits. Do not prescribe tree layout beyond these requested presentation markers. Preserve accurate unaffected content, evidence and connections.
This is a proposal-generation eval, not authority to accept/publish global changes. If the visible eval harness supplies ChangeSession tools, create an isolated proposal and write only this group's changes there; include changeSessionId on every proposal call. If it is a text-only harness, return the proposal text. Never edit live global canvases or source code in an eval. Other contexts' proposals are not prerequisites and need not run first.
All captured short handles are read-scoped and may expire. Locate the stable document ID and diagram title/hash, reread current anchors/versions, and verify the captured baseline before any proposal edits. If baseline content or relationships drift, report that mismatch rather than silently changing the eval input. Independent application is conditional on unchanged baselines and disjoint actual write sets; this input does not bypass acceptance conflict checks.
DiffTree integration limitation: full-range get_repository_diff_hunks currently fails its 8 MiB cap because the range contains unrelated investigation dumps. The path-scoped Git deltas supplied here are real evidence but are NOT server-issued hunk IDs. Do not fabricate hunk IDs or claim a fully mapped API DiffTree. Discover narrower supported commit sets if the harness requires DiffTree creation; otherwise report the limitation and retain the complete textual proposal. No backend behavior was changed to bypass this limit.
'''
# Keep source and delta inputs complete but avoid duplicating target bodies in patches:
# pinned target files supply new/context lines; diff blocks retain exact old-side excerpts.
manifest=dict(schemaVersion=1,promptVersion=1,createdAt=datetime.datetime.now(datetime.timezone.utc).isoformat(),repositoryId=REPO,comparisonBase=BASE,head=HEAD,commits=commits,observedCurrentHead=git('rev-parse','HEAD').strip(),group='ChangeSession evals - 03f2168 to 81f05a2b',ownership=ownership,migrations=migrations,groups=[],limitations=['Full-range MCP hunk discovery exceeds 8 MiB due unrelated investigation dumps; scoped Git evidence is supplied without fabricated API hunk IDs.'])
for g in groups:
 selected={r['path'] for f in features if f['number'] in g['features'] for r in f['ranges']}|set(g['extras'])
 selected.discard('src/features/mapping/search/useDiagramSymbolSearch.ts')
 # Relevant bootstrap explains cross-feature composition without granting cross-group writes.
 selected.add('src/server/app/bootstrap.ts')
 sources=[]; deltas=[]; removed=[]; patches=[];currentBytes=0
 for path in sorted(selected):
  before=subprocess.run(['git','show',BASE+':'+path],cwd=ROOT,text=True,capture_output=True)
  if path not in tracked:
   if before.returncode==0:
    removed.append(path)
   else: raise RuntimeError('Unexpected absent evidence file: '+path)
  else:
   body=git('show',HEAD+':'+path); currentBytes+=len(body.encode())
   sources.append(dict(type='sourceFile',sourceId=REPO,path=path,startLine=1,endLine=len(body.splitlines()),revision=HEAD))
  patch=git('diff','--no-ext-diff','--no-textconv','--no-renames','--unified=3',BASE,HEAD,'--',path)
  if not patch:continue
  patches.append(patch)
  segments=[]
  for m in re.finditer(r'^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@([^\n]*)\n',patch,re.M):
   tail=patch[m.end():]; tail=tail.split('\n@@ ',1)[0]
   oldlines=[ln[1:] for ln in tail.splitlines() if ln.startswith((' ','-')) and not ln.startswith('--- ')]
   segments.append(dict(oldStart=int(m[1]),oldLines=int(m[2] or 1),newStart=int(m[3]),newLines=int(m[4] or 1),heading=m[5],oldSideExcerpt='\n'.join(oldlines)))
  deltas.append(dict(path=path,status='deleted' if path in removed else 'added' if before.returncode else 'modified',hunks=segments))
 scope='Assigned group '+g['key']+': '+g['title']+'\n\n'+facts[g['key']]+'\n\nFeature briefs (cross-group references are read-only):\n'+ '\n'.join(f"{f['number']}. {f['title']}: {f['features']}" for f in features)+'\n\nMissing detail IDs owned here: '+', '.join(g['new'])+'\nMigration IDs owned here: '+', '.join(g['migrations'])+'\n'
 contracts='Global exclusive ownership table:\n'+json.dumps(ownership,indent=2)+'\n\nMigration endpoint contract:\n'+json.dumps(migrations,indent=2)
 prompt=common+'\n'+scope+'\n'+contracts
 blocks=[dict(type='text',text=prompt)]
 # All global diagrams are visible as read-only context unless owned; repeated experimental
 # copies remain distinct targets so application cannot overwrite a sibling silently.
 for c in canvases:
  if c['key'] in ['C08','C10','C13','C15']: continue
  if g['key']!='01' and c['key'] in ['C12','C14']: continue
  payload={**c,'access':'writable' if c['owner']==g['key'] else 'read-only'}
  blocks.append(dict(type='text',text='Captured baseline canvas (not an expected output):\n'+json.dumps(payload,ensure_ascii=False,separators=(',',':'))))
 blocks.append(dict(type='text',text='Pinned net-code-change evidence. Each old-side excerpt is the exact before text for its hunk; target/context lines are supplied by the pinned target source file. These are Git line ranges, not server hunk IDs.\n'+json.dumps({'comparisonBase':BASE,'head':HEAD,'deltas':deltas},indent=2)))
 blocks.append(dict(type='text',text='Pinned target source files follow. Every sourceFile is captured at the explicit target SHA; no working-tree source is captured. Deleted files are represented by their before excerpts above.'))
 blocks+=sources
 previous=D/g['key']/'create-request.json'
 requestId=json.load(open(previous))['requestId'] if previous.exists() else str(uuid.uuid4())
 req=dict(requestId=requestId,name='ChangeSession '+g['key']+' - '+g['title'],description=f"Exclusive canvas ownership; code {BASE[:7]}..{HEAD[:8]}. Reproducible ChangeSession eval input v1, including captured parents, pinned source and scoped code deltas.",group=manifest['group'],context=blocks)
 write(g['key']+'/prompt-v1.txt',prompt)
 write(g['key']+'/code-delta.json',deltas)
 write(g['key']+'/code-diff.patch',''.join(patches))
 write(g['key']+'/source-manifest.json',sources)
 write(g['key']+'/create-request.json',req)
 estimated=currentBytes+sum(len(b['text'].encode()) for b in blocks if b['type']=='text')
 record={k:v for k,v in g.items() if k!='extras'}
 record.update(requestId=requestId,agentContextId='saved-agent-context-'+requestId,ownedDocumentIds=[canvases[i]['documentId'] for i in g['owned']],sourceFiles=len(sources),estimatedResolvedBytes=estimated,deletedSourceFiles=removed,createRequestFile=g['key']+'/create-request.json',promptFile=g['key']+'/prompt-v1.txt')
 manifest['groups'].append(record)
 print(g['key'],len(sources),'sources',estimated,'resolved bytes',len(json.dumps(req)),'request bytes')
 # Resolved AgentContexts must fit their application's explicit 2 MiB bound.
 assert estimated<1800000,(g['key'],estimated)
write('manifest.json',manifest)
# Validate global parent uniqueness, coverage, both-endpoint ownership and missing-detail uniqueness.
assert set(owner)=={0,1,2,3,4,5,6,7,12,14}
assert {n for g in groups for n in g['features']}==set(range(1,13))
assert len([n for g in groups for n in g['new']])==len({n for g in groups for n in g['new']})==8
for m in migrations:
 assert owner[m['source']['canvas']]==owner[m['destination']['canvas']]==m['owner']
 assert m['source']!=m['destination']
write('validation.json',dict(exclusiveCanvasOwners=True,exclusiveParentDiagramOwners=True,all12FeaturesCovered=True,all8MissingDetailsAssignedOnce=True,allMigrationEndpointsColocated=True,all16CapturedAsciiSnapshotsMatchPreviousReview=True,sourceHead=HEAD,sourceBase=BASE,writeTargets=sum(len(canvases[i]['diagrams']) for i in owner)))
