#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const dotenv = require('dotenv');
const { normalizeTaskTitle } = require('./normalize-task-title');

const ROOT = path.resolve(__dirname, '..');
const SCRIPT_PATH = path.join(ROOT, 'script.js');
const REPORT_PATH = path.join(__dirname, 'report.json');
const ENV_PATH = path.join(ROOT, '.env');
const EXPECTED = Object.freeze({
  clients: 136,
  serviceOrders: 392,
  tasks: 576,
  orphanTasks: 0,
  ordersWithoutTasks: 189,
  classifiedTasks: 99,
  unclassifiedTasks: 477
});

function extractJsonArray(source, variableName) {
  const declaration = `const ${variableName} =`;
  const declarationIndex = source.indexOf(declaration);
  if(declarationIndex < 0) throw new Error(`${variableName} não foi encontrado em script.js`);
  const start = source.indexOf('[', declarationIndex + declaration.length);
  if(start < 0) throw new Error(`Array de ${variableName} não foi encontrado`);

  let depth = 0;
  let inString = false;
  let escaped = false;
  for(let index = start; index < source.length; index += 1) {
    const char = source[index];
    if(inString) {
      if(escaped) escaped = false;
      else if(char === '\\') escaped = true;
      else if(char === '"') inString = false;
      continue;
    }
    if(char === '"') inString = true;
    else if(char === '[') depth += 1;
    else if(char === ']') {
      depth -= 1;
      if(depth === 0) return JSON.parse(source.slice(start, index + 1));
    }
  }
  throw new Error(`Fim do array ${variableName} não foi encontrado`);
}

function nullable(value) {
  return value == null || String(value).trim() === '' ? null : value;
}

function loadMigrationEnvironment() {
  const result = dotenv.config({ path: ENV_PATH, quiet: true });
  if (result.error && result.error.code !== 'ENOENT') {
    throw new Error(`Não foi possível carregar o arquivo .env: ${result.error.message}`);
  }
  return requireMigrationVariables(process.env);
}

function requireMigrationVariables(environment) {
  const missing = ['SUPABASE_URL', 'SUPABASE_SECRET_KEY']
    .filter((name) => !environment[name] || environment[name].trim() === '');
  if (missing.length) {
    throw new Error(
      `Configuração do Supabase ausente: ${missing.join(', ')}. ` +
      'Preencha essas variáveis no arquivo .env local antes de executar a migração.'
    );
  }
  const secretKey = environment.SUPABASE_SECRET_KEY.trim();
  if (secretKey.startsWith('sb_publishable_')) {
    throw new Error(
      'SUPABASE_SECRET_KEY contém uma chave publicável. ' +
      'Use uma chave secreta sb_secret_... (ou a service_role legada) somente no .env local.'
    );
  }
  return {
    url: environment.SUPABASE_URL.trim(),
    secretKey
  };
}

function nameKey(name) {
  return String(name).trim().toLocaleLowerCase('pt-BR');
}

function duplicateValues(items, field) {
  const counts = new Map();
  for(const item of items) counts.set(item[field], (counts.get(item[field]) || 0) + 1);
  return [...counts].filter(([, count]) => count > 1).map(([value, count]) => ({ value, count }));
}

function assertExpected(actual) {
  const differences = Object.entries(EXPECTED)
    .filter(([key, expected]) => actual[key] !== expected)
    .map(([key, expected]) => `${key}: esperado ${expected}, encontrado ${actual[key]}`);
  if (differences.length) throw new Error(`Validação dos mocks falhou:\n- ${differences.join('\n- ')}`);
}

