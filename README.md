# 🎵 Wholehearted.stats — API

Backend do Wholehearted.stats, um sistema de scrobbling pessoal multi-tenant construído sobre a Spotify Web API. Registra automaticamente cada música ouvida, isola dados por usuário e expõe endpoints de estatísticas agregadas.

**Produção:** https://spotify-lastfm-api-production.up.railway.app

## O que é isso

O Last.fm rastreia sua escuta via scrobbling — cada música tocada é registrada com timestamp. O Wholehearted.stats faz o mesmo, mas com infraestrutura própria: você controla os dados, a agregação e a visualização.

A API autentica com o Spotify via OAuth 2.0 + PKCE, armazena tokens criptografados em repouso e roda jobs em background por usuário que consultam o histórico de escuta a cada 5 minutos, persistindo apenas o que é novo.

### Sobre o acesso

O sistema suporta múltiplos usuários — cada um autentica com sua própria conta Spotify e tem seus dados completamente isolados. Perfis públicos são acessíveis sem login em `/u/[slug]`.

⚠️ O app está em Development Mode no Spotify (limite de 5 usuários). Para testar, entre em contato.

---

## Arquitetura

```
┌─────────────────────────────────────────────────────┐
│                    Railway (produção)                │
│                                                     │
│  ┌─────────────┐    ┌──────────────┐               │
│  │  NestJS API  │    │  BullMQ      │               │
│  │  (HTTP)      │    │  Workers     │               │
│  └──────┬──────┘    └──────┬───────┘               │
│         │                  │                        │
│         ▼                  ▼                        │
│  ┌─────────────────────────────────┐               │
│  │     Railway Redis (Dedicado)    │               │
│  └─────────────────────────────────┘               │
│                                                     │
│  ┌─────────────────────────────────┐               │
│  │          Neon (PostgreSQL)       │               │
│  └─────────────────────────────────┘               │
└─────────────────────────────────────────────────────┘
          ▲                    ▲
          │                    │
   Spotify Web API      Frontend (Vercel)
```

### Fluxo do sync por usuário

1. Login OAuth completa
2. Job BullMQ registrado para esse `userId`
3. A cada 3min: `GET /me/player/recently-played`
4. Compara com cursor (último scrobble salvo)
5. Persiste apenas músicas novas com `userId`
6. Dorme 3 minutos → repete indefinidamente

### Isolamento de dados

- **users** → um registro por conta Spotify
- **scrobbles** → `user_id` em toda linha — queries sempre filtradas
- **stats** → agregações por `userId` — zero vazamento entre usuários
- **public routes** → acesso por slug sem autenticação

---

## Stack

| Camada | Tecnologia | Decisão |
|--------|-----------|---------|
| Framework | NestJS + TypeScript | Modularização, DI nativa, decorators |
| Banco de dados | PostgreSQL (Neon) | ACID, queries complexas de agregação |
| Filas | BullMQ + Redis (Railway) | Jobs persistentes, retry automático, rede privada sem limite de comandos |
| Auth | OAuth 2.0 + PKCE + JWT | Sem client_secret exposto, sessão stateless |
| Criptografia | AES-256-GCM | Tokens em repouso nunca em texto puro |
| Deploy | Railway | Processo contínuo — BullMQ não funciona em serverless |
| Testes | Jest | Unit tests com mocks tipados |
| Logging | Pino + nestjs-pino | Structured logging em production |

---

## Módulos

### AuthModule
OAuth Authorization Code + PKCE completo. O state anti-CSRF e o codeVerifier do PKCE são armazenados temporariamente no Redis (TTL 5min) em vez de cookies — solução para o problema de SameSite em contexto cross-origin em produção. Após o callback, gera JWT com `userId` e `slug` e seta cookie httpOnly. Em caso de recusa de permissão (`access_denied`) ou falhas no handshake, redireciona para a rota `/auth/restricted` do frontend.

### SpotifyModule
Client wrapper — único ponto de contato com a Spotify API. Gerencia refresh automático do access_token com buffer de 60 segundos antes da expiração, retry automático respeitando o header `Retry-After` em caso de rate limit 429, e descriptografia de tokens em memória (nunca persistidos em texto puro).

