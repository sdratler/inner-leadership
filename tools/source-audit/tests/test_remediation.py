"""Synthetic denial/regression cases for SYS033's reviewed-policy boundary."""
from pathlib import Path
import sys,unittest,json,copy,os,tempfile,hashlib,zipfile
from datetime import datetime,timezone,timedelta
from unittest.mock import patch,Mock
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
import audit as a
import policy_gate as g
import preflight as pf
import signer
import ledger_checks as l
from test_audit import fixture, row, NOW, SHA
HEAD='b'*40

class PolicyTests(unittest.TestCase):
 def setUp(self):
  self.s,self.m=fixture();self.m.update(checker_version='2.0.0',cross_ledger_required=True,max_snapshot_age_seconds=1800)
  self.m['sources']={k:{**v,'required':[],'forbidden':[]} for k,v in self.m['sources'].items()}
  self.base=copy.deepcopy(self.m);self.changed={'tools/source-audit/audit.py':'c'*64,g.POLICY_PATH:'d'*64,g.RECEIPT_PATH:'e'*64}
  self.r={'schema_version':1,'receipt_id':'SYNTHETIC-RECEIPT','repository':a.REPOSITORY,'base_sha':SHA,'base_policy_sha256':g.canonical_hash(self.base),'result_policy_sha256':g.canonical_hash(self.m),'work_ids':['SYS-034'],'created_at':(NOW-timedelta(minutes=1)).isoformat(),'expires_at':(NOW+timedelta(hours=24)).isoformat(),'prepared_by':'synthetic-proposer','changed_files_sha256':{k:v for k,v in self.changed.items() if k!=g.RECEIPT_PATH},'decision_ids':['SYNTHETIC-DECISION'],'effect_limits':{'merge':False,'deploy':False,'paid_activation':False,'private_client_data':False,'consumer_unlock':False}}
  self.pins=[['Receipt ID'],[self.r['receipt_id'],'Approved',self.r['base_policy_sha256'],self.r['result_policy_sha256'],g.canonical_hash(self.r),'SYS-034',self.r['expires_at'],'synthetic-independent-reviewer','https://example.invalid/review',HEAD,NOW.isoformat(),'']]
 def check(self):return g.validate_receipt(self.r,self.pins,self.base,self.m,self.changed,'SYS-034',SHA,HEAD,NOW)
 def test_valid_exact_receipt(self):self.assertEqual(self.check()['independent_pin'],'APPROVED_EXACT_HEAD')
 def test_valid_policy(self):g.validate_policy(self.m)
 def test_policy_missing_cross_ledger(self):self.m['cross_ledger_required']=False;self.assertRaises(g.GateError,g.validate_policy,self.m)
 def test_policy_wrong_source_id(self):self.m['sources']['product']['id']='wrong';self.assertRaises(g.GateError,g.validate_policy,self.m)
 def test_policy_unbounded_freshness(self):self.m['max_snapshot_age_seconds']=999999;self.assertRaises(g.GateError,g.validate_policy,self.m)
 def test_policy_unsafe_owned_root(self):self.m['ownership_roots']['LS-000']=['../escape'];self.assertRaises(g.GateError,g.validate_policy,self.m)
 def test_no_pin(self):self.pins=self.pins[:1];self.assertRaises(g.GateError,self.check)
 def test_duplicate_pin(self):self.pins.append(self.pins[1][:]);self.assertRaises(g.GateError,self.check)
 def test_proposed_not_approved(self):self.pins[1][1]='Proposed';self.assertRaises(g.GateError,self.check)
 def test_self_review_denied(self):self.pins[1][7]=self.r['prepared_by'];self.assertRaises(g.GateError,self.check)
 def test_wrong_head_denied(self):self.pins[1][9]='f'*40;self.assertRaises(g.GateError,self.check)
 def test_no_head_denied(self):self.pins[1][9]='';self.assertRaises(g.GateError,self.check)
 def test_expired_receipt(self):self.r['expires_at']=(NOW-timedelta(seconds=1)).isoformat();self.assertRaises(g.GateError,self.check)
 def test_long_lease_receipt(self):self.r['expires_at']=(NOW+timedelta(days=3)).isoformat();self.assertRaises(g.GateError,self.check)
 def test_changed_file_denied(self):self.changed['tools/source-audit/audit.py']='f'*64;self.assertRaises(g.GateError,self.check)
 def test_extra_file_denied(self):self.changed['unexpected.py']='f'*64;self.assertRaises(g.GateError,self.check)
 def test_missing_file_denied(self):del self.changed['tools/source-audit/audit.py'];self.assertRaises(g.GateError,self.check)
 def test_receipt_missing_from_pr(self):del self.changed[g.RECEIPT_PATH];self.assertRaises(g.GateError,self.check)
 def test_changed_policy_denied(self):self.m['max_snapshot_age_seconds']=300;self.assertRaises(g.GateError,self.check)
 def test_changed_base_denied(self):self.base['max_snapshot_age_seconds']=300;self.assertRaises(g.GateError,self.check)
 def test_effect_escalation_denied(self):self.r['effect_limits']['merge']=True;self.assertRaises(g.GateError,self.check)
 def test_reviewer_without_evidence_denied(self):self.pins[1][8]='';self.assertRaises(g.GateError,self.check)
 def test_pin_digest_mismatch(self):self.pins[1][4]='0'*64;self.assertRaises(g.GateError,self.check)
 def test_pin_work_scope_mismatch(self):self.pins[1][5]='LS-025';self.assertRaises(g.GateError,self.check)
 def test_pin_future_approval_denied(self):self.pins[1][10]=(NOW+timedelta(hours=1)).isoformat();self.assertRaises(g.GateError,self.check)
 def test_duplicate_json_key_denied(self):self.assertRaises(g.GateError,g.bounded_json,b'{"x":1,"x":2}')
 def test_json_float_denied(self):self.assertRaises(g.GateError,g.bounded_json,b'{"x":1.5}')
 def test_json_nan_denied(self):self.assertRaises(g.GateError,g.bounded_json,b'{"x":NaN}')
 def test_json_depth_denied(self):self.assertRaises(g.GateError,g.bounded_json,('['*15+'0'+']'*15).encode())
 def test_json_size_denied(self):self.assertRaises(g.GateError,g.bounded_json,b' '* (g.MAX_JSON+1))
 def test_safe_paths(self):
  for path in ('../x','x/../y','/x','x\\y','x:y','x//y','./x','x/./y','x\x00y'):
   with self.subTest(path=path):self.assertFalse(g.safe_path(path))
 def test_owner_component_boundary(self):self.assertFalse(g.owns('tools/source-audit-evil/a',['tools/source-audit']));self.assertTrue(g.owns('tools/source-audit/a',['tools/source-audit']))
 def test_work_marker_exact(self):
  req={'work_id':'SYS-034','claim_id':'synthetic-run','starting_sha':SHA};self.assertEqual(g.work_request('<!-- LIFE_SKILLS_WORK_REQUEST '+json.dumps(req)+' -->'),req)
 def test_multiple_markers_denied(self):
  req={'work_id':'SYS-034','claim_id':'synthetic-run','starting_sha':SHA};x='<!-- LIFE_SKILLS_WORK_REQUEST '+json.dumps(req)+' -->';self.assertRaises(g.GateError,g.work_request,x+x)
 def test_unmarked_pr_denied(self):self.assertRaises(g.GateError,g.work_request,'not authorized')
 def test_get_file_checks_git_blob(self):
  raw=b'synthetic';item={'type':'file','encoding':'base64','size':len(raw),'sha':'f'*40,'content':__import__('base64').b64encode(raw).decode()}
  with patch.object(g,'api',return_value=item):self.assertRaises(g.GateError,g.get_file,'a.py',SHA,None)
 def test_get_file_no_execution(self):
  raw=b'raise RuntimeError("must not execute")';item={'type':'file','encoding':'base64','size':len(raw),'sha':hashlib.sha1(b'blob '+str(len(raw)).encode()+b'\0'+raw).hexdigest(),'content':__import__('base64').b64encode(raw).decode()}
  with patch.object(g,'api',return_value=item):self.assertEqual(g.get_file('a.py',SHA,None),raw)
 def test_wrong_event_denied_before_source_credentials(self):
  pr={'state':'open','base':{'repo':{'full_name':a.REPOSITORY},'ref':'main','sha':SHA},'head':{'sha':HEAD}}
  with patch.dict(os.environ,{'GITHUB_TOKEN':'synthetic','GITHUB_SHA':SHA,'GITHUB_EVENT_NAME':'pull_request'},clear=True),patch.object(g,'api',return_value=pr),patch.object(a,'collect_live') as collect:
   self.assertRaises(g.GateError,g.run_gate,1);collect.assert_not_called()
 def test_failed_gate_never_publishes_success(self):
  with tempfile.TemporaryDirectory() as d:
   event=Path(d)/'event.json';event.write_text(json.dumps({'pull_request':{'head':{'sha':HEAD}}}));calls=[]
   def api(path,token=None,data=None):
    if data:calls.append(json.loads(data));return {}
    return {'head':{'sha':HEAD}}
   with patch.dict(os.environ,{'GITHUB_TOKEN':'synthetic','GITHUB_EVENT_PATH':str(event),'GITHUB_RUN_ID':'123'},clear=True),patch.object(g,'run_gate',side_effect=g.GateError('SYNTHETIC_DENIAL')),patch.object(g,'api',side_effect=api):
    self.assertEqual(g.main(['--pr','1','--publish-status','--output',str(Path(d)/'out.json')]),1)
   self.assertEqual([c['state'] for c in calls],['failure'])

