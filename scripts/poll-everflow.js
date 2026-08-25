'use strict';

require('dotenv').config({ quiet: true });
const crypto = require('node:crypto');
const { requestJson } = require('../lib/http-json');
const { normalizeWithLlm } = require('../lib/normalize-with-llm');
const { validateNormalization, priorityDecision } = require('../lib/classification');

const EVERFLOW_URL = 'https://api.flow2.com.br/v1';
const PAGE_SIZE = 100;
const ORDER_BATCH_SIZE = 50;
const LLM_BATCH_SIZE = Number(process.env.LLM_BATCH_SIZE) || 25;
const WINDOW_MONTHS = Number(process.env.EVERFLOW_WINDOW_MONTHS) || 6;
const DRY_RUN = String(process.env.DRY_RUN).toLowerCase() !== 'false';
const INTERVAL_MS = 5 * 60 * 1000;

function requiredEnvironment() {
  const required = ['EVERFLOW_TOKEN', 'SUPABASE_URL', 'SUPABASE_SECRET_KEY', 'OPENAI_API_KEY'];
  const missing = required.filter((name) => !process.env[name]?.trim());
  if (missing.length) throw new Error(`Variáveis ausentes no .env: ${missing.join(', ')}`);
}

const everflowHeaders = () => ({ Authorization: `Bearer ${process.env.EVERFLOW_TOKEN.trim()}`, Accept: 'application/json' });
const supabaseBase = () => `${process.env.SUPABASE_URL.trim().replace(/\/$/, '')}/rest/v1`;
const supabaseHeaders = () => ({ apikey: process.env.SUPABASE_SECRET_KEY.trim(), Authorization: `Bearer ${process.env.SUPABASE_SECRET_KEY.trim()}`, Accept: 'application/json' });
const text = (value) => value == null ? '' : String(value).trim();
const nullable = (value) => text(value) || null;
const dateOnly = (value) => value ? String(value).slice(0, 10) : null;
const hash = (value) => crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');
const chunks = (array, size) => Array.from({ length: Math.ceil(array.length / size) }, (_, index) => array.slice(index * size, (index + 1) * size));

function monthAfter(month) {
  const [year, number] = month.split('-').map(Number);
  return new Date(Date.UTC(year, number, 1)).toISOString().slice(0, 7);
}

function monthWindow(month) {
  const [year, number] = month.split('-').map(Number);
  return {
    start: new Date(Date.UTC(year, number - 1, 1)).toISOString(),
    end: new Date(Date.UTC(year, number, 0, 23, 59, 59, 999)).toISOString()
  };
}

function queryString(params) {
  const query = new URLSearchParams();
  Object.entries(params).forEach(([key, value]) => {
    if (Array.isArray(value)) value.forEach((item) => query.append(key, String(item)));
    else if (value !== undefined && value !== null && value !== '') query.set(key, String(value));
  });
  return query.toString();
}

async function fetchOrdersForMonth(month) {
  const range = monthWindow(month);
  const result = [];
  for (let pageIndex = 0; ; pageIndex += 1) {
    const query = queryString({ DataPrevistaInicioMaiorOuIgualA: range.start, DataPrevistaInicioMenorOuIgualA: range.end, PageIndex: pageIndex, PageSize: PAGE_SIZE, SortField: 'dataCadastro', SortType: 'asc' });
    const response = await requestJson(`${EVERFLOW_URL}/ordensServico?${query}`, { headers: everflowHeaders() });
    const page = response?.itens || [];
    result.push(...page);
    const totalPages = Number(response?.totalPages);
    if (!page.length || (Number.isFinite(totalPages) && totalPages > 0 ? pageIndex + 1 >= totalPages : page.length < PAGE_SIZE)) return result;
  }
}

async function fetchTasks(orderIds) {
  const result = [];
  for (let pageIndex = 0; ; pageIndex += 1) {
    const query = queryString({ IdsOrdensServico: orderIds, PageIndex: pageIndex, PageSize: PAGE_SIZE, CarregarDetalhesTarefa: true, SortField: 'id', SortType: 'asc' });
    const response = await requestJson(`${EVERFLOW_URL}/ordensServico/tarefas?${query}`, { headers: everflowHeaders() });
    const page = response?.itens || [];
    result.push(...page.flatMap((item) => item.tarefas || []));
    const totalPages = Number(response?.totalPages);
    if (!page.length || (Number.isFinite(totalPages) && totalPages > 0 ? pageIndex + 1 >= totalPages : page.length < PAGE_SIZE)) return result;
  }
}

async function dbGet(path) { return requestJson(`${supabaseBase()}/${path}`, { headers: supabaseHeaders() }); }
async function dbPost(path, body, prefer = 'resolution=merge-duplicates,return=representation') {
  return requestJson(`${supabaseBase()}/${path}`, { method: 'POST', headers: { ...supabaseHeaders(), 'Content-Type': 'application/json', Prefer: prefer }, body: JSON.stringify(body) });
}

