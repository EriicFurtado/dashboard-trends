'use strict';

require('dotenv').config({ quiet: true });

const EVERFLOW_URL = 'https://api.flow2.com.br/v1';
const PAGE_SIZE = 100;
const TASK_BATCH_SIZE = 50;
const START_MONTH = '2024-01';
const endMonth = process.env.EVERFLOW_END_MONTH || new Date().toISOString().slice(0, 7);
const syncScope = process.argv.includes('--window') || process.env.EVERFLOW_SYNC_SCOPE === 'window' ? 'window' : 'history';

const required = ['EVERFLOW_TOKEN', 'SUPABASE_URL', 'SUPABASE_SECRET_KEY'];
const missing = required.filter((name) => !process.env[name]?.trim());
if (missing.length) throw new Error(`Variáveis ausentes no .env: ${missing.join(', ')}`);

const everflowHeaders = {
  Authorization: `Bearer ${process.env.EVERFLOW_TOKEN.trim()}`,
  Accept: 'application/json'
};
const supabaseBase = `${process.env.SUPABASE_URL.trim().replace(/\/$/, '')}/rest/v1`;
const supabaseHeaders = {
  apikey: process.env.SUPABASE_SECRET_KEY.trim(),
  Authorization: `Bearer ${process.env.SUPABASE_SECRET_KEY.trim()}`,
  Accept: 'application/json'
};

function monthAfter(month) {
  const [year, value] = month.split('-').map(Number);
  const date = new Date(Date.UTC(year, value, 1));
  return date.toISOString().slice(0, 7);
}

function monthWindow(month) {
  const [year, value] = month.split('-').map(Number);
  const start = new Date(Date.UTC(year, value - 1, 1));
  const end = new Date(Date.UTC(year, value, 0, 23, 59, 59, 999));
  return { start: start.toISOString(), end: end.toISOString() };
}

function dateOnly(value) {
  return value ? String(value).slice(0, 10) : null;
}

function text(value) {
  return value == null ? '' : String(value).trim();
}

function nullable(value) {
  const normalized = text(value);
  return normalized ? normalized : null;
}

function clientExternalId(order) {
  return String(order.idCliente ?? order.contrato?.cliente?.id ?? order.cnpjCpf ?? '').trim();
}

function normalizedKey(value) {
  return text(value).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLocaleLowerCase('pt-BR');
}

const typeCodes = new Set(['AUT', 'RED', 'SEG', 'AAV', 'FIN', 'ONB', 'VTE']);
const stages = new Map([
  ['1 pagamento', '1º Pagamento'],
  ['compras de materiais', 'Compras de materiais'],
  ['infraestrutura', 'Infraestrutura'],
  ['pre-configuracao', 'Pré-Configuração'],
  ['instalacao', 'Instalação'],
  ['configuracao final', 'Configuração Final'],
  ['treinamento', 'Treinamento'],
  ['projeto', 'Projeto'],
  ['visita tecnica', 'Visita Técnica']
]);

function normalizeTaskName(value) {
  const originalName = text(value);
  const parts = originalName.split('|').map((part) => part.trim());
  if (parts.length < 3) return { originalName, name: originalName, typeCode: null, stage: null, issue: 'INVALID_TITLE_FORMAT' };
  const typeCode = parts[0].toUpperCase();
  const stage = stages.get(normalizedKey(parts[1]));
  const name = parts.slice(2).join(' | ').trim();
  if (!typeCodes.has(typeCode)) return { originalName, name: name || originalName, typeCode: null, stage: null, issue: 'UNKNOWN_TYPE_CODE' };
  if (!stage) return { originalName, name: name || originalName, typeCode: null, stage: null, issue: 'UNKNOWN_STAGE' };
  if (!name) return { originalName, name: originalName, typeCode: null, stage: null, issue: 'INVALID_TITLE_FORMAT' };
  return { originalName, name, typeCode, stage, issue: null };
}

async function requestJson(url, options = {}, attempts = 3) {
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    const response = await fetch(url, options);
    if (response.ok) {
      const body = await response.text();
      return body ? JSON.parse(body) : null;
    }
    const details = (await response.text()).slice(0, 500);
    if (attempt === attempts || (response.status !== 429 && response.status < 500)) {
      throw new Error(`${options.method || 'GET'} ${url} falhou (${response.status}): ${details}`);
    }
    await new Promise((resolve) => setTimeout(resolve, attempt * 1000));
  }
}

