#!/usr/bin/env python3
"""Compare all six frozen parsed JSON files with independently reviewed fixtures.

Only reads independent_expected.json, the accepted sources, parse_summary.json,
and its parsed/reviewTable paths. Never imports/runs/reads the parser or tests.
The fixture was written before inspecting any parsed output. Heading-root and
isolated-target variants below were explicitly admitted in that fixture before
comparison. This script records baseline counts and selected variant separately.
"""
from pathlib import Path
import copy, hashlib, itertools, json
from collections import Counter
BASE=Path(__file__).resolve().parent

def sha(p):return hashlib.sha256(p.read_bytes()).hexdigest()
def reindex(nodes):
 nodes.sort(key=lambda n:(n['line'],n['startColumn']))
 lookup={n['key']:n for n in nodes}
 for n in nodes:n['children']=[]
 for i,n in enumerate(nodes):
  n['order']=i
  if n['parent']:lookup[n['parent']]['children'].append(n['key'])
 for n in nodes:
  d=0;p=n['parent']
  while p:d+=1;p=lookup[p]['parent']
  n['depth']=d
 return nodes

def variants(key,d):
 for heading,omit in itertools.product([False,True] if key in ('sol_1','sol_3') else [False], [False,True] if key=='sol_1' else [False]):
  ns=copy.deepcopy(d['nodes']);notes=[]
  if omit:
   ns=[n for n in ns if n['key']!='25:55'];notes.append('omit isolated LineGridScene reference target (predeclared alternative)')
  if heading:
   line,text,children=(221,'Legend',[223,224]) if key=='sol_1' else (161,'SOURCE MAP',list(range(164,184,2)))
   ns.append({'key':f'{line}:0','line':line,'startColumn':0,'endColumn':len(text),'text':text,'parent':None,'children':[],'sourceSpans':[{'line':line,'startColumn':0,'endColumn':len(text)}]})
   for n in ns:
    if n['line'] in children:n['parent']=f'{line}:0'
   notes.append(f'{text} as tree root (predeclared heading alternative)')
  yield reindex(ns),notes

