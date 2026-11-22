"""Source-reviewed behavioral checks on paired Sol/high outputs. No model calls.
These selected checks are not an exhaustive semantic score or a random sample.
Each check tests implementation landmarks on the named node, not range volume.
"""
import json
import subprocess
from pathlib import Path

HERE = Path(__file__).resolve().parent
OLD = HERE.parent / 'phase2-ghostty'
SHA = 'ea8b12a8a9894b5259c441eadd8f6f0c65e215af'
REPO = '/home/john/softwarez/ghostty'
S='src/Surface.zig'; E='src/termio/Exec.zig'; T='src/termio/Termio.zig'
G='src/renderer/generic.zig'; P='src/terminal/PageList.zig'; TH='src/termio/Thread.zig'

def part(name, path, line, text):
    return {'name':name,'path':path,'line':line,'expectedText':text}
checks=[]
def add(id, cases, diagram, node, parts, interpretation):
    checks.append(dict(id=id,cases=cases,diagram=diagram,node=node,parts=parts,interpretation=interpretation))

add('mouse-behavior',['core-1'],'d1','n24',[
 part('scroll reporting',S,3733,'self.mouseReport'),part('local viewport scrolling',S,3756,'scrollViewport'),
 part('button reporting',S,4083,'self.mouseReport'),part('motion reporting',S,4796,'self.mouseReport'),
 part('drag selection',S,4865,'setSelection(drag_selection)')],
 'Old ranges only identify callback signatures. New ranges contain real reporting, local scrolling and drag selection behavior in all three repeats.')
add('key-route',['core-1'],'d1','n20',[
 part('bindings first',S,2837,'maybeHandleBinding'),part('encode unhandled key',S,2940,'self.encodeKey'),part('enqueue bytes',S,2953,'self.queueIo')],
 'The old ranges already established this basic route. New full bodies add useful handling details, but larger ranges do not create a new basic-route success.')
add('input-callback-behavior',['canvas-1','canvas-2'],'d1','n16',[
 part('key binding',S,2837,'maybeHandleBinding'),part('key encoding',S,2940,'self.encodeKey'),
 part('text/paste dispatch',S,3431,'completeClipboardPaste'),part('mouse reporting',S,4083,'self.mouseReport')],
 'Real key/mouse behavior is added, but canvas-1 repeat 2 and canvas-2 repeat 2 still truncate mouseButtonCallback before reporting/selection logic.')
add('snapshot-under-lock',['core-2'],'d1','n73',[
 part('acquire lock',G,1420,'state.lockDemand'),part('take snapshot',G,1484,'terminal_state.beginUpdate'),part('release lock',G,1421,'state.unlockDemand')],
 'Both new outputs add State lock/unlock internals but drop beginUpdate, which both matched old outputs attached to this node. This loses the relationship claimed by the label.')
add('active-screen-switch',['core-2'],'d1','n60',[
 part('select owned screen','src/terminal/ScreenSet.zig',108,'self.active = self.all.get(key)')],
 'Repeat 3 regresses from declaration plus assignment to declaration only. Repeat 2 was already incomplete.')
add('font-refcount-implementation',['canvas-1','canvas-2'],'d1','n6',[
 part('increment','src/font/SharedGridSet.zig',115,'ref += 1'),part('decrement','src/font/SharedGridSet.zig',422,'ref -= 1'),
 part('last-owner destruction','src/font/SharedGridSet.zig',428,'grid.deinit')],
 'New mappings contain App fields and sometimes Surface ref calls, but none attach the reference-count implementation. This is a regression in three paired outputs, not an improvement in ownership coverage.')
add('device-ownership',['canvas-1','canvas-2'],'d1','n7',[
 part('App retains device',S,568,'app.device = device'),part('renderer borrows device',S,581,'.device = render_device')],
 'One gain (canvas-1 repeat 3) and one loss (canvas-2 repeat 2); all other pairs preserve the same evidence.')
add('resize-coalescing',['canvas-1','canvas-2'],'d1','n28',[
 part('retain latest resize',TH,390,'coalesce_data.resize = resize'),part('schedule timer',TH,397,'self.coalesce.reset'),
 part('apply coalesced size',TH,445,'cb.io.resize')],
 'Canvas-1 repeat 2 loses the timer scheduling implementation. Repeat 3 lacks the applying callback in both variants. Other pairs were already covered.')
