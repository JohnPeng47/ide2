import fnmatch, json, subprocess, sys
from pathlib import Path
D=Path(__file__).parent
base='src/terminal/'
files={k:base+v+'.zig' for k,v in dict(T='Terminal',S='Screen',SS='ScreenSet',PL='PageList',P='page',CP='compress/Page',CO='compress',M='mem',Sel='Selection',SG='SelectionGesture',Search='search/terminal',CR='c/grid_ref_tracked',CT='c/terminal',R='render',Mode='modes',Tabs='Tabstops',K='kitty',KG='kitty/graphics',KS='kitty/graphics_storage',KK='kitty/key',Style='style',Link='hyperlink').items()}
files.update(IO='src/termio/Termio.zig',SH='src/termio/stream_handler.zig',DLL='src/datastruct/intrusive_linked_list.zig',DS='src/datastruct/main.zig',RT='src/renderer/Thread.zig')
scopes=dict(s='structure',e='entity',b='behavior',r='relationship',g='guarantee',y='subsystem')
roles=dict(d='declaration',i='implementation',u='use')
scope_rows='ery s s sr ser srg sbgr sber ey s sr srg s s sery s sr brg srgb srg s sbrg esy sg srg sg sr sr s'.split()
assert len(scope_rows)==29
rows='''
1 T:1-4:d T:48-182:d T:281-328:d T:330-430:di T:1893:d T:2272-2298:i T:2301-2314:iu T:2401-2449:iu T:4912-5074:di T:5868-5911:di IO:40-43:d IO:272-306:i IO:308-322:u IO:335-351:iu IO:354-365:iu SH:188-199:u SH:208-250:u
2 T:45-46:d T:56-68:d T:253-266:d Tabs:1-10:d T:366-376:i IO:304-306:u T:4912:d T:4923-4966:i T:5049-5074:i
3 T:70-77:d T:83-84:d T:153-182:d T:227-251:d Mode:15-35:di T:5569-5590:di T:5617-5638:di R:983-1002:u R:1411-1414:u
4 T:86-87:d T:268-279:d T:384-391:i T:454-509:di S:143-156:d S:209-218:d T:5906:u T:5956:u
5 T:37-38:d T:48-49:d T:344-348:d T:356-369:iu T:395-404:iu SS:1-8:d SS:17-109:di
6 SS:23-31:d SS:38-53:di SS:104-109:di T:5680-5683:u T:5740-5747:u T:5868-5876:u
7 SS:33-36:d SS:47-52:i SS:69-72:di SS:90-102:di T:4912:d T:4999-5047:iu T:5868-5876:iu Search:128-138:iu Search:269-315:iu SG:86-90:d SG:172-179:iu SG:583-610:iu CT:2188-2234:iu CR:16-32:di CR:44-49:u CR:78-99:iu
8 SS:17-21:d SS:30-31:d SS:38-67:di SS:74-102:di T:344-348:d T:356-369:iu T:395-404:u T:5680-5747:iu T:5758-5762:d T:5783-5785:u S:315-367:di
9 S:1:d S:37-141:d S:143-269:di S:271-367:di S:441-489:di S:936-979:di S:2234-2237:d S:2310-2349:iu S:3053-3106:di SS:38-62:iu SS:75-88:iu T:5680-5747:u
10 S:52-56:d S:143-194:d S:209-218:d T:2700-2754:di S:2234-2253:iu S:2368-2396:i
11 S:195-199:d S:315-319:d S:329-346:iu S:838-873:di S:884-979:di PL:7800-7818:di P:1120-1133:di T:2301-2314:u T:2401-2409:u
12 S:58-62:d S:3053-3106:di Sel:24-52:d Sel:70-82:di Sel:121-149:di PL:354-357:d PL:472-473:d PL:6309-6334:di
13 S:64-75:d S:220-269:di K:11-13:d KK:5-62:di T:1906-1915:u T:2756-2777:di SH:332-352:u
14 S:77-141:d S:315-319:d S:348-367:iu S:441:d S:464-488:iu S:3017-3051:di K:8-9:d KG:18-27:d KS:69-108:d KS:151-166:d R:996-1002:u R:1411-1414:u
15 PL:1-4:d S:44-45:d S:315-327:iu S:334-338:u S:361-367:u S:441-443:u S:2234-2237:d S:2310-2322:u PL:401-511:d PL:648-719:di PL:727-805:di PL:938-988:di PL:1278-1369:di PL:4027-4052:di PL:5431-5546:di T:3585-3600:u RT:837-856:u
16 PL:335-352:d PL:359-399:di PL:401-402:d PL:465-470:d PL:507-511:d PL:648-665:iu PL:677-705:iu PL:7601-7624:di PL:7652-7673:di
17 PL:354-357:d PL:472-505:d PL:518-533:d PL:648-651:d PL:681-719:iu PL:3347:d PL:3364-3379:i PL:7352-7362:iu
18 S:315-319:d S:329-345:iu S:936-979:di S:2234-2253:iu S:2310-2338:iu S:3053-3106:di Sel:129-149:di PL:472-487:d PL:648-651:d PL:681-705:iu PL:713-719:di PL:997:d PL:1057-1076:i PL:1683-1688:d PL:1715-1742:i PL:1813-1851:i PL:3790-3793:d PL:3844-3867:i PL:4061:d PL:4130-4156:i PL:5784-5787:d PL:5870-5889:i PL:6263-6286:di PL:6309-6334:di PL:7677-7722:di
19 PL:14:d PL:51-63:d PL:404-405:d DS:14:d DLL:4-110:di PL:727-732:d PL:783-804:i PL:4061:d PL:4102-4128:i PL:4193-4206:i PL:4225-4250:i PL:7352-7383:di PL:7675-7722:di
20 PL:56-77:d PL:93:d PL:407-431:d PL:727-732:d PL:783-799:i PL:938-954:di PL:3694-3697:di PL:5152-5213:di PL:5660-5724:di PL:6364-6382:di
21 PL:59-64:d PL:79-91:d PL:95-121:di PL:206-212:di PL:239-245:di CO:10-11:d CP:42-57:d P:147-176:d
22 PL:79-91:d PL:98-108:u PL:247-299:di PL:5548-5632:di CP:34-57:d CP:84-163:di M:119-248:di M:278-330:di M:332-358:di
23 P:147-237:d P:239-331:di P:1873-1892:d P:1894-2031:di P:1101-1133:di PL:727-732:d PL:783-791:iu
24 P:30-82:di P:157-176:d P:239-258:di P:268-290:di P:1894-1943:di PL:335-352:d PL:5152-5181:iu PL:5197-5201:iu
25 P:178-186:d P:268:d P:274-292:i P:1101-1133:di P:1907-1928:i P:2215-2217:d
26 P:182-186:d P:268:d P:274-292:i P:1107-1133:di P:1907-1928:i P:2392-2442:d
27 P:84-100:d P:202-213:d P:268:d P:302-309:i P:1642-1761:di P:1981-1994:i P:2396-2409:d
28 P:102-118:d P:197-200:d P:215-223:d P:268:d P:293-301:i P:310-318:i P:1356-1380:di P:1410-1485:di P:1496-1533:di P:1975-2012:i P:2419-2421:d P:2432-2435:d Style:676-691:d Link:15-23:d Link:209-240:di PL:7842-7850:u
29 P:188-195:d P:225-232:d P:268:d P:319-323:i P:2045-2084:d P:2268-2279:d R:1200-1208:u
'''
nodes=[]; mappings=[]
for expected, raw in enumerate(rows.strip().splitlines(),1):
    n,*entries=raw.split(); assert int(n)==expected
    node='n'+n
    nodes.append(dict(node=node,scope=[scopes[c] for c in scope_rows[expected-1]]))
    for e in entries:
        p,lines,role=e.split(':'); s,e=map(int,lines.split('-')) if '-' in lines else (int(lines),)*2
        mappings.append(dict(node=node,path=files[p],startLine=s,endLine=e,role=[roles[c] for c in role]))
