'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { queryProjectRecords, transformProjectRecords, maxIsoDate, mapEverflowStatus } = require('../projects');

const serviceTypes = [
  { code: 'AUT', name: 'Automação', sort_order: 1 },
  { code: 'RED', name: 'Redes', sort_order: 2 }
];
const stages = [
  { name: 'Infraestrutura', sort_order: 1 },
  { name: 'Instalação', sort_order: 2 },
  { name: 'Treinamento', sort_order: 3 }
];

function order(id, externalId, clientId = 'client-1', clientName = 'Gegê') {
  return {
    id, external_id: externalId, client_id: clientId,
    occurrence: 'Projeto Padrão', operational_service_type: 'Projeto',
    deadline_level: 'Prazo alto', status: 'Agendado',
    registered_on: '2026-08-01', planned_start_on: '2026-08-10',
    planned_end_on: '2026-09-10', updated_at: '2026-08-19T12:00:00Z',
    client: { id: clientId, name: clientName, updated_at: '2026-08-18T12:00:00Z' }
  };
}

function task(id, serviceOrderId, overrides = {}) {
  return {
    id: `task-uuid-${id}`, external_id: id, service_order_id: serviceOrderId,
    name: `Tarefa ${id}`, type_code: 'AUT', stage: 'Infraestrutura',
    status: 'Planejando', planned_on: '2026-08-20', started_on: null,
    ended_on: null, technician: null, updated_at: '2026-08-19T13:00:00Z',
    ...overrides
  };
}

function transform(serviceOrders, tasks) {
  return transformProjectRecords({ serviceOrders, tasks, serviceTypes, stages });
}

test('mapeia os status do Everflow para os status do Gantt', () => {
  const today = new Date('2026-08-20T12:00:00');
  const future = '2026-08-21';
  const cases = [
    ['Planejado', 'Planejada'], ['Planejada', 'Planejada'],
    ['Agenda', 'Planejada'], ['Agendada', 'Planejada'],
    ['Em deslocamento', 'Planejada'], ['Em execução', 'Andamento'],
    ['Pause', 'Bloqueado'], ['Pausa', 'Bloqueado'],
    ['Impedida', 'Bloqueado'], ['Finalizada', 'Finalizado']
  ];
  for (const [everflow, gantt] of cases) {
    assert.equal(mapEverflowStatus(everflow, future, today), gantt);
  }
});

test('calcula atraso pela data prevista, independentemente do status não finalizado', () => {
  const today = new Date('2026-08-20T12:00:00');
  assert.equal(mapEverflowStatus('Planejado', '2026-08-19', today), 'Atrasada');
  assert.equal(mapEverflowStatus('Em execução', '2026-08-19', today), 'Atrasada');
  assert.equal(mapEverflowStatus('Impedida', '2026-08-19', today), 'Atrasada');
  assert.equal(mapEverflowStatus('Finalizada', '2026-08-19', today), 'Finalizado');
});

test('exclui tarefas canceladas do Gantt pelo mapper', () => {
  assert.equal(mapEverflowStatus('Cancelada', '2026-08-19', new Date('2026-08-20T12:00:00')), null);
});

test('cliente com uma OS mantém a OS como projeto', () => {
  const result = transform([order('os-1', 123)], [task(1, 'os-1')]);
  assert.equal(result.projects.length, 1);
  assert.equal(result.projects[0].projects[0].externalId, 123);
});

test('cliente com múltiplas OS permanece em uma única raiz', () => {
  const result = transform([order('os-1', 123), order('os-2', 456)], [task(1, 'os-1'), task(2, 'os-2')]);
  assert.equal(result.projects.length, 1);
  assert.equal(result.projects[0].projects.length, 2);
});

test('cliente pode possuir múltiplos tipos de serviço', () => {
  const result = transform([order('os-1', 123)], [
    task(1, 'os-1'),
    task(2, 'os-1', { type_code: 'RED', stage: 'Instalação' })
  ]);
  assert.deepEqual(result.projects[0].services.map((service) => service.typeCode), ['AUT', 'RED']);
});

test('tarefa classificada usa somente type_code e stage persistidos', () => {
  const result = transform([order('os-1', 123)], [task(1, 'os-1', { name: 'Texto sem prefixo' })]);
  const transformed = result.projects[0].services[0].stages[0].tasks[0];
  assert.equal(transformed.typeCode, 'AUT');
  assert.equal(transformed.stage, 'Infraestrutura');
  assert.equal(transformed.name, 'Texto sem prefixo');
});

