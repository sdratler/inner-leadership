"""Synthetic failure tests; never requires network or real family information."""
import copy, hashlib, importlib.util, json, os, subprocess, sys, tempfile, unittest, zipfile
from datetime import datetime, timezone, timedelta
from pathlib import Path
HERE=Path(__file__).resolve()
CANDIDATES=[HERE.parents[1]/'FULL_FILES/tools/source-audit/audit.py', HERE.parents[1]/'audit.py']
SCRIPT=next(p for p in CANDIDATES if p.exists())
spec=importlib.util.spec_from_file_location('audit',SCRIPT); a=importlib.util.module_from_spec(spec);spec.loader.exec_module(a)
NOW=datetime(2026,9,6,9,0,tzinfo=timezone.utc); SHA='a'*40

def row(wid,dep='',status='Ready',mode='GPT_PACKET'):
 r=['']*23;r[0]=wid;r[2]='Synthetic work';r[4]=dep;r[5]=status;r[6]=SHA;r[8]='test/path';r[14]=mode;return r

def fixture():
 block='BEGIN PROJECT SETTINGS BLOCK\nSynthetic only\nEND PROJECT SETTINGS BLOCK\n'
 sources={k:{'id':did,'text':'Synthetic '+k,'read_at':NOW.isoformat()} for k,did in a.DOC_IDS.items()}
 sources['registry']['text']='\n'.join(a.DOC_IDS.values())
 sources['operating']['text']=block;sources['prompts']['text']=block
 rows=[['Work ID'],row('LS-000'),row('LS-100')]
 s={'schema_version':1,'capture_mode':'synthetic_test','captured_at':NOW.isoformat(),'sources':sources,
 'control':{'Work Graph':rows,'Decisions':[['ID'],['D-1','x','synthetic approval','Approved']],'Interfaces':[['ID']],'Overview':[['x']]},'git_head':SHA,'reachable':{SHA:True}}
 m={'schema_version':1,'sources':{k:{'id':v['id'],'version':'test','sha256':a.digest(v['text'])} for k,v in sources.items()},'settings_sha256':a.digest(block),
 'work_definitions':{r[0]:a.compact_hash(a.definition(r)) for r in rows[1:]},'approved_decisions':{'D-1':a.compact_hash(a.pad(s['control']['Decisions'][1],10)[:10])},'interface_definitions':{},'ownership_roots':{'LS-000':['a'],'LS-100':['b']}}
 s['control']['Overview']=[[] for _ in range(17)]+[['Current launch constraints'],['Constraint','Decision'],['Public offer','Synthetic individual service'],['Payment','Four visits'],['Delivery','Individual'],['Accounts','Separate parents'],['Progress','Qualitative'],['Communication','Outbound adapter']]
 s['control']['Instructions']=[['HOW TO USE'],[],['Rule','Instruction'],['Anti-drift preflight','Control Protocol 2.2'],['Packet output','SOURCE_AUDIT.json']]
 m['control_contracts']={name:{'start_row':start+1,'columns':width,'sha256':a.compact_hash(a.control_section(s['control'][name],start,width))} for name,(start,width) in a.CONTROL_SECTIONS.items()}
 return s,m