### SyncModule
Um job BullMQ repetível por usuário, registrado no momento do login. Usa o timestamp do scrobble mais recente como cursor para o parâmetro `after`, garantindo que apenas músicas novas sejam processadas. Dedup por índice único `(track_spotify_id, played_at, user_id)` — duas camadas de proteção contra duplicata.

### StatsModule
Endpoints de agregação protegidos por `AuthGuard`. `userId` extraído do JWT — sem query ao banco por request. QueryBuilder TypeORM com `GROUP BY`, `COUNT`, `EXTRACT`, `DATE_TRUNC` e timezone de São Paulo.

### PublicModule
Rotas sem autenticação para perfis públicos por slug. Usadas pelo Next.js no servidor para gerar Open Graph e pelo ProfileDashboard client-side.

### LoggerModule
Structured logging com Pino (`nestjs-pino`). Dual transport: pretty-print colorido em dev e JSON estruturado em produção (capturado diretamente pelo stdout da Railway e replicado em arquivo local). Suporta configuração dinâmica de nível via `LOG_LEVEL` (padrão: `debug` em dev e `info` em prod).

Principais integrações monitoradas:
- **Spotify Web API**: Medição de latência (`durationMs`), auto-refresh de tokens em repouso, logs de retry em caso de Rate Limit (429) e captura de erros HTTP com detalhes da resposta do Spotify.
- **Sync Processor (BullMQ)**: Métricas completas de cada ciclo de sincronização (faixas novas vs. inseridas, `jobId`, usuário mascarado e tempo de execução), além de tolerância a falhas na invalidação de cache.
- **OAuth & Auth**: Registro de novos usuários vs. atualização de sessões, detecção de divergência de `state` (anti-CSRF) ou expiração do `code_verifier` no Redis.
- **Cache & Redis**: Listeners de ciclo de vida (`connect`, `error`, `reconnecting`), observabilidade de `Cache HIT` e `Cache MISS` (em nível `debug`) e fallback suave (*graceful degradation*) caso o Redis oscile.
- **Criptografia AES-256-GCM**: Alertas estruturados em caso de falha de decifração por dados corrompidos ou rotação de chaves.

---

## Decisões de arquitetura

### Por que BullMQ em vez de setInterval?
`setInterval` vive na memória do processo — se o servidor reiniciar, o timer some. BullMQ persiste os jobs no Redis: o estado da fila sobrevive a restarts, tem histórico de execuções, retry automático em falha e suporte nativo a jobs por usuário com payload tipado.

### Por que PKCE sem client_secret?
O `client_secret` não pode ser exposto em repositório ou variável pública. O PKCE substitui o secret por um `codeVerifier` gerado localmente — o Spotify valida o hash SHA-256 no callback sem precisar do secret no fluxo. Mais seguro e adequado para apps que não conseguem guardar secrets com segurança.

### Por que Redis para o state OAuth em vez de cookies?
Cookies `SameSite: 'none'` são bloqueados por browsers em aba anônima e em contextos third-party. O Redis elimina essa dependência — o state e o codeVerifier ficam no servidor, não no browser.

### Por que desnormalizar a tabela scrobbles?
Queries de agregação (top tracks, top artists, activity by hour) com joins em tabelas normalizadas são mais lentas e complexas. Com dados de faixa e artista na própria linha do scrobble, as queries usam `GROUP BY` direto — sem joins, com índices eficientes.

### Por que Lazy Backfill para foto de perfil do Spotify?
A foto do perfil é capturada inicialmente no momento do login OAuth. No entanto, para suportar usuários existentes no banco sem exigir que façam logout/login, o `SyncProcessor` implementa um lazy backfill idempotente: se `avatarUrl` for nulo, busca a imagem via `GET /v1/me`, persiste e invalida o cache. Usuários com avatar já preenchido pulam a chamada, garantindo custo contínuo de rate limit estritamente zero para os ciclos periódicos. O tratamento de erro é não-bloqueante (falhas pontuais na API do Spotify não impedem a ingestão de scrobbles).

### Preparação para multi-tenant sem reescrever
Todo método do `StatsService` recebe `userId` como primeiro parâmetro desde o início. O `AuthGuard` extrai o `userId` do JWT — sem query ao banco por request. Quando um novo usuário faz login, um job BullMQ é registrado especificamente para ele. A mudança para multi-tenant completo foi cirúrgica: dois arquivos alterados, nenhuma regra de negócio reescrita.

