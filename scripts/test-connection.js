'use strict';

require('dotenv').config({ quiet: true });

const url = process.env.SUPABASE_URL?.trim().replace(/\/$/, '');
const key = process.env.SUPABASE_PUBLISHABLE_KEY?.trim();

function fail(message) {
  console.error(`Falha na conexão com o Supabase: ${message}`);
  process.exitCode = 1;
}

async function main() {
  if (!url || !key) {
    fail('preencha SUPABASE_URL e SUPABASE_PUBLISHABLE_KEY no arquivo .env.');
    return;
  }

  let response;
  try {
    response = await fetch(`${url}/rest/v1/service_orders?select=id&limit=1`, {
      headers: { apikey: key, Authorization: `Bearer ${key}` },
      signal: AbortSignal.timeout(10_000)
    });
  } catch (error) {
    fail(error.cause?.message || error.message);
    return;
  }

  if (!response.ok) {
    const details = (await response.text()).slice(0, 300);
    fail(`HTTP ${response.status} ${response.statusText}${details ? ` — ${details}` : ''}`);
    return;
  }

  console.log('Conectado com sucesso ao Supabase (tabela service_orders acessível).');
}

main();
