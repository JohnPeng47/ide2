from pathlib import Path
import json
from collections import defaultdict
scope=['structure relationship subsystem','behavior relationship subsystem','entity structure relationship subsystem','structure relationship guarantee','structure entity relationship','entity behavior relationship','structure','entity behavior relationship subsystem','behavior relationship','behavior relationship subsystem','entity behavior relationship guarantee','entity behavior relationship','behavior relationship']
m={i:defaultdict(dict) for i in range(9,22)}
paths={'S':'src/Surface.zig','A':'src/App.zig','RT':'src/apprt.zig','E':'src/apprt/embedded.zig','G':'src/apprt/gtk/class/surface.zig','GA':'src/apprt/gtk/class/application.zig','T':'src/termio/Termio.zig','I':'src/termio/Thread.zig','R':'src/renderer/Thread.zig','M':'src/termio/mailbox.zig','K':'src/input/key_encode.zig','B':'src/input/Binding.zig','F':'src/renderer/generic.zig','Z':'src/renderer/size.zig'}
data='''9
RT D1-10 D39-53
src/apprt/gtk.zig D2-3
src/apprt/gtk/Surface.zig D6-13 I19-39
G D660-666 I3557-3570 I3610-3629 I1963-1981
E D447-455 I278-294 I504-520 I615-624 I634-646 I670-676 I1842-1861
A I199-218 I220-242
macos/Sources/Ghostty/Surface_View/SurfaceView_AppKit.swift U386-395
10
S D1-11
GA D692-698 U739-750 I2535-2609 I2611-2616 U2628-2634
src/apprt/gtk/class/window.zig I429-477 I496-498
src/apprt/gtk/class/tab.zig I207-223
src/apprt/gtk/class/split_tree.zig I212-277 U735-742
G U1445-1458 U2963-2974 U3026-3034 U3517-3551
E I202-228 I1026-1043 I1052-1062 I1131-1136
macos/Sources/Ghostty/Ghostty.App.swift U588-595 I924-1011
macos/Sources/App/AppDelegate.swift I798-816
macos/Sources/Features/Terminal/BaseTerminalController.swift I282-316 I666-688
11
S D1-16 D64-108 D133-166 DI474-827 DI829-879
I D236 I259-269
T D367-371 I389-400
src/termio/backend.zig D22-25 I39-48
src/termio/Exec.zig I86-93 I897-901 I909-924 I990-1007 I1063-1084
12
S D74-79 D474-484 I623-626 U881-893
E U615-624 I641-646 I278-294
G I3557-3570 U3610-3625 I1963-1981
13
S D144-147 DI301-472 U505-507 I643-644 I873-876 I1822-1831
14
A U172-176
S U1017-1019 DI1804-1906 I2536-2572 I2577-2579 I919
src/renderer/message.zig I86-104
R I397-400 I406-415 I446-458 U487-493
F D2171-2173 I2217-2229
T DI182-248 I437-447 I466-521
I I308-313 I321-324 U464-468
15
S D104-131 D141-142 D155-166 D229-299 I638-643 I1297-1299 I3437-3451 I3466-3477 I3935-3942
16
S D190-207 DI2790-2982 DI3421-3432 DI3918-4297
G U1445-1458 U2963-2974 U3026-3034
E I202-228 I1052-1062 I1131-1136 U2073-2084 U2110-2116 U2150-2164
17
S U2792-2795 U2834-2840 DI2987-3219 DI4941-5819
B D303 I2722-2760
A I319-331 I444-482 I486-529
src/apprt/gtk/App.zig I61-68
GA D692-698 I739-750
E I303-323
18
S U2792-2795 U2834-2846 U2938-2961 I3326-3419 U3421-3432 I3802-3805 I3813-3875 U3918-3923 U4057-4094 I6264-6341
K I59-72 I82-319 I327-550 I1028-1116
src/input/mouse_encode.zig I41-50 I81-172 I176-238 I248-280
src/input/paste.zig I12-22 I42-119
19
S D171-175 DI895-920 U2953-2957 U3871-3875 U6335-6340
T DI431-447 U456-463
M I47-55 I57-108
src/termio/message.zig D92-98 I119-132
I I289-302 I308-313 I349-366
20
src/apprt/structs.zig D13-21
G U3497-3502 U3517-3538
E U1026-1043
S I447-471 I536-562 I2510-2516 U2549-2553 DI2600-2649 I2651-2658
Z DI28-79 I199-204 I245-262 I279-306
21
S D2618 I2637-2649 DI2577-2579 U899-903 U919
T I437-447 I524-530 I534-553 I561-564
I D289-296 I308-313 U326 I389-406 I427-451 U464-468
R D290 I301-303 I404 I474-493
F DI2249-2266'''
role={'D':'declaration','U':'use','I':'implementation'}
for row in data.splitlines():
 if row.isdigit(): n=int(row); continue
 p,*ls=row.split();p=paths.get(p,p).replace('Surface_View','Surface View'); lines=Path(p).read_text().splitlines();dest=m[n][p]
 for r in ls:
  code=r.rstrip('0123456789-'); args=list(map(int,r[len(code):].split('-')));assert 1<=args[0]<=args[-1]<=len(lines),(p,r)
  for line in range(args[0],args[-1]+1):dest.setdefault(line,set()).update(code)
# Parent scope stops at core/host interface for n9; n11 aggregation left to coordinator.
for n,kids in [(9,[10]),(13,[14]),(16,[17,18,19]),(20,[21])]:
 for k in kids:
  for p,r in m[k].items():
   for line,roles in r.items(): m[n][p].setdefault(line,set()).update(roles)
obj={'diagramId':'d1','nodes':[{'node':f'n{n}','scope':scope[n-9].split()} for n in m],'mappings':[]}
for n,byfile in m.items():
 for p,byline in byfile.items():
  # Group adjacent covered lines into disjoint ranges. Roles are unioned within a range.
  intervals=[]
  for line,roles in sorted(byline.items()):
   if intervals and intervals[-1][1]+1==line:intervals[-1][1]=line;intervals[-1][2]|=roles
   else:intervals.append([line,line,set(roles)])
  for a,b,roles in intervals:obj['mappings'].append(dict(node=f'n{n}',path=p,startLine=a,endLine=b,role=[role[x] for x in 'DUI' if x in roles]))
Path('/tmp/d1-n9-n21.json').write_text(json.dumps(dict(diagrams=[obj],notes=''),separators=(',',':')))
print(len(obj['mappings']))