function prepareMigration(osData, taskData) {
  const issues = [];
  const osByExternalId = new Map(osData.map((order) => [order.os, order]));
  const taskOrderIds = new Set(taskData.map((task) => task.os));
  const clientsByKey = new Map();

  for(const order of osData) {
    if(order.cliente == null || String(order.cliente).trim() === '') continue;
    const key = nameKey(order.cliente);
    if(!clientsByKey.has(key)) {
      clientsByKey.set(key, { external_id: null, name: String(order.cliente).trim() });
    }
  }

  const normalizedTasks = taskData.map((task) => {
    const normalized = normalizeTaskTitle(task.nome);
    if(normalized.issue) {
      issues.push({
        entity_type: 'task',
        external_id: String(task.id),
        issue_code: normalized.issue,
        details: {
          originalName: normalized.originalName,
          serviceOrderExternalId: task.os
        }
      });
    }
    return { task, normalized };
  });

  const validation = {
    clients: clientsByKey.size,
    serviceOrders: osData.length,
    tasks: taskData.length,
    orphanTasks: taskData.filter((task) => !osByExternalId.has(task.os)).length,
    ordersWithoutTasks: osData.filter((order) => !taskOrderIds.has(order.os)).length,
    classifiedTasks: normalizedTasks.filter(({ normalized }) => !normalized.issue).length,
    unclassifiedTasks: normalizedTasks.filter(({ normalized }) => normalized.issue).length,
    serviceOrdersWithoutClient: osData.filter((order) => !nullable(order.cliente)).length,
    tasksWithoutServiceOrderId: taskData.filter((task) => task.os == null || task.os === '').length,
    tasksWithoutClient: taskData.filter((task) => !nullable(task.cliente)).length,
    taskClientMismatches: taskData.filter((task) => {
      const order = osByExternalId.get(task.os);
      return order && nameKey(task.cliente) !== nameKey(order.cliente);
    }).length,
    duplicateServiceOrderIds: duplicateValues(osData, 'os'),
    duplicateTaskIds: duplicateValues(taskData, 'id'),
    missingServiceOrderIds: osData.filter((order) => order.os == null || order.os === '').length,
    missingTaskIds: taskData.filter((task) => task.id == null || task.id === '').length,
    emptyTaskNames: taskData.filter((task) => !nullable(task.nome)).length,
    emptyServiceOrderStatuses: osData.filter((order) => !nullable(order.status)).length,
    emptyTaskStatuses: taskData.filter((task) => !nullable(task.status)).length
  };

  assertExpected(validation);
  const hardFailures = [
    validation.serviceOrdersWithoutClient,
    validation.tasksWithoutServiceOrderId,
    validation.tasksWithoutClient,
    validation.taskClientMismatches,
    validation.duplicateServiceOrderIds.length,
    validation.duplicateTaskIds.length,
    validation.missingServiceOrderIds,
    validation.missingTaskIds,
    validation.emptyTaskNames,
    validation.emptyServiceOrderStatuses,
    validation.emptyTaskStatuses
  ];
  if (hardFailures.some(Boolean)) {
    throw new Error(`Integridade dos mocks falhou: ${JSON.stringify(validation, null, 2)}`);
  }

  return { clients: [...clientsByKey.values()], normalizedTasks, issues, validation };
}

class SupabaseRest {
  constructor(url, key) {
    this.baseUrl = `${url.replace(/\/$/, '')}/rest/v1`;
    this.headers = { apikey: key, Authorization: `Bearer ${key}` };
  }

  async request(table, { method = 'GET', query = '', body, prefer } = {}) {
    const response = await fetch(`${this.baseUrl}/${table}${query}`, {
      method,
      headers: {
        ...this.headers,
        ...(body ? { 'Content-Type': 'application/json' } : {}),
        ...(prefer ? { Prefer: prefer } : {})
      },
      body: body ? JSON.stringify(body) : undefined
    });
    if(!response.ok) {
      throw new Error(`${method} ${table} falhou (${response.status}): ${await response.text()}`);
    }
    if(response.status === 204) return null;
    const text = await response.text();
    return text ? JSON.parse(text) : null;
  }

  async upsert(table, rows, conflict, select = '*') {
    const result = [];
    for(let index = 0; index < rows.length; index += 100) {
      const chunk = rows.slice(index, index + 100);
      const data = await this.request(table, {
        method: 'POST',
        query: `?on_conflict=${encodeURIComponent(conflict)}&select=${encodeURIComponent(select)}`,
        body: chunk,
        prefer: 'resolution=merge-duplicates,return=representation'
      });
      result.push(...data);
    }
    return result;
  }
}