### Decisão de Infraestrutura: Migração do Upstash para Redis Dedicado (Railway)
Inicialmente, o projeto utilizou o Upstash Redis (Serverless). No entanto, o BullMQ opera via polling de marcadores (`BZPOPMIN`), agendamento de jobs futuros e execução contínua de scripts Lua compilados (`moveToActive.lua`). No modelo do Upstash:
1. Cada subcomando invocado dentro de scripts Lua (`ZRANGEBYSCORE`, `HMGET`, `RPOPLPUSH`, etc.) é bilhetado individualmente.
2. A presença de jobs agendados recorrentes ativa a trava interna `maximumBlockTimeout = 10` do BullMQ, gerando uma taxa contínua de ~1,2 a 1,5 comandos/segundo (~109.000 comandos/dia mesmo com o backend ocioso), o que esgotaria a cota mensal gratuita de 500k comandos em 4 a 5 dias.
3. Tentativas de amenizar o tráfego aumentando `stalledInterval` para 10 minutos fragilizavam a resiliência operacional em caso de falhas de workers.

**Decisão:** Migração para uma instância dedicada de Redis hospedada no próprio Railway, dentro da mesma rede privada (`redis.railway.internal`). Como o faturamento no Railway é baseado em recursos (RAM/CPU) e não em contagem de requisições, o BullMQ pôde ser restaurado aos seus parâmetros ideais de engenharia (`stalledInterval: 30000`, `drainDelay: 5`), com latência de rede próxima de zero e sem risco de exaustão de cota.

### Falha Suave de Cache (Graceful Degradation)
O cache no Redis nunca atua como ponto único de falha (*Single Point of Failure*). As rotas públicas e o worker de sincronização tratam operações de leitura, gravação e invalidação em `try/catch`. Caso o Redis oscile ou atinja limites de requisição temporários, a aplicação emite um log estruturado em `warn` e busca as métricas diretamente no PostgreSQL, garantindo que o usuário final nunca receba erro 500 por instabilidade no cache.

### Projeção Restrita e Segurança por Padrão (Secure by Default) no TypeORM
O comportamento padrão de ORMs (trazer todas as colunas da entidade via `SELECT *`) pode gerar vazamento acidental de credenciais criptografadas em endpoints públicos (ex: `findBySlug`), além de expor dados relacionais internos multi-tenant (`user_id` em listagens de scrobbles). Para mitigar isso:
- A entidade `User` marca tokens com `@Column({ select: false })`, exigindo projeção explícita apenas no pipeline de refresh e autenticação (`SpotifyService.getUser`).
- O boot da aplicação (`SyncService.onModuleInit`) projeta estritamente `{ id: true }`, evitando carregar dados volumosos para o heap de memória da aplicação.
- Listagens de faixas recentes projetam estritamente as propriedades visuais da faixa e a chave necessária para o React (`id`), descartando o `userId`.

### Deduplicação de Scrobbles em Lote (Batch Dedup)
O endpoint do Spotify retorna até 50 faixas recentes por consulta. Em vez de emitir até 50 queries sequenciais individuais ao PostgreSQL para verificar existência (`findOne`/`existsBy`), o worker extrai os timestamps recebidos e realiza uma única busca em lote via `In(playedAts)`. O matching é resolvido em memória em tempo $O(1)$ através de um `Set`, reduzindo o tráfego de rede entre a aplicação e o banco e acelerando a execução dos jobs do BullMQ.

---

## Testes

O projeto inclui testes unitários (Jest) com cobertura dos componentes críticos:

- `src/common/utils/slug.util.spec.ts` — Geração e validação de slugs
- `src/common/encryption/encryption.service.spec.ts` — Criptografia AES-256-GCM
- `src/app.controller.spec.ts` — Controller principal
- `src/sync/sync.processor.spec.ts` — Processador de sync BullMQ com batch dedup
- `src/sync/sync.service.spec.ts` — Inicialização de agendamentos e projeção restrita de usuários
- `src/stats/stats.service.spec.ts` — Projeção sanitizada de scrobbles recentes
- `src/public/public.controller.spec.ts` — Rotas públicas com cache e tratamento de perfis

