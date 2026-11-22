import json
from pathlib import Path
from collections import defaultdict
p=Path('/tmp/ghostty-input')
scope={a[0]:a[1:] for a in map(str.split,(p/'scopes').read_text().splitlines())}
n={i:[] for i in range(24,36)}
files={'S':'src/Surface.zig','A':'src/App.zig','T':'src/termio/Termio.zig','H':'src/termio/Thread.zig','E':'src/termio/Exec.zig','I':'src/input.zig','K':'src/input/key_encode.zig','M':'src/input/mouse_encode.zig','P':'src/input/paste.zig','V':'src/terminal/stream.zig','F':'src/termio/stream_handler.zig','Q':'src/termio/mailbox.zig','D':'src/termio/message.zig','B':'src/input/Binding.zig','Z':'src/terminal/modes.zig','Y':'src/terminal/Terminal.zig','C':'src/terminal/Screen.zig','G':'src/apprt/gtk/class/surface.zig','L':'src/apprt/embedded.zig','W':'macos/Sources/Ghostty/Ghostty.App.swift','R':'src/apprt/gtk/class/application.zig','b':'src/termio/backend.zig','q':'src/datastruct/blocking_queue.zig','d':'src/datastruct/message_data.zig','t':'src/termio.zig','k':'src/input/key.zig','f':'src/input/function_keys.zig','s':'src/terminal/kitty/key.zig','i':'src/input/kitty.zig','p':'src/pty.zig','m':'src/terminal/mouse.zig','g':'src/renderer/size.zig','a':'src/apprt.zig'}
roles={'d':'declaration','u':'use','i':'implementation'}
def add(id, spec):
 for phrase in spec.splitlines():
  if not phrase.strip(): continue
  f,*rs=phrase.split()
  f=files.get(f,f)
  for r in rs:
   lines, role=r.split(':')
   s,*e=map(int, lines.split('-'))
   n[id].append((f,s,e[0] if e else s,role))
def inherit(id,*children,exclude=()):
 for child in children:
  n[id].extend(r for r in n[child] if r[0] not in exclude)
