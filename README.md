# Dashboard Trends

Dashboard web para acompanhamento de ordens de serviço, tarefas e projetos com dados do Supabase.

## Pré-requisitos

- Git
- Node.js 18 ou superior
- npm
- Projeto Supabase configurado com `supabase/schema.sql`

## Setup local

```bash
git clone https://github.com/EriicFurtado/dashboard-trends.git
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

## Passo a passo para testar o polling em outra máquina

Este fluxo deve começar sempre em modo seguro. Não altere `DRY_RUN` para `false` antes de conferir um ciclo completo.

### 1. Baixar o projeto e instalar as dependências

```powershell
git clone https://github.com/EriicFurtado/dashboard-trends.git
Set-Location dashboard-trends
npm.cmd ci
Copy-Item .env.example .env
```

Se o repositório já estiver clonado, use `git pull` na branch combinada e depois execute `npm.cmd ci`. O arquivo `.env` é local e não deve ser enviado ao Git.

### 2. Preencher o `.env`

Abra o `.env` e substitua somente os placeholders:

```dotenv
SUPABASE_URL=https://seu-projeto.supabase.co
SUPABASE_PUBLISHABLE_KEY=sb_publishable_sua-chave-publica
SUPABASE_SECRET_KEY=sb_secret_sua-chave-de-servidor
EVERFLOW_TOKEN=seu-token-everflow
OPENAI_API_KEY=sk-sua-chave-openai

DRY_RUN=true
OPENAI_MODEL=gpt-4.1-mini
LLM_BATCH_SIZE=25
EVERFLOW_WINDOW_MONTHS=6
```

**PEDIR AO LUÍS AS CREDENCIAIS**

- `SUPABASE_PUBLISHABLE_KEY` pode ser usada pelo navegador.
- `SUPABASE_SECRET_KEY`, `EVERFLOW_TOKEN` e `OPENAI_API_KEY` são segredos de backend.
- Nunca copie esses três segredos para JavaScript carregado pelo navegador.
- Confirme que `DRY_RUN=true` antes do primeiro teste.

### 3. Preparar o Supabase

No SQL Editor do Supabase:

- Em um projeto novo, aplique primeiro `supabase/schema.sql`.
- Aplique, na ordem, as migrations de `supabase/migrations/` que ainda não existem nesse banco.
- Para este polling, confirme a aplicação de `20260825_classification_polling.sql`.
- Não aplique o arquivo `.down.sql`; ele existe apenas para rollback.

Se a migration estiver ausente, o polling indicará que colunas como
`classification_source` ou `everflow_raw_hash` não existem.

### 4. Validar configuração e testes locais

```powershell
npm.cmd run test:connection
npm.cmd test
```

Todos os testes devem passar antes de consultar o Everflow.

### 5. Executar um dry-run completo

```powershell
npm.cmd run poll:everflow:once 2>&1 |
  Tee-Object -FilePath logs\poll-everflow-dry-run.log
```

No final, procure por `poll_completed` e confira:

- `dry_run` deve ser `true`;
- `tasks_new_or_changed` mostra quantas tarefas seriam processadas;
- cada `classification_decision` mostra dados brutos, normalização, validação e decisão de prioridade;
- `would_write_classification` informa se a classificação seria gravada;
- resultados com `discarded_validation` mantêm a classificação anterior.

Se aparecer `poll_failed`, não habilite escrita. Resolva o erro e repita o dry-run.

### 6. Marcar correções humanas como manuais

Antes do primeiro ciclo com escrita, abra `supabase/mark_tasks_manual.sql`, coloque os IDs externos das tarefas corrigidas no array e execute o SQL no Supabase. Linhas `manual` nunca são sobrescritas pelo polling ou pelo sync histórico.

### 7. Fazer um único ciclo com escrita

Somente após aprovar o dry-run, altere no `.env`:

```dotenv
DRY_RUN=false
```

Execute uma vez:

```powershell
npm.cmd run poll:everflow:once
```

Confira no Supabase as tabelas `tasks`, `classification_log` e
`migration_issues`. Rode o comando uma segunda vez: sem mudanças no Everflow, o
resultado esperado é `tasks_new_or_changed: 0`.

### 8. Iniciar a recorrência de cinco minutos

```powershell
npm.cmd run poll:everflow
```

Esse comando mantém um processo separado do `server.js`, executa um ciclo imediato e repete a cada cinco minutos. Mantenha o terminal/processo ativo. Em produção, configure o mesmo comando em um gerenciador de processos ou no Agendador de Tarefas do Windows para reiniciar após logout ou reboot.

Para interromper uma execução iniciada no terminal, pressione `Ctrl+C`.

### 9. Conferir o Gantt

Inicie o dashboard com `npm.cmd run dev` e abra <http://localhost:8000>. O Gantt consulta o Supabase na carga e atualiza novamente a cada cinco minutos enquanto a aba estiver visível. Não é necessário disparar um evento manual.

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
