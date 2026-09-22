import assert from 'node:assert/strict';
import { test } from 'vitest';
import { LIFE_SKILLS_ADMIN_LABELS, assertAdministrativeLabel, labelDoesNotEstablishPaymentOrConsent, preserveUnrelatedLabels } from '../../src/features/labels/admin-labels.ts';

test('allows only administrative Life Skills labels and preserves unrelated labels', () => {
  assert.equal(LIFE_SKILLS_ADMIN_LABELS.length, 6);
  assert.doesNotThrow(() => assertAdministrativeLabel('LS • Paid', 'associate'));
  assert.throws(() => assertAdministrativeLabel('Clinical • Diagnosis', 'associate'));
  assert.deepEqual(preserveUnrelatedLabels(['VIP', 'LS • Lead'], ['LS • Paid']), ['VIP', 'LS • Paid']);
  assert.equal(labelDoesNotEstablishPaymentOrConsent(), false);
});

test('does not expose group, broadcast, send, reply or clinical operations', () => {
  assert.deepEqual(Object.keys({ list: true, associate: true, remove: true }).sort(), ['associate', 'list', 'remove']);
});
