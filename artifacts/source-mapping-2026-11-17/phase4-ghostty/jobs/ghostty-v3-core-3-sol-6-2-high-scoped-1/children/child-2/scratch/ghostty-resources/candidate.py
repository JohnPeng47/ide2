import json, pathlib, subprocess
base=pathlib.Path('/tmp/ghostty-resources')
alias=dict(S='src/Surface.zig',A='src/App.zig',C='src/config/Config.zig',F='src/font/SharedGridSet.zig',EM='src/apprt/embedded.zig',GK='src/apprt/gtk/class/surface.zig',SZ='src/renderer/size.zig',RE='src/renderer.zig',R='src/renderer/generic.zig',RM='src/renderer/message.zig',RO='src/renderer/Options.zig',RT='src/renderer/Thread.zig',RS='src/renderer/State.zig',T='src/termio/Termio.zig',IT='src/termio/Thread.zig',B='src/termio/backend.zig',MB='src/termio/mailbox.zig',TM='src/termio/message.zig',E='src/termio/Exec.zig',SH='src/termio/stream_handler.zig',ST='src/terminal/stream.zig')
role=dict(d='declaration',u='use',i='implementation')
notes={
'n18':'Surface stores DerivedConfig by value, without a Config pointer, and copies/owns the arena-backed fields indicated in init. The title slice is assigned directly from config.title at Surface.zig:424, not duplicated; in Surface it is used only for the nullness check at 1023, so not every field is deep-owned.',
'n19':'The two workers receive their own independently derived configs built from the effective Config, not copies of Surface.DerivedConfig. The I/O Backend.ThreadData.changeConfig hook is a no-op at this commit.',
'n21':'Both the stream handler and shared renderer state address Termio.terminal. The renderer’s separate terminal.RenderState is a frame snapshot, not another terminal emulator.',
'n22':'The lock is a contract for member data, not a blanket thread-safety guarantee for State. In particular, generic.zig:1562 ends the lock scope, but the regex-link call at 1571–1577 reads live state.mouse.point/mods rather than the critical.mouse copy. The mapped snapshot, parser, and Surface mutation paths otherwise show the intended synchronization.',
'n23':'This is a bounded handoff heuristic, not a strict fairness guarantee; both POSIX batch parsing and Windows serial reading yield only after processOutput has unlocked.',
'n16':'renderer_thr and io_thr are OS thread handles; renderer_thread and io_thread own event-loop machinery. Exec starts its own reader (and the POSIX gather stage); Surface.draw provides a synchronous main-thread entry point.',
'n12':'The Surface owns per-session state and borrows App device and refcounted font grid; the runtime owns stable Surface storage. Model the normal destruction order separately from per-allocation initialization errdefers.'}
assert subprocess.check_output(['git','rev-parse','HEAD'],text=True).strip()=='ea8b12a8a9894b5259c441eadd8f6f0c65e215af'
records={}; paths={}
for line in (base/'map.txt').read_text().splitlines():
    key,*vals=line.split()
    if key.startswith('n'):
        assert key not in records
        rec=records[key]={'diagramId':'d1','node':key,'scope':vals,'ranges':[]}
        assert vals and len(set(vals))==len(vals) and set(vals)<={'structure','entity','behavior','relationship','guarantee','subsystem'}
    else:
        path=alias.get(key,key)
        pair,rv=vals
        start,end=map(int,pair.split('-'))
        if path not in paths:
            content=subprocess.check_output(['git','show',f'HEAD:{path}'])
            assert pathlib.Path(path).read_bytes()==content
            assert path.startswith('src/') and not set(path.split('/')) & {'test','tests','benchmark','build','examples','fixtures','docs','scripts'}
            paths[path]=content.decode().splitlines()
        assert 0<start<=end<=len(paths[path]),(rec['node'],path,start,end,len(paths[path]))
        assert len(rv)==len(set(rv))>0
        for p,s,e,*_ in rec['ranges']:
            assert p!=path or max(start,s)>min(end,e),(rec['node'],p,start,end,s,e)
        rec['ranges'].append((path,start,end,[role[r] for r in rv]))
assert set(records)=={f'n{i}' for i in range(12,24)}
for i in range(12,24):
    rec=records[f'n{i}']; assert rec['ranges']
    rec['ranges']=[f'{p}:{s}-{e}:{",".join(r)}' for p,s,e,r in rec['ranges']]
    rec['notes']=notes.get(rec['node'],'')
    print(json.dumps(rec,ensure_ascii=False,separators=(',',':')))