async function migrateRemote(prepared, osData, environment) {
  const db = new SupabaseRest(environment.url, environment.secretKey);

  const clients = await db.upsert('clients', prepared.clients, 'name_key', 'id,name,name_key');
  const clientIdByKey = new Map(clients.map((client) => [client.name_key, client.id]));

  const ordersPayload = osData.map((order) => ({
    external_id: order.os,
    client_id: clientIdByKey.get(nameKey(order.cliente)),
    occurrence: nullable(order.ocorrencia),
    operational_service_type: nullable(order.tipoServico),
    deadline_level: nullable(order.prazo),
    status: order.status,
    registered_on: nullable(order.cadastro),
    planned_start_on: nullable(order.prevInicio),
    planned_end_on: nullable(order.prevTermino)
  }));
  const orders = await db.upsert('service_orders', ordersPayload, 'external_id', 'id,external_id');
  const orderIdByExternalId = new Map(orders.map((order) => [order.external_id, order.id]));

  const tasksPayload = prepared.normalizedTasks.map(({ task, normalized }) => ({
    external_id: task.id,
    service_order_id: orderIdByExternalId.get(task.os),
    original_name: normalized.originalName,
    name: normalized.name,
    type_code: normalized.typeCode,
    stage: normalized.stage,
    status: task.status,
    planned_on: nullable(task.prevista),
    started_on: nullable(task.inicio),
    ended_on: nullable(task.fim),
    technician: nullable(task.tecnico),
    auxiliaries: Array.isArray(task.auxiliares) ? task.auxiliares : [],
    original_category: nullable(task.categoria),
    occurrence: nullable(task.ocorrencia),
    management_type: nullable(task.tipoMP),
    warranty: Boolean(task.garantia),
    original_duration_text: nullable(task.diferenca)
  }));
  await db.upsert('tasks', tasksPayload, 'external_id', 'id,external_id');
  await db.upsert('migration_issues', prepared.issues, 'entity_type,external_id,issue_code', 'id,external_id,issue_code');

  const [remoteClients, remoteOrders, remoteTasks, remoteIssues] = await Promise.all([
    db.request('clients', { query: '?select=id,name_key' }),
    db.request('service_orders', { query: '?select=id,external_id' }),
    db.request('tasks', { query: '?select=id,external_id,service_order_id,type_code' }),
    db.request('migration_issues', { query: '?select=external_id,issue_code&entity_type=eq.task' })
  ]);
  const remoteOrderIds = new Set(remoteOrders.map((order) => order.id));
  const orderIdsWithTasks = new Set(remoteTasks.map((task) => task.service_order_id));
  const remoteValidation = {
    clients: remoteClients.length,
    serviceOrders: remoteOrders.length,
    tasks: remoteTasks.length,
    orphanTasks: remoteTasks.filter((task) => !remoteOrderIds.has(task.service_order_id)).length,
    ordersWithoutTasks: remoteOrders.filter((order) => !orderIdsWithTasks.has(order.id)).length,
    classifiedTasks: remoteTasks.filter((task) => task.type_code != null).length,
    unclassifiedTasks: remoteTasks.filter((task) => task.type_code == null).length,
    migrationIssues: remoteIssues.length
  };
  assertExpected(remoteValidation);
  return remoteValidation;
}

function buildReport(prepared, remoteValidation = null) {
  const issuesByCode = Object.fromEntries(
    [...new Set(prepared.issues.map((issue) => issue.issue_code))]
      .sort()
      .map((code) => [code, prepared.issues.filter((issue) => issue.issue_code === code).length])
  );
  return {
    generatedAt: new Date().toISOString(),
    source: 'script.js',
    dryRun: remoteValidation == null,
    validation: prepared.validation,
    remoteValidation,
    issueSummary: issuesByCode,
    issues: prepared.issues
  };
}

async function main() {
  const dryRun = process.argv.includes('--dry-run');
  const environment = loadMigrationEnvironment();
  const source = fs.readFileSync(SCRIPT_PATH, 'utf8');
  const osData = extractJsonArray(source, 'OS_DATA');
  const taskData = extractJsonArray(source, 'TASK_DATA');
  const prepared = prepareMigration(osData, taskData);
  const remoteValidation = dryRun ? null : await migrateRemote(prepared, osData, environment);
  const report = buildReport(prepared, remoteValidation);
  fs.writeFileSync(REPORT_PATH, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  console.log(JSON.stringify({ ...prepared.validation, migrationIssues: prepared.issues.length, dryRun, remoteValidation }, null, 2));
  console.log(`Relatório: ${REPORT_PATH}`);
}

if(require.main === module) {
  main().catch((error) => {
    console.error(error.stack || error.message);
    process.exitCode = 1;
  });
}

module.exports = {
  extractJsonArray,
  prepareMigration,
  nameKey,
  nullable,
  loadMigrationEnvironment,
  requireMigrationVariables
};
