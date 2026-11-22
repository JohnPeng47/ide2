import json, pathlib, subprocess
root=pathlib.Path('.')
scopes={
16:'entity behavior relationship',17:'structure behavior relationship subsystem',18:'behavior relationship subsystem',19:'entity behavior relationship guarantee',20:'entity behavior relationship',21:'behavior relationship',22:'structure entity relationship subsystem',23:'structure entity behavior relationship subsystem',24:'structure entity behavior relationship',25:'structure entity relationship guarantee',26:'structure entity behavior relationship',27:'structure entity behavior relationship',28:'entity behavior relationship',
}
paths={
'S':'src/Surface.zig','T':'src/termio/Termio.zig','Th':'src/termio/Thread.zig','M':'src/termio/mailbox.zig','Msg':'src/termio/message.zig','B':'src/termio/backend.zig','E':'src/termio/Exec.zig','Tp':'src/termio.zig','H':'src/termio/stream_handler.zig','Opt':'src/termio/Options.zig',
'K':'src/input/key_encode.zig','Mouse':'src/input/mouse_encode.zig','Paste':'src/input/paste.zig','Bind':'src/input/Binding.zig','St':'src/terminal/stream.zig','Pa':'src/terminal/Parser.zig','Term':'src/terminal/Terminal.zig','TP':'src/terminal/paste.zig','Exp':'src/terminal/main.zig','Pick':'src/terminal/SelectionGesture.zig','Screen':'src/terminal/Screen.zig','SS':'src/terminal/ScreenSet.zig','CR':'src/terminal/kitty/clipboard_response.zig',
'Sz':'src/renderer/size.zig','R':'src/renderer/generic.zig','RS':'src/renderer/State.zig','RT':'src/renderer/Thread.zig','RM':'src/renderer/message.zig','GL':'src/renderer/OpenGL.zig','Font':'src/font/SharedGrid.zig',
'Apr':'src/apprt.zig','AS':'src/apprt/structs.zig','Emb':'src/apprt/embedded.zig','Gtk':'src/apprt/gtk/class/surface.zig','GtkApp':'src/apprt/gtk/App.zig','GtkApplication':'src/apprt/gtk/class/application.zig','Swift':'macos/Sources/Ghostty/Surface View/SurfaceView_AppKit.swift','SwiftApp':'macos/Sources/Ghostty/Ghostty.App.swift','App':'src/App.zig','C':'src/Command.zig','Pty':'src/pty.zig','F':'src/os/flatpak.zig',
}
doc={n:[] for n in scopes}
roles={'d':'declaration','u':'use','i':'implementation'}
def add(n,s):
 for line in s.strip().splitlines():
  key,*ranges=line.split()
  for v in ranges:
   span,rr=v.split(':'); ab=list(map(int,span.split('-')))
   doc[n].append(dict(node=f'n{n}',path=paths[key],startLine=ab[0],endLine=ab[-1],role=[roles[r] for r in rr]))
