from pathlib import Path
p=Path(__file__).with_name('records')
lines=p.read_text().splitlines()
# Compact version: keep adjacent ownership/use blocks together, with roles relative to each node.
replace={
'n1':'ebr x',
'n2':'sebrx +n3 +n4 +n5 +n6 +n7 +n8 +n14 G:124-170:d G:238-252:d G:260-269:d G:283-296:d G:743-815:ui G:830-839:ui G:903-909:di G:976-1014:di G:1192-1230:di G:2171-2246:di S:2581-2598:ui T:306-349:ui T:397-438:ui',
'n3':'ser G:274-281:d G:846-849:u G:1381-1392:ui G:1479-1487:u G:1562-1567:u TM:51-51:d Snap:289-399:d Snap:467-510:d Snap:828-860:d Snap:885-899:dui Snap:920-947:dui Snap:2696-2732:ui Snap:2843-2878:ui',
'n4':'ser G:172-228:d G:254-272:d G:302-583:dui G:712-729:di G:759-761:ui G:816-829:ui G:865-901:dui G:914-943:dui G:1232-1256:dui G:1771-1783:ui G:1811-1905:ui G:2046-2168:dui G:2171-2191:ui C:42-127:dui Im:15-103:dui Im:560-585:d Im:698-713:dui Im:778-811:dui F:21-23:d Sh:19-36:di Cache:32-87:di M:219-234:dui M:246-375:dui O:252-271:dui O:327-436:dui MB:21-185:dui OB:18-126:dui MX:40-117:di OX:42-104:di MT:44-108:di OT:55-146:di MS:120-190:di OS:103-159:di',
'n5':'ser G:204-207:d G:731-741:ui G:818-822:ui G:865-871:ui G:1314-1358:dui G:1889-1905:ui G:2973-2989:u G:3477-3537:ui G:3674-3691:dui A:53-55:d A:123-131:ui A:141-146:ui S:81-84:d S:528-534:ui S:580-589:u S:627-631:u S:870-871:ui S:2536-2572:dui Opt:14-15:d Msg:29-43:d T:397-400:ui FG:41-64:d FG:83-128:di FG:379-464:dui FS:88-154:dui FS:411-431:dui M:347-375:di O:410-436:di',
'n6':'ser R:39-45:di A:57-58:d A:126-133:i A:136-151:ui S:564-589:ui Opt:7-9:d G:227-228:d G:712-721:ui G:823-825:u G:870-873:ui M:42-71:dui M:131-146:ui M:179-197:ui M:219-234:ui MD:19-66:di O:47-96:dui O:197-214:ui OD:18-74:di OD:102-105:di E:1253-1257:di GS:107-109:ui GSurf:1782-1805:di',
'n8':'ebrx +n9 +n10 +n11 +n12 +n13 G:1376-1398:ui G:1410-1419:i G:1568-1580:ui G:1627-1630:i G:1706-1710:ui G:2340-2430:dui T:537-585:ui',
'n9':'brg G:1371-1375:d G:1408-1427:ui G:1479-1493:ui State:13-20:d State:36-80:dui S:592-595:i S:631-636:ui Snap:941-1027:dui Snap:1136-1279:ui Snap:1399-1414:ui PL:7352-7383:dui',
'n11':'ebr G:1371-1375:d G:1399-1409:d G:1420-1421:u G:1479-1562:ui State:19-34:d State:107-140:di S:2669-2738:dui S:1609-1629:ui S:1712-1717:ui Snap:791-826:dui Snap:920-1414:dui Snap:2114-2323:dui Snap:2401-2590:dui Snap:2666-2900:dui Im:245-486:dui Im:666-695:di KI:869-879:dui',
'n12':'ebrg G:1371-1375:d G:1420-1421:u G:1479-1487:u G:1555-1567:ui G:1645-1659:u State:74-80:di Snap:920-940:d Snap:1416-1484:dui Snap:1540-1567:di',
'n13':'brx G:1371-1375:d G:1484-1487:u G:1508-1526:ui G:1564-1626:ui G:1631-1705:ui G:1868-1905:ui G:2559-2615:dui G:2623-3691:dui Snap:802-826:dui Snap:1285-1397:ui Snap:1423-1484:di Snap:1576-1670:di C:42-215:dui Cur:7-68:di Im:76-243:dui Im:253-486:dui Im:666-695:di Im:778-811:dui Ov:82-148:dui F:16-28:d F:43-51:di Sh:19-36:di Run:12-383:dui Cache:58-78:di HB:114-300:dui CT:303-544:dui No:69-138:dui FG:224-250:dui FG:379-464:dui CR:327-349:dui FD:10-24:di FT:426-778:dui CF:289-567:dui SF:147-260:dui SC:125-162:dui FA:136-364:di',
'n14':'ebr x',
'n15':'serx +n16 +n17 +n18 +n19 +n20 R:22-23:d S:92-102:d S:753-759:ui T:1-3:d T:113-173:dui T:191-257:dui T:749-812:dui G:903-909:dui G:946-974:dui O:197-214:dui',
'n16':'sbrx T:20-64:d T:69-101:d T:116-164:dui T:200-200:d T:220-257:ui T:290-444:dui T:460-517:dui T:519-714:dui T:733-747:di G:41-47:di G:945-956:ui G:1074-1086:dui G:1110-1190:dui G:1258-1312:dui G:1371-1375:d G:1716-1731:di DL:93-111:dui DL:148-174:dui DL:195-256:dui S:2574-2579:dui IO:718-734:ui',
'n17':'sbr Msg:45-46:d S:2574-2579:dui S:2600-2658:dui IO:523-530:d IO:542-564:ui IT:326-326:ui IT:389-406:di IT:427-451:dui T:290-290:d T:301-303:ui T:404-404:ui T:474-493:dui G:2248-2304:dui G:1740-1743:d G:1759-1764:ui G:1843-1866:ui G:2630-2651:ui Size:28-44:dui Size:194-229:dui O:216-236:di M:199-234:dui E:1026-1043:dui GSurf:3497-3551:dui GR:125-140:ui GR:217-226:dui',
'n18':'ebrg S:597-604:u S:631-636:ui S:711-721:ui IO:43-53:d IO:312-328:ui IO:335-349:ui IO:702-762:dui SH:37-42:d SH:114-119:dui T:151-164:ui T:231-237:ui T:474-493:dui T:537-542:d T:567-585:ui G:1371-1375:d G:1408-1427:ui G:1479-1493:ui G:1555-1567:ui State:13-20:d State:36-105:dui Ex:1493-1495:ui Ex:1516-1519:ui Ex:1806-1811:ui',
'n19':'ebr S:922-929:dui E:1001-1006:dui E:1988-1992:dui G:1712-1739:dui G:1794-1807:ui G:1907-1909:ui M:148-160:dui M:236-243:dui MF:67-91:ui MF:105-131:dui ML:84-89:di ML:125-166:dui OF:51-90:di O:197-206:di',
'n20':'brg S:829-855:dui T:175-189:dui T:220-234:ui T:253-257:ui T:722-731:di G:332-339:di G:841-874:dui G:911-943:dui G:958-974:dui G:1232-1256:dui G:1273-1298:ui G:1074-1086:ui DL:113-146:dui DL:196-219:ui ML:42-48:dui M:139-146:di O:92-96:di O:208-214:di'
}
for i,l in enumerate(lines):
 if not l.startswith('n') or not l[1].isdigit(): continue
 node=l.split()[0]
 if node not in replace or node in ("n1","n14"): continue
 lines[i]=node+' '+replace[node]
lines=[l.replace('S:1015-1018:d S:1154-1158:ui','S:1017-1018:d S:1154-1158:ui').replace(' G:302-354:dui G:876-901:dui',' G:321-354:dui G:876-901:dui').replace(' A:577-581:d','').replace(' M:73-137:ui M:162-243:dui',' M:73-137:ui M:162-243:dui').replace(' GSurf:3629-3629:ui','').replace(' GApp:692-698:d',' GApp:692-698:d') if l.startswith('n14 ') else l for l in lines]
p.write_text('\n'.join(lines)+'\n')