def compare(expected,actual,source):
 ex={n['key']:n for n in expected};actual_by_id={n['id']:n for n in actual['nodes']}
 paired={}; unmatched=set(ex)
 # Exact source coordinates are primary identity. Unique same-line fallback
 # exposes position errors without turning each shifted node into two errors.
 for n in actual['nodes']:
  k=f"{n['line']}:{n['column']-1}"
  if k not in unmatched:
   candidates=[x for x in unmatched if ex[x]['line']==n['line']]
   if len(candidates)==1:k=candidates[0]
   else:k=None
  if k is not None:paired[n['id']]=k;unmatched.remove(k)
 def ak(i):
  if i is None:return None
  return paired.get(i,f"UNEXPECTED:{actual_by_id[i]['line']}:{actual_by_id[i]['column']-1}")
 errors=[];audit=[]
 for n in actual['nodes']:
  k=paired.get(n['id']);e=ex.get(k);diff={}
  observed={'text':n['label'],'parent':ak(n['parent_id']),'children':[ak(i) for i in n['children']],'depth':n['depth'],'line':n['line'],'startColumn':n['column']-1,'end_line':n['end_line']}
  want=None
  if e is None:diff['presence']={'expected':'excluded from containment tree','actual':observed}
  else:
   want={'text':e['text'],'parent':e['parent'],'children':e['children'],'depth':e['depth'],'line':e['line'],'startColumn':e['startColumn'],'end_line':max(s['line'] for s in e['sourceSpans'])}
   for field,val in want.items():
    if observed[field]!=val:diff[field]={'expected':val,'actual':observed[field]}
   expected_raw=[source[s['line']-1] for s in e['sourceSpans']]
   if n['raw_lines']!=expected_raw:diff['raw_lines']={'expected':expected_raw,'actual':n['raw_lines']}
  record={'actual_id':n['id'],'expected_key':k,'source_line':n['line'],'source_raw':source[n['line']-1],'expected':want,'actual':observed,'differences':diff,'status':'fail' if diff else 'pass'}
  audit.append(record)
  if diff:errors.append(record)
 for k in sorted(unmatched,key=lambda x:(ex[x]['line'],ex[x]['startColumn'])):
  e=ex[k];errors.append({'actual_id':None,'expected_key':k,'source_line':e['line'],'source_raw':source[e['line']-1],'expected':e,'actual':None,'differences':{'presence':{'expected':e['text'],'actual':'missing'}},'status':'fail'})
 rootwant=[n['key'] for n in expected if n['parent'] is None];rootactual=[ak(i) for i in actual['roots']]
 if rootwant!=rootactual:errors.append({'source_line':None,'differences':{'ordered_roots':{'expected':rootwant,'actual':rootactual}}})
 expected_order=[n['key'] for n in expected];actual_order=[ak(n['id']) for n in actual['nodes']]
 if expected_order!=actual_order:errors.append({'source_line':None,'differences':{'node_source_order':{'expected':expected_order,'actual':actual_order}}})
 # Every source line: verify raw text and node/continuation membership, including
 # excluded prose, underlines, blank lines and guide-only routing segments.
 membership={}
 for e in expected:
  for i,s in enumerate(e['sourceSpans']):membership.setdefault(s['line'],[]).append((e['key'],'node' if i==0 else 'continuation'))
 line_audit=[]
 classified={l['line']:l for l in actual['lines']}
 for line,raw in enumerate(source,1):
  l=classified.get(line);want=membership.get(line,[]);diff={}
  if l is None:diff['presence']='source line classification absent'
  else:
   if l['raw']!=raw:diff['raw']={'expected':raw,'actual':l['raw']}
   actual_member=ak(l['node_id']) if l['node_id'] is not None else None
   if want:
    if (actual_member,l['kind']) not in want:diff['membership']={'expected':want,'actual':[actual_member,l['kind']]}
    if len(want)>1:diff['multiple_source_nodes']={'expected':want,'actual':[actual_member,l['kind']]}
   elif l['node_id'] is not None or l['kind'] in ('node','continuation'):diff['exclusion']={'expected':'excluded','actual':[actual_member,l['kind']]}
  line_audit.append({'line':line,'raw':raw,'expected_membership':want,'actual_classification':l,'status':'fail' if diff else 'pass','differences':diff})
 return {'node_audit':audit,'node_and_structure_differences':errors,'line_audit':line_audit,'ordered_expected_roots':rootwant,'ordered_actual_roots':rootactual,'expected_nodes':len(expected),'expected_edges':sum(n['parent'] is not None for n in expected),'expected_roots':len(rootwant),'expected_node_source_lines':len(membership),'expected_excluded_source_lines':len(source)-len(membership),'expected_continuation_lines':sum(any(kind=='continuation' for _,kind in v) for v in membership.values()),'actual_nodes':len(actual['nodes']),'actual_edges':sum(n['parent_id'] is not None for n in actual['nodes']),'actual_roots':len(actual['roots']),'actual_line_kinds':dict(Counter(l['kind'] for l in actual['lines']))}

