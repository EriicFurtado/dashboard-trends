'use strict';

const DEFAULT_MODEL = process.env.OPENAI_MODEL || 'gpt-4.1-mini';

function taskSchema() {
  const nullableString = { type: ['string', 'null'] };
  return {
    type: 'object', additionalProperties: false, required: ['tasks'],
    properties: {
      tasks: {
        type: 'array',
        items: {
          type: 'object', additionalProperties: false,
          required: ['external_id', 'type_code', 'stage', 'original_category', 'occurrence', 'management_type'],
          properties: {
            external_id: { type: 'integer' }, type_code: nullableString, stage: nullableString,
            original_category: nullableString, occurrence: nullableString, management_type: nullableString
          }
        }
      }
    }
  };
}

async function normalizeWithLlm(rawTasks, { stages, apiKey = process.env.OPENAI_API_KEY, model = DEFAULT_MODEL, fetchImpl = fetch } = {}) {
  if (!rawTasks.length) return [];
  if (!apiKey?.trim()) throw new Error('OPENAI_API_KEY ausente; nenhuma tarefa pode ser normalizada.');
  const input = rawTasks.map((task) => ({
    external_id: Number(task.external_id), title: task.title, description: task.description,
    everflow_category: task.original_category, occurrence: task.occurrence,
    management_type: task.management_type
  }));
  const response = await fetchImpl('https://api.openai.com/v1/responses', {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey.trim()}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model,
      instructions: `Normalize Everflow tasks. type_code must be AUT, RED, SEG, AAV, FIN, ONB, VTE or null. stage must be exactly one of: ${stages.join('; ')} or null. Do not invent source facts; use null when uncertain. Preserve semantic wording for original_category, occurrence, and management_type. Return exactly one result per external_id.`,
      input: JSON.stringify(input),
      text: { format: { type: 'json_schema', name: 'normalized_everflow_tasks', strict: true, schema: taskSchema() } }
    })
  });
  const body = await response.json();
  if (!response.ok) throw new Error(`OpenAI Responses API falhou (${response.status}): ${JSON.stringify(body).slice(0, 500)}`);
  const outputText = body.output_text || body.output?.flatMap((item) => item.content || []).find((item) => item.type === 'output_text')?.text;
  if (!outputText) throw new Error('OpenAI Responses API não retornou output_text estruturado.');
  return JSON.parse(outputText).tasks;
}

module.exports = { normalizeWithLlm, taskSchema };
