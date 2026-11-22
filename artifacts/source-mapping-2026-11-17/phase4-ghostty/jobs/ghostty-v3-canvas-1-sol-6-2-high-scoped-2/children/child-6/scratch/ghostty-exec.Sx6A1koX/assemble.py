import json, pathlib, sys
scopes = [
 'sebru',     # 1  Exec implementation
 'sr',        # 2  variant storage and ownership
 'ser',       # 3  subprocess entity and ownership
 'sr',        # 4  arena/cwd/env/args storage and ownership
 'sr',        # 5  cached sizes and propagation
 'sr',        # 6  optional owned handles
 'srb',       # 7  selected process variants
 'ebr',       # 8  named start and launch handoffs
 'ebr',       # 9  named initTerminal and its effects
 'ebrg',      # 10 named queueWrite and no writes after exit
 'ebrg',      # 11 named threadExit and ordered shutdown
 'srg',       # 12 stack placement/lifetime, stable callback pointer
 'esr',       # 13 nested backend ThreadData entity
 'sbr',       # 14 watcher fields and use
 'ebr',       # 15 processExitCommon mailbox notification
 'sbr',       # 16 write resource fields and use
 'sbrg',      # 17 stable write state, pool retirement
 'sbr',       # 18 timer and mode caching
 'sbr',       # 19 thread/descriptor storage and handoff
 'ubr',       # 20 POSIX reader subsystem
 'sbr',       # 21 shared ring fields and producer/consumer operations
 'sbrg',      # 22 locking, conditions and idle notification
 'ebr',       # 23 gather thread and PTY/quit processing
 'br',        # 24 consumer flow and renderer handoff
 'brg',       # 25 join before reader returns
 'br',        # 26 Windows-specific reader path
]
scope = dict(s='structure',e='entity',b='behavior',r='relationship',g='guarantee',u='subsystem')
roles = dict(d='declaration',u='use',i='implementation')
paths = dict(E='src/termio/Exec.zig',T='src/termio/Termio.zig',I='src/termio/Thread.zig',B='src/termio/backend.zig',X='src/termio.zig',O='src/termio/Options.zig',S='src/Surface.zig',A='src/App.zig',M='src/apprt/surface.zig',C='src/Command.zig',F='src/os/flatpak.zig',OS='src/os/main.zig',P='src/pty.zig',PT='src/os/pipe.zig',FD='src/lib/compat/fd.zig',R='src/renderer/State.zig',G='src/renderer/generic.zig',SZ='src/renderer/size.zig',VT='src/terminal/Terminal.zig',SC='src/config/command.zig',SH='src/termio/stream_handler.zig')
# Gather leaves first; parent entries include the relevant parts of their children.
ranges = {
 26: 'E:139-145:ui E:196-197:d E:203-230:ui E:1083-1094:ui E:1778-1826:di P:325-339:d P:419-425:di T:702-762:di R:36-105:di G:1420-1421:u',
 25: 'E:1412:d E:1441-1442:di E:1462-1476:ui E:1481-1491:i E:1497-1505:i E:1526:d E:1532-1539:i',
 24: 'E:1412:d E:1478-1520:ui E:1696-1705:i T:702-762:di R:36-105:di G:1370-1375:d G:1420-1427:ui',
 23: 'E:1320-1357:d E:1364-1410:d E:1431-1439:ui E:1462-1476:ui E:1522-1741:dui E:1756-1776:di E:196-197:d E:203-217:i',
 22: 'E:1364-1373:d E:1386-1406:d E:1412:d E:1441-1460:ui E:1481-1491:ui E:1497-1514:ui E:1526:d E:1532-1563:ui E:1614-1658:ui E:1696-1705:ui E:1735-1741:di FD:10-83:di',
 21: 'E:1305-1318:d E:1359-1410:d E:1441-1442:di E:1462-1466:u E:1481-1505:ui E:1551-1579:ui E:1685-1705:ui',
 20: 'E:123-127:di E:139-156:ui E:196-197:d E:203-217:i E:229:u E:1269-1776:dui T:702-762:di SH:114-119:di R:36-105:di G:1370-1375:d G:1420-1427:ui FD:10-83:di',
 19: 'E:123-127:di E:139-156:ui E:196-230:di E:535-550:di E:897-900:d E:1015-1019:i E:1083-1094:i E:1412-1414:di E:1462-1476:ui E:1541-1549:ui E:1635-1641:i E:1713-1733:ui E:1778-1826:dui P:109-121:d P:325-339:d OS:54:d PT:7-22:di',
 18: 'E:35-36:d E:133-137:di E:147-156:ui E:181-194:ui E:232-264:di E:317-401:dui E:540-549:d E:563-565:i P:25-37:d P:194-205:di I:348:ui T:682:d T:698-700:ui B:56-64:dui S:1162:u S:1457-1468:di',
 17: 'E:403-409:d E:416-469:ui E:471-490:di E:492-508:d E:520-525:d E:549-555:di',
 16: 'E:129-131:di E:147-156:ui E:403-490:dui E:493-508:d E:514-525:d E:549-565:di',
 15: 'E:158-179:ui E:274-315:dui F:163-232:dui F:395-408:ui F:457-518:dui T:389-399:ui T:838-845:d M:104-107:d M:169-207:dui A:161-167:di A:273-281:di A:293:u A:532-550:di A:577-581:d A:596-613:dui S:1015-1018:d S:1141:ui S:1297-1299:di',
 14: 'E:106-121:di E:147-179:ui E:274-315:dui E:413-414:u E:510-518:d E:527-533:d E:557-558:ui F:83-105:d F:163-232:dui F:395-408:ui F:457-518:dui',
 13: 'I:259-286:dui T:389-400:ui T:824-852:di B:115-123:di E:147-156:ui E:196-201:ui E:274-283:ui E:403-414:u E:492-566:di',
 12: 'S:134-136:d S:761-767:ui I:135-139:du I:236:d I:259-296:dui T:367-371:d T:389-400:ui T:427-429:di T:824-852:di B:39-54:dui B:115-123:di E:44-61:di E:147-175:ui E:403-422:ui E:459-480:ui E:492-508:d E:549-566:di',
 11: 'I:259-269:ui T:427-429:dui B:50-54:dui E:196-230:dui E:535-550:di E:1105-1133:di E:1158-1258:dui E:1412-1414:di E:1462-1491:ui E:1526-1539:di E:1635-1641:i E:1696-1733:ui E:1778-1780:di E:1789-1826:ui C:485-506:di F:141-161:di F:234-278:di',
 10: 'I:288-296:du I:347-366:ui T:452-463:dui B:76-86:dui E:129-131:di E:147-156:ui E:274-277:i E:403-490:dui E:492-508:d E:510-525:d',
 9: 'T:254:d T:304-310:ui B:33-37:dui VT:59-65:d VT:70-71:d E:63-84:dui E:266-272:dui E:590-597:d E:855-883:i E:909-924:ui E:1135-1156:di VT:5569-5583:di',
 8: 'E:86-104:dui E:895-1103:dui P:9-23:d P:55-76:di P:92-96:di P:131-187:di P:226-266:di P:325-455:di C:160-483:dui F:10-18:di F:117-139:dui F:280-455:dui',
 7: 'E:24-26:u E:38-42:d E:602-609:d E:990-1095:dui C:1-20:d C:52-112:d C:160-176:di OS:46-47:d F:10-70:di F:117-139:di',
 6: 'E:24-26:u E:587-609:d E:886-941:dui E:990-1019:ui E:1063-1133:dui P:19-23:d P:189-192:di P:457-464:di',
 5: 'E:63-84:dui E:266-272:dui E:594-595:d E:880-883:i E:909-916:ui E:1135-1156:di P:9-17:d P:87-90:di P:218-224:di P:473-484:di SZ:191-196:d SZ:237-242:d',
 4: 'S:665-700:ui E:568-584:d E:587-593:d E:622-893:dui E:926-1026:ui E:1829-2057:dui SC:156-168:di SH:43-86:dui SH:189-236:di',
 3: 'E:44-84:di E:86-104:ui E:196-202:ui E:266-272:ui E:568-609:d E:622-1267:dui E:1829-2064:dui C:20:d C:52-112:d C:160-176:di F:10-70:di F:117-139:di P:9-23:d SZ:191-196:d SZ:237-242:d SC:156-168:di',
 2: 'X:23-30:d O:20-21:d S:687-725:ui T:34-35:d T:308-310:ui T:335-356:ui B:13-31:dui E:1-4:d E:44-61:di',
 1: 'E:1-4:d E:24-26:u E:35-61:di B:39-86:dui B:105-123:dui I:236:d I:326:u I:389-406:di I:427-451:dui T:254:d T:367-425:dui T:524-540:dui T:854-859:dui P:39-53:d P:98-103:di P:268-322:di P:486-491:di S:829:d S:840-845:ui S:856-858:ui I:473-482:di',
}