add(35,'''b 39-48:dui 76-86:dui
T 367-371:d 389-400:ui
E 86-103:du 129-131:ui 147-156:ui 403-490:dui 498-525:du 897-900:d 909-916:ui 990-1019:ui 1021-1039:ui 1083-1095:ui
p 19-23:du 133-187:di 334-402:dui 439-455:ui
src/global.zig 27-30:du
build.zig.zon 26-31:d''')
add(34,'''H 253-278:ui 288-375:dui 453-471:dui
Q 30-34:d
q 149-168:di
D 91-98:d
T 449-463:dui
b 22-25:d 76-86:dui
E 403-409:d''')
add(33,'''S 171-175:d 895-920:dui 2445-2506:dui 3918-3923:d 4019-4031:ui 4057-4178:ui 4678-4682:d 4778-4867:ui 4941:d 5161-5187:ui 5555-5563:ui 5635-5644:ui 6347-6352:dui
S 2325-2443:dui
C 3063-3106:di 3361-3415:di
D 91-98:d 118-132:di
Q 47-55:dui 63-98:dui
H 289-302:dui 349-366:ui''')
add(32,'''S 703-725:ui 895-920:dui
T 61-62:d 254:d 335-352:ui 431-447:dui
Q 11-109:dui
t 23-32:du
q 56-71:d 74-90:di 99-168:di
H 253-278:ui 288-313:dui 347-368:ui 453-471:dui''')
add(31,'''I 16:du
S 3421-3432:dui 4180-4191:ui 4941:d 5240-5248:ui 6010-6026:dui 6156-6162:dui 6219-6239:dui 6261-6341:dui
P 4-119:dui 121-125:d 163-183:di
D 107-116:dui
d 38-74:dui
G 1727-1737:dui 4215-4227:du 4257-4291:ui 4644-4676:dui 4695-4744:dui 4796-4819:ui 4851-4920:dui
L 715-719:d 742-753:ui 772-801:ui 866-954:dui 1131-1168:dui 2330-2336:dui
W 58-76:ui 298-345:dui 415-469:dui''')
add(30,'''I 15:du
S 3584-3589:d 3680-3682:ui 3729-3750:ui 3800-3875:dui 3880-3905:dui 3918-3923:d 3935-3948:ui 4057-4094:ui 4678-4682:d 4735-4737:ui 4778-4801:ui
M 12-280:dui
m 6-29:dui
g 114-174:dui
Y 116-126:d
D 91-93:d''')
add(29,'''V 1673:d 2262-2302:ui 2631-2650:ui
Z 38-51:di 209-231:dui 382:d 395-403:d 411:d 417-421:d
F 188-194:dui 208-212:d 295-304:ui 322:ui 641-644:d 681-685:ui 775-819:ui
S 3691-3723:ui 6028-6033:ui 6343-6398:dui
G 4218-4227:du 4239-4245:ui 4293-4309:dui
src/terminal/paste.zig 167-184:dui 214-242:dui
src/terminal/kitty/clipboard_response.zig 29-216:dui''')
inherit(29,30,31)
add(28,'''S 3399-3419:dui 4941:d 5029-5051:ui
K 12-97:dui 99-319:dui 327-445:dui 526-534:ui 552-618:dui 628-699:dui 924-975:dui 1008-1117:dui
f 12-69:dui 78-86:dui 121-149:ui 150-259:ui 264-314:dui
i 3-129:di
V 1673:d 2262-2302:ui 2319-2363:ui 2418-2425:ui 2752-2810:ui 3146-3149:d 3414-3430:ui
Z 38-51:di 209-231:dui 375:d 388-393:d 404-405:d
F 188-194:dui 208-212:d 295-304:ui 318:ui 333-352:ui 594-600:dui 641-644:d 681-685:ui
Y 83-84:d 112-114:d
C 74-75:d
s 5-62:dui 78-106:di 123-124:d''')
add(27,'''I 13:du 25:du
k 16-55:d 84-88:d
S 3324-3419:dui
T 40-43:d
Y 83-84:d 112-114:d
C 74-75:d
s 14-17:di 78-93:d
K 12-618:dui 628-699:dui 701-892:dui 924-975:dui 1008-1117:dui
f 12-314:dui
i 3-129:di
D 13-17:du
d 8-36:d''')
add(26,'''S 881-885:dui 2325-2443:dui 2445-2506:dui 3043-3057:ui 3124-3157:ui 4899-4905:dui 4931-5819:dui 6219-6239:dui 6261-6262:ui
B 302-333:d 1372-1557:dui
A 318-331:dui 441-529:dui
T 604-679:dui
H 289-313:dui 328-337:ui
Y 5868-5911:di
C 3063-3106:di 3361-3415:di
a 39-53:du
src/apprt/gtk/App.zig 61-68:dui
R 691-835:dui 2535-2585:dui
L 52-53:d 303-323:dui
W 58-62:ui 572-601:dui 924-1011:dui''')
add(25,'''S 2790-3219:dui 3245-3419:dui 4941:d 5821-5833:dui
B 2716-2760:dui
k 57-78:di
K 82-97:dui
A 484-529:dui
L 201-228:dui 2070-2084:dui
G 1445-1458:ui''')
add(24,'''a 39-53:du
A 345-412:dui
S 688-701:ui 761-767:ui 2574-2579:dui 3579-3761:dui
G 2963-2974:ui 3026-3034:ui 3087-3097:ui 3147-3167:ui
L 1052-1062:dui 1075-1122:dui
F 756-758:ui''')
inherit(24,*range(25,36),exclude=('src/pty.zig','src/renderer/size.zig','src/terminal/kitty/clipboard_response.zig','src/apprt/gtk/class/application.zig'))
notes='d1/n24–n35 worker subset, pinned to ea8b12a8a9894b5259c441eadd8f6f0c65e215af. n25: a non-consuming binding can execute and still allow encoding; sequence leader events can also be encoded and held for later flush/drop. n29/n31: ordinary text goes through input.paste.encode; clipboard mode 5522 instead sends a Kitty paste-event MIME listing, not the clipboard text. n33: the guard drops write_small, write_stable and write_alloc at Surface.queueIo; it is not a universal Termio write interlock (e.g. Termio.clearScreen can emit a form feed at a prompt). n35: the actual OS-write scheduling after Exec.write_stream.queueWrite belongs to external libxev, outside the mapped source; the repository connects the stream to the POSIX PTY master or Windows pseudoconsole input pipe. The dedicated validate_source_mappings tool was not exposed to this worker; the subset was checked locally for allowed values, tracked paths, exclusions, bounds, and no duplicated lines within a node.'
# Combine adjacent blocks when they overlap, accruing the roles that apply to the combined range.
merged={}
for id, ranges in n.items():
 out=[]
 for file in sorted({r[0] for r in ranges}):
  cur=None
  for _, s, e, r in sorted(x for x in set(ranges) if x[0]==file):
   if cur is not None and (s<=cur[2] or (s==cur[2]+1 and r==cur[3])):
    cur=(file, cur[1], max(cur[2],e), ''.join(c for c in roles if c in cur[3] or c in r))
   else:
    if cur is not None: out.append(cur)
    cur=(file,s,e,r)
  if cur is not None: out.append(cur)
 merged[id]=out
maps=[{'node':f'n{id}','path':f,'startLine':s,'endLine':e,'role':[roles[x] for x in r]} for id,v in merged.items() for f,s,e,r in v]
result={'diagrams':[{'diagramId':'d1','nodes':[{'node':k,'scope':v} for k,v in scope.items()],'mappings':maps}],'notes':notes}
(p/'candidate.json').write_text(json.dumps(result,separators=(',',':'))+'\n')
(p/'compact.jsonl').write_text(''.join(json.dumps({'diagramId':'d1','node':f'n{id}','scope':scope[f'n{id}'],'ranges':[f'{f}:{s}-{e}:{r}' for f,s,e,r in v]},separators=(',',':'))+'\n' for id,v in merged.items())+json.dumps({'notes':notes})+'\n')
print(f'{len(scope)} nodes; {len(maps)} mappings')
