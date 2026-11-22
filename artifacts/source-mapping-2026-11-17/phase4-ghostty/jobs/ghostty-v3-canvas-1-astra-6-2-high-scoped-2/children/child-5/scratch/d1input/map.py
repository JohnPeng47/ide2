import json, pathlib
D={'diagramId':'d1','nodes':[],'mappings':[]}; C={'diagrams':[D],'notes':''}
for n,s in enumerate(['entity relationship guarantee subsystem','structure relationship guarantee','structure entity relationship guarantee','entity behavior relationship','structure','entity behavior relationship subsystem','behavior relationship','behavior relationship subsystem','entity behavior relationship guarantee','entity behavior relationship','behavior relationship'],11): D['nodes'].append({'node':f'n{n}','scope':s.split()})
from collections import defaultdict
from itertools import groupby
E=defaultdict(lambda:defaultdict(dict)); P={'S':'src/Surface.zig','A':'src/App.zig','E':'src/apprt/embedded.zig','GS':'src/apprt/gtk/class/surface.zig','GA':'src/apprt/gtk/class/application.zig','G':'src/apprt/gtk/App.zig','T':'src/termio/Termio.zig','I':'src/termio/Thread.zig','M':'src/termio/message.zig','B':'src/termio/mailbox.zig','X':'src/termio/Exec.zig','BE':'src/termio/backend.zig','R':'src/renderer/Thread.zig','F':'src/renderer/generic.zig','RM':'src/renderer/message.zig','Z':'src/renderer/size.zig','MA':'macos/Sources/Ghostty/Ghostty.App.swift','MS':'macos/Sources/Ghostty/Ghostty.Surface.swift','MV':'macos/Sources/Ghostty/Surface View/SurfaceView_AppKit.swift'}
def add(n,path,ranges,role):
    p=P.get(path,path);roles={'d':'declaration','u':'use','i':'implementation'}
    for r in ranges.split():
        v=list(map(int,r.split('-')));start,end=v[0],v[-1];assert 1<=start<=end
        for i in range(start,end+1): E[n][p].setdefault(i,set()).update(roles[x] for x in role)
def a(n,s):
    for row in s.strip().splitlines():
        p,role,r=row.split(maxsplit=2);add(n,p,r,role)
def union(n,*children):
    for c in children:
        for p,lines in E[c].items():
            for i,roles in lines.items():E[n][p].setdefault(i,set()).update(roles)
a(12,'''S d 74-79 477-484
S ui 624-626 881-893
E d 451 504
E ui 617-624 634-646
GS d 666 3557
GS ui 3558-3570 3610-3624 1963-1981''')
a(14,'''S di 1804-1906
S ui 1017-1019 2510-2531 2536-2572 2577-2579 899-920
A ui 172-176
E ui 1881-1890
GA ui 2836 2865-2875
RM d 48-53
RM di 86-104
M d 38-43
T di 182-248 437-447 466-521
B i 63-98 102-108
I ui 289-296 308-313 321-324 453-471
R di 103-111 446-458
R ui 290 301-303 397-400 406-415 474-493
F di 588-710 2171-2246
src/termio/stream_handler.zig i 122-136''')
a(13,'''S d 144-147
S di 301-472
S ui 505-507 644 876 1822-1831''');union(13,14)
a(15,'''S d 104-131 141-142 155-166 229-299
S ui 638-639 643 1297-1299 2618-2621 3437-3451 3466-3477 3935-3942''')
a(17,'''S u 2792-2795 2834-2841
S di 2987-3219 3280-3322 4941-5819 5824-5833
src/input/Binding.zig i 2722-2760
A ui 319-331 444-482 486-529
G ui 61-68
GA ui 692-835
E ui 303-323
MA u 58-62 572-605''')
a(18,'''S u 2792-2795 2834-2846 2938-2961 3918-3923 4058-4094 4180-4191 6017-6033
S di 3324-3419 3421-3432 3802-3805 3813-3875 6219-6262 6264-6341 6347-6398
src/input/key_encode.zig i 59-97 99-1117
src/input/mouse_encode.zig i 41-51 81-172 176-280
src/input/paste.zig i 4-22 42-119
src/terminal/paste.zig i 167-177 214-242
src/input/kitty.zig di 3-27
src/input/function_keys.zig di 12-49 51-68 73-91 277-294
src/terminal/kitty/clipboard_response.zig i 105-120 140-185 191-216
E ui 715-719 748-753 772-796 866-871 912-920 2330-2336
src/apprt/gtk/Surface.zig ui 74-83
GS ui 1727-1737 4218-4229 4239-4245 4283-4291 4296-4309 4851-4869 4885-4903
M i 107-116''')
a(19,'''S d 171-175
S di 895-920
S u 2953-2957 3871-3875 6335-6341 5555-5563
S i 2451-2473 4096-4112 4124-4137 4166-4178
T di 431-447 456-463
M d 91-98
M i 107-132
B i 47-55 63-98 102-108
I ui 289-313 349-366 453-471
BE ui 76-86
X i 403-469''')
a(16,'''S di 2792-2982 3421-3432 3918-4297
S d 190-207
E ui 202-228 1052-1062 1131-1136 2073-2084 2110-2116 2150-2164
GS ui 1275-1281 1445-1463 2844-2874 2923-2938 2956-2974 3000-3011 3026-3034 3339-3344 3400-3420
MS u 47-58 83-94 136-149''');union(16,17,18,19)
a(21,'''S d 2618
S ui 2637-2649 2577-2579 899-920
M d 48-49
RM d 45-46
T di 437-447 524-564
B i 63-98 102-108
I ui 272 289-296 308-313 326 389-406 427-451 453-471
R ui 232 290 301-303 404 474-493
F i 2249-2266
BE ui 66-74
X i 266-272 1136-1156
src/terminal/Terminal.zig i 4912-4921 4935-4953 5060-5074''')
a(20,'''S di 2600-2658
S i 447-471 536-562 2510-2516 2549-2553 3765-3798
Z di 20-79 191-204 245-262 277-306
E ui 1026-1043 1996-1998
GS ui 3497-3502 3514-3538
MV u 482-497''');union(20,21)
a(11,'''S d 1-16 64-84 92-108 133-153 155-175 184-185
S di 474-827 829-885 1017-1241
T di 254-365 367-376 399
I ui 263-272
BE ui 39-48
X i 86-104 895-916 998-1018 1021-1030 1063-1094''');union(11,12,13,15,16,20)
for n in range(11,22):
    for p,lines in sorted(E[n].items()):
        data=pathlib.Path(p).read_text().splitlines();assert max(lines)<=len(data),(n,p,max(lines))
        for _,grp in groupby(enumerate(sorted(lines.items())),lambda k:(k[0]-k[1][0],sorted(k[1][1]))):
            pts=list(grp);b,role=pts[0][1];e=pts[-1][1][0];D['mappings'].append(dict(node='n'+str(n),path=p,startLine=b,endLine=e,role=sorted(role)))
file=pathlib.Path('/tmp/d1input/subset.json');file.write_text(json.dumps(C,separators=(',',':')));print(file,len(D['mappings']))
