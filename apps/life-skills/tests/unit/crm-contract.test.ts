import assert from 'node:assert/strict';
import test from 'node:test';
import { CRM_ADMIN_FIELDS, CRM_FIELD_MAP_VERSION, buildAdministrativePatch, parseStableLeadId, resolveCrmHeaders } from '../../src/features/labels/crm-contract.ts';
import { administrativePatch } from '../../src/features/onboarding/parents-first.ts';

test('preserves both producer ID prefixes without renaming', () => {
  assert.equal(parseStableLeadId('LS-LEAD-SYNTH-1'), 'LS-LEAD-SYNTH-1');
  assert.equal(parseStableLeadId('LS-WAPI-SYNTH-1'), 'LS-WAPI-SYNTH-1');
  assert.equal(parseStableLeadId('LS-WAPI-3f8a0c1d9e22ab44'), 'LS-WAPI-3f8a0c1d9e22ab44');
  assert.throws(() => parseStableLeadId('parent@example.invalid'), /stable_lead_id/);
  assert.deepEqual(administrativePatch('LS-WAPI-SYNTH-1', { 'Payment status': 'DUE' }), { leadId: 'LS-WAPI-SYNTH-1', fields: { 'Payment status': 'DUE' } });
});

test('resolves exact header names and fails duplicate or missing fields', () => {
  const headers = ['unrelated', ...CRM_ADMIN_FIELDS];
  const resolved = resolveCrmHeaders(headers);
  assert.equal(resolved['Payment status'], headers.indexOf('Payment status'));
  assert.throws(() => resolveCrmHeaders([...headers, 'Payment status']), /ambiguous_crm_header/);
  assert.throws(() => resolveCrmHeaders(headers.filter(header => header !== 'Booking status')), /missing_crm_header/);
});

test('returns versioned, field-owned patches and never includes notes', () => {
  assert.deepEqual(buildAdministrativePatch('LS-WAPI-SYNTH-2', { 'Message receipt': 'accepted' }), { leadId: 'LS-WAPI-SYNTH-2', fieldMapVersion: CRM_FIELD_MAP_VERSION, fields: { 'Message receipt': 'accepted' } });
  assert.throws(() => buildAdministrativePatch('LS-LEAD-SYNTH-2', { Notes: 'overwrite' }), /unowned_crm_field/);
});