add('regular-text-shaping',['canvas-1','canvas-2'],'d3','n13',[
 part('normal text shaping',G,3299,'self.font_shaper.shape(run)')],
 'Normal text shaping remains attached in only canvas-1 repeat 1. Counting any shape call would hide that the added second hit is only IME preedit shaping.')
add('preedit-shaping',['canvas-1','canvas-2'],'d3','n13',[
 part('IME preedit shaping',G,3030,'self.font_shaper.shape(run)')],
 'Canvas-1 repeat 2 adds a real preedit path, but it is not coverage of the normal text path or the complete renderer pipeline.')
add('glyph-cache-atlas',['canvas-1','canvas-2'],'d3','n13',[
 part('glyph cache lookup','src/font/SharedGrid.zig',395,'self.glyphs.get(key)'),
 part('text/emoji atlas selection','src/font/SharedGrid.zig',409,'const atlas: *font.Atlas')],
 'Neither variant attaches these implementation details; broad renderer selections do not reach the font implementation.')
add('spawn-paths',['canvas-1'],'d4','n8',[
 part('PTY creation',E,910,'Pty.open'),part('normal command start',E,1063,'cmd.start'),part('Flatpak command spawn',E,1007,'cmd.spawn')],
 'The new outputs consistently include both command launch paths. Old repeat 1 reaches normal start; repeat 2 reaches Flatpak spawn; repeat 3 cuts off before either launch call.')
add('pooled-write-lifetime',['canvas-1'],'d4','n10',[
 part('skip exited child',E,414,'exec.exited'),part('allocate pooled write',E,420,'write_pool.create'),
 part('copy into stable buffer',E,430,'fastmem.copy'),part('schedule async write',E,459,'write_stream.queueWrite'),
 part('recycle completed write',E,480,'write_pool.destroy')],
 'New outputs consistently connect the guard, allocation, buffer copy, scheduling and completion. Old excerpts each omit part of that lifecycle.')
add('pty-gather-pipeline',['canvas-1'],'d4','n23',[
 part('read PTY',E,1576,'posix.read'),part('publish batch',E,1700,'pipeline.lens'),
 part('wake parser',E,1704,'batch_ready.signal'),part('observe quit',E,1721,'pollfds[1].revents')],
 'New outputs add the full gather lifecycle. Old repeat 1 omits quit handling; repeat 3 omits publication and quit handling.')
add('compressed-page-restore',['canvas-1'],'d5','n22',[
 part('recommit retained memory',P,270,'terminal_mem.recommit'),part('restore encoding',P,273,'compressed.restore'),
 part('release encoded copy',P,294,'compressed.deinit'),part('become resident',P,297,'.resident = restored')],
 'Repeats 2 and 3 progress from a descriptive union comment to actual retained-mapping restoration. Repeat 1 adds another file with documentation and fields, not restoration code.')
add('selection-replacement',['canvas-1'],'d5','n12',[
 part('track untracked selection','src/terminal/Screen.zig',3070,'sel.track(self)'),
 part('release replaced pins','src/terminal/Screen.zig',3085,'untrackPin'),
 part('install tracked selection','src/terminal/Screen.zig',3095,'self.selection = tracked_sel')],
 'New mappings consistently include selection replacement and pin cleanup. Old repeat 2 already did; repeats 1 and 3 were incomplete at this node.')
add('parse-dispatch',['canvas-1','canvas-2'],'d2','n23',[
 part('schedule render',T,716,'handler.queueRender'),part('parse input slice',T,753,'terminal_stream.nextSlice')],
 'Four old outputs already show both calls. New canvas-1 repeat 3 repairs its missing parse call; other growth is mainly surrounding code.')
add('resize-order',['core-1'],'d1','n75',[
 part('lock shared state',T,534,'mutex.lockUncancelable'),part('resize backend',T,540,'backend.resize'),
 part('resize terminal',T,543,'terminal.resize')],
 'Already correctly covered in all old outputs. New output adds essentially no meaningful coverage.')
add('shutdown-order',['canvas-1','canvas-2'],'d1','n45',[
 part('stop search',S,831,'s.deinit'),part('join renderer',S,837,'renderer_thr.join'),part('join IO',S,844,'io_thr.join')],
 'All five pairs already map the same implementation; this is preserved coverage, not a delegation gain.')