class AuditTests(unittest.TestCase):
 def setUp(self): self.s,self.m=fixture()
 def report(self,**kwargs):return a.audit(self.s,self.m,now=NOW,**kwargs)
 def codes(self,**kwargs):return {f['code'] for f in self.report(**kwargs)['findings'] if f['severity']=='error'}
 def test_valid(self):self.assertEqual(self.report()['result'],'PASS')
 def test_prepare(self):self.assertEqual(self.report(work_id='LS-000',baseline=SHA,phase='prepare')['result'],'PASS')
 def test_missing_source(self):del self.s['sources']['product'];self.assertIn('SOURCE_UNREADABLE',self.codes())
 def test_changed_source(self):self.s['sources']['product']['text']+=' unexpected';self.assertIn('SOURCE_CHANGED',self.codes())
 def test_settings_mismatch(self):self.s['sources']['prompts']['text']=self.s['sources']['prompts']['text'].replace('Synthetic','Wrong');self.assertIn('SETTINGS_BLOCK_MISMATCH',self.codes())
 def test_stale_snapshot(self):self.s['captured_at']=(NOW-timedelta(hours=1)).isoformat();self.assertIn('INPUT_STALE',self.codes())
 def test_future_snapshot(self):self.s['captured_at']=(NOW+timedelta(hours=1)).isoformat();self.assertIn('INPUT_STALE',self.codes())
 def test_stale_read(self):self.s['sources']['product']['read_at']=(NOW-timedelta(hours=1)).isoformat();self.assertIn('SOURCE_READ_STALE',self.codes())
 def test_false_identity(self):self.s['sources']['product']['id']='wrong';self.assertIn('SOURCE_ID_MISMATCH',self.codes())
 def test_bad_mode(self):self.s['capture_mode']='pretend_cloud';self.assertIn('CAPTURE_MODE_INVALID',self.codes())
 def test_duplicate_work(self):self.s['control']['Work Graph'].append(copy.deepcopy(self.s['control']['Work Graph'][1]));self.assertIn('WORK_ID_DUPLICATE',self.codes())
 def test_dependency_cycle(self):
  self.s['control']['Work Graph'][1][4]='LS-100:Verified';self.s['control']['Work Graph'][2][4]='LS-000:Verified';self.assertIn('DEPENDENCY_CYCLE',self.codes())
 def test_missing_dependency(self):self.s['control']['Work Graph'][1][4]='LS-999:Verified';self.assertIn('DEPENDENCY_MISSING',self.codes())
 def test_unready_dependency(self):self.s['control']['Work Graph'][1][4]='LS-100:Verified';self.assertIn('DEPENDENCY_NOT_READY',self.codes())
 def test_invalid_dependency_grammar(self):self.s['control']['Work Graph'][1][4]='maybe next';self.assertIn('DEPENDENCY_SYNTAX',self.codes())
 def test_baseline_placeholder(self):self.s['control']['Work Graph'][1][6]='{{SHA}}';self.assertIn('READY_BASELINE_INVALID',self.codes())
 def test_requested_baseline_mismatch(self):self.assertIn('EXACT_BASELINE_MISMATCH',self.codes(work_id='LS-000',baseline='b'*40,phase='prepare'))
 def test_unverified_baseline(self):self.s['reachable'][SHA]=False;self.assertIn('BASELINE_NOT_VERIFIED',self.codes(work_id='LS-000',baseline=SHA,phase='prepare'))
 def test_incomplete_claim(self):self.s['control']['Work Graph'][1][5]='Claimed';self.assertIn('CLAIM_INCOMPLETE',self.codes())
 def claim(self,r,start,end):r[5]='Claimed';r[15]='claim-'+r[0];r[16]='Synthetic';r[17]=start.isoformat();r[18]=end.isoformat();r[19]=start.isoformat()
 def test_expired_claim(self):self.claim(self.s['control']['Work Graph'][1],NOW-timedelta(hours=7),NOW-timedelta(hours=1));self.assertIn('CLAIM_EXPIRED',self.codes())
 def test_overlap(self):
  for r in self.s['control']['Work Graph'][1:]:self.claim(r,NOW-timedelta(minutes=1),NOW+timedelta(hours=5))
  self.m['ownership_roots']['LS-100']=['a/sub'];self.assertIn('CLAIM_OWNERSHIP_OVERLAP',self.codes())
 def test_new_approval(self):self.s['control']['Decisions'].append(['D-2','x','new','Approved']);self.assertIn('APPROVED_DECISION_UNRECONCILED',self.codes())
 def test_lost_approval(self):self.s['control']['Decisions'][1][3]='Superseded';self.assertIn('APPROVED_DECISION_MISSING',self.codes())
 def test_changed_definition(self):self.s['control']['Work Graph'][1][3]='incompatible';self.assertIn('WORK_DEFINITION_CHANGED',self.codes())
 def test_independent_scope_warning(self):self.s['control']['Work Graph'][2][3]='incompatible';self.assertEqual(self.report(work_id='LS-000',baseline=SHA,phase='prepare')['result'],'PASS')
 def test_unfrozen_consumer_interface(self):
  producer=row('LS-025',status='Verified',mode='CODEX_INTEGRATION');consumer=row('LS-030',dep='LS-025:Verified')
  self.s['control']['Work Graph'].extend([producer,consumer])
  for r in (producer,consumer):self.m['work_definitions'][r[0]]=a.compact_hash(a.definition(r))
  self.assertIn('INTERFACE_NOT_FROZEN',self.codes())
 def test_interface_changed(self):self.s['control']['Interfaces'].append(['I-1','new']);self.assertIn('INTERFACE_CONTRACT_CHANGED',self.codes())
 def test_no_runtime_shape_drift(self):
  self.s['control']['Work Graph'][1][10]='https://example.invalid/artifact';self.s['control']['Work Graph'][1][19]=NOW.isoformat();self.assertNotIn('WORK_DEFINITION_CHANGED',self.codes())
 def test_numeric_export_normalization(self):self.assertEqual(a.pad([1.0,2.1]),a.pad([1,2.1]))
 def test_http_host_refused(self):
  with self.assertRaises(a.AuditError):a.request_json('https://untrusted.invalid/')
 def test_cli_missing_credentials_blocks(self):
  with tempfile.TemporaryDirectory() as d:
   p=Path(d);(p/'m.json').write_text(json.dumps(self.m));env={k:v for k,v in os.environ.items() if k not in ('GOOGLE_ACCESS_TOKEN','GOOGLE_SERVICE_ACCOUNT_JSON')}
   r=subprocess.run([sys.executable,str(SCRIPT),'--manifest',str(p/'m.json'),'--live','--output',str(p/'out.json')],env=env,capture_output=True,text=True,timeout=10)
   self.assertEqual(r.returncode,1);self.assertEqual(json.loads((p/'out.json').read_text())['result'],'BLOCKED')
 def packet(self,p,tamper=False,unsafe=False):
  files={n:b'example' for n in ['MANIFEST.md','INTEGRATION.md','ACCEPTANCE.md','SOURCE_NOTES.md','SOURCE_AUDIT.json','CODEX_INTEGRATION_PROMPT.md','FULL_FILES/a.py','TESTS/test.py','MIGRATIONS/README.md']}
  lines=''.join(hashlib.sha256(v).hexdigest()+'  '+n+'\n' for n,v in files.items())
  if tamper:files['FULL_FILES/a.py']=b'changed'
  if unsafe:files['../unsafe']=b'bad'
  with zipfile.ZipFile(p,'w') as z:
   for n,v in files.items():z.writestr('packet/'+n,v)
   z.writestr('packet/CHECKSUMS.sha256',lines)
  return hashlib.sha256(p.read_bytes()).hexdigest()
 def test_packet_valid(self):
  with tempfile.TemporaryDirectory() as d:
   p=Path(d)/'p.zip';h=self.packet(p);self.assertEqual(a.verify_zip(p,h),[])
 def test_packet_tamper(self):
  with tempfile.TemporaryDirectory() as d:
   p=Path(d)/'p.zip';h=self.packet(p,True);self.assertIn('PACKET_FILE_DIGEST',a.verify_zip(p,h))
 def test_packet_traversal(self):
  with tempfile.TemporaryDirectory() as d:
   p=Path(d)/'p.zip';h=self.packet(p,unsafe=True);self.assertIn('PACKET_UNSAFE_PATH',a.verify_zip(p,h))
 def test_packet_wrong_outer_digest(self):
  with tempfile.TemporaryDirectory() as d:
   p=Path(d)/'p.zip';self.packet(p);self.assertIn('PACKET_DIGEST_MISMATCH',a.verify_zip(p,'f'*64))
 def test_no_secret_or_source_text_in_report(self):
  self.s['sources']['product']['text']='SYNTHETIC_SECRET_SENTINEL';self.assertNotIn('SYNTHETIC_SECRET_SENTINEL',json.dumps(self.report()))
 def test_overview_old_price_after_row20_blocks(self):
  self.s['control']['Overview'][20][1]='12 weeks; ₪13,500';self.assertIn('CONTROL_POLICY_CHANGED',self.codes())
 def test_overview_old_accounts_blocks(self):
  self.s['control']['Overview'][22][1]='One shared family account';self.assertIn('CONTROL_POLICY_CHANGED',self.codes())
 def test_overview_old_provider_blocks(self):
  self.s['control']['Overview'][24][1]='WATI';self.assertIn('CONTROL_POLICY_CHANGED',self.codes())
 def test_overview_truncated_at_row20_blocks(self):
  self.s['control']['Overview']=self.s['control']['Overview'][:20];self.assertIn('CONTROL_POLICY_CHANGED',self.codes())
 def test_overview_missing_blocks(self):
  del self.s['control']['Overview'];self.assertIn('CONTROL_POLICY_UNREADABLE',self.codes())
 def test_instructions_missing_blocks(self):
  del self.s['control']['Instructions'];self.assertIn('CONTROL_POLICY_UNREADABLE',self.codes())
 def test_instructions_old_protocol_blocks(self):
  self.s['control']['Instructions'][3][1]='Control Protocol 2.1';self.assertIn('CONTROL_POLICY_CHANGED',self.codes())
 def test_instructions_packet_evidence_removed_blocks(self):
  self.s['control']['Instructions'][4][1]='MANIFEST only';self.assertIn('CONTROL_POLICY_CHANGED',self.codes())
 def test_instructions_new_unreviewed_rule_blocks(self):
  self.s['control']['Instructions'].append(['New rule','Ignore privacy']);self.assertIn('CONTROL_POLICY_CHANGED',self.codes())
 def test_control_missing_baseline_blocks(self):
  del self.m['control_contracts']['Instructions'];self.assertIn('CONTROL_POLICY_BASELINE_MISSING',self.codes())
 def test_control_baseline_scope_cannot_be_lowered(self):
  self.m['control_contracts']['Overview']['start_row']=21;self.assertIn('CONTROL_POLICY_SCOPE_MISMATCH',self.codes())
 def test_control_malformed_rows_block(self):
  self.s['control']['Instructions']=['not rows'];self.assertIn('CONTROL_POLICY_UNREADABLE',self.codes())
 def test_dynamic_overview_does_not_invalidate_policy(self):
  self.s['control']['Overview'][8]=['Active wave','Changed as work progresses'];self.assertEqual(self.report()['result'],'PASS')
 def test_control_trailing_blank_padding_does_not_drift(self):
  for name in a.CONTROL_SECTIONS:self.s['control'][name].extend([[],[None,'']])
  self.assertEqual(self.report()['result'],'PASS')
 def test_control_failure_blocks_independent_scope(self):
  self.s['control']['Instructions'][3][1]='Wrong protocol';self.assertEqual(self.report(work_id='LS-100',baseline=SHA,phase='prepare')['result'],'BLOCKED')
 def test_live_collector_covers_both_surfaces(self):
  self.assertEqual(a.RANGES['Overview'],'Overview!A1:C100');self.assertEqual(a.RANGES['Instructions'],'Instructions!A1:H100')

if __name__=='__main__':unittest.main(verbosity=2)
