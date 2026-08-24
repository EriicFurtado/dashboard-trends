# Dashboard Trends

Dashboard web para acompanhamento de ordens de serviço, tarefas e projetos com dados do Supabase.

## Pré-requisitos

- Git
- Node.js 18 ou superior
- npm (incluído com o Node.js)
- Um projeto Supabase com o schema de `supabase/schema.sql` e as políticas de `supabase/rls.sql`
- A URL e a chave publicável (`publishable`/`anon`) desse projeto

Nunca coloque uma chave secreta ou `service_role` no frontend ou em arquivos versionados.

## Setup local

```bash
git clone <URL-DO-REPOSITORIO>
cd dashboard-trends
npm ci
```

Copie o arquivo de exemplo para `.env`:

```bash
# macOS/Linux
cp .env.example .env

# Windows PowerShell
Copy-Item .env.example .env
```

Edite `.env` e substitua os placeholders:

```dotenv
SUPABASE_URL=https://perguntar_para_o_luís
SUPABASE_PUBLISHABLE_KEY=perguntar_para_o_luis
```

Inicie o projeto com um único comando:

```bash
npm run dev
```

Abra [http://localhost:8000](http://localhost:8000). O servidor gera a configuração pública do navegador a partir do `.env`; não edite `supabase.js` com credenciais.

## Testar a conexão com o Supabase

Com o `.env` preenchido, execute:

```bash
npm run test:connection
```

O resultado esperado é:

```text
Conectado com sucesso ao Supabase (tabela service_orders acessível).
```

Se o teste falhar, confira a URL, a chave publicável, a existência da tabela `service_orders` e as políticas de leitura (RLS).

## Testes locais

```bash
npm test
```

## Estrutura essencial

- `Dashboard_Interativo_OS.html`, `styles.css` e `script.js`: interface principal
- `projects.js`: consultas e transformação dos dados de projetos
- `supabase.js`: criação do cliente Supabase no navegador
- `server.js`: servidor local e injeção segura da configuração pública
- `supabase/`: schema e políticas RLS necessários para preparar o banco
- `tests/`: testes automatizados

## Variáveis de ambiente

| Variável | Obrigatória | Uso |
| --- | --- | --- |
| `SUPABASE_URL` | Sim | URL pública do projeto Supabase |
| `SUPABASE_PUBLISHABLE_KEY` | Sim | Chave pública usada pelo navegador e pelo teste de conexão |
| `PORT` | Não | Porta do servidor local; padrão `8000` |

O `.env` é ignorado pelo Git. Somente `.env.example`, com placeholders, deve ser versionado.