def parse(row):
    for token in row.split():
        path, lines, role = token.split(':')
        bounds = list(map(int, lines.split('-')))
        yield paths[path], bounds[0], bounds[-1], set(role)

def coalesce(iterable):
    ordered = sorted(iterable, key=lambda r:r[:3]); merged = []
    for path, start, end, role in ordered:
        if merged and path == merged[-1][0] and start <= merged[-1][2] + 1:
            prior = merged.pop()
            merged.append((path, prior[1], max(end, prior[2]), prior[3] | role))
        else:
            merged.append((path, start, end, role))
    return merged

root = pathlib.Path(sys.argv[1]); linecounts = {}
nodes = [dict(node=f'n{i}', scope=[scope[c] for c in s]) for i, s in enumerate(scopes,1)]
assert len(nodes) == len(ranges) == 26
mappings = []
root_union = ' '.join(ranges.values())
for i in range(1, 27):
    for path, a, b, role in coalesce(parse(root_union if i == 1 else ranges[i])):
        if path not in linecounts:
            linecounts[path] = len((root/path).read_text().splitlines())
        assert 0 < a <= b <= linecounts[path]
        assert set(role) <= set(roles)
        mappings.append(dict(node=f'n{i}', path=path, startLine=a, endLine=b, role=[roles[c] for c in roles if c in role]))
notes = ('d4: The POSIX reader is the non-Windows spawn branch; Windows instead uses a blocking ReadFile loop. '
         'The .fork_exec tag also stores the Windows Command; its name does not imply that Windows forks. '
         'The iOS NullPty is a compile-time stub, not another real PTY implementation. '
         'The validate_source_mappings tool was not available in this worker session; node coverage, roles, paths, bounds, and nonoverlap were checked locally.')
candidate = dict(diagrams=[dict(diagramId='d4', nodes=nodes, mappings=mappings)], notes=notes)
with open('candidate.json', 'w') as f:
    f.write('{"diagrams":[{"diagramId":"d4","nodes":[\n')
    f.write(',\n'.join(json.dumps(n,separators=(',',':')) for n in nodes))
    f.write('\n],"mappings":[\n')
    f.write(',\n'.join(json.dumps(m,separators=(',',':')) for m in mappings))
    f.write('\n]}],"notes":' + json.dumps(notes) + '}\n')
assert json.loads(pathlib.Path('candidate.json').read_text()) == candidate
print(f'{len(mappings)} mappings in {len(linecounts)} paths')
