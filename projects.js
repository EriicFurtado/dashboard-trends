'use strict';

(function exposeProjectData(global, factory) {
  const api = factory();
  if(typeof module !== 'undefined' && module.exports) module.exports = api;
  if(global) global.ProjectData = api;
})(typeof window !== 'undefined' ? window : globalThis, function projectDataFactory() {
  const PAGE_SIZE = 1000;

  function maxIsoDate(values) {
    const valid = values.filter((value) => typeof value === 'string' && !Number.isNaN(Date.parse(value)));
    return valid.length ? valid.sort().at(-1) : null;
  }

  const EVERFLOW_TO_GANTT_STATUS = Object.freeze({
    agendado: 'Planejada',
    agendada: 'Planejada',
    planejada: 'Planejada',
    'em servico': 'Andamento',
    'em execucao': 'Andamento',
    pausado: 'Bloqueado',
    pause: 'Bloqueado',
    pausa: 'Bloqueado',
    impedida: 'Bloqueado',
    finalizada: 'Finalizado'
  });

  function normalizeStatus(value) { return String(value || '').trim().normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()}

  function statusDate(value) {
    if(!value) return null;
    const date = value instanceof Date ? new Date(value) : new Date(String(value).slice(0,10) + 'T12:00:00');
    return Number.isNaN(date.getTime()) ? null : date;
  }

  function mapEverflowStatus(status, plannedEnd, currentDate = new Date()) {
    const normalized = normalizeStatus(status);
    if(normalized === 'cancelada') return null;

    const mapped = EVERFLOW_TO_GANTT_STATUS[normalized] || 'Planejada';
    if(mapped === 'Finalizado') return mapped;

    const deadline = statusDate(plannedEnd);
    const today = statusDate(currentDate);
    if(deadline && today) {
      deadline.setHours(12,0,0,0);
      today.setHours(12,0,0,0);
      if(deadline < today) return 'Atrasada';
    }
    return mapped;
  }

  async function fetchAll(createQuery) {
    const rows = [];
    for(let from = 0; ; from += PAGE_SIZE) {
      const {data, error} = await createQuery().range(from, from + PAGE_SIZE - 1);
      if(error) throw error;
      rows.push(...(data || []));
      if(!data || data.length < PAGE_SIZE) return rows;
    }
  }

  async function queryProjectRecords(client) {
    if (!client || typeof client.from !== 'function') throw new TypeError('Cliente Supabase inválido.');

    const [serviceOrders, tasks, serviceTypes, stages] = await Promise.all([
      fetchAll(() => client
        .from('service_orders')
        // occurrence is filtered by RLS (lower(btrim(occurrence)) = lower('Projeto Padrão')),
        // not here, so that case/accent/whitespace variants are matched the same way everywhere.
        .select('id,external_id,client_id,occurrence,operational_service_type,deadline_level,status,registered_on,planned_start_on,planned_end_on,updated_at,client:clients!inner(id,name,updated_at)')
        .order('external_id', { ascending: true })),
      fetchAll(() => client
        .from('tasks')
        .select('id,external_id,service_order_id,name,type_code,stage,status,planned_on,started_on,ended_on,technician,updated_at')
        .order('external_id', { ascending: true })),
      fetchAll(() => client
        .from('service_types')
        .select('code,name,sort_order')
        .order('sort_order', { ascending: true })),
      fetchAll(() => client
        .from('stages')
        .select('name,sort_order')
        .order('sort_order', { ascending: true }))
    ]);

    return { serviceOrders, tasks, serviceTypes, stages };
  }

  function transformProjectRecords({ serviceOrders = [], tasks = [], serviceTypes = [], stages = [] }) {
    const typeByCode = new Map(serviceTypes.map((type) => [type.code, type]));
    const stageByName = new Map(stages.map((stage) => [stage.name, stage]));
    const orderById = new Map(serviceOrders.map((order) => [order.id, order]));
    const clientById = new Map();
    const transformedTasks = [];

    for (const order of serviceOrders) {
      if (!order.client || order.client.id !== order.client_id) continue;
      if (!clientById.has(order.client_id)) {
        clientById.set(order.client_id, {
          id: order.client_id,
          client: order.client.name,
          projects: [],
          tasks: [],
          unclassifiedTasks: [],
          services: []
        });
      }
      clientById.get(order.client_id).projects.push({
        id: order.id,
        externalId: order.external_id,
        clientId: order.client_id,
        client: order.client.name,
        occurrence: order.occurrence,
        operationalServiceType: order.operational_service_type,
        deadlineLevel: order.deadline_level,
        status: order.status,
        registeredOn: order.registered_on,
        plannedStartOn: order.planned_start_on,
        plannedEndOn: order.planned_end_on,
        updatedAt: order.updated_at
      });
    }

    for (const task of tasks) {
      const order = orderById.get(task.service_order_id);
      if (!order || !clientById.has(order.client_id)) continue;
      const transformed = {
        id: task.id,
        externalId: task.external_id,
        name: task.name,
        typeCode: task.type_code,
        stage: task.stage,
        status: task.status,
        plannedAt: task.planned_on,
        startAt: task.started_on,
        endAt: task.ended_on,
        technician: task.technician,
        serviceOrderId: order.id,
        serviceOrderExternalId: order.external_id,
        orderPlannedStartOn: order.planned_start_on,
        orderPlannedEndOn: order.planned_end_on,
        updatedAt: task.updated_at,
        ganttStatus: null
      };
      // The Gantt status must use the same effective deadline as the rendered
      // bar: the task date first, then the service-order deadline as fallback.
      transformed.ganttStatus = mapEverflowStatus(
        transformed.status,
        transformed.endAt || transformed.plannedAt || transformed.orderPlannedEndOn
      );
      const client = clientById.get(order.client_id);
      client.tasks.push(transformed);
      transformedTasks.push(transformed);

      if (!task.type_code || !task.stage || !typeByCode.has(task.type_code) || !stageByName.has(task.stage)) {
        client.unclassifiedTasks.push(transformed);
      }
    }

    for (const client of clientById.values()) {
      client.services = serviceTypes.map((type) => {

        const serviceTasks = client.tasks.filter((task) => task.typeCode === type.code && stageByName.has(task.stage));
        return {
          typeCode: type.code,
          typeName: type.name,
          serviceOrderIds: [...new Set(serviceTasks.map((task) => task.serviceOrderId))],
          serviceOrderExternalIds: [...new Set(serviceTasks.map((task) => task.serviceOrderExternalId))]
            .sort((a, b) => a - b),
          tasks: serviceTasks,
          stages: stages.map((stage) => ({
            name: stage.name,
            tasks: serviceTasks.filter((task) => task.stage === stage.name)
          })).filter((stage) => stage.tasks.length > 0)
        };
      }).filter((service) => service.tasks.length > 0);
      client.projects.sort((a, b) => a.externalId - b.externalId);
    }

    const projects = [...clientById.values()].sort((a, b) => a.client.localeCompare(b.client, 'pt-BR'));
    const updatedAt = maxIsoDate([
      ...serviceOrders.map((order) => order.updated_at),
      ...tasks.map((task) => task.updated_at),
      ...serviceOrders.map((order) => order.client && order.client.updated_at)
    ]);

    return {
      projects,
      tasks: transformedTasks,
      unclassifiedTaskCount: projects.reduce((sum, client) => sum + client.unclassifiedTasks.length, 0),
      updatedAt
    };
  }

  async function loadProjects(client) {
    return transformProjectRecords(await queryProjectRecords(client));
  }

  return { loadProjects, queryProjectRecords, transformProjectRecords, maxIsoDate, mapEverflowStatus };
});