async function fetchAll(path, pageSize = 1000) {
  const rows = [];
  for (let offset = 0; ; offset += pageSize) {
    const separator = path.includes('?') ? '&' : '?';
    const page = await dbGet(`${path}${separator}offset=${offset}&limit=${pageSize}`);
    rows.push(...page);
    if (page.length < pageSize) return rows;
  }
}

function clientExternalId(order) { return String(order.idCliente ?? order.contrato?.cliente?.id ?? order.cnpjCpf ?? '').trim(); }
function rawOrder(order) {
  return {
    external_id: Number(order.id), client_external_id: clientExternalId(order),
    client_name: text(order.clienteNomeRazaoSocial || order.nomeClienteSolicitante || order.clienteApelido) || `Cliente ${clientExternalId(order)}`,
    occurrence: nullable(order.ocorrencia?.descricao), operational_service_type: nullable(order.tipoOcorrencia?.descricao),
    deadline_level: nullable(order.prazoStatus), status: text(order.statusChamado?.descricao || order.status || 'Sem status'),
    registered_on: dateOnly(order.dataCadastro), planned_start_on: dateOnly(order.dataPrevistaInicio), planned_end_on: dateOnly(order.dataPrevistaFim)
  };
}

function rawTask(task, order) {
  const source = {
    title: text(task.nome), description: nullable(task.descricao || task.observacao),
    original_category: nullable(task.categoria?.descricao || task.categoria?.nome || task.tipoTarefa?.descricao),
    occurrence: nullable(task.ocorrencia?.descricao || order?.ocorrencia?.descricao),
    management_type: nullable(task.tipoGestao?.descricao || task.tipoGerenciamento?.descricao)
  };
  const operational = {
    external_id: Number(task.id), order_external_id: Number(task.idOrdemServico), original_name: source.title,
    name: source.title || `Tarefa ${task.id}`, status: text(task.status?.nome || task.status || 'Sem status'),
    planned_on: dateOnly(task.dataPrevistaInicio), started_on: dateOnly(task.duracoesTarefas?.[0]?.dataInicio),
    ended_on: dateOnly(task.dataFinalizacao), technician: nullable(task.tecnicoResponsavel?.nome)
  };
  return { ...operational, ...source, everflow_raw_hash: hash({ operational, source }) };
}

async function loadDatabaseSnapshot() {
  const [clients, orders, tasks, stages, orphanIssues] = await Promise.all([
    fetchAll('clients?select=id,external_id'),
    fetchAll('service_orders?select=id,external_id,everflow_raw_hash'),
    fetchAll('tasks?select=id,external_id,classification_source,everflow_raw_hash'),
    fetchAll('stages?select=name&order=sort_order.asc'),
    fetchAll('migration_issues?select=external_id,details&entity_type=eq.task&issue_code=eq.MISSING_SERVICE_ORDER')
  ]);
  return {
    clients: new Map(clients.map((row) => [String(row.external_id), row])),
    orders: new Map(orders.map((row) => [Number(row.external_id), row])),
    tasks: new Map(tasks.map((row) => [Number(row.external_id), row])),
    stages: stages.map((row) => row.name),
    orphanHashes: new Map(orphanIssues.map((row) => [Number(row.external_id), row.details?.everflow_raw_hash || null]))
  };
}

async function saveOperationalData(rawOrders, snapshot) {
  if (DRY_RUN) return;
  const clientRows = [...new Map(rawOrders.map((order) => [order.client_external_id, { external_id: order.client_external_id, name: order.client_name }])).values()];
  for (const batch of chunks(clientRows, 100)) await dbPost('clients?on_conflict=external_id&select=id,external_id', batch);
  const clients = await fetchAll('clients?select=id,external_id');
  const clientIds = new Map(clients.map((row) => [String(row.external_id), row.id]));
  const rows = rawOrders.map((order) => ({ ...order, client_id: clientIds.get(order.client_external_id), everflow_raw_hash: hash(order) }));
  rows.forEach((row) => { delete row.client_external_id; delete row.client_name; });
  for (const batch of chunks(rows, 100)) await dbPost('service_orders?on_conflict=external_id&select=id,external_id', batch);
}

async function recordMissingServiceOrder(task, normalized, validation) {
  const details = {
    serviceOrderExternalId: task.order_external_id,
    errors: ['MISSING_SERVICE_ORDER'],
    everflow_raw_hash: task.everflow_raw_hash,
    llm: normalized
  };
  await dbPost('migration_issues?on_conflict=entity_type,external_id,issue_code', {
    entity_type: 'task', external_id: String(task.external_id),
    issue_code: 'MISSING_SERVICE_ORDER', details
  });
  await dbPost('classification_log', {
    task_external_id: task.external_id,
    everflow_value: {
      title: task.title, description: task.description,
      original_category: task.original_category, occurrence: task.occurrence,
      management_type: task.management_type
    },
    llm_value: normalized,
    validation_passed: validation.passed,
    validation_errors: [...validation.errors, 'MISSING_SERVICE_ORDER'],
    previous_source: null,
    incoming_source: 'llm_normalized',
    written: false,
    decision: 'discarded_missing_service_order'
  }, 'return=representation');
}