add(17, 'S 2834-2840:u 2987-3219:di 3280-3322:di 4941-5819:di\nBind 1374-1489:di 1539-1557:di 2722-2760:di\nApp 444-529:di\nEmb 303-323:di\nGtkApp 61-68:di\nGtkApplication 692-835:di\nSwiftApp 58-62:u 572-595:i\n')
add(18, 'S 2792-2795:d 2834-2846:i 2938-2961:i 3280-3432:di 3802-3805:di 3813-3905:di 3918-3923:d 4057-4094:i 5240-5248:u 6017-6033:i 6219-6398:di\nK 14-618:di 631-699:di 1010-1117:di\nMouse 13-51:di 81-280:di\nPaste 4-125:di 180-183:di\nTP 167-242:di\nCR 105-216:di\nEmb 747-801:i 912-917:u 2330-2336:u\nGtk 4218-4309:ui 4851-4920:ui\n')
add(19, 'S 171-175:d 2451-2473:di 895-920:di 4096-4178:i 5555-5563:i\nScreen 3063-3106:di\nT 437-447:di\nMsg 91-98:d 118-132:di\nM 47-108:di\nTh 349-366:i\n')
add(16, 'S 2451-2506:di 2792-3219:di 3326-3432:di 3813-3905:di 3918-4297:di 6264-6341:di 895-920:di 4941-4975:di\nPick 278-296:di 558-660:di 682-693:di\nEmb 202-228:du 1052-1062:du 1131-1136:du\nGtk 2844-2874:ui 1445-1475:ui 2923-3046:ui 3388-3420:ui\n')
add(21, 'S 2577-2579:di 2618:d 2637-2649:ui 895-920:di\nT 437-447:di 524-564:di\nM 63-108:di\nTh 326:u 389-406:di 427-471:di\nMsg 48-49:d\nRM 45-46:d\nRT 232:u 290-304:i 404:u 474-493:i\nR 2249-2304:di\nGL 231-236:di\n')
add(20, 'S 447-471:di 536-562:i 2510-2517:i 2536:d 2542-2553:i 2600-2658:di\nEmb 1026-1043:ui 1996-1998:u\nSwift 482-507:ui\nGtk 3497-3537:ui\nSz 28-79:di 186-204:di 231-306:di\nT 524-564:di\nRT 404:u\nFont 143-148:di\nR 2249-2304:di\n')
add(23, 'S 687-725:ui\nT 34-35:d 308-310:u 344:u 354-356:ui 389-400:ui 427-429:ui\nB 14-54:di 66-86:di\nE 38-230:di 266-315:di 403-490:di 587-609:d 886-1258:di 1493-1519:ui 1778-1826:ui\nC 163-303:di 305-436:di\nPty 19-23:d 134-192:di 221-224:di 230-266:di 344-464:di 476-484:di\nF 122-139:di 280-447:di\n')
add(24, 'T 64-66:d 312-361:ui 705-717:di 736-754:ui\nH 96-112:di 188-246:di\nExp 62:d\nSt 588-671:di 722-739:di 831-1009:di 1371-1593:di 1637-1671:di\nPa 257-317:di\n')
add(25, 'S 633-636:i 3399-3405:u\nT 40-46:d 272-328:i 335-361:i 705-717:i 736-754:i\nTerm 1-4:d 48-165:d 344-404:di\nExp 60:d\nH 23-26:d 188-246:ui\nRS 13-20:d\nR 274-275:d 1479-1487:ui\n')
add(26, 'S 703-721:i 1870-1885:ui\nT 37-38:d 58-62:d 182-248:di 312-365:di 437-447:di 466-530:di 756-761:ui\nM 11-108:di\nMsg 13-98:d 107-132:di\nTh 289-375:ui\nH 151-154:i\n')
add(28, 'S 2637-2638:u 2953-2957:u\nT 437-463:di 524-564:di\nTh 27-34:d 64-68:d 253-286:di 289-375:di 389-406:di 427-471:di\nM 63-108:di\nB 66-86:di\nE 266-272:di 403-490:di 1136-1156:di\n')
add(27, 'S 133-136:d 607-609:i 640-642:i 761-767:i 840-858:i\nTp 27-32:d\nTh 1-12:d 43-87:d 92-375:di 389-406:di 427-482:di\nT 367-463:di 524-564:di 830-852:di\nB 39-54:di 66-86:di\nE 86-230:di 403-490:di\n')
add(22, 'S 133-136:d 633-642:i 661-725:ui 761-767:i 840-858:i\nT 1-5:d 28-74:d 182-248:di 250-762:di 767-852:di\nB 14-54:di 66-86:di\nE 38-230:di 403-490:di 587-609:d 897-1095:di 1493-1519:ui 1789-1812:ui\nMsg 13-98:d\nM 11-108:di\nTh 253-375:di 389-406:di 427-471:di\nH 23-42:d 65-154:di 188-246:di\nSt 588-671:di 722-739:di\nTerm 48-165:d 344-404:di\nRS 13-20:d\n')
node_rows=[{'node':f'n{n}','scope':scope.split()} for n,scope in scopes.items()]
notes=('Assigned portion only: d1 n16–n28. For d1 n19, readonly drops write messages sent via Surface.queueIo; it does not gate stream-generated protocol replies, which enter the Termio mailbox directly (src/termio/stream_handler.zig:151–154). For d1 n21, the core Surface sends the renderer its own resize immediately; Termio sends another after its resize. For d1 n25, the renderer also owns a RenderState snapshot, not a second live Terminal. The requested validate_source_mappings tool was not available; local checks verified references, enums, tracked paths, non-overlap, and line bounds at the pinned commit.')
candidate={'diagrams':[{'diagramId':'d1','nodes':node_rows,'mappings':[r for n in scopes for r in doc[n]]}],'notes':notes}
path=pathlib.Path('/tmp/ghostty-d1input/candidate.json')
# One compact JSON record per line for review.
header='{"diagrams":[{"diagramId":"d1","nodes":'+json.dumps(node_rows,separators=(',',':'))+',"mappings":[\n'
path.write_text(header+',\n'.join(json.dumps(r,separators=(',',':')) for r in candidate['diagrams'][0]['mappings'])+']}],"notes":'+json.dumps(notes,ensure_ascii=False)+'}\n')
assert json.loads(path.read_text())==candidate
assert subprocess.check_output(['git','rev-parse','HEAD'],text=True).strip()=='ea8b12a8a9894b5259c441eadd8f6f0c65e215af'
counts={}
for n,ranges in doc.items():
 assert ranges and scopes[n] and set(scopes[n].split()) <= set('structure entity behavior relationship guarantee subsystem'.split())
 seen={}
 for r in ranges:
  p=r['path']; a,b=r['startLine'],r['endLine']; rr=r['role']
  if p not in counts:
   counts[p]=len(subprocess.check_output(['git','show',f'HEAD:{p}']).splitlines())
  assert 1 <= a <= b <= counts[p] and rr and set(rr)<=set(roles.values()),r
  for c,d in seen.setdefault(p,[]): assert b<c or d<a,(n,p,a,b,c,d)
  seen[p].append((a,b))
print(path, 'nodes',len(node_rows),'ranges',sum(map(len,doc.values())))