class WorkAuthorityTests(unittest.TestCase):
 def setUp(self):
  self.s,self.m=fixture();r=row('SYS-034',status='Claimed',mode='CODEX_INTEGRATION');r[15]='synthetic-claim';r[16]='synthetic-integrator';r[17]=(NOW-timedelta(minutes=1)).isoformat();r[18]=(NOW+timedelta(hours=5)).isoformat();r[19]=NOW.isoformat();self.r=r
  self.s['control']['Work Graph'].append(r);self.s['control']['Chat Runs']=[['Run ID']]
  self.m['work_definitions'][r[0]]=a.compact_hash(a.definition(r));self.m['ownership_roots'][r[0]]=['tools/source-audit']
  self.req={'work_id':'SYS-034','claim_id':r[15],'starting_sha':SHA};self.changed={'tools/source-audit/a.py':'a'*64}
 def check(self):return g.validate_work(self.req,self.s,self.m,self.changed,HEAD,NOW)
 def test_valid_live_claim(self):self.check()
 def test_claim_wrong(self):self.req['claim_id']='other-claim';self.assertRaises(g.GateError,self.check)
 def test_claim_expired(self):self.r[18]=(NOW-timedelta(seconds=1)).isoformat();self.assertRaises(g.GateError,self.check)
 def test_claim_over_six_hours(self):self.r[18]=(NOW+timedelta(hours=7)).isoformat();self.assertRaises(g.GateError,self.check)
 def test_ready_not_claimed(self):self.r[5]='Ready';self.assertRaises(g.GateError,self.check)
 def test_no_ownership(self):self.changed={'other/a.py':'a'*64};self.assertRaises(g.GateError,self.check)
 def test_live_overlap(self):
  other=copy.deepcopy(self.r);other[0]='SYS-033';other[15]='other-claim';self.s['control']['Work Graph'].append(other);self.m['ownership_roots']['SYS-033']=['tools'];self.assertRaises(g.GateError,self.check)
 def test_unknown_live_owner(self):
  other=copy.deepcopy(self.r);other[0]='SYS-033';other[15]='other-claim';self.s['control']['Work Graph'].append(other);self.assertRaises(g.GateError,self.check)
 def test_wrong_starting_sha(self):self.req['starting_sha']='f'*40;self.assertRaises(g.GateError,self.check)
 def test_wrong_definition(self):self.r[3]='scope drift';self.assertRaises(g.GateError,self.check)
 def test_next_action_not_definition(self):self.r[22]='truthful new action';self.check()
 def test_closed_run_needs_result_column_t(self):
  self.r[5]='Integrated';self.r[15]='';self.r[11]=HEAD;run=['']*26;run[0]=self.req['claim_id'];run[2]=NOW.isoformat();run[4]='SYS-034';run[11]=HEAD;self.s['control']['Chat Runs'].append(run)
  self.assertRaises(g.GateError,self.check);run[19]=HEAD;self.check()
 def test_preflight_derives_integration(self):self.assertEqual(pf.derive(self.s,'SYS-034','synthetic-claim'),('integrate',SHA,[]))
 def test_preflight_unowned_denied(self):self.assertRaises(a.AuditError,pf.derive,self.s,'SYS-034','other-run')
 def test_preclaim_ready_only(self):self.assertRaises(a.AuditError,pf.derive,self.s,'SYS-034',None,True)

