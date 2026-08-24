'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { extractJsonArray, requireMigrationVariables } = require('../migration/migrate-mocks');

const source = fs.readFileSync(path.resolve(__dirname, '..', 'script.js'), 'utf8');
const osData = extractJsonArray(source, 'OS_DATA');
const taskData = extractJsonArray(source, 'TASK_DATA');

test('não mantém dados mockados no frontend', () => {
  assert.deepEqual(osData, []);
  assert.deepEqual(taskData, []);
  assert.match(source, /const GEO_DATA = \[\];/);
});

test('exige URL e chave secreta para executar o migrador', () => {
  assert.throws(
    () => requireMigrationVariables({}),
    /SUPABASE_URL, SUPABASE_SECRET_KEY/
  );
  assert.throws(
    () => requireMigrationVariables({ SUPABASE_URL: 'https://example.supabase.co' }),
    /SUPABASE_SECRET_KEY/
  );
  assert.throws(
    () => requireMigrationVariables({
      SUPABASE_URL: 'https://example.supabase.co',
      SUPABASE_SECRET_KEY: 'sb_publishable_example'
    }),
    /chave publicável/
  );
  assert.deepEqual(
    requireMigrationVariables({
      SUPABASE_URL: ' https://example.supabase.co ',
      SUPABASE_SECRET_KEY: ' secret-value '
    }),
    { url: 'https://example.supabase.co', secretKey: 'secret-value' }
  );
});
