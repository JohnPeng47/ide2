#!/usr/bin/env python3
"""Source-specific reviewed fixture builder. Never imports or reads the parser.

Run before comparison: python diagram_parser/round_3/independent_build_expectations.py
Boundaries, exceptional columns, routing suffixes and wrapped label are explicitly
reviewed against the original six ASCII sources. Generic regex only transcribes
ordinary four-column branches inside these reviewed source-specific boundaries.
Positions are 1-based lines, 0-based columns, end-exclusive; labels retain named
inline references verbatim. Unconnected arrow targets do not create containment.
"""
from pathlib import Path
import hashlib, json, re
BASE=Path(__file__).resolve().parent
SOURCES={
 'sol_1':'generated/sol_1/diagrams/mapping-domain-model.txt',
 'sol_2':'blind_replacement/sol_2/diagrams/domain-model.txt',
 'sol_3':'generated/sol_3/diagrams/domain-model.txt',
 'astra_1':'generated/astra_1/diagrams/domain-model.txt',
 'astra_2':'generated/astra_2/diagrams/domain-model.txt',
 'astra_3':'generated/astra_3/diagrams/domain-model.txt',
}
# Root and inclusive last line of an independently reviewed tree block.
BLOCKS={
 'sol_1':[(4,22),(25,43),(66,89),(95,105),(107,112),(114,126),(128,135),(141,148),(151,159),(161,171),(174,180),(186,198),(204,218)],
 'sol_2':[(1,37),(39,68),(70,100),(102,113)],
 'sol_3':[(4,159)],
 'astra_1':[(5,20),(22,45),(47,70),(72,83),(85,113),(115,124),(126,133)],
 'astra_2':[(5,22),(24,43),(45,68),(70,78),(80,109),(111,120),(122,128)],
 'astra_3':[(1,120)],
}
TRIMS={
 'sol_1':{13:'currentRevisionId',15:'revisions: ProjectRepresentationRevision [id -> record]',16:'ProjectRepresentationRevision',20:'scene',22:'evidence',25:'MappingDocument',26:'scene',32:'collapsedContentId?',34:'DiagramBox',35:'contentId',37:'ContainerBox',38:'children: GridBox[] (recursive)',39:'layout',40:'collisionPolicy: push-right',41:'gap',43:'contents: GridContent [contentId -> content]'},
 'sol_2':{10:'currentRevisionId',11:'revisions',12:'ProjectRepresentationRevision'},
 'sol_3':{14:'currentRevisionId',15:'owns 1..* revisions',16:'revisions: RepresentationRevision[id]'},
}
AMBIGUITIES={
 'sol_1':[
  {'lines':[25], 'kind':'isolated_reference_target', 'description':'LineGridScene at column 55 is a separately drawn arrow target without its own explicit containment branches. Baseline includes a standalone root; omitting that isolated reference-only target is an accepted alternative. It must never become part of the MappingDocument label or its containment child.'},
  {'lines':[43,44,45,46,47,48,49,50], 'kind':'imperfect_alignment', 'description':'GridContent is separately drawn at column 57; its first branch starts at column 60, others at 59. Despite the one-column wobble, id/ascii/revision/mappings are its children, sourceRanges is under mappings, and the two range fields are under sourceRanges. This relationship is clear; no unresolved parent alternative is accepted.'},
  {'lines':[84,85], 'kind':'workflow_annotation', 'description':'The two standalone --> lines indicate save workflow results. Baseline excludes them as reference annotations with no containment edges. A representation retaining them as non-containment annotation records is equivalent.'},
  {'lines':[221,222,223,224], 'kind':'heading_or_root', 'description':'Legend is an underlined section heading. Baseline excludes heading and includes two connector entries as roots under the explicit-connector appendix policy. Treating Legend as a root parent is an accepted intent alternative; dropping the connector entries entirely is not the declared appendix policy.'},
 ],
 'sol_3':[
  {'lines':[161,162,164,165,166,167,168,169,170,171,172,173,174,175,176,177,178,179,180,181,182,183], 'kind':'heading_or_root', 'description':'SOURCE MAP is an underlined section heading with an explicit-connector appendix. Baseline treats its ten branch entries as roots and ten file entries as their children. Treating SOURCE MAP as an additional parent root is an accepted intent alternative. Excluding the appendix is policy-incorrect.'}
 ],
}