class CrossLedgerTests(unittest.TestCase):
 def setUp(self):
  self.s,self.m=fixture();self.m['cross_ledger_required']=True
  for n,h in l.HEADERS.items():
   self.s['control'].setdefault(n,[[h]]);self.s['control'][n][0]=[h]
 def report(self,scope=None):return a.audit(self.s,self.m,scope,SHA if scope else None,now=NOW)
 def codes(self,scope=None):return {x['code'] for x in self.report(scope)['findings'] if x['severity']=='error'}
 def test_complete_empty_ledgers_pass(self):self.assertEqual(self.report()['result'],'PASS')
 def test_missing_ledger_fails(self):del self.s['control']['Policy Receipts'];self.assertIn('LEDGER_UNREADABLE',self.codes())
 def test_duplicate_ledger_id_fails_unrelated_scope(self):self.s['control']['Merge Packets'] += [['x'],['x']];self.assertIn('LEDGER_DUPLICATE_ID',self.codes('LS-000'))
 def test_accepted_result_not_on_main(self):
  r=row('LS-025',status='Verified',mode='CODEX_INTEGRATION');r[11]=SHA;self.s['control']['Work Graph'].append(r);self.m['work_definitions'][r[0]]=a.compact_hash(a.definition(r));self.assertIn('ACCEPTED_RESULT_NOT_ON_MAIN',self.codes())
 def test_freeze_needs_direct_evidence(self):
  self.s['control']['Interfaces'].append(['I-013','','','','','Frozen']);self.assertIn('INTERFACE_FREEZE_EVIDENCE_MISSING',self.codes())
 def test_consumer_not_unlocked_by_branch(self):
  r=row('LS-030',status='Ready');self.s['control']['Work Graph'].append(r);self.m['work_definitions'][r[0]]=a.compact_hash(a.definition(r));self.assertIn('CONSUMER_ACCEPTED_MAIN_MISSING',self.codes())
 def test_next_action_mutable(self):self.s['control']['Work Graph'][1][22]='Updated next action';self.assertNotIn('WORK_DEFINITION_CHANGED',self.codes())
 def test_dynamic_overview_rows_excluded(self):self.s['control']['Overview'] += [['dynamic','changed']]*8;self.assertNotIn('CONTROL_POLICY_CHANGED',self.codes())
 def test_unrelated_cycle_is_global(self):
  r=row('SYS-034',dep='SYS-034:Verified',status='Draft');self.s['control']['Work Graph'].append(r);self.assertIn('DEPENDENCY_CYCLE',self.codes('LS-000'))
 def test_unsupported_scheduler_claim_absent(self):self.assertIsNone(self.report()['scheduler_installed'])
 def test_interface_source_hash_and_tests_needed(self):
  self.assertFalse(l.has_positive_test_evidence('NOT RUN — PASS planned'));self.assertTrue(l.has_positive_test_evidence('PASS 8 tests'))