async function runCycle() {
  requiredEnvironment();
  const startedAt = new Date().toISOString();
  console.log(JSON.stringify({ event: 'poll_started', started_at: startedAt, dry_run: DRY_RUN, window_months: WINDOW_MONTHS }));
  const orderMap = new Map();
  for (let offset = 0, month = new Date().toISOString().slice(0, 7); offset <= WINDOW_MONTHS; offset += 1, month = monthAfter(month)) {
    for (const order of await fetchOrdersForMonth(month)) orderMap.set(Number(order.id), order);
  }
  const orders = [...orderMap.values()];
  let tasks = [];
  for (const batch of chunks(orders.map((order) => order.id), ORDER_BATCH_SIZE)) tasks.push(...await fetchTasks(batch));
  tasks = [...new Map(tasks.map((task) => [Number(task.id), task])).values()];

  const snapshot = await loadDatabaseSnapshot();
  const normalizedOrders = orders.filter(clientExternalId).map(rawOrder);
  await saveOperationalData(normalizedOrders, snapshot);
  if (!DRY_RUN) {
    const refreshed = await fetchAll('service_orders?select=id,external_id,everflow_raw_hash');
    snapshot.orders = new Map(refreshed.map((row) => [Number(row.external_id), row]));
  }
  const orderByExternalId = new Map(orders.map((order) => [Number(order.id), order]));
  const changed = tasks.map((task) => rawTask(task, orderByExternalId.get(Number(task.idOrdemServico))))
    .filter((task) => {
      const persistedHash = snapshot.tasks.get(task.external_id)?.everflow_raw_hash
        || snapshot.orphanHashes.get(task.external_id);
      return persistedHash !== task.everflow_raw_hash;
    });
  console.log(JSON.stringify({ event: 'delta_detected', orders_fetched: orders.length, tasks_fetched: tasks.length, tasks_new_or_changed: changed.length }));

  const decisions = [];
  for (const batch of chunks(changed, LLM_BATCH_SIZE)) {
    const llmRows = await normalizeWithLlm(batch, { stages: snapshot.stages });
    const llmById = new Map(llmRows.map((row) => [Number(row.external_id), row]));
    for (const task of batch) {
      const current = snapshot.tasks.get(task.external_id);
      const normalized = llmById.get(task.external_id) || null;
      const validation = validateNormalization(normalized, snapshot.stages);
      const priority = priorityDecision(current?.classification_source, 'llm_normalized', validation.passed);
      const orderRow = snapshot.orders.get(task.order_external_id);
      const canPersist = Boolean(orderRow);
      const payload = {
        external_id: task.external_id, service_order_id: orderRow?.id || null, original_name: task.original_name,
        name: task.name, status: task.status, planned_on: task.planned_on, started_on: task.started_on,
        ended_on: task.ended_on, technician: task.technician, everflow_raw_hash: task.everflow_raw_hash,
        raw_classification: {
          title: task.title,
          description: task.description,
          original_category: task.original_category,
          occurrence: task.occurrence,
          management_type: task.management_type
        },
        normalized, validation_passed: validation.passed, validation_errors: validation.errors,
        classification_source: 'llm_normalized'
      };
      const log = { event: 'classification_decision', task_external_id: task.external_id, previous_source: current?.classification_source || null, incoming_source: 'llm_normalized', validation_passed: validation.passed, validation_errors: canPersist ? validation.errors : [...validation.errors, 'MISSING_SERVICE_ORDER'], would_write_classification: priority.written && canPersist, decision: canPersist ? priority.decision : 'discarded_missing_service_order', raw: payload.raw_classification, normalized };
      console.log(JSON.stringify(log));
      decisions.push(log);
      if (!DRY_RUN) {
        if (canPersist) await dbPost('rpc/upsert_polled_task', { payload }, 'return=representation');
        else await recordMissingServiceOrder(task, normalized, validation);
      }
    }
  }
  const summary = { event: 'poll_completed', dry_run: DRY_RUN, started_at: startedAt, finished_at: new Date().toISOString(), orders_fetched: orders.length, tasks_fetched: tasks.length, tasks_new_or_changed: changed.length, classifications_would_write: decisions.filter((item) => item.would_write_classification).length, classifications_discarded: decisions.filter((item) => !item.would_write_classification).length };
  console.log(JSON.stringify(summary));
  return summary;
}

async function startScheduler() {
  let running = false;
  const execute = async () => {
    if (running) return console.warn(JSON.stringify({ event: 'poll_skipped', reason: 'previous_cycle_running' }));
    running = true;
    try { await runCycle(); } catch (error) { console.error(JSON.stringify({ event: 'poll_failed', error: error.message })); }
    finally { running = false; }
  };
  await execute();
  setInterval(execute, INTERVAL_MS);
  console.log(JSON.stringify({ event: 'scheduler_started', interval_seconds: INTERVAL_MS / 1000, dry_run: DRY_RUN }));
}

if (require.main === module) {
  (process.argv.includes('--once') ? runCycle() : startScheduler()).catch((error) => { console.error(JSON.stringify({ event: 'poll_failed', error: error.message })); process.exitCode = 1; });
}

module.exports = { runCycle, rawTask, rawOrder, monthWindow };
