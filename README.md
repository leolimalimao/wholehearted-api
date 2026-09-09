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
│  │         Upstash (Redis)          │               │
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
3. A cada 5min: `GET /me/player/recently-played`
4. Compara com cursor (último scrobble salvo)
5. Persiste apenas músicas novas com `userId`
6. Dorme 5 minutos → repete indefinidamente

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
| Filas | BullMQ + Redis (Upstash) | Jobs persistentes, retry automático, por usuário |
| Auth | OAuth 2.0 + PKCE + JWT | Sem client_secret exposto, sessão stateless |
| Criptografia | AES-256-GCM | Tokens em repouso nunca em texto puro |
| Deploy | Railway | Processo contínuo — BullMQ não funciona em serverless |
| Testes | Jest | Unit tests com mocks tipados |
| Logging | Pino + nestjs-pino | Structured logging em production |

---

## Módulos

### AuthModule
OAuth Authorization Code + PKCE completo. O state anti-CSRF e o codeVerifier do PKCE são armazenados temporariamente no Redis (TTL 5min) em vez de cookies — solução para o problema de SameSite em contexto cross-origin em produção. Após o callback, gera JWT com `userId` e `slug` e seta cookie httpOnly.

### SpotifyModule
Client wrapper — único ponto de contato com a Spotify API. Gerencia refresh automático do access_token com buffer de 60 segundos antes da expiração, retry automático respeitando o header `Retry-After` em caso de rate limit 429, e descriptografia de tokens em memória (nunca persistidos em texto puro).

### SyncModule
Um job BullMQ repetível por usuário, registrado no momento do login. Usa o timestamp do scrobble mais recente como cursor para o parâmetro `after`, garantindo que apenas músicas novas sejam processadas. Dedup por índice único `(track_spotify_id, played_at, user_id)` — duas camadas de proteção contra duplicata.

### StatsModule
Endpoints de agregação protegidos por `AuthGuard`. `userId` extraído do JWT — sem query ao banco por request. QueryBuilder TypeORM com `GROUP BY`, `COUNT`, `EXTRACT`, `DATE_TRUNC` e timezone de São Paulo.

### PublicModule
Rotas sem autenticação para perfis públicos por slug. Usadas pelo Next.js no servidor para gerar Open Graph e pelo ProfileDashboard client-side.

### LoggerModule
Structured logging com Pino. Dual transport: pretty-print em dev, JSON em produção. Correlação de requests via `AsyncLocalStorage` com `requestId` único por HTTP request. Injeção via `@InjectPinoLogger()`.

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

### Preparação para multi-tenant sem reescrever
Todo método do `StatsService` recebe `userId` como primeiro parâmetro desde o início. O `AuthGuard` extrai o `userId` do JWT — sem query ao banco por request. Quando um novo usuário faz login, um job BullMQ é registrado especificamente para ele. A mudança para multi-tenant completo foi cirúrgica: dois arquivos alterados, nenhuma regra de negócio reescrita.

---

## Testes

O projeto inclui testes unitários (Jest) com cobertura dos componentes críticos:

- `src/common/utils/slug.util.spec.ts` — Geração e validação de slugs
- `src/common/encryption/encryption.service.spec.ts` — Criptografia AES-256-GCM
- `src/app.controller.spec.ts` — Controller principal
- `src/sync/sync.processor.spec.ts` — Processador de sync BullMQ

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
| NODE_ENV | production |
| PORT | Porta do servidor |

---

## Repositórios

| Projeto | URL |
|---------|-----|
| API (backend) | https://gitlab.com/caritas-html/spotify-charts |
| Web (frontend) | https://gitlab.com/caritas-html/spotify-lastfm-web |