class WorkflowBoundaryTests(unittest.TestCase):
 def test_privileged_jobs_no_application_commands(self):
  p=Path(__file__).resolve().parents[3]/'.github/workflows/source-audit.yml';s=p.read_text()
  for word in ('npm ci','npm run','npx ','pull_request.head.ref','persist-credentials: true'):self.assertNotIn(word,s)
  self.assertIn('environment: source-policy-bootstrap',s);self.assertIn('environment: source-integrity-reader',s)
 def test_application_ci_no_external_secrets_or_environment(self):
  p=Path(__file__).resolve().parents[3]/'.github/workflows/pr-ci.yml';s=p.read_text()
  self.assertNotIn('secrets.',s);self.assertNotIn('environment:',s);self.assertNotIn('pull_request_target',s);self.assertNotIn('cache:',s)
 def test_signer_discovers_existing_only(self):
  with tempfile.TemporaryDirectory() as d:
   candidate=Path(d)/'openssl';candidate.write_bytes(b'')
   with patch.object(signer,'shutil') as sh,patch.object(signer.subprocess,'run') as sub,patch.dict(os.environ,{},clear=True):
    sh.which.return_value=str(candidate);sub.return_value=Mock(returncode=0,stdout=b'OpenSSL 3 synthetic',stderr=b'')
    self.assertEqual(signer.find_openssl(),str(candidate.resolve()))