source={}
for check in checks:
    for p in check['parts']:
        if p['path'] not in source:
            source[p['path']]=subprocess.check_output(['git','-C',REPO,'show',SHA+':'+p['path']],text=True).splitlines()
        p['sourceLine']=source[p['path']][p['line']-1]
        assert p['expectedText'] in p['sourceLine'],p

def load(p):return json.loads(p.read_text())
def hit(ranges,p):return any(m['path']==p['path'] and m['startLine']<=p['line']<=m['endLine'] for m in ranges)
details=[];summary=[]
for check in checks:
    rows=[]
    for case in check['cases']:
        cid='ghostty-v3-'+case
        inp=load(HERE/(cid+'-input.json'));oldinp=load(OLD/(cid+'-input.json'))
        assert inp['repo']['commit']==oldinp['repo']['commit']==SHA
        d=next(d for d in inp['diagrams'] if d['diagramId']==check['diagram'])
        od=next(d for d in oldinp['diagrams'] if d['diagramId']==check['diagram'])
        assert d['ascii']==od['ascii'] and d['nodes']==od['nodes']
        label=next(n['label'] for n in d['nodes'] if n['ref']==check['node'])
        for repeat in range(1,4):
            newdir=HERE/'jobs'/f'{cid}-sol-high_sol-medium-{repeat}'
            if load(newdir/'status.json')['status']!='finished':continue
            row={'check':check['id'],'case':case,'repeat':repeat,'node':check['diagram']+'/'+check['node'],'label':label}
            for variant,folder in [('old',OLD/'jobs'/f'{cid}-high-{repeat}'),('new',newdir)]:
                mapping=load(folder/'mapping.json')
                allranges=[m for d in mapping['diagrams'] for m in d['mappings']]
                ranges=[m for d in mapping['diagrams'] if d['diagramId']==check['diagram'] for m in d['mappings'] if m['node']==check['node']]
                parts={p['name']:hit(ranges,p) for p in check['parts']}
                row[variant]={'parts':parts,'allParts':all(parts.values()),'anywhereParts':{p['name']:hit(allranges,p) for p in check['parts']},'ranges':ranges,'mappingFile':str(folder/'mapping.json')}
            row['gainedParts']=[p for p,v in row['new']['parts'].items() if v and not row['old']['parts'][p]]
            row['lostParts']=[p for p,v in row['old']['parts'].items() if v and not row['new']['parts'][p]]
            rows.append(row)
    details+=rows
    summary.append({'check':check['id'],'pairs':len(rows),'oldComplete':sum(r['old']['allParts'] for r in rows),'newComplete':sum(r['new']['allParts'] for r in rows),'pairsWithGains':sum(bool(r['gainedParts']) for r in rows),'pairsWithLosses':sum(bool(r['lostParts']) for r in rows),'interpretation':check['interpretation']})
report={'commit':SHA,'comparison':'Phase 2 Sol/high single agent versus Phase 3 Sol/high with Sol/medium children','scope':'10 successful paired outputs. Two failed Sol attempts excluded. Selected source-reviewed claims across all four inputs; not an exhaustive review of every node.','method':'Read node labels, both sets of ranges, and actual pinned source. Implementation landmarks make judgments reproducible. Complete means these selected parts are present, not proof of the entire node. No aggregate semantic score: checks were selected after inspecting results. Direct-node and anywhere-in-output evidence are separate.','checks':checks,'summary':summary,'details':details}
report['reviewedNodePositions']=len({(r['case'],r['node']) for r in details})
report['pairedNodeObservations']=len({(r['case'],r['node'],r['repeat']) for r in details})
retention=load(HERE/'retention-analysis.json')
report['verifiedAssemblyLosses']=[
 {'key':s['key'],'evidence':o}
 for s in retention['samples'] if s['key'].startswith('ghostty-v3-core-2-sol-high_sol-medium-')
 for o in s['omissions'] if o['diagram']=='d1' and o['node']=='n60'
]
report['conclusion']='Meaningful improvements in named callbacks, I/O lifecycles and selected storage operations; preserved coverage on already well-mapped operations; regressions in snapshot, font lifetime and active-screen relationships. No uniform semantic improvement. Child discoveries can be lost in lead assembly. Prompt changes and delegation are confounded.'
(HERE/'semantic-node-review.json').write_text(json.dumps(report,indent=2)+'\n')
for r in summary:print(f"{r['check']}: {r['oldComplete']}/{r['pairs']} -> {r['newComplete']}/{r['pairs']} (gains {r['pairsWithGains']}; losses {r['pairsWithLosses']})")