function queryString(params) {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (Array.isArray(value)) value.forEach((item) => query.append(key, String(item)));
    else if (value !== undefined && value !== null && value !== '') query.set(key, String(value));
  }
  return query.toString();
}

async function fetchOrders(month, pageIndex, usePlannedWindow = false) {
  const window = monthWindow(month);
  const query = queryString({
    ...(usePlannedWindow
      ? { DataPrevistaInicioMaiorOuIgualA: window.start, DataPrevistaInicioMenorOuIgualA: window.end }
      : { DataCadastroMaiorOuIgualA: window.start, DataCadastroMenorOuIgualA: window.end }),
    PageIndex: pageIndex,
    PageSize: PAGE_SIZE,
    SortField: 'dataCadastro',
    SortType: 'asc'
  });
  return requestJson(`${EVERFLOW_URL}/ordensServico?${query}`, { headers: everflowHeaders });
}

async function fetchTasks(orderIds) {
  const result = [];
  let pageIndex = 0;
  while (true) {
    const query = queryString({
      IdsOrdensServico: orderIds,
      PageIndex: pageIndex,
      PageSize: PAGE_SIZE,
      CarregarDetalhesTarefa: false,
      SortField: 'id',
      SortType: 'asc'
    });
    const response = await requestJson(`${EVERFLOW_URL}/ordensServico/tarefas?${query}`, { headers: everflowHeaders });
    const page = response?.itens || [];
    result.push(...page.flatMap((item) => item.tarefas || []));
    const totalPages = Number(response?.totalPages);
    if (!page.length || (Number.isFinite(totalPages) && totalPages > 0 ? pageIndex + 1 >= totalPages : page.length < PAGE_SIZE)) break;
    pageIndex += 1;
  }
  return result;
}

async function supabaseRequest(table, body, conflict) {
  const url = `${supabaseBase}/${table}?on_conflict=${encodeURIComponent(conflict)}&select=*`;
  return requestJson(url, {
    method: 'POST',
    headers: { ...supabaseHeaders, 'Content-Type': 'application/json', Prefer: 'resolution=merge-duplicates,return=representation' },
    body: JSON.stringify(body)
  });
}

async function fetchKnownServiceOrders() {
  const rows = [];
  for (let offset = 0; ; offset += 1000) {
    const query = queryString({
      select: 'id,external_id',
      order: 'external_id.asc',
      offset,
      limit: 1000
    });
    const page = await requestJson(`${supabaseBase}/service_orders?${query}`, { headers: supabaseHeaders });
    rows.push(...(page || []));
    if (!page || page.length < 1000) return rows;
  }
}

async function upsertProtectedTask(payload) {
  return requestJson(`${supabaseBase}/rpc/upsert_polled_task`, {
    method: 'POST',
    headers: { ...supabaseHeaders, 'Content-Type': 'application/json', Prefer: 'return=representation' },
    body: JSON.stringify({ payload })
  });
}

