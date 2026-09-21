# Débitos Técnicos — Wholehearted.stats

Registro de débitos técnicos e melhorias arquiteturais pendentes de implementação.

---

### [DEBT-001] Auto-gerenciamento do Ciclo de Vida de Sync (Spotify 403 / Revogação de Token)

- **Status:** Pendente
- **Severidade:** Média (gera ruído em logs e consumo desnecessário de worker em produção)
- **Plano arquitetural detalhado:** [`docs/plans/sync-self-healing.md`](./plans/sync-self-healing.md)

#### Contexto e Sintoma
Quando um usuário do Spotify é removido manualmente da lista de testes (*User Management*) no Spotify Developer Dashboard ou quando o usuário revoga os acessos do aplicativo em sua conta Spotify, o worker do BullMQ (`SyncProcessor`) recebe **HTTP 403 Forbidden** (`The user is not registered for this application...`) ou **HTTP 400/401** (`invalid_grant`).

Atualmente, o processador relança o erro (`throw err`), ativando a política de retry imediato do BullMQ (`attempts: 2`) e repetindo o ciclo a cada 3 minutos indefinidamente através do `JobScheduler`.

#### Causa Raiz
1. O sistema não distingue **erros transitórios** (429 rate limit, 5xx instabilidade) de **erros terminais** (403 conta não permitida, 401 refresh token revogado).
2. A entidade `User` não possui campos de estado de ingestão (`syncStatus: 'ACTIVE' | 'SUSPENDED'`), e a rotina de boot (`SyncService.onModuleInit`) registra agendamentos cegamente para todos os usuários existentes no banco.

#### Solução Planejada (quando for retomado)
1. **Schema:** Adicionar colunas `syncStatus` (`'ACTIVE' | 'SUSPENDED'`, default `'ACTIVE'`) e `syncSuspendedReason` (nullable) na tabela `users` (via TypeORM + DDL manual no Neon).
2. **Exceções de Domínio:** Criar `SpotifyUserNotRegisteredException` e `SpotifyTokenRevokedException` para mapear erros terminais no `SpotifyService`.
3. **Self-Healing no Worker:** No `SyncProcessor`, ao capturar essas exceções terminais:
   - Suspender o usuário no banco (`syncStatus = 'SUSPENDED'`).
   - Chamar `syncService.unregisterSyncForUser(userId)` para remover o scheduler do BullMQ imediatamente.
   - Encerrar o job graciosamente sem `throw` (sem retries inúteis).
4. **Proteção no Boot:** `SyncService.onModuleInit` filtra apenas `where: { syncStatus: 'ACTIVE' }`.
5. **Reativação Transparente:** Ao logar novamente via OAuth (`AuthService.upsertUser`), restaurar para `ACTIVE` e restabelecer o scheduler.
