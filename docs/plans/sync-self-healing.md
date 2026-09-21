# Plano de Implementação: Auto-Gerenciamento e Resiliência de Sync (Spotify 403 / Revogação)

## Contexto e Motivação
Em ambiente de produção, quando um usuário é desregistrado do painel do Spotify Developer (Modo de Desenvolvimento) ou quando o usuário revoga o acesso da aplicação em sua conta Spotify, as chamadas subsequentes do worker do BullMQ (`SyncProcessor`) falham com status **HTTP 403 Forbidden** (`The user is not registered for this application...`) ou **HTTP 401/400** (`invalid_grant`).

Atualmente, o sistema trata essas falhas permanentes da mesma forma que falhas transitórias: relança o erro (`throw err`), consumindo retries imediatos e repetindo a tentativa indefinidamente a cada 3 minutos via `JobScheduler`. Isso gera:
1. Ruído excessivo na observabilidade e logs de erro de produção a cada 3 minutos.
2. Desperdício de recursos de processamento e conexões de rede chamando o Spotify com credenciais sabidamente inválidas.
3. Necessidade de intervenção manual no banco e no Redis para remover o usuário.

## Objetivos
1. **Modelagem de Estado de Sync**: Registrar na entidade `User` se a ingestão contínua está ativa ou suspensa, preservando o histórico de scrobbles e perfil público.
2. **Exceções de Domínio Tipadas**: Identificar no `SpotifyService` erros terminais de autorização/registro e mapeá-los para classes de erro explícitas (`SpotifyUserNotRegisteredException`, `SpotifyTokenRevokedException`).
3. **Auto-Desativação no Worker (Self-Healing)**: Suspender o usuário no banco de dados e remover o scheduler no BullMQ imediatamente ao encontrar um erro terminal, sem `throw` (evitando retry imediato inútil).
4. **Proteção no Boot da Aplicação**: Ajustar `SyncService.onModuleInit` para registrar schedulers exclusivamente para usuários com `syncStatus: 'ACTIVE'`.
5. **Reativação no Login OAuth**: Reativar automaticamente o status do usuário e recriar o agendador no BullMQ quando o usuário fizer login com sucesso novamente via `AuthService`.
6. **Cobertura de Testes**: Garantir testes unitários rigorosos para as exceções, o worker e o serviço de agendamento.

---

## Fases de Execução

### Fase 1: Schema e Entidade TypeORM (`User`)
- Adicionar os campos na entidade `User`:
  - `syncStatus: 'ACTIVE' | 'SUSPENDED'` (coluna `varchar(20)`, default `'ACTIVE'`).
  - `syncSuspendedReason: string | null` (coluna `varchar(100)`, nullable `true`).
- **Validação isolada**: Testes existentes continuam passando; aplicação sobe e TypeORM sincroniza a coluna sem quebrar dados existentes.

### Fase 2: Exceções de Domínio e Detecção na Camada Spotify
- Criar `SpotifyUserNotRegisteredException` e `SpotifyTokenRevokedException` em `src/spotify/spotify.exceptions.ts`.
- No `SpotifyService.get`: capturar erros Axios `403` com body `"The user is not registered for this application"` e lançar `SpotifyUserNotRegisteredException`.
- No `AuthService.refreshAccessToken` / `SpotifyService`: capturar erros de refresh com `invalid_grant` e mapear para `SpotifyTokenRevokedException`.
- **Validação isolada**: Testes unitários do `SpotifyService` cobrindo o lançamento das exceções específicas em cenários de 403 e token revogado.

### Fase 3: Gerenciamento do Scheduler no `SyncService`
- Criar o método `unregisterSyncForUser(userId: string): Promise<void>` no `SyncService` para encapsular a remoção de `recently-played-sync:${userId}` no BullMQ.
- Atualizar `SyncService.onModuleInit` para filtrar apenas usuários com `syncStatus: 'ACTIVE'`.
- **Validação isolada**: Testes unitários em `sync.service.spec.ts` cobrindo registro, desregistro e filtragem de usuários no boot.

### Fase 4: Integração do Worker (`SyncProcessor`) e Reativação (`AuthService`)
- No `SyncProcessor.process`:
  - Capturar `SpotifyUserNotRegisteredException` e `SpotifyTokenRevokedException`.
  - Executar auto-suspensão:
    - Atualizar `User` no banco para `syncStatus: 'SUSPENDED'` e motivo correspondente (`'SPOTIFY_USER_NOT_REGISTERED'` ou `'SPOTIFY_TOKEN_REVOKED'`).
    - Chamar `syncService.unregisterSyncForUser(userId)`.
    - Logar em nível `WARN` estruturado (não `ERROR`).
    - Finalizar o job sem relançar o erro (`throw`), evitando retry inútil do BullMQ.
- No `AuthService.upsertUser`:
  - Resetar `syncStatus = 'ACTIVE'` e `syncSuspendedReason = null` ao autenticar novamente.
- **Validação isolada**: Testes unitários em `sync.processor.spec.ts` validando a captura do erro, persistência e desregistro do scheduler.

### Fase 5: Verificação de Ponta a Ponta e Documentação
- Rodar toda a suite de testes (`npm test`).
- Atualizar o `README.md` na seção de Decisões de Arquitetura documentando a estratégia de self-healing e classificação de erros de fila.
