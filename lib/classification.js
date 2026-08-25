'use strict';

const TYPE_CODES = Object.freeze(['AUT', 'RED', 'SEG', 'AAV', 'FIN', 'ONB', 'VTE']);
const PRIORITY = Object.freeze({ everflow_raw: 1, llm_normalized: 2, manual: 3 });

function validateNormalization(value, stages) {
  const errors = [];
  if (!value || typeof value !== 'object') return { passed: false, errors: ['INVALID_RESULT'] };
  if (!TYPE_CODES.includes(value.type_code)) errors.push('UNKNOWN_TYPE_CODE');
  if (!stages.includes(value.stage)) errors.push('UNKNOWN_STAGE');
  for (const field of ['original_category', 'occurrence', 'management_type']) {
    if (value[field] !== null && typeof value[field] !== 'string') errors.push(`INVALID_${field.toUpperCase()}`);
  }
  return { passed: errors.length === 0, errors };
}

function priorityDecision(currentSource = 'everflow_raw', incomingSource = 'llm_normalized', validationPassed = true) {
  if (!validationPassed) return { written: false, decision: 'discarded_validation' };
  if (currentSource === 'manual') return { written: false, decision: 'discarded_manual_lock' };
  if ((PRIORITY[incomingSource] || 0) < (PRIORITY[currentSource] || 0)) return { written: false, decision: 'discarded_lower_priority' };
  return { written: true, decision: 'written' };
}

module.exports = { TYPE_CODES, PRIORITY, validateNormalization, priorityDecision };