test('tarefa não classificada não recebe fallback', () => {
  const result = transform([order('os-1', 123)], [task(1, 'os-1', {
    name: 'AUT | Infraestrutura | Texto sugestivo', type_code: null, stage: null
  })]);
  assert.equal(result.projects[0].services.length, 0);
  assert.equal(result.projects[0].unclassifiedTasks.length, 1);
  assert.equal(result.unclassifiedTaskCount, 1);
});

test('etapa sem tarefas não cria linha vazia', () => {
  const result = transform([order('os-1', 123)], [task(1, 'os-1')]);
  assert.deepEqual(result.projects[0].services[0].stages.map((stage) => stage.name), ['Infraestrutura']);
});

test('OS sem tarefas é preservada sem tarefas artificiais', () => {
  const result = transform([order('os-1', 123)], []);
  assert.equal(result.projects[0].projects.length, 1);
  assert.equal(result.projects[0].tasks.length, 0);
  assert.equal(result.projects[0].services.length, 0);
});

test('datas nulas são preservadas', () => {
  const result = transform([order('os-1', 123)], [task(1, 'os-1', {
    planned_on: null, started_on: null, ended_on: null
  })]);
  const transformed = result.tasks[0];
  assert.equal(transformed.plannedAt, null);
  assert.equal(transformed.startAt, null);
  assert.equal(transformed.endAt, null);
});

test('mais de uma tarefa pode ocupar a mesma etapa', () => {
  const result = transform([order('os-1', 123)], [task(1, 'os-1'), task(2, 'os-1')]);
  assert.equal(result.projects[0].services[0].stages[0].tasks.length, 2);
});

test('mais de uma OS pode ocupar o mesmo tipo sem perder o vínculo', () => {
  const result = transform([order('os-1', 123), order('os-2', 456)], [task(1, 'os-1'), task(2, 'os-2')]);
  const service = result.projects[0].services[0];
  assert.deepEqual(service.serviceOrderIds, ['os-1', 'os-2']);
  assert.deepEqual(service.serviceOrderExternalIds, [123, 456]);
  assert.deepEqual(service.tasks.map((item) => item.serviceOrderId), ['os-1', 'os-2']);
  assert.deepEqual(service.tasks.map((item) => item.serviceOrderExternalId), [123, 456]);
});

test('preserva IDs internos e externos da tarefa', () => {
  const result = transform([order('os-1', 123)], [task(77, 'os-1')]);
  assert.equal(result.tasks[0].id, 'task-uuid-77');
  assert.equal(result.tasks[0].externalId, 77);
});

test('ignora tarefas de OS que não pertencem à consulta de Projetos', () => {
  const result = transform([order('os-1', 123)], [task(1, 'outside-order')]);
  assert.equal(result.tasks.length, 0);
});

test('determina a sincronização mais recente sem criar datas artificiais', () => {
  assert.equal(maxIsoDate([null, 'inválida', '2026-08-18T10:00:00Z', '2026-08-19T09:00:00Z']), '2026-08-19T09:00:00Z');
  assert.equal(maxIsoDate([null, '']), null);
});

test('consulta as tabelas necessárias e filtra OS de Projeto Padrão', async () => {
  const calls = [];
  const rows = {
    service_orders: [order('os-1', 123)],
    tasks: [task(1, 'os-1')],
    service_types: serviceTypes,
    stages
  };
  const client = {
    from(table) {
      calls.push({ table, filters: [] });
      const call = calls.at(-1);
      const query = {
        select(columns) { call.columns = columns; return query; },
        eq(column, value) { call.filters.push([column, value]); return query; },
        order() { return query; },
        async range(from, to) { return { data: rows[table].slice(from, to + 1), error: null }; }
      };
      return query;
    }
  };
  const result = await queryProjectRecords(client);
  assert.equal(result.serviceOrders.length, 1);
  assert.deepEqual(calls.map((call) => call.table), ['service_orders', 'tasks', 'service_types', 'stages']);
  assert.ok(calls[0].columns.includes('client:clients!inner'));
  assert.deepEqual(calls[0].filters, [['occurrence', 'Projeto Padrão']]);
});

test('o transformador não contém fallback por categoria, regex ou nome', () => {
  const source = require('node:fs').readFileSync(require.resolve('../projects'), 'utf8');
  assert.doesNotMatch(source, /original_category|categoria|new RegExp|\.match\(|\.test\(/i);
  assert.doesNotMatch(source, /AUTO|REDES|AAT|AAC/);
});
