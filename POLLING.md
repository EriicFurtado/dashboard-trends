# Polling incremental Everflow → OpenAI → Supabase

1. Aplique `supabase/migrations/20260825_classification_polling.sql`.
2. Configure `OPENAI_API_KEY` somente no `.env` do backend e mantenha `DRY_RUN=true`.
3. Rode `npm run poll:everflow:once` e revise os eventos `classification_decision`.
4. Só após a aprovação, use `DRY_RUN=false` e inicie o processo separado com
   `npm run poll:everflow`. Ele roda imediatamente e depois a cada cinco minutos.

O polling mantém a paginação, usa o mês atual e os próximos meses, compara
`everflow_raw_hash` e só envia tarefas novas ou alteradas em lotes à OpenAI. A função
PostgreSQL `upsert_polled_task` aplica atomicamente a prioridade
`everflow_raw < llm_normalized < manual`, atualiza campos operacionais, grava
`classification_log` e envia normalizações inválidas a `migration_issues`.

Preencha os IDs Everflow em `supabase/mark_tasks_manual.sql` para proteger correções.

O Gantt lê o Supabase na carga e, enquanto a aba estiver visível, novamente a cada
cinco minutos. Não é necessário disparar evento pelo job nem habilitar Realtime.