if __name__=='__main__':unittest.main()


class PendingCanonicalDecisionTests(unittest.TestCase):
 def setUp(self):
  self.s,self.m=fixture();self.did='D-SYNTHETIC-PENDING'
  decision=[self.did,'synthetic','derived copy only','Approved','','','synthetic-owner','2026-09-07','','']
  self.s['control']['Decisions'].append(decision);h=a.compact_hash(decision)
  self.m['approved_decisions'][self.did]=h
  self.m['pending_canonical_decisions']={self.did:{'decision_sha256':h,'state':'APPROVED_PROPAGATION_PENDING','unaffected_work_ids':['SYS-033','SYS-034','SYS-021'],'source_sha256':{'website':a.digest(self.s['sources']['website']['text'])}}}
 def pending(self,scope=None):
  return [x for x in a.audit(self.s,self.m,scope,SHA,now=NOW)['findings'] if x['code'].startswith(('APPROVED_CANONICAL','PENDING_DECISION'))]
 def test_global_hold_is_error(self):self.assertEqual(self.pending()[0]['severity'],'error')
 def test_scoped_process_hold_is_visible_warning(self):self.assertEqual(self.pending('SYS-033')[0]['severity'],'warning')
 def test_scoped_integrator_hold_is_visible_warning(self):self.assertEqual(self.pending('SYS-034')[0]['severity'],'warning')
 def test_marketing_remains_blocked(self):self.assertEqual(self.pending('MKT-050')[0]['severity'],'error')
 def test_changed_pending_source_invalidates_boundary(self):self.s['sources']['website']['text']+='drift';self.assertEqual(self.pending('SYS-033')[0]['code'],'PENDING_DECISION_POLICY_INVALID')
 def test_marketing_cannot_exempt_itself(self):self.m['pending_canonical_decisions'][self.did]['unaffected_work_ids'].append('MKT-050');self.assertEqual(self.pending('SYS-033')[0]['code'],'PENDING_DECISION_POLICY_INVALID')
 def test_changed_pending_decision_not_silently_accepted(self):self.m['pending_canonical_decisions'][self.did]['decision_sha256']='0'*64;self.assertEqual(self.pending('SYS-033')[0]['code'],'PENDING_DECISION_POLICY_INVALID')