notes='d5 assignment only. Parent records include their own coordination and direct handoffs; descendant ranges are supplied separately for union by the caller. The requested validate_source_mappings tool was unavailable; the candidate was checked locally for node IDs, scopes, roles, tracked paths, exclusions, line bounds, and overlap.'
candidate=dict(diagrams=[dict(diagramId='d5',nodes=nodes,mappings=mappings)],notes=notes)
assert len(nodes)==29
p=D/'candidate.json'
with p.open('w') as f:
    f.write('{"diagrams":[{"diagramId":"d5","nodes":[\n')
    f.write(',\n'.join(json.dumps(x,separators=(',',':')) for x in nodes))
    f.write('\n],"mappings":[\n')
    f.write(',\n'.join(json.dumps(x,separators=(',',':')) for x in mappings))
    f.write('\n]}],"notes":'+json.dumps(notes)+'}\n')
assert json.loads(p.read_text())==candidate
tracked=set(subprocess.check_output(['git','ls-files','-z'],text=True).rstrip('\0').split('\0'))
assert subprocess.check_output(['git','rev-parse','HEAD'],text=True).strip()=='ea8b12a8a9894b5259c441eadd8f6f0c65e215af'
lens={}
seen={}
for m in mappings:
    path=m['path']; assert path in tracked
    assert not set(Path(path).parts).intersection({'test','tests','Tests','__fixtures__','__tests__','benchmarks','build','dist','docs','examples','fixtures','node_modules','scripts','deps','vendor'})
    assert not any(fnmatch.fnmatch(Path(path).name,pat) for pat in ('*.test.*','*.spec.*','*.md','*.mdx','*LICENSE*','AGENTS.md'))
    assert m['role'] and set(m['role'])<=set(roles.values())
    if path not in lens: lens[path]=sum(1 for _ in Path(path).open())
    assert 1 <= m['startLine'] <= m['endLine'] <= lens[path],m
    lines=set(range(m['startLine'],m['endLine']+1))
    seen.setdefault((m['node'],path),set())
    assert seen[(m['node'],path)].isdisjoint(lines),m
    seen[(m['node'],path)].update(lines)
assert {m['node'] for m in mappings}=={n['node'] for n in nodes}
assert all(n['scope'] and set(n['scope'])<=set(scopes.values()) for n in nodes)
print(p, len(nodes),len(mappings))