def build(key, rel):
 raw=(BASE/rel).read_bytes(); lines=raw.decode().splitlines(); nodes=[]; used=set(); exclusion_overrides={}
 def add(line,start,text,parent=None,spans=None):
  n={'key':f'{line}:{start}','line':line,'startColumn':start,'endColumn':start+len(text),'text':text,'parent':parent,'children':[], 'sourceSpans':spans or [{'line':line,'startColumn':start,'endColumn':start+len(text)}]}
  nodes.append(n); used.update(s['line'] for s in n['sourceSpans']);return n['key']
 def ordinary(root,last):
  roottext=lines[root-1].strip(); rootcol=len(lines[root-1])-len(lines[root-1].lstrip())
  roottext=TRIMS.get(key,{}).get(root,roottext)
  stack={0:add(root,rootcol,roottext)}
  for line in range(root+1,last+1):
   s=lines[line-1]
   if key=='sol_1' and line in (84,85):
    exclusion_overrides[line]='standalone sideways workflow-reference annotation; no containment edge';continue
   if key=='astra_3' and line==77:continue
   m=re.fullmatch(r'([ |]*)([|+`\\]--)[ ]+(\S.*)',s)
   if not m:
    assert not s.strip() or re.fullmatch(r'[ |v]+',s),(key,line,s)
    continue
   col=len(m[1]); depth=(col-rootcol)//4+1
   assert (col-rootcol)%4==0 and depth>0,(key,line,col,rootcol)
   text=TRIMS.get(key,{}).get(line,m[3].rstrip());start=m.start(3)
   if key=='astra_3' and line==76:
    continuation='mappings, selection, instruction'; cstart=lines[76].index(continuation)
    spans=[{'line':76,'startColumn':start,'endColumn':len(s)},{'line':77,'startColumn':cstart,'endColumn':len(lines[76])}]
    n=add(line,start,text+' '+continuation,stack[depth-1],spans)
    nodes[-1]['endColumn']=len(s)
   else:n=add(line,start,text,stack[depth-1])
   stack={d:v for d,v in stack.items() if d<depth};stack[depth]=n
 for root,last in BLOCKS[key]:ordinary(root,last)
 if key=='sol_1':
  # Continue MappingDocument after the physically overlapping right-hand tree.
  parent='25:0'
  for line,p in [(52,parent),(53,'52:4'),(55,parent),(56,'55:4'),(57,'55:4'),(58,'55:4'),(60,parent)]:
   m=re.search(r'[|`]-- +(\S.*)',lines[line-1]);add(line,m.start(1),m[1],p)
  add(25,55,'LineGridScene')
  add(43,57,'GridContent')
  for line,label,p in [(44,'id','43:57'),(45,'ascii','43:57'),(46,'revision','43:57'),(47,'mappings: EvidenceMapping[]','43:57'),(48,'sourceRanges[]','47:63'),(49,'source/file identity','48:67'),(50,'line/column range','48:67')]:
   add(line,lines[line-1].rindex(label),label,p)
  for line in (223,224):
   label= 'containment / owned state' if line==223 else 'reference, derivation, or workflow result'
   add(line,lines[line-1].index(label),label)
 if key=='sol_3':
  for line in range(164,184,2):
   add(line,4,lines[line-1][4:])
   add(line+1,8,lines[line][8:],f'{line}:4')
 nodes.sort(key=lambda n:(n['line'],n['startColumn']))
 lookup={n['key']:n for n in nodes}
 for i,n in enumerate(nodes):
  n['order']=i
  if n['parent']:lookup[n['parent']]['children'].append(n['key'])
 for n in nodes:
  d=0;p=n['parent']
  while p:d+=1;p=lookup[p]['parent']
  n['depth']=d
 exclusions=[]
 for line,s in enumerate(lines,1):
  if line in used:continue
  if line in exclusion_overrides:reason=exclusion_overrides[line]
  elif not s.strip():reason='blank'
  elif re.fullmatch(r'[ |v=\-]+',s):reason='drawn guide/routing wire or heading underline'
  else:reason='title, heading, explanatory prose, or legend metadata'
  exclusions.append({'line':line,'text':s,'reason':reason})
 return {'source':rel,'sha256':hashlib.sha256(raw).hexdigest(),'source_line_count':len(lines),'nodes':nodes,'roots':[n['key'] for n in nodes if n['parent'] is None],'edges':[[n['parent'],n['key']] for n in nodes if n['parent']], 'excluded_lines':exclusions,'ambiguities':AMBIGUITIES.get(key,[])}

if __name__=='__main__':
 result={'reviewer_task':'/root/round_3_independent_review','basis':'ASCII reviewed before parser results; explicit source boundaries and exceptional label/position decisions in independent_build_expectations.py','accepted_diagrams':6,'positions':'line is 1-based, columns 0-based and end-exclusive; source spans list wrapped lines','diagrams':{k:build(k,v) for k,v in SOURCES.items()}}
 (BASE/'independent_expected.json').write_text(json.dumps(result,indent=2)+'\n')
 print(json.dumps({k:{'nodes':len(v['nodes']),'roots':len(v['roots']),'edges':len(v['edges']),'lines':v['source_line_count'],'excluded_lines':len(v['excluded_lines'])} for k,v in result['diagrams'].items()},indent=2))
