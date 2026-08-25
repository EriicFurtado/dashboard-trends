# Dashboard Trends

Dashboard web para acompanhamento de ordens de serviço, tarefas e projetos com dados do Supabase.

## Pré-requisitos

- Git
- Node.js 18 ou superior
- npm
- Projeto Supabase configurado com `supabase/schema.sql`

## Setup local

```bash
git clone <URL-DO-REPOSITORIO>
cd dashboard-trends
npm ci
cp .env.example .env
```

No Windows PowerShell, use `Copy-Item .env.example .env`. Preencha o `.env`:

```dotenv
SUPABASE_URL=https://seu-projeto.supabase.co
SUPABASE_PUBLISHABLE_KEY=sb_publishable_sua-chave-aqui
SUPABASE_SECRET_KEY=sb_secret_sua-chave-de-servidor-aqui
EVERFLOW_TOKEN=seu-token-everflow-aqui
```

Nunca exponha `SUPABASE_SECRET_KEY` ou `EVERFLOW_TOKEN` no navegador ou no Git.

## Rodar o frontend

```bash
npm run dev
```

Abra <http://localhost:8000>.

## Testar conexão

```bash
npm run test:connection
```

## Sincronizar Everflow → Supabase

Aplique `supabase/schema.sql` e depois `supabase/migrations/20260824_allow_duplicate_client_names.sql` no Supabase. Em seguida execute:

```bash
npm run sync:everflow
```

O sincronizador busca as OS desde janeiro de 2024, pagina os resultados, consulta tarefas relacionadas via `IdsOrdensServico`, normaliza nomes no formato `TIPO|ETAPA|NOME` e faz upsert idempotente em `clients`, `service_orders`, `tasks` e `migration_issues`.

Para o pulling recorrente do mês atual até seis meses à frente, agende externamente a cada 15 minutos:

```bash
npm run sync:everflow:window
```

Esse modo filtra por `DataPrevistaInicioMaiorOuIgualA` e `DataPrevistaInicioMenorOuIgualA`. O agendador pode ser o n8n, Task Scheduler do Windows, cron ou outro serviço; o script não mantém um processo permanente.

## Testes

```bash
npm test
```

## Variáveis de ambiente

| Variável | Obrigatória | Uso |
| --- | --- | --- |
| `SUPABASE_URL` | Sim | URL do projeto Supabase |
| `SUPABASE_PUBLISHABLE_KEY` | Sim para o frontend | Chave pública do navegador |
| `SUPABASE_SECRET_KEY` | Sim para sincronização | Chave server-side para escrita |
| `EVERFLOW_TOKEN` | Sim para sincronização | Token da API Flow/Everflow |
| `PORT` | Não | Porta local; padrão `8000` |

O `.env` é ignorado pelo Git; somente `.env.example` com placeholders deve ser versionado.
