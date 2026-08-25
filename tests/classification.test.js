'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { validateNormalization, priorityDecision } = require('../lib/classification');

const stages = ['Instalação', 'Projeto'];

test('accepts known type and exact project stage', () => {
  assert.deepEqual(validateNormalization({ type_code: 'AUT', stage: 'Projeto', original_category: null, occurrence: 'Projeto Padrão', management_type: null }, stages), { passed: true, errors: [] });
});

test('rejects unknown type and stage', () => {
  const result = validateNormalization({ type_code: 'XYZ', stage: 'inventada', original_category: null, occurrence: null, management_type: null }, stages);
  assert.equal(result.passed, false);
  assert.deepEqual(result.errors, ['UNKNOWN_TYPE_CODE', 'UNKNOWN_STAGE']);
});

test('manual always blocks automatic classification', () => {
  assert.deepEqual(priorityDecision('manual', 'llm_normalized', true), { written: false, decision: 'discarded_manual_lock' });
});

test('equal or higher priority writes and failed validation never writes', () => {
  assert.equal(priorityDecision('llm_normalized', 'llm_normalized', true).written, true);
  assert.equal(priorityDecision('everflow_raw', 'llm_normalized', true).written, true);
  assert.deepEqual(priorityDecision('everflow_raw', 'llm_normalized', false), { written: false, decision: 'discarded_validation' });
});