async function syncMonth(month, includeKnownOrders = false) {
  let pageIndex = 0;
  let orders = [];
  while (true) {
    const response = await fetchOrders(month, pageIndex, syncScope === 'window');
    const page = response?.itens || [];
    orders.push(...page);
    const totalPages = Number(response?.totalPages);
    if (!page.length || (Number.isFinite(totalPages) && totalPages > 0 ? pageIndex + 1 >= totalPages : page.length < PAGE_SIZE)) break;
    pageIndex += 1;
  }

  const issues = [];
  const validOrders = [];
  for (const order of orders) {
    const externalId = clientExternalId(order);
    if (!externalId) {
      issues.push({
        entity_type: 'service_order',
        external_id: String(order.id),
        issue_code: 'MISSING_CLIENT_IDENTIFIER',
        details: { clientName: order.clienteNomeRazaoSocial || order.nomeClienteSolicitante || order.clienteApelido || null, month }
      });
      continue;
    }
    validOrders.push(order);
  }
  orders = validOrders;

  const clients = new Map();
  for (const order of orders) {
    const externalId = clientExternalId(order);
    clients.set(externalId, {
      external_id: externalId,
      name: text(order.clienteNomeRazaoSocial || order.nomeClienteSolicitante || order.clienteApelido) || `Cliente ${externalId}`
    });
  }
  const savedClients = [];
  for (const chunk of [...clients.values()].reduce((all, _, index, array) => index % 100 ? all : [...all, array.slice(index, index + 100)], [])) {
    savedClients.push(...await supabaseRequest('clients', chunk, 'external_id'));
  }
  const clientIds = new Map(savedClients.map((client) => [String(client.external_id), client.id]));
  const orderRows = orders.map((order) => ({
    external_id: Number(order.id),
    client_id: clientIds.get(clientExternalId(order)),
    occurrence: nullable(order.ocorrencia?.descricao),
    operational_service_type: nullable(order.tipoOcorrencia?.descricao),
    deadline_level: nullable(order.prazoStatus),
    status: text(order.statusChamado?.descricao || order.status || 'Sem status'),
    registered_on: dateOnly(order.dataCadastro),
    planned_start_on: dateOnly(order.dataPrevistaInicio),
    planned_end_on: dateOnly(order.dataPrevistaFim)
  }));
  const savedOrders = [];
  for (let index = 0; index < orderRows.length; index += 100) savedOrders.push(...await supabaseRequest('service_orders', orderRows.slice(index, index + 100), 'external_id'));
  const knownOrders = includeKnownOrders ? await fetchKnownServiceOrders() : [];
  const orderIds = new Map(knownOrders.map((order) => [Number(order.external_id), order.id]));
  for (const order of savedOrders) orderIds.set(Number(order.external_id), order.id);

  // Tasks can be created on an older service order that no longer belongs to
  // the current planned-start window. Poll every order already known by the
  // database, plus any order discovered in this window, so those tasks are not
  // silently missed.
  const taskOrderExternalIds = [...new Set([
    ...orderIds.keys(),
    ...orders.map((order) => Number(order.id))
  ])].filter(Number.isFinite);
  let tasks = [];
  for (let index = 0; index < taskOrderExternalIds.length; index += TASK_BATCH_SIZE) {
    tasks.push(...await fetchTasks(taskOrderExternalIds.slice(index, index + TASK_BATCH_SIZE)));
  }
  tasks = [...new Map(tasks.map((task) => [Number(task.id), task])).values()];

  const taskRows = [];
  for (const task of tasks) {
    const normalized = normalizeTaskName(task.nome);
    if (normalized.issue) issues.push({ entity_type: 'task', external_id: String(task.id), issue_code: normalized.issue, details: { originalName: normalized.originalName, serviceOrderExternalId: task.idOrdemServico } });
    taskRows.push({
      external_id: Number(task.id), service_order_id: orderIds.get(Number(task.idOrdemServico)), original_name: normalized.originalName,
      name: normalized.name || normalized.originalName || `Tarefa ${task.id}`, type_code: normalized.typeCode, stage: normalized.stage,
      status: text(task.status?.nome || task.status || 'Sem status'), planned_on: dateOnly(task.dataPrevistaInicio),
      started_on: dateOnly(task.duracoesTarefas?.[0]?.dataInicio), ended_on: dateOnly(task.dataFinalizacao),
      technician: nullable(task.tecnicoResponsavel?.nome)
    });
  }
  for (const row of taskRows) {
    await upsertProtectedTask({
      ...row,
      raw_classification: {
        type_code: row.type_code,
        stage: row.stage,
        original_category: null,
        occurrence: null,
        management_type: null
      },
      normalized: {
        type_code: row.type_code,
        stage: row.stage,
        original_category: null,
        occurrence: null,
        management_type: null
      },
      validation_passed: Boolean(row.type_code && row.stage),
      validation_errors: row.type_code && row.stage ? [] : ['LEGACY_TITLE_NORMALIZATION_FAILED'],
      classification_source: 'everflow_raw',
      everflow_raw_hash: null
    });
  }
  for (let index = 0; index < issues.length; index += 100) await supabaseRequest('migration_issues', issues.slice(index, index + 100), 'entity_type,external_id,issue_code');
  return {
    month,
    orders: orders.length,
    task_orders_polled: taskOrderExternalIds.length,
    tasks: taskRows.length,
    issues: issues.length
  };
}

async function main() {
  const results = [];
  if (syncScope === 'window') {
    const current = new Date().toISOString().slice(0, 7);
    for (let offset = 0, month = current; offset <= 6; offset += 1, month = monthAfter(month)) {
      results.push(await syncMonth(month, offset === 0));
    }
  } else {
    for (let month = START_MONTH; month <= endMonth; month = monthAfter(month)) results.push(await syncMonth(month));
  }
  console.log(JSON.stringify({ ok: true, results }, null, 2));
}

main().catch((error) => { console.error(`Sincronização abortada: ${error.message}`); process.exitCode = 1; });