fixture=json.loads((BASE/'independent_expected.json').read_text());summary=json.loads((BASE/'parse_summary.json').read_text())
assert len(summary['entries'])==fixture['accepted_diagrams']==6
report={'reviewer_task':'/root/round_3_independent_review','round':3,'accepted_diagram_count':6,'independence':'Read all six accepted original ASCII files and created independent_expected.json before reading parsed JSON, review tables or parse_summary. Did not read or run tree_parser.py, parser snapshot, parser tests, previous-round reports, or excluded inputs. Directory names were listed during discovery, but excluded file contents were never inspected.','policy':'Labels exclude drawn routing-wire graphics and retain full named inline reference annotations including arrow run lengths. Reference/workflow arrows are not containment edges. Detached ordinary prose bullet appendices after explicit trees are prose; standalone bullet trees, guided/indented lists within trees and appendices with explicit branch connectors are trees.','source_positions':'1-based lines, 0-based start columns in fixture/report; parser column converted from 1-based. Parsed raw_lines and end_line checked for every node; every source line and excluded line checked.','fixture_sha256':sha(BASE/'independent_expected.json'),'parser_sha256_from_capture':summary['parserSha256'],'diagrams':[]}
for entry in summary['entries']:
 key=entry['generator'];d=fixture['diagrams'][key];assert entry['source']==d['source'];assert sha(BASE/d['source'])==d['sha256']==entry['sourceSha256'];assert sha(BASE/entry['parsed'])==entry['parsedSha256']
 source=(BASE/d['source']).read_text().splitlines();actual=json.loads((BASE/entry['parsed']).read_text())
 # Independently verify review-table rows agree with the frozen JSON, then rely
 # on JSON for complete source positions and classification audit.
 table=(BASE/entry['reviewTable']).read_text().splitlines()
 assert table[1+len(actual['nodes'])]==''
 for row,n in zip(table[1:1+len(actual['nodes'])],actual['nodes']):
  parts=row.split(maxsplit=4);assert int(parts[0])==n['id'] and int(parts[1])==n['line'] and int(parts[3])==n['depth'] and json.loads(parts[4])==n['label']
  if n['parent_id'] is None:assert parts[2]=='ROOT'
  else:assert int(parts[2])==next(p['line'] for p in actual['nodes'] if p['id']==n['parent_id'])
 nonnode_start=table.index('LINES NOT CLASSIFIED AS NODE:')+1
 diagnostics_start=table.index('DIAGNOSTICS:')+1
 assert json.loads('\n'.join(table[diagnostics_start:]))==actual['diagnostics']
 excluded_table=[row for row in table[nonnode_start:diagnostics_start-1] if row.strip()]
 excluded_json=[row for row in actual['lines'] if row['kind']!='node']
 assert len(excluded_table)==len(excluded_json)
 for row,l in zip(excluded_table,excluded_json):
  parts=row.split(maxsplit=3)
  assert int(parts[0])==l['line'] and parts[1]==l['kind'] and parts[2]==f"node={l['node_id']}" and json.loads(parts[3])==l['raw']
 candidates=[]
 for ns,notes in variants(key,d):
  c=compare(ns,actual,source);candidates.append((len(c['node_and_structure_differences'])+sum(l['status']=='fail' for l in c['line_audit']),c,notes))
 _,best,notes=min(candidates,key=lambda x:x[0]);failed=bool(best['node_and_structure_differences'] or any(l['status']=='fail' for l in best['line_audit']))
 report['diagrams'].append({'id':entry['id'],'generator':key,'source':d['source'],'source_sha256':d['sha256'],'parsed_sha256':entry['parsedSha256'],'source_line_count':len(source),'verdict':'fail' if failed else 'pass','baseline_expected_counts':{'nodes':len(d['nodes']),'roots':len(d['roots']),'edges':len(d['edges']),'excluded_lines':len(d['excluded_lines'])},'accepted_intent_alternatives_used':notes,'ambiguities_and_source_interpretation_notes':d['ambiguities'],'parser_exception':entry['exception'],'diagnostics':entry['diagnostics'],'strict_would_fail':entry['strictWouldFail'],**best})
report['totals']={'accepted_diagrams':6,'semantic_failures':sum(d['verdict']=='fail' for d in report['diagrams']),'semantic_passes':sum(d['verdict']=='pass' for d in report['diagrams']),'ambiguous_only_verdicts':0,'diagrams_with_unresolved_source_intent':2,'genuine_unresolved_intent_regions':3,'intent_regions':['sol_1:25 isolated reference target','sol_1:221 heading versus root','sol_3:161 heading versus root'],'ambiguity_interpretation':'Accepted alternatives were documented before seeing outputs. Sol 1 fails under every alternative; Sol 3 passes an independently predeclared alternative. Thus ambiguities are tracked separately from policy-correct passes and unequivocal failures.','parser_exceptions':sum(d['parser_exception'] is not None for d in report['diagrams']),'diagrams_with_diagnostics':sum(bool(d['diagnostics']) for d in report['diagrams']),'diagnostic_events':sum(len(d['diagnostics']) for d in report['diagrams']),'strict_diagnostic_failures':sum(d['strict_would_fail'] for d in report['diagrams']),'actual_nodes':sum(d['actual_nodes'] for d in report['diagrams']),'actual_roots':sum(d['actual_roots'] for d in report['diagrams']),'actual_edges':sum(d['actual_edges'] for d in report['diagrams']),'expected_nodes_selected_variants':sum(d['expected_nodes'] for d in report['diagrams']),'expected_roots_selected_variants':sum(d['expected_roots'] for d in report['diagrams']),'expected_edges_selected_variants':sum(d['expected_edges'] for d in report['diagrams']),'source_lines_audited':sum(d['source_line_count'] for d in report['diagrams']),'actual_excluded_lines_audited':sum(sum(v for k,v in d['actual_line_kinds'].items() if k not in ('node','continuation')) for d in report['diagrams']),'actual_continuation_lines_audited':sum(d['actual_line_kinds'].get('continuation',0) for d in report['diagrams'])}
(BASE/'independent_review.json').write_text(json.dumps(report,indent=2)+'\n')
print(json.dumps({'totals':report['totals'],'diagrams':[{k:d[k] for k in ['generator','verdict','expected_nodes','actual_nodes','expected_roots','actual_roots','expected_edges','actual_edges']} for d in report['diagrams']]},indent=2))