Os testes utilizam mocks tipados e cobrem caminhos felizes e edge cases. Execute com `npm run test` (local) ou `npm run test:cov` para cobertura detalhada.

---

## Endpoints

### Auth
```
GET /api/auth/login      → inicia fluxo OAuth, redireciona pro Spotify
GET /api/auth/callback   → callback do Spotify, salva tokens, seta JWT cookie
GET /api/auth/me         → verifica sessão ativa, retorna slug
GET /api/auth/logout     → limpa cookie de sessão
```

### Stats (requer JWT)
```
GET /api/stats/overview?range=month
GET /api/stats/top-tracks?range=month&limit=10
GET /api/stats/top-artists?range=month&limit=10
GET /api/stats/activity/hours?range=month
GET /api/stats/activity/days?range=month
GET /api/stats/activity/timeline?range=month
GET /api/stats/recent?limit=20
```

### Public (sem autenticação)
```
GET /api/public/profile/:slug
GET /api/public/profile/:slug/overview?range=month
GET /api/public/profile/:slug/recent?limit=20
GET /api/public/profile/:slug/hours?range=month
```

**Valores válidos para `range`:** `week` | `month` | `3months` | `6months` | `year` | `all`

---

## Segurança

| Camada | Implementação |
|--------|--------------|
| Tokens em repouso | AES-256-GCM com IV aleatório por operação |
| OAuth | PKCE S256 — sem client_secret no fluxo |
| CSRF | state no Redis com TTL 5min, deletado após uso |
| Sessão | JWT em cookie httpOnly + secure + sameSite |
| Rotas | AuthGuard em todas as rotas privadas |
| Rate limiting | @nestjs/throttler — 60 req/min por IP |
| Headers | Helmet — CSP, HSTS, X-Frame-Options |
| CORS | Whitelist de origens explícitas |
| Schema | synchronize: false em produção |

---

## Rodando localmente

### Pré-requisitos
- Node.js 20+
- Docker

### Setup

```bash
git clone https://gitlab.com/caritas-html/wholehearted-stats-api
cd wholehearted-stats-api
npm install
```

Cria o `.env`:
```env
SPOTIFY_CLIENT_ID=seu_client_id
SPOTIFY_CLIENT_SECRET=seu_client_secret
SPOTIFY_REDIRECT_URI=http://127.0.0.1:3001/api/auth/callback

SESSION_SECRET=   # openssl rand -hex 32
ENCRYPTION_KEY=   # openssl rand -hex 32
JWT_SECRET=       # openssl rand -hex 32

POSTGRES_USER=spotify_user
POSTGRES_PASSWORD=spotify_pass
POSTGRES_DB=spotify_lastfm
POSTGRES_PORT=5433
DATABASE_URL=postgresql://spotify_user:spotify_pass@localhost:5433/spotify_lastfm

REDIS_PORT=6380
REDIS_URL=redis://localhost:6380

FRONTEND_URL=http://127.0.0.1:3000
NODE_ENV=development
PORT=3001
```

Inicia os containers:
```bash
docker compose up -d
npm run start:dev
```

Faz o login OAuth uma vez:
```
http://127.0.0.1:3001/api/auth/login
```

---

## Variáveis de ambiente (produção)

| Variável | Descrição |
|----------|-----------|
| SPOTIFY_CLIENT_ID | Client ID do Spotify Developer |
| SPOTIFY_CLIENT_SECRET | Client Secret do Spotify Developer |
| SPOTIFY_REDIRECT_URI | URL de callback registrada no Spotify |
| SESSION_SECRET | Secret de sessão (32 bytes hex) |
| ENCRYPTION_KEY | Chave AES-256 para tokens (32 bytes hex) |
| JWT_SECRET | Secret para assinar JWTs (32 bytes hex) |
| DATABASE_URL | Connection string PostgreSQL |
| REDIS_URL | Connection string Redis |
| FRONTEND_URL | URL do frontend (CORS) |
| LOG_LEVEL | Nível mínimo do Pino (`debug`, `info`, `warn`, `error` — padrão `info` em prod) |
| NODE_ENV | production |
| PORT | Porta do servidor |

---

## Repositórios

| Projeto | URL |
|---------|-----|
| API (backend) | https://gitlab.com/caritas-html/spotify-charts |
| Web (frontend) | https://gitlab.com/caritas-html/spotify-lastfm-web